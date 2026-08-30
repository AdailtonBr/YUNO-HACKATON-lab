/**
 * Integração da vertical de energia: Autoridade + as três comercializadoras.
 *
 * O que o `freeze.test.js` prova em memória, este prova atravessando a rede:
 * a loja atesta a própria oferta, a Autoridade enriquece com o que a loja não
 * pode atestar, o motor decide, e o resultado volta pela loja.
 *
 * As três recusas da demo estão aqui, e cada uma cai por um motivo diferente —
 * é isso que separa "o mandato funciona" de "o mandato governa o agente".
 */

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
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

let mongod, authority, authorityUrl;
const stores = {};

const PRICE = { volt_andina: 24400, cerrado_power: 23100, helios_trading: 25300 };
const PRODUCT = { volt_andina: "VOLT-SECO-2027", cerrado_power: "CERR-SECO-2027", helios_trading: "HELI-SECO-2027" };
const VOLUME = 42000;

const listen = (app) => new Promise((r) => { const s = app.listen(0, () => r(s)); });

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri("energy_test"));

  authority = await listen(buildApp());
  authorityUrl = `http://127.0.0.1:${authority.address().port}`;

  for (const key of Object.keys(STORES)) {
    const srv = await listen(buildStore({ ...STORES[key], authorityUrl }));
    stores[key] = { srv, url: `http://127.0.0.1:${srv.address().port}` };
  }
});

after(async () => {
  authority?.close();
  Object.values(stores).forEach((s) => s.srv.close());
  await mongoose.disconnect();
  await mongod?.stop();
});

beforeEach(async () => {
  await Promise.all(
    [Mandate, Approval, AuditLog, Merchant, Agent, UsedNonce, Idempotency,
     Proposal, PaymentMethod, SupplyContract, MarketCurve].map((m) => m.deleteMany({}))
  );
  await seed();
});

/* ------------------------------- helpers ------------------------------- */

const asHuman = { "content-type": "application/json", "x-human-id": DEMO.humanId };

const post = (path, body, headers = asHuman) =>
  fetch(`${authorityUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body ?? {}) });

/** A moldura da diretoria. */
async function umbrella(over = {}) {
  const r = await post("/mandates", {
    agentId: DEMO.agentId,
    paymentMethodId: "pm_aurora_liquidacao",
    ...UMBRELLA_DRAFT,
    expiresAt: UMBRELLA_DRAFT.expiresAt.toISOString(),
    ...over,
  });
  return (await r.json()).mandateId;
}

/** O operacional do gestor, derivado dela. */
async function operational(parentId, over = {}) {
  const r = await post(`/mandates/${parentId}/derive`, {
    ...OPERATIONAL_DRAFT,
    expiresAt: OPERATIONAL_DRAFT.expiresAt.toISOString(),
    ...over,
  });
  return { status: r.status, body: await r.json() };
}

/** Uma tentativa de contratação, atravessando a loja de verdade. */
async function buy(storeKey, mandateId, over = {}) {
  const price = over.price ?? PRICE[storeKey];
  const quantity = over.quantity ?? VOLUME;
  const productId = over.productId ?? PRODUCT[storeKey];

  const purchaseTicket = issueTicket(
    {
      agentId: DEMO.agentId, mandateId, merchantId: storeKey, productId,
      price, quantity, total: price * quantity, currency: "BRL",
    },
    DEMO.agentSecret
  );

  const r = await fetch(`${stores[storeKey].url}/buy`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productId, quantity, mandateId, purchaseTicket, idempotencyKey: newNonce() }),
  });
  return r.json();
}

/* --------------------- as três decisões da demo --------------------- */

test("VOLT ANDINA: passa as regras duras e ESCALA pela alcada", async () => {
  const parent = await umbrella();
  const { body } = await operational(parent);
  const r = await buy("volt_andina", body.mandateId);

  assert.equal(r.ok, false);
  assert.equal(r.action, "escalate");
  assert.equal(r.reason.params.attr, "economia_liquida_brl");
  // R$210.000 de economia liquida, contra um teto de alcada de R$50.000.
  assert.equal(r.reason.params.actual, 21000000);
});

test("CERRADO POWER: melhor preco de todos, recusada pelo RATING", async () => {
  const parent = await umbrella();
  const { body } = await operational(parent);
  const r = await buy("cerrado_power", body.mandateId);

  assert.equal(r.ok, false);
  assert.equal(r.action, "reject");
  assert.equal(r.reason.params.attr, "rating");
  // BB, e o rating NAO veio da oferta: veio da allow-list da Autoridade.
  assert.equal(r.reason.params.actual, "BB");
});

test("HELIOS TRADING: a comissao embutida derruba antes de qualquer outra coisa", async () => {
  const parent = await umbrella();
  const { body } = await operational(parent);
  const r = await buy("helios_trading", body.mandateId);

  assert.equal(r.ok, false);
  assert.equal(r.action, "reject");
  assert.equal(r.reason.params.attr, "comissao_terceiro");
  assert.equal(r.reason.params.actual, 1400);
});

test("o enriquecimento chega ao trilho: curva, multa e economia ficam gravadas", async () => {
  const parent = await umbrella();
  const { body } = await operational(parent);
  await buy("volt_andina", body.mandateId);

  const entry = await AuditLog.findOne({ mandateId: body.mandateId, event: "purchase_decision" }).lean();
  const a = entry.purchase.attributes;
  assert.equal(a.curva_ref_brl_mwh, 24900);
  assert.equal(a.multa_rescisoria_brl, 79800000);
  assert.equal(a.economia_liquida_brl, 21000000);
  // Sem isto, a disputa nao teria como refazer a conta meses depois.
  assert.equal(a.desconto_vs_curva_pct, 2.01);
});

/* ----------------- o que a Autoridade recusa antes do motor ----------------- */

test("preco efetivo que nao fecha com a decomposicao e recusado", async () => {
  const parent = await umbrella();
  const { body } = await operational(parent);

  // Uma loja que anuncia 239, declara 0 de comissao e cobra 253.  A conta nao
  // fecha, e a Autoridade a refaz -- e o mesmo idioma do total_mismatch.
  const price = 25300;
  const purchase = {
    productId: "VOLT-SECO-2027", name: "forjada", price, quantity: VOLUME,
    total: price * VOLUME, currency: "BRL",
    attributes: {
      productId: "VOLT-SECO-2027", preco_energia: 23900, comissao_terceiro: 0,
      submercado: "SECO", fonte: "convencional", estrutura_preco: "fixo",
      periodo_suprimento: "2027-01/2027-12", prazo_meses: 12,
      flexibilidade_pct: 10, take_or_pay_pct: 90, operacao: "novo_contrato",
      price, quantity: VOLUME, total: price * VOLUME,
    },
  };
  const purchaseTicket = issueTicket(
    { agentId: DEMO.agentId, mandateId: body.mandateId, merchantId: "volt_andina",
      productId: "VOLT-SECO-2027", price, quantity: VOLUME, total: price * VOLUME, currency: "BRL" },
    DEMO.agentSecret
  );

  const r = await post(
    "/introspect",
    { mandateId: body.mandateId, purchase, purchaseTicket, idempotencyKey: newNonce() },
    { "content-type": "application/json", "x-api-key": "demo-key-volt" }
  ).then((x) => x.json());

  assert.equal(r.valid, false);
  assert.equal(r.reason.code, "commission_math_mismatch");
});

test("sem contrato vigente nao ha contra o que comparar", async () => {
  const parent = await umbrella();
  const { body } = await operational(parent);
  await SupplyContract.deleteMany({});

  const r = await buy("volt_andina", body.mandateId);
  assert.equal(r.reason.code, "no_active_contract");
});

test("sem curva do submercado, a compra nao acontece", async () => {
  const parent = await umbrella();
  const { body } = await operational(parent);
  await MarketCurve.deleteMany({});

  const r = await buy("volt_andina", body.mandateId);
  assert.equal(r.reason.code, "unknown_curve");
});

/* ------------------------- a curva e consulta viva ------------------------- */

test("A CURVA MUDA E A DECISAO MUDA, sem ninguem tocar no mandato", async () => {
  const parent = await umbrella();
  const { body } = await operational(parent);

  // Com a curva a R$249, a Volt esta 2,01% abaixo do mercado e qualifica.
  const antes = await buy("volt_andina", body.mandateId);
  assert.equal(antes.action, "escalate");

  // O mercado cai para R$246: a mesma oferta passa a estar so 0,65% abaixo.
  // Nada no mandato mudou -- mudou o mundo contra o qual ele e lido.
  const patch = await fetch(`${authorityUrl}/curves/SECO`, {
    method: "PATCH", headers: asHuman,
    body: JSON.stringify({ periodo: "2027", precoBrlMwh: 24600 }),
  });
  assert.equal(patch.status, 200);

  const depois = await buy("volt_andina", body.mandateId);
  assert.equal(depois.action, "reject");
  assert.equal(depois.reason.params.attr, "desconto_vs_curva_pct");
});

/* ------------------------------- supersede ------------------------------- */

test("APERTAR O TETO nao edita mandato: emite versao 2 e revoga a 1", async () => {
  const parent = await umbrella();
  const { body } = await operational(parent);

  const apertado = OPERATIONAL_DRAFT.constraints.map((c) =>
    c.attr === "desconto_vs_curva_pct" ? { ...c, value: 5.0 } : c
  );
  const r = await post(`/mandates/${body.mandateId}/supersede`, {
    constraints: apertado,
    expiresAt: OPERATIONAL_DRAFT.expiresAt.toISOString(),
  }).then((x) => x.json());

  assert.equal(r.version, 2);
  assert.equal(r.supersedes, body.mandateId);

  // A versao 1 morreu, e morreu como revogada -- nao foi apagada.
  const v1 = await Mandate.findById(body.mandateId).lean();
  assert.equal(v1.revoked, true);

  // E sob a versao 2 a Volt Andina (2,01% abaixo) deixa de qualificar.
  const depois = await buy("volt_andina", r.mandateId);
  assert.equal(depois.action, "reject");
  assert.equal(depois.reason.params.attr, "desconto_vs_curva_pct");
});

/* ------------------------------- hierarquia ------------------------------- */

test("REVOGAR O GUARDA-CHUVA mata o operacional, e a recusa nomeia o pai", async () => {
  const parent = await umbrella();
  const { body } = await operational(parent);

  assert.equal((await buy("volt_andina", body.mandateId)).action, "escalate");

  await post(`/mandates/${parent}/revoke`);

  const depois = await buy("volt_andina", body.mandateId);
  assert.equal(depois.action, "reject");
  assert.equal(depois.reason.code, "parent_revoked");
  // Aponta o dedo: "por que este mandato parou de valer?" merece resposta.
  assert.equal(depois.reason.params.parent, parent);

  // E o filho continua com a propria flag intacta: quem morreu foi a moldura.
  const child = await Mandate.findById(body.mandateId).lean();
  assert.equal(child.revoked, false);
});

test("um filho nao pode viver mais que o pai", async () => {
  const parent = await umbrella({ expiresAt: "2026-10-31T23:59:59Z" });
  const { status, body } = await operational(parent, { expiresAt: "2026-12-31T23:59:59Z" });
  assert.equal(status, 400);
  assert.equal(body.error, "outlives_parent");
});

test("derivar de um mandato ja revogado nao acontece", async () => {
  const parent = await umbrella();
  await post(`/mandates/${parent}/revoke`);
  const { status, body } = await operational(parent);
  assert.equal(status, 409);
  assert.equal(body.error, "parent_revoked");
});
