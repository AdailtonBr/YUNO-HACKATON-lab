/**
 * O teste do CONGELAMENTO (Fase 0).
 *
 * Quatro frentes vão construir em paralelo sobre os contratos congelados em
 * `docs/ENERGY-VOCABULARY.md`.  Se esses contratos não fecharem entre si,
 * o erro só aparece no dia da integração — com quatro pessoas já tendo
 * construído por cima.  Este arquivo existe para que isso não aconteça.
 *
 * O que ele prova, sem rede e sem banco:
 *  - os números da demo batem com o documento de escopo (§6.3);
 *  - as constraints congeladas produzem os três vereditos que a demo precisa;
 *  - a ordem das constraints é a que faz cada recusa dizer a coisa certa;
 *  - o motor NÃO PRECISOU MUDAR para entender energia.
 *
 * Se um destes cair, pare a Fase 1 e conserte o congelamento primeiro.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { evaluate } from "../src/authority/engine.js";
import { derivedAttributes, mtm, diasParaDenuncia } from "../src/authority/energy.js";
import { effectiveStatus } from "../src/authority/hierarchy.js";
import { DEMO, OPERATIONAL_DRAFT, UMBRELLA_DRAFT } from "../src/seed.js";
import { STORES } from "../../app2/src/catalogs.js";

const VOLUME = 42000; // MWh — o remanescente do contrato da Aurora
const NOW = new Date("2026-08-30T12:00:00Z");

/** A oferta como a comercializadora a expõe, pelo adaptador dela. */
const offerOf = (storeKey) => {
  const s = STORES[storeKey];
  return s.toCommon(s.catalog[0]);
};

const merchantOf = (id) => DEMO.merchants.find((m) => m._id === id);

/**
 * Monta a compra exatamente como o sistema real a monta: a loja atesta os
 * atributos do produto, e a AUTORIDADE injeta os derivados por cima.
 */
function purchaseFor(storeKey, quantity = VOLUME) {
  const offer = offerOf(storeKey);
  const { name, price, currency, stock, ...attrs } = offer;
  const total = price * quantity;

  const derived = derivedAttributes({
    offer,
    contract: DEMO.contract,
    curve: DEMO.curve,
    merchant: merchantOf(storeKey),
    quantity,
  });

  return {
    productId: offer.productId,
    name,
    price,
    quantity,
    total,
    currency,
    attributes: { ...attrs, price, quantity, total, ...derived },
    __derived: derived,
  };
}

const mandateFrom = (draft, over = {}) => ({
  _id: "mnd_test",
  humanId: DEMO.humanId,
  agentId: DEMO.agentId,
  usedCount: 0,
  revoked: false,
  parentMandateId: null,
  ...draft,
  ...over,
});

const ctxFor = (mandate, purchase, merchantId) => ({
  ticket: {
    agentId: mandate.agentId,
    mandateId: mandate._id,
    merchantId,
    productId: purchase.productId,
    price: purchase.price,
    quantity: purchase.quantity,
    total: purchase.total,
    currency: purchase.currency,
  },
  authenticatedMerchantId: merchantId,
  approval: null,
  now: NOW,
});

const run = (storeKey, draft = OPERATIONAL_DRAFT, quantity = VOLUME) => {
  const mandate = mandateFrom(draft);
  const purchase = purchaseFor(storeKey, quantity);
  return { purchase, result: evaluate(mandate, purchase, ctxFor(mandate, purchase, storeKey)) };
};

/* ------------------- os números do documento de escopo ------------------- */

test("a multa mark-to-market e a do escopo: R$798.000", () => {
  assert.equal(
    mtm({ pContrato: 26800, pMercado: 24900, volumeRemanescente: VOLUME }),
    79800000
  );
});

test("mercado ACIMA do contrato zera a multa — e o piso nao ressuscita uma multa que nao existe", () => {
  const zero = mtm({ pContrato: 24000, pMercado: 26800, volumeRemanescente: VOLUME, piso: 5000000 });
  assert.equal(zero, 0);
});

test("VOLT ANDINA: economia liquida de R$210.000, como no slide", () => {
  const { purchase } = run("volt_andina");
  assert.equal(purchase.__derived.economia_liquida_brl, 21000000);
  assert.equal(purchase.__derived.multa_rescisoria_brl, 79800000);
  assert.equal(purchase.__derived.desconto_vs_curva_pct, 2.01);
});

test("HELIOS: a comissao embutida vira R$253 efetivos e a economia fica NEGATIVA em R$168.000", () => {
  const offer = offerOf("helios_trading");
  // O comparador ingenuo ve 239; o preco que sai da conta e 253.
  assert.equal(offer.preco_energia, 23900);
  assert.equal(offer.comissao_terceiro, 1400);
  assert.equal(offer.price, 25300);

  const { purchase } = run("helios_trading");
  assert.equal(purchase.__derived.economia_liquida_brl, -16800000);
});

test("a simplificacao do escopo vale: (curva - preco) x volume da a mesma economia", () => {
  // "a economia da troca nao depende do preco do contrato antigo" (§3.2).
  for (const key of ["volt_andina", "cerrado_power", "helios_trading"]) {
    const { purchase } = run(key);
    const atalho = (DEMO.curve.precoBrlMwh - purchase.price) * VOLUME;
    assert.equal(purchase.__derived.economia_liquida_brl, atalho, key);
  }
});

/* --------------------- os tres vereditos que a demo pede -------------------- */

test("VOLT ANDINA passa em todas as regras duras e ESCALA pela alcada", () => {
  const { result } = run("volt_andina");
  assert.equal(result.valid, false);
  assert.equal(result.action, "escalate");
  assert.equal(result.reason.code, "constraint_failed");
  // Escala porque R$210.000 passa do teto de R$50.000 da alcada — nao porque
  // alguma regra dura falhou.
  assert.equal(result.reason.params.attr, "economia_liquida_brl");

  // E a prova de que a alcada foi a ULTIMA a ser avaliada: tudo antes dela
  // passou.  Se uma regra dura tivesse falhado, o motor teria parado antes.
  const antes = result.trace.slice(0, result.trace.length - 1);
  assert.ok(antes.every((t) => t.verdict === "ok"), "toda regra dura deveria ter passado");
});

test("CERRADO POWER tem o MELHOR preco e mesmo assim e recusada — pelo rating", () => {
  const { purchase, result } = run("cerrado_power");
  // O melhor desconto contra a curva de todos os tres.
  assert.ok(purchase.__derived.desconto_vs_curva_pct > 7);
  assert.equal(result.valid, false);
  assert.equal(result.action, "reject");
  assert.equal(result.reason.params.attr, "rating");
});

test("HELIOS e recusada pela COMISSAO, que e a manchete — e o resto fica nao avaliado", () => {
  const { result } = run("helios_trading");
  assert.equal(result.valid, false);
  assert.equal(result.action, "reject");
  assert.equal(result.reason.params.attr, "comissao_terceiro");

  // O motor para na primeira regra que falha, e o trace diz a verdade sobre
  // isso: dizer "ok" sobre o que nao se olhou seria mentira.  Quem mostra a
  // lista inteira de violacoes e a tabela do agente, que e pre-filtro.
  const prazo = result.trace.find((t) => t.attr === "prazo_meses");
  assert.equal(prazo.verdict, "not_evaluated");
});

test("o rating vem da AUTORIDADE, nunca da oferta — a vendedora nao atesta o proprio credito", () => {
  for (const key of Object.keys(STORES)) {
    const offer = offerOf(key);
    assert.equal(offer.rating, undefined, `${key} nao pode declarar o proprio rating`);
    assert.equal(offer.garantia, undefined, `${key} nao pode declarar a propria garantia`);
  }
  const { purchase } = run("volt_andina");
  assert.equal(purchase.attributes.rating, "A-");
  assert.equal(purchase.attributes.garantia, true);
});

/* ------------------------------ risco e escopo ----------------------------- */

test("130% da carga e recusado por COBERTURA, nao por teto de volume", () => {
  const { result } = run("volt_andina", OPERATIONAL_DRAFT, Math.round(VOLUME * 1.3));
  assert.equal(result.valid, false);
  assert.equal(result.reason.params.attr, "cobertura_pct");
});

test("o mandato guarda-chuva aceita a Volt Andina — a moldura da diretoria nao atrapalha", () => {
  const { result } = run("volt_andina", UMBRELLA_DRAFT);
  assert.equal(result.valid, true);
});

test("o motor JA exige teto de total para volume maior que um (D19)", () => {
  const semTotal = {
    ...OPERATIONAL_DRAFT,
    constraints: OPERATIONAL_DRAFT.constraints.filter((c) => c.attr !== "total"),
  };
  const { result } = run("volt_andina", semTotal);
  assert.equal(result.valid, false);
  assert.equal(result.reason.code, "quantity_uncapped");
});

/* -------------------------------- hierarquia ------------------------------- */

test("revogar o guarda-chuva mata o operacional, e o trilho diz qual pai quebrou", () => {
  const pai = mandateFrom(UMBRELLA_DRAFT, { _id: "mnd_pai", revoked: true });
  const filho = mandateFrom(OPERATIONAL_DRAFT, { _id: "mnd_filho", parentMandateId: "mnd_pai" });

  const vivo = effectiveStatus(filho, [], NOW);
  assert.equal(vivo.status, "active");

  const morto = effectiveStatus(filho, [pai], NOW);
  assert.equal(morto.status, "revoked");
  assert.equal(morto.brokenBy, "mnd_pai");
});

/* --------------------------- a janela de denuncia -------------------------- */

test("a janela de denuncia e o gatilho real da decisao, nao o fim da vigencia", () => {
  // Contrato ate 31/12/2027 com 90 dias de denuncia: o prazo real e 02/10/2027.
  const dias = diasParaDenuncia(DEMO.contract, new Date("2027-09-25T00:00:00Z"));
  assert.ok(dias > 0 && dias < 10, `esperava a janela fechando em dias, veio ${dias}`);

  const passou = diasParaDenuncia(DEMO.contract, new Date("2027-11-01T00:00:00Z"));
  assert.ok(passou < 0, "passada a janela, o contrato rola por mais um periodo");
});
