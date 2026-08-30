/**
 * Testes do ciclo diário (Frente C).
 *
 * Puros: sem rede, sem banco, sem relógio real.  `planCycle` recebe o retrato
 * do mundo e devolve o que avaliou e o que vai tentar; quem faz I/O é
 * `runCycle`, e o que ele faz de interessante já está aqui.
 *
 * Os dados são os CONGELADOS: os catálogos reais das três comercializadoras e
 * os rascunhos de mandato do `seed.js`.  Um teste do ciclo com dados inventados
 * provaria que o ciclo funciona sobre dados inventados.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { planCycle, watchKey } from "../src/agent/watcher.js";
import { assessOffer, rankOffers, denunciaAlert, VERDICT, AUTHORITY_ONLY } from "../src/agent/cycle-log.js";
import { DEMO, OPERATIONAL_DRAFT } from "../src/seed.js";
import { STORES } from "../../app2/src/catalogs.js";

const NOW = new Date("2026-08-30T12:00:00Z"); // o "hoje" da demo
const VOLUME = DEMO.contract.volumeRemanescenteMwh; // 42.000 MWh

/**
 * ATENCAO — contradicao nos dados congelados, sinalizada ao grupo.
 *
 * O mandato operacional expira em 31/12/2026, e a data-limite da denuncia do
 * contrato da Aurora e 02/10/2027 (fim de vigencia menos 90 dias).  Ou seja: no
 * dia em que a janela de denuncia se aproxima, o mandato que autorizaria a
 * troca ja morreu ha 9 meses — e o teste de fogo 10 ("adianta o relogio ate a
 * janela") fica inalcancavel com os numeros como estao.
 *
 * Nao mexo em `seed.js` (congelado, e nao e da minha coluna).  Os testes da
 * janela declaram a suposicao aqui, em voz alta, com um mandato que vive o
 * bastante para chegar la.  Se o grupo esticar `expiresAt` para 2027-12-31,
 * este `over` some e nada mais muda.
 */
const ATE_2027 = { expiresAt: new Date("2027-12-31T23:59:59Z") };

/** A oferta como o agente a recebe do RFQ: o comum + de quem ela veio. */
const offerOf = (storeKey) => {
  const s = STORES[storeKey];
  return { ...s.toCommon(s.catalog[0]), merchantId: s.id, merchantName: s.name, storeUrl: `http://x/${s.id}` };
};

const mandate = (over = {}) => ({
  _id: "mnd_op",
  humanId: DEMO.humanId,
  agentId: DEMO.agentId,
  ...OPERATIONAL_DRAFT,
  usedCount: 0,
  revoked: false,
  ...over,
});

const assess = (storeKey, over = {}) =>
  assessOffer({
    offer: offerOf(storeKey),
    mandate: mandate(),
    contract: DEMO.contract,
    curve: DEMO.curve,
    quantity: VOLUME,
    ...over,
  });

const failedAttrs = (a) => a.failures.map((f) => f.attr);

/* ------------------- a projeção, e o que ela não faz ---------------- */

test("o agente NAO projeta rating nem garantia — a contraparte nao e dado dele", () => {
  const volt = assess("volt_andina");

  for (const attr of AUTHORITY_ONLY) {
    assert.equal(attr in volt.projected, false, `${attr} nao pode estar na projecao do agente`);
  }
  // Elas viram PERGUNTA ABERTA, e a oferta segue tentavel.  Pre-rejeitar por um
  // atributo que so a Autoridade atesta seria o agente decidindo.
  assert.deepEqual(volt.unknowns.map((u) => u.attr).sort(), ["garantia", "rating"]);
  assert.equal(volt.verdict, VERDICT.ELIGIBLE);
});

test("a projecao usa a MESMA conta da Autoridade: R$210.000 na Volt, −R$168.000 na Helios", () => {
  assert.equal(assess("volt_andina").gain, 21000000);
  assert.equal(assess("helios_trading").gain, -16800000);
  assert.equal(assess("cerrado_power").gain, 75600000);
});

test("a Helios anuncia 239 e o preco EFETIVO e 253 — e por isso ela fica acima da curva", () => {
  const h = assess("helios_trading");
  assert.equal(h.price, 25300);
  assert.equal(h.projected.desconto_vs_curva_pct, -1.61);
});

/* --------------- o quadro completo vs. a razao unica ---------------- */

test("a tabela do agente lista TODAS as falhas — e o motor, de proposito, da uma so", () => {
  const h = assess("helios_trading");

  assert.equal(h.verdict, VERDICT.REJECTED);
  // Cinco regras violadas de uma vez.  A Autoridade vai devolver UMA razao (a
  // comissao, que e a primeira do mandato) e marcar o resto `not_evaluated` —
  // e esta certa.  Quem mostra o quadro inteiro e a tabela, que nao decide nada.
  assert.deepEqual(failedAttrs(h).sort(), [
    "comissao_terceiro",
    "desconto_vs_curva_pct",
    "flexibilidade_pct",
    "prazo_meses",
    "take_or_pay_pct",
  ]);
  assert.ok(h.failures.length > 1, "a razao unica e da Autoridade; aqui o quadro e completo");
});

test("comissao embutida e falha DURA, nao pergunta: recusar-se a declarar vale o mesmo", () => {
  const h = assess("helios_trading");
  const c = h.checks.find((x) => x.attr === "comissao_terceiro");
  assert.equal(c.ok, false);
  assert.equal(c.on_missing, "deny");
  assert.equal(c.policy, "deny");
});

/* ------------------ escalar nao e recusar --------------------------- */

test("estourar a alcada ESCALA, nao recusa — senao o ciclo descartaria a vencedora", () => {
  const volt = assess("volt_andina");

  // R$210.000 estoura o teto de R$50.000 da alcada.  E o resultado BOM.
  const alcada = volt.escalations.find((e) => e.attr === "economia_liquida_brl");
  assert.ok(alcada, "a alcada tem que aparecer como escalonamento");
  assert.equal(alcada.on_fail, "escalate");
  assert.equal(volt.failures.length, 0);
  assert.equal(volt.verdict, VERDICT.ELIGIBLE);
});

/* --------------- ordenar por economia, nao por preco ---------------- */

test("a ordem e por ECONOMIA: a Cerrado vem antes da Volt, e a Helios nem entra", () => {
  const all = ["volt_andina", "cerrado_power", "helios_trading"].map(assess);
  const ranked = rankOffers(all);

  // A Cerrado tem o melhor preco E a melhor economia — o agente a tenta
  // primeiro, e e a AUTORIDADE que a derruba pelo rating.  A recusa vira um
  // fato assinado no trilho, em vez de um palpite do comparador.
  assert.deepEqual(ranked.map((o) => o.merchantId), ["cerrado_power", "volt_andina"]);
  assert.equal(ranked.some((o) => o.merchantId === "helios_trading"), false);
});

test("uma oferta que passa nas regras mas nao economiza e DESCARTADA, nao recusada", () => {
  // Um mandato sem as regras que a Helios fere: sobra so a aritmetica.
  const semRegrasDuras = mandate({
    constraints: OPERATIONAL_DRAFT.constraints.filter(
      (c) => !["comissao_terceiro", "prazo_meses", "flexibilidade_pct", "take_or_pay_pct", "desconto_vs_curva_pct"].includes(c.attr)
    ),
  });
  const h = assess("helios_trading", { mandate: semRegrasDuras });

  assert.equal(h.failures.length, 0);
  assert.equal(h.gain < 0, true);
  assert.equal(h.verdict, VERDICT.DISCARDED);
});

/* ----------------------- a janela de denuncia ----------------------- */

test("os alertas sao D−30, D−15 e D−7, e vale o limiar MAIS RECENTE", () => {
  assert.equal(denunciaAlert(40).level, null);
  assert.equal(denunciaAlert(30).level, 30);
  assert.equal(denunciaAlert(22).level, 30);
  assert.equal(denunciaAlert(15).level, 15);
  assert.equal(denunciaAlert(10).level, 15);
  assert.equal(denunciaAlert(7).level, 7);
  assert.equal(denunciaAlert(1).level, 7);
});

test("passada a janela, a oportunidade esta PERDIDA — e o ciclo nao tenta nada", () => {
  const passou = denunciaAlert(-1);
  assert.equal(passou.missed, true);

  // 2027-10-15 ja passou do limite (31/12/2027 menos 90 dias = 02/10/2027).
  const depois = new Date("2027-10-15T12:00:00Z");
  const [plan] = planCycle({
    mandates: [mandate(ATE_2027)],
    offers: [offerOf("volt_andina")],
    contract: DEMO.contract,
    curve: DEMO.curve,
    now: depois,
  });

  assert.equal(plan.denuncia.missed, true);
  // Avaliou tudo — mas nao tenta: o contrato ja rolou, e comprar agora seria
  // comprar uma troca que a empresa nao pode mais fazer.
  assert.equal(plan.assessed.length, 1);
  assert.deepEqual(plan.attempts, []);
});

/* ----------------------------- o plano ------------------------------ */

test("o ciclo compra VOLUME, nao uma unidade", () => {
  const [plan] = planCycle({
    mandates: [mandate()],
    offers: [offerOf("volt_andina")],
    contract: DEMO.contract,
    curve: DEMO.curve,
    now: NOW,
  });

  assert.equal(plan.quantity, VOLUME);
  assert.equal(plan.attempts[0].offer.total, 24400 * VOLUME);
});

test("mandato revogado, expirado ou esgotado nao entra no ciclo", () => {
  const world = { offers: [offerOf("volt_andina")], contract: DEMO.contract, curve: DEMO.curve, now: NOW };

  assert.deepEqual(planCycle({ mandates: [mandate({ revoked: true })], ...world }), []);
  assert.deepEqual(planCycle({ mandates: [mandate({ expiresAt: new Date("2020-01-01") })], ...world }), []);
  assert.deepEqual(planCycle({ mandates: [mandate({ maxUses: 2, usedCount: 2 })], ...world }), []);
});

test("o ciclo NAO opera sob o mandato-pai: quem tem filho e moldura, nao permissao", () => {
  // O guarda-chuva tem 4 regras; o operacional que deriva dele tem 17.  Operar
  // sob o pai seria comprar sob o conjunto mais frouxo tendo o mais apertado
  // disponivel — alargar o mandato pela porta dos fundos.
  const pai = mandate({ _id: "mnd_pai", parentMandateId: null, constraints: [] });
  const filho = mandate({ _id: "mnd_filho", parentMandateId: "mnd_pai" });

  const plans = planCycle({
    mandates: [pai, filho],
    offers: [offerOf("volt_andina")],
    contract: DEMO.contract,
    curve: DEMO.curve,
    now: NOW,
  });

  assert.deepEqual(plans.map((p) => p.mandate._id), ["mnd_filho"]);
});

test("um mandato sem filhos continua operando normalmente", () => {
  const plans = planCycle({
    mandates: [mandate()],
    offers: [offerOf("volt_andina")],
    contract: DEMO.contract,
    curve: DEMO.curve,
    now: NOW,
  });
  assert.equal(plans.length, 1);
});

test("o teto por tique limita quantos mandatos um bug consegue disparar", () => {
  const muitos = Array.from({ length: 9 }, (_, i) => mandate({ _id: `mnd_${i}` }));
  const plans = planCycle({
    mandates: muitos,
    offers: [offerOf("volt_andina")],
    contract: DEMO.contract,
    curve: DEMO.curve,
    now: NOW,
    maxMandates: 3,
  });
  assert.equal(plans.length, 3);
});

test("e o teto de tentativas por mandato tambem", () => {
  const [plan] = planCycle({
    mandates: [mandate()],
    offers: ["volt_andina", "cerrado_power", "helios_trading"].map(offerOf),
    contract: DEMO.contract,
    curve: DEMO.curve,
    now: NOW,
    maxAttemptsPerMandate: 1,
  });
  assert.equal(plan.attempts.length, 1);
  assert.equal(plan.attempts[0].offer.merchantId, "cerrado_power");
});

/* -------------------------- idempotencia ---------------------------- */

test("a chave e ESTAVEL na mesma oportunidade: retentativa nao compra duas vezes", () => {
  const world = {
    mandates: [mandate()],
    offers: [offerOf("volt_andina")],
    contract: DEMO.contract,
    curve: DEMO.curve,
    now: NOW,
  };
  const a = planCycle(world)[0].attempts[0];
  const b = planCycle(world)[0].attempts[0];
  assert.equal(a.idempotencyKey, b.idempotencyKey);
});

test("a chave MUDA com o uso, com a oferta, com o preco e com o VOLUME", () => {
  const m = mandate({ maxUses: 2 });
  const volt = offerOf("volt_andina");

  assert.notEqual(watchKey(m, volt, VOLUME), watchKey({ ...m, usedCount: 1 }, volt, VOLUME));
  assert.notEqual(watchKey(m, volt, VOLUME), watchKey(m, { ...volt, productId: "OUTRO" }, VOLUME));
  assert.notEqual(watchKey(m, volt, VOLUME), watchKey(m, { ...volt, price: 23000 }, VOLUME));
  // O mesmo produto pelo mesmo preco, em 42.000 MWh ou em 10.000, sao duas
  // operacoes: sem o volume na chave, a segunda receberia o recibo da primeira.
  assert.notEqual(watchKey(m, volt, VOLUME), watchKey(m, volt, 10000));
  // O prefixo distingue a compra do ciclo da compra feita na conversa.
  assert.match(watchKey(m, volt, VOLUME), /^watch:/);
});
