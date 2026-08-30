/**
 * Os dois elos que a vertical de energia acrescenta à cadeia da disputa.
 *
 * `delegation_valid` — quem emitiu este mandato tinha poderes para emiti-lo?
 *   É a pergunta que o caso pessoal nunca precisou fazer. Numa empresa, o
 *   gestor opera dentro de uma moldura que a diretoria abriu; se a moldura não
 *   existia, ou já tinha sido retirada, o que ele assinou não compromete ninguém.
 *
 * `curve_at_decision` — o número que decidiu é o número que ficou no registro?
 *   O mandato limita o desconto contra o mercado, então a decisão pendura-se
 *   num número externo que muda todo dia. Congelamos a curva usada; aqui a
 *   conta é refeita a partir dela.
 *
 * Puros: o veredito sai do trilho, e o trilho é só dado.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { resolveDispute } from "../src/authority/dispute.js";

const T0 = "2026-08-29T09:00:00Z"; // a diretoria abre a moldura
const T1 = "2026-08-29T10:00:00Z"; // o gestor emite o operacional
const T2 = "2026-08-29T11:00:00Z"; // a compra
const T3 = "2026-08-29T12:00:00Z"; // depois

const CURVA = 24900;
const PRECO = 24400;
const VOLUME = 42000;

const parent = (over = {}) => ({
  _id: "mnd_guarda_chuva",
  humanId: "user_aurora",
  agentId: "agent_aurora",
  humanReadable: "In submarket SECO, spend at most R$11,000,000.00 in total.",
  ...over,
});

const mandate = (over = {}) => ({
  _id: "mnd_operacional",
  humanId: "user_aurora",
  agentId: "agent_aurora",
  mode: "autonomo",
  parentMandateId: "mnd_guarda_chuva",
  humanReadable: "At least 2% below the market curve.",
  constraints: [{ attr: "desconto_vs_curva_pct", op: "gte", value: 2.0 }],
  ...over,
});

const purchase = (over = {}) => ({
  productId: "VOLT-SECO-2027",
  price: PRECO,
  quantity: VOLUME,
  total: PRECO * VOLUME,
  currency: "BRL",
  attributes: {
    preco_energia: PRECO,
    comissao_terceiro: 0,
    curva_ref_brl_mwh: CURVA,
    desconto_vs_curva_pct: 2.01, // (24900 - 24400) / 24900 * 100
    multa_rescisoria_brl: 79800000,
    economia_liquida_brl: 21000000,
    ...over,
  },
});

const decision = (over = {}) => ({
  _id: "aud_buy",
  ts: T2,
  event: "purchase_decision",
  mandateId: "mnd_operacional",
  merchantId: "volt_andina",
  agentIdAuthenticated: "agent_aurora",
  purchase: purchase(),
  decision: "valido",
  receiptId: "rcpt_1",
  trace: [{ attr: "desconto_vs_curva_pct", op: "gte", value: 2.0, actual: 2.01, verdict: "ok" }],
  ...over,
});

const criadoOperacional = { ts: T1, event: "mandate_created", actor: { type: "human", id: "user_aurora" } };
const criadoPai = { ts: T0, event: "mandate_created", actor: { type: "human", id: "user_aurora" } };
const pago = (p) => ({ ts: T2, event: "payment_result", receiptId: "rcpt_1", purchase: p });

const linkOf = (r, key) => r.evidence.find((e) => e.key === key);

const resolve = (over = {}) => {
  const d = over.disputed ?? decision();
  return resolveDispute(
    d,
    over.trail ?? [criadoOperacional, d, pago(d.purchase)],
    over.mandate ?? mandate(),
    { parent: over.parent === undefined ? parent() : over.parent, parentTrail: over.parentTrail ?? [criadoPai] }
  );
};

/* ---------------------------- a cadeia completa ---------------------------- */

test("cadeia completa, com delegacao e curva: o registro sustenta a cobranca", () => {
  const r = resolve();
  assert.equal(r.verdict, "authorized");
  assert.equal(r.brokenLink, null);
  // Os sete elos, na ordem em que a cadeia se conta.
  assert.deepEqual(r.evidence.map((e) => e.key), [
    "mandate_created",
    "delegation_valid",
    "agent_identity",
    "rules_passed",
    "curve_at_decision",
    "human_approval",
    "charged_what_was_verified",
  ]);
});

/* ------------------------------- a delegacao ------------------------------- */

test("um mandato sem pai nao precisa de delegacao — o elo nao se aplica", () => {
  const r = resolve({ mandate: mandate({ parentMandateId: null }), parent: null, parentTrail: [] });
  assert.equal(r.verdict, "authorized");
  const l = linkOf(r, "delegation_valid");
  assert.equal(l.ok, null); // nao se aplica, e isso nao e uma falha
  assert.equal(l.required, false);
});

test("a moldura da diretoria aparece na evidencia, com os termos que ela aceitou", () => {
  const l = linkOf(resolve(), "delegation_valid");
  assert.equal(l.ok, true);
  assert.equal(l.parentMandateId, "mnd_guarda_chuva");
  assert.equal(l.ts, T0);
  assert.match(l.terms, /SECO/);
});

test("mandato-pai que nao existe: a delegacao NAO se sustenta", () => {
  const r = resolve({ parent: null, parentTrail: [] });
  assert.equal(r.verdict, "not_authorized");
  assert.equal(r.brokenLink, "delegation_valid");
});

test("mandato-pai sem ato humano no trilho: a delegacao NAO se sustenta", () => {
  // O pai existe no banco, mas ninguem registrou tendo-o criado.  Um mandato
  // que apareceu sem ato de gente nao prova delegacao nenhuma.
  const r = resolve({ parentTrail: [] });
  assert.equal(r.verdict, "not_authorized");
  assert.equal(r.brokenLink, "delegation_valid");
});

test("pai REVOGADO antes da compra: a delegacao cai, e a data fica na evidencia", () => {
  const revogado = { ts: T1, event: "mandate_revoked", actor: { type: "human", id: "user_aurora" } };
  const r = resolve({ parentTrail: [criadoPai, revogado] });
  assert.equal(r.verdict, "not_authorized");
  assert.equal(r.brokenLink, "delegation_valid");
  assert.equal(linkOf(r, "delegation_valid").revokedBefore, T1);
});

test("pai revogado DEPOIS da compra nao invalida o que ja tinha acontecido", () => {
  // A ordem importa: retirar a moldura amanha nao desautoriza o que foi
  // comprado ontem sob ela.
  const revogadoDepois = { ts: T3, event: "mandate_revoked", actor: { type: "human", id: "user_aurora" } };
  const r = resolve({ parentTrail: [criadoPai, revogadoDepois] });
  assert.equal(r.verdict, "authorized");
});

/* --------------------------------- a curva --------------------------------- */

test("a conta do desconto e REFEITA a partir da curva congelada, e bate", () => {
  const l = linkOf(resolve(), "curve_at_decision");
  assert.equal(l.ok, true);
  assert.equal(l.curva, CURVA);
  assert.equal(l.registrado, 2.01);
  assert.equal(l.recalculado, 2.01);
});

test("desconto registrado que NAO sai da curva registrada derruba a cobranca", () => {
  // Alguem aprovou contra um mercado diferente do que deixou no registro.
  const d = decision({ purchase: purchase({ desconto_vs_curva_pct: 7.5 }) });
  const r = resolveDispute(d, [criadoOperacional, d, pago(d.purchase)], mandate(), {
    parent: parent(), parentTrail: [criadoPai],
  });
  assert.equal(r.verdict, "not_authorized");
  assert.equal(r.brokenLink, "curve_at_decision");
  assert.equal(linkOf(r, "curve_at_decision").recalculado, 2.01);
});

test("compra que nao e de energia: o elo da curva nao se aplica", () => {
  const d = decision({ purchase: { productId: "TEN-001", price: 9800, attributes: { size: "40" } } });
  const r = resolveDispute(d, [criadoOperacional, d, pago(d.purchase)], mandate(), {
    parent: parent(), parentTrail: [criadoPai],
  });
  const l = linkOf(r, "curve_at_decision");
  assert.equal(l.ok, null);
  assert.equal(l.required, false);
});

/* ------------------------- o que ja valia continua ------------------------- */

test("tentativa recusada nao gera disputa: nao ha o que contestar", () => {
  const d = decision({ decision: "recusado", receiptId: null });
  const r = resolveDispute(d, [criadoOperacional, d], mandate(), { parent: parent(), parentTrail: [criadoPai] });
  assert.equal(r.verdict, "nothing_charged");
  assert.equal(r.charged, null);
});

/* ------------------- a regra dispensada por um sim humano ------------------- */

const dispensada = () =>
  decision({
    trace: [
      { attr: "rating", op: "in", value: ["A-"], actual: "A-", verdict: "ok" },
      { attr: "economia_liquida_brl", op: "lte", value: 5000000, actual: 21000000, verdict: "approved_by_human" },
    ],
  });

const simDoGestor = (p) => ({
  ts: T1,
  event: "approval_granted",
  actor: { type: "human", id: "user_aurora" },
  purchase: { productId: p.productId, price: p.price },
});

test("regra dispensada por um sim humano NAO quebra as regras — migra para a aprovacao", () => {
  const d = dispensada();
  const r = resolveDispute(
    d,
    [criadoOperacional, simDoGestor(d.purchase), d, pago(d.purchase)],
    mandate(),
    { parent: parent(), parentTrail: [criadoPai] }
  );
  assert.equal(r.verdict, "authorized");

  // O elo das regras continua de pe, e diz QUAL regra foi dispensada.
  const regras = linkOf(r, "rules_passed");
  assert.equal(regras.ok, true);
  assert.deepEqual(regras.waived, ["economia_liquida_brl"]);

  // E o elo da aprovacao passou a ser exigido, dizendo por que.
  const aprov = linkOf(r, "human_approval");
  assert.equal(aprov.ok, true);
  assert.equal(aprov.required, true);
  assert.deepEqual(aprov.because, { waived: ["economia_liquida_brl"] });
  assert.equal(aprov.by, "user_aurora");
});

test("regra dispensada SEM o sim registrado: a cobranca NAO se sustenta", () => {
  // E o cenario mais grave possivel: alguem passou por cima de um limite e nao
  // ha, no trilho, ninguem que tenha assumido essa decisao.
  const d = dispensada();
  const r = resolveDispute(d, [criadoOperacional, d, pago(d.purchase)], mandate(), {
    parent: parent(), parentTrail: [criadoPai],
  });
  assert.equal(r.verdict, "not_authorized");
  assert.equal(r.brokenLink, "human_approval");
});
