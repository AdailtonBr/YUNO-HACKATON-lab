/**
 * Bateria adversarial: 24 ataques, caixa-preta.
 *
 * Nada aqui importa o motor nem chama `evaluate`.  Tudo passa por HTTP, como um
 * atacante teria — e o atacante mais forte que modelamos não é um estranho: é
 * uma **comercializadora registrada**, com apiKey válida, que conhece o
 * `mandateId` e o `agentId` de uma compra que ela mesma atendeu.
 *
 * Cada teste nomeia o ataque e o código exato da recusa.  Quando um ataque cai
 * numa porta diferente da esperada, o teste diz qual — porque "foi barrado" e
 * "foi barrado por onde eu achava" são fatos diferentes, e a diferença ensina.
 */

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import { buildApp } from "../src/app.js";
import { seed, DEMO, UMBRELLA_DRAFT, OPERATIONAL_DRAFT } from "../src/seed.js";
import { buildStore } from "../../app2/src/store.js";
import { STORES } from "../../app2/src/catalogs.js";
import { issueTicket, newNonce } from "../src/authority/ticket.js";
import {
  Mandate, Approval, AuditLog, Merchant, Agent, UsedNonce, Idempotency,
  Proposal, PaymentMethod, SupplyContract, MarketCurve,
} from "../src/authority/models.js";

let mongod, authority, A, mandateId;
const stores = {};

const KEY = { volt_andina: "demo-key-volt", cerrado_power: "demo-key-cerrado" };
const OFERTA = { productId: "VOLT-SECO-2027", price: 24400, quantity: 42000 };
const VOL = OFERTA.quantity;

const HUMANO = { "content-type": "application/json", "x-human-id": DEMO.humanId };
const OUTRO = { "content-type": "application/json", "x-human-id": "user_intruso" };

const listen = (app) => new Promise((r) => { const s = app.listen(0, () => r(s)); });

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri("adversarial_test"));
  authority = await listen(buildApp());
  A = `http://127.0.0.1:${authority.address().port}`;
  for (const key of Object.keys(STORES)) {
    const srv = await listen(buildStore({ ...STORES[key], authorityUrl: A }));
    stores[key] = srv;
  }
});

after(async () => {
  authority?.close();
  Object.values(stores).forEach((s) => s.close());
  await mongoose.disconnect();
  await mongod?.stop();
});

const post = (path, body, headers = HUMANO) =>
  fetch(`${A}${path}`, { method: "POST", headers, body: JSON.stringify(body ?? {}) })
    .then((r) => r.json().then((j) => ({ status: r.status, body: j })).catch(() => ({ status: r.status, body: null })));

beforeEach(async () => {
  await Promise.all(
    [Mandate, Approval, AuditLog, Merchant, Agent, UsedNonce, Idempotency,
     Proposal, PaymentMethod, SupplyContract, MarketCurve].map((m) => m.deleteMany({}))
  );
  await seed();
  const pai = await post("/mandates", {
    agentId: DEMO.agentId, paymentMethodId: "pm_aurora_liquidacao",
    ...UMBRELLA_DRAFT, expiresAt: UMBRELLA_DRAFT.expiresAt.toISOString(),
  });
  const filho = await post(`/mandates/${pai.body.mandateId}/derive`, {
    ...OPERATIONAL_DRAFT, expiresAt: OPERATIONAL_DRAFT.expiresAt.toISOString(),
  });
  mandateId = filho.body.mandateId;
});

/* ------------------------------- utilitários ------------------------------- */

/** A compra como a loja honesta a montaria — e os pontos onde ela pode mentir. */
const compra = (over = {}) => {
  const price = over.price ?? OFERTA.price;
  const quantity = over.quantity ?? VOL;
  const total = over.total ?? price * quantity;
  const productId = over.productId ?? OFERTA.productId;
  const attrs = {
    productId, preco_energia: price, comissao_terceiro: 0,
    submercado: "SECO", fonte: "convencional", estrutura_preco: "fixo",
    periodo_suprimento: "2027-01/2027-12", prazo_meses: 12,
    flexibilidade_pct: 10, take_or_pay_pct: 90, operacao: "novo_contrato",
    ...(over.attributes ?? {}),
  };
  return { productId, name: "oferta", price, quantity, total, currency: "BRL",
    attributes: { ...attrs, price, quantity, total } };
};

const bilhete = (over = {}, segredo = DEMO.agentSecret) =>
  issueTicket({
    agentId: over.agentId ?? DEMO.agentId,
    mandateId: over.mandateId ?? mandateId,
    merchantId: over.merchantId ?? "volt_andina",
    productId: over.productId ?? OFERTA.productId,
    price: over.price ?? OFERTA.price,
    quantity: over.quantity ?? VOL,
    total: over.total ?? (over.price ?? OFERTA.price) * (over.quantity ?? VOL),
    currency: "BRL",
  }, segredo, over.opts ?? {});

/** Fala com /introspect COMO UMA LOJA REGISTRADA — o atacante mais forte. */
const comoLoja = (loja, purchase, purchaseTicket, mid = mandateId) =>
  post("/introspect", { mandateId: mid, purchase, purchaseTicket, idempotencyKey: newNonce() },
    { "content-type": "application/json", "x-api-key": KEY[loja] });

const codigo = (r) => r.body?.reason?.code ?? r.body?.error ?? (r.body?.valid ? "PASSOU" : null);

/* ======================= 1-6 · identidade do agente ======================= */

test("1 · agente NAO REGISTRADO assina e tenta comprar", async () => {
  const r = await comoLoja("volt_andina", compra(), bilhete({ agentId: "agent_fantasma" }, "qualquer"));
  assert.equal(codigo(r), "unknown_agent");
});

test("2 · nome certo, segredo chutado — saber o nome nao e saber assinar", async () => {
  const r = await comoLoja("volt_andina", compra(), bilhete({}, "segredo-errado"));
  assert.equal(codigo(r), "ticket_bad_signature");
});

test("3 · payload adulterado DEPOIS de assinado (baixa o preco)", async () => {
  const [p, sig] = bilhete().split(".");
  const obj = JSON.parse(Buffer.from(p, "base64url").toString());
  obj.price = 1;
  const forjado = Buffer.from(JSON.stringify(obj)).toString("base64url") + "." + sig;
  const r = await comoLoja("volt_andina", compra({ price: 1 }), forjado);
  assert.equal(codigo(r), "ticket_bad_signature");
});

test("4 · campo EXTRA no payload, assinado corretamente", async () => {
  // Sem a exigencia de forma canonica, este campo passaria: a assinatura sobre
  // a forma canonica fecharia, e o extra chegaria intacto a quem lesse depois.
  const obj = {
    agentId: DEMO.agentId, mandateId, merchantId: "volt_andina", productId: OFERTA.productId,
    price: OFERTA.price, quantity: VOL, total: OFERTA.price * VOL, currency: "BRL",
    nonce: newNonce(), iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 120,
    superPoderes: true,
  };
  const enc = Buffer.from(JSON.stringify(obj)).toString("base64url");
  const sig = crypto.createHmac("sha256", DEMO.agentSecret).update(enc).digest("base64url");
  const r = await comoLoja("volt_andina", compra(), `${enc}.${sig}`);
  assert.equal(codigo(r), "ticket_malformed");
});

test("5 · bilhete expirado", async () => {
  const r = await comoLoja("volt_andina", compra(), bilhete({ opts: { ttlSeconds: -60 } }));
  assert.equal(codigo(r), "ticket_expired");
});

test("6 · bilhete da Volt apresentado na Cerrado", async () => {
  const r = await comoLoja("cerrado_power", compra(), bilhete({ merchantId: "volt_andina" }));
  assert.equal(codigo(r), "ticket_merchant_mismatch");
});

/* ============== 7-12 · a loja REGISTRADA como atacante ============== */

test("7 · a loja INFLA o preco atestado acima do que o agente assinou", async () => {
  const r = await comoLoja("volt_andina", compra({ price: 24900 }), bilhete({ price: 24400 }));
  assert.equal(codigo(r), "ticket_price_mismatch");
});

test("8 · a loja MULTIPLICA o volume: 42.000 assinados viram 84.000", async () => {
  const r = await comoLoja("volt_andina", compra({ quantity: 84000 }), bilhete({ quantity: VOL }));
  assert.equal(codigo(r), "ticket_quantity_mismatch");
});

test("9 · a loja afirma um total que nao fecha com preco x volume", async () => {
  const r = await comoLoja("volt_andina", compra({ total: 1 }), bilhete());
  assert.equal(codigo(r), "ticket_total_mismatch");
});

test("10 · a loja ESCONDE a comissao: preco != energia + comissao", async () => {
  const r = await comoLoja("volt_andina",
    compra({ attributes: { preco_energia: 23000, comissao_terceiro: 0 } }), bilhete());
  assert.equal(codigo(r), "commission_math_mismatch");
});

test("11 · a Cerrado (rating BB) declara o PROPRIO rating como AAA", async () => {
  // A Autoridade sobrescreve: quem atesta a contraparte e ela, a partir da
  // allow-list.  A vendedora e a ultima parte que deveria declarar o proprio
  // risco de credito.
  const r = await comoLoja("cerrado_power",
    compra({ productId: "CERR-SECO-2027", price: 23100, attributes: { rating: "AAA", garantia: true } }),
    bilhete({ merchantId: "cerrado_power", productId: "CERR-SECO-2027", price: 23100 }));
  assert.equal(codigo(r), "constraint_failed");
  assert.equal(r.body.reason.params.attr, "rating");
  assert.equal(r.body.reason.params.actual, "BB");
});

test("12 · loja NAO CREDENCIADA chama /introspect", async () => {
  const r = await post("/introspect",
    { mandateId, purchase: compra(), purchaseTicket: bilhete(), idempotencyKey: newNonce() },
    { "content-type": "application/json", "x-api-key": "chave-inventada" });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, "unknown_merchant");
});

/* ======================== 13 · replay ======================== */

test("13 · replay do MESMO bilhete, depois de uma compra concluida", async () => {
  // O nonce so queima na operacao atomica que EFETIVA a compra.  Uma escalada
  // nao consome nada, de proposito: o agente precisa retentar com o mesmo
  // bilhete depois do sim do humano.  Entao o replay so existe apos um desfecho.
  const m = await post("/mandates", {
    agentId: DEMO.agentId, mode: "autonomo", currency: "BRL",
    paymentMethodId: "pm_aurora_liquidacao", maxUses: 5,
    expiresAt: "2026-12-31T23:59:59Z",
    constraints: [{ attr: "total", op: "lte", value: 2000000000 }],
  });
  const id = m.body.mandateId;
  const t = bilhete({ mandateId: id });

  const primeira = await comoLoja("volt_andina", compra(), t, id);
  assert.equal(primeira.body.valid, true, "a primeira tem que concluir");

  const segunda = await comoLoja("volt_andina", compra(), t, id);
  assert.equal(codigo(segunda), "ticket_replayed");
});

/* ============ 14-18 · isolamento entre titulares ============ */

test("14 · intruso emite mandato para o agente da Aurora", async () => {
  const conta = await post("/wallet/methods",
    { rail: "pix", instrument: { key: "intruso@exemplo.com" } }, OUTRO);
  const m = await post("/mandates", {
    agentId: DEMO.agentId, mode: "autonomo", currency: "BRL",
    paymentMethodId: conta.body.methodId, maxUses: 1,
    expiresAt: "2026-12-31T23:59:59Z", constraints: [],
  }, OUTRO);
  assert.equal(m.body.error, "not_your_agent");
});

test("15 · intruso emite mandato pagando com a CONTA da Aurora", async () => {
  const m = await post("/mandates", {
    agentId: "agent_intruso", mode: "autonomo", currency: "BRL",
    paymentMethodId: "pm_aurora_liquidacao", maxUses: 1,
    expiresAt: "2026-12-31T23:59:59Z", constraints: [],
  }, OUTRO);
  assert.equal(m.body.error, "unknown_payment_method");
});

test("16 · intruso le o trilho de um mandato da Aurora que ele conhece o id", async () => {
  const r = await fetch(`${A}/audit?mandateId=${mandateId}`, { headers: OUTRO }).then((x) => x.json());
  assert.deepEqual(r, [], "um id conhecido nao pode virar janela para o trilho alheio");
});

test("17 · trilho sem sessao nenhuma", async () => {
  assert.equal((await fetch(`${A}/audit`)).status, 401);
});

test("18 · intruso lista os mandatos da Aurora, e revoga um deles", async () => {
  assert.deepEqual(await fetch(`${A}/mandates`, { headers: OUTRO }).then((x) => x.json()), []);
  const r = await post(`/mandates/${mandateId}/revoke`, {}, OUTRO);
  assert.equal(r.status, 404);
  const vivo = await Mandate.findById(mandateId).lean();
  assert.equal(vivo.revoked, false, "o mandato da Aurora nao pode ter sido tocado");
});

/* ============ 19-20 · vazamento do instrumento ============ */

test("19 · o paymentMethodRef nao sai na carteira", async () => {
  const bruto = await fetch(`${A}/wallet/methods`, { headers: HUMANO }).then((x) => x.text());
  assert.ok(!bruto.includes("paymentMethodRef"), bruto);
  assert.ok(!bruto.includes(DEMO.paymentRef), "o ponteiro em si nao pode aparecer");
});

test("20 · o paymentMethodRef nao sai no mandato", async () => {
  const bruto = await fetch(`${A}/mandates`, { headers: HUMANO }).then((x) => x.text());
  assert.ok(!bruto.includes("paymentMethodRef"), bruto);
  assert.ok(!bruto.includes(DEMO.paymentRef));
});

/* ============ 21-24 · estado vivo e enumeracao ============ */

test("21 · compra sob mandato REVOGADO", async () => {
  await post(`/mandates/${mandateId}/revoke`);
  const r = await comoLoja("volt_andina", compra(), bilhete());
  assert.equal(codigo(r), "revoked");
});

test("22 · compra sob mandato cujo PAI foi revogado", async () => {
  const filho = await Mandate.findById(mandateId).lean();
  await post(`/mandates/${filho.parentMandateId}/revoke`);
  const r = await comoLoja("volt_andina", compra(), bilhete());
  assert.equal(codigo(r), "parent_revoked");
  assert.equal(r.body.reason.params.parent, filho.parentMandateId);
});

test("23 · enumeracao: adivinhar um mandateId", async () => {
  const inventado = "mnd_0000000000000000";
  const r = await comoLoja("volt_andina", compra(), bilhete({ mandateId: inventado }), inventado);
  assert.equal(codigo(r), "unknown_mandate");
});

test("24 · o sim humano vale UMA vez, nao vira cheque em branco", async () => {
  const primeira = await comoLoja("volt_andina", compra(), bilhete());
  assert.equal(primeira.body.action, "escalate");

  const pend = await fetch(`${A}/approvals`, { headers: HUMANO }).then((x) => x.json());
  await post(`/approvals/${pend[0].approvalId}/approve`);

  const concluiu = await comoLoja("volt_andina", compra(), bilhete());
  assert.equal(concluiu.body.valid, true);

  const denovo = await comoLoja("volt_andina", compra(), bilhete());
  assert.equal(denovo.body.action, "escalate", "a mesma aprovacao nao pode servir duas vezes");
});
