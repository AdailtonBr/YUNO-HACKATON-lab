/**
 * Os 12 TESTES DE FOGO (§8 do escopo) — os critérios de aceite do projeto.
 *
 * A banca vai operar o sistema ao vivo e cada um destes é uma coisa que ela faz
 * com as próprias mãos.  Por isso são de ponta a ponta: Mongo em memória,
 * Autoridade de verdade, as três comercializadoras de verdade em portas
 * efêmeras, e o agente falando só HTTP com as duas pontas.  Um teste de fogo
 * que atalhasse a rede provaria que o atalho funciona.
 *
 * ## Sobre os `todo`
 *
 * A Frente C é dona destes 12, mas não é dona do que a maioria deles precisa —
 * a injeção dos atributos derivados, as rotas de curva e contrato, o supersede
 * e a hierarquia são da Frente A.  Escrever só os que passam hoje seria
 * esconder o placar.
 *
 * Então eles estão escritos por inteiro e marcados `todo` com o bloqueio
 * nomeado.  `node --test` os executa, reporta como pendentes e **não reprova a
 * suíte** — o merge não trava, e o placar fica na tela.  Quando a frente dona
 * entregar, tira-se a marca e o teste ou passa ou aponta o defeito.  Nenhum
 * deles foi enfraquecido para passar antes da hora.
 */

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import { buildApp } from "../src/app.js";
import { buildStore } from "../../app2/src/store.js";
import { STORES } from "../../app2/src/catalogs.js";
import { seed, DEMO, MANDATE_OPERATIONAL_ID, MANDATE_UMBRELLA_ID } from "../src/seed.js";
import { runCycle, attemptOffer, watchKey } from "../src/agent/watcher.js";
import { assessOffer, VERDICT } from "../src/agent/cycle-log.js";
import { attemptPurchase, searchCatalogs } from "../src/agent/agent.js";
import { Mandate, Approval, AuditLog, Merchant, Agent, UsedNonce, Idempotency, PaymentMethod, SupplyContract, MarketCurve } from "../src/authority/models.js";

let mongod, authority, authorityBase;
const servers = [];
let stores = []; // [{ id, url }]

/**
 * O mundo, injetado.
 *
 * As rotas `GET /curves` e `GET /contracts` são da Frente A e ainda não
 * existem.  Em vez de esperar por elas, o ciclo recebe curva e contrato já
 * lidos — o que se está testando aqui é o CICLO, não o transporte.  Os valores
 * são os do `seed.js`, então o dia em que as rotas subirem o número não muda.
 */
const world = () => ({ curve: { ...DEMO.curve }, contract: { ...DEMO.contract } });

const agentDeps = () => ({
  stores,
  agentId: DEMO.agentId,
  agentSecret: DEMO.agentSecret,
  authorityUrl: authorityBase,
  world: world(),
});

const listen = (app) =>
  new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
    servers.push(s);
  });

before(async () => {
  // O atalho documentado do `seed.js`.  Os 12 testes são sobre o que acontece
  // DEPOIS do mandato existir; a cena da emissão é da Frente D.
  process.env.SEED_MANDATES = "1";

  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri("fire_drill"));

  authority = await listen(buildApp());
  authorityBase = `http://127.0.0.1:${authority.address().port}`;

  for (const s of Object.values(STORES)) {
    const srv = await listen(buildStore({ ...s, authorityUrl: authorityBase }));
    stores.push({ id: s.id, url: `http://127.0.0.1:${srv.address().port}` });
  }
});

after(async () => {
  for (const s of servers) s.close();
  await mongoose.disconnect();
  await mongod?.stop();
});

/** Os catálogos são objetos vivos no módulo: o que um teste mexe, outro herda. */
const pristine = Object.fromEntries(
  Object.entries(STORES).map(([k, s]) => [k, s.catalog.map((p) => ({ ...p }))])
);

beforeEach(async () => {
  await Promise.all(
    [Mandate, Approval, AuditLog, Merchant, Agent, UsedNonce, Idempotency, PaymentMethod, SupplyContract, MarketCurve].map(
      (m) => m.deleteMany({})
    )
  );
  for (const [k, snapshot] of Object.entries(pristine)) {
    STORES[k].catalog.forEach((p, i) => Object.assign(p, snapshot[i]));
  }
  await seed();
});

/* ------------------------------ utilitários ------------------------- */

const mandateDoc = (id = MANDATE_OPERATIONAL_ID) => Mandate.findById(id).lean();

const offers = () => searchCatalogs(stores, "");
const offerFrom = async (merchantId) => (await offers()).find((o) => o.merchantId === merchantId);

const auditFor = (mandateId) => AuditLog.find({ mandateId }).sort({ ts: 1, seq: 1 }).lean();

/** O que o merchant viu do próprio lado — é onde a recusa tem que aparecer. */
const verificationsOf = (merchantId) =>
  fetch(`${stores.find((s) => s.id === merchantId).url}/verifications`).then((r) => r.json());

/* =================================================================== *
 * 1 — Deixa o dia rodar
 * =================================================================== */

test("1 · o dia roda: a Cerrado cai pelo rating e a Volt Andina ESCALA com R$210.000", { todo: "Frente A: introspect ainda não injeta os atributos derivados (rating, economia_liquida_brl)" }, async () => {
  const cycle = await runCycle(agentDeps());
  const run = cycle.mandates.find((m) => m.mandateId === MANDATE_OPERATIONAL_ID);

  // A ordem das tentativas é a da ECONOMIA: a Cerrado é a mais rentável e a
  // primeira a ser tentada — e é a Autoridade, não o agente, que a derruba.
  assert.deepEqual(run.attempts.map((a) => a.merchantId), ["cerrado_power", "volt_andina"]);
  assert.equal(run.attempts[0].decision, "recusado");
  assert.equal(run.attempts[0].reason.params.attr, "rating");

  assert.equal(run.attempts[1].decision, "escalado");
  assert.equal(run.attempts[1].projectedGain, 21000000); // R$ 210.000,00
  assert.ok(run.attempts[1].approvalRequestId, "a alçada tem que criar uma pendência");
});

/* =================================================================== *
 * 2 — Sobe a curva de 249 para 262
 * =================================================================== */

test("2 · a curva sobe para R$262 e a MESMA oferta passa a valer R$756.000", { todo: "Frente A: PATCH /curves não existe (routes.energy.js)" }, async () => {
  const r = await fetch(`${authorityBase}/curves/SECO`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-human-id": DEMO.humanId },
    body: JSON.stringify({ precoBrlMwh: 26200 }),
  });
  assert.equal(r.status, 200);

  const cycle = await runCycle({ ...agentDeps(), world: undefined }); // lê a curva NOVA pela rota
  const run = cycle.mandates.find((m) => m.mandateId === MANDATE_OPERATIONAL_ID);
  const volt = run.offers.find((o) => o.merchantId === "volt_andina");

  // (26200 − 24400) × 42.000 = R$ 756.000.  A multa cai junto: a curva subiu.
  assert.equal(volt.gain, 75600000);
});

/* =================================================================== *
 * 3 — Revoga o mandato ao vivo
 * =================================================================== */

test("3 · revogado ao vivo: o ciclo para de tentar E uma tentativa forçada morre na Autoridade", async () => {
  await Mandate.updateOne({ _id: MANDATE_OPERATIONAL_ID }, { $set: { revoked: true } });

  // (a) O ciclo não gasta rede para ouvir um não que já se sabe.
  const cycle = await runCycle(agentDeps());
  assert.equal(cycle.mandates.some((m) => m.mandateId === MANDATE_OPERATIONAL_ID), false);

  // (b) E o que importa para a defesa: se o agente tentasse assim mesmo — por
  //     bug, por má-fé, por ter lido o mandato antes da revogação —, quem diz
  //     não é a Autoridade, do lado do merchant.  A autonomia do agente não
  //     adiciona autoridade nenhuma.
  const mandate = await Mandate.findById(MANDATE_OPERATIONAL_ID).lean();
  const { result } = await attemptOffer({
    mandate,
    offer: await offerFrom("volt_andina"),
    ...world(),
    deps: agentDeps(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason.code, "revoked");

  // E a recusa aparece do lado da COMERCIALIZADORA, que é onde a banca olha.
  const { verifications } = await verificationsOf("volt_andina");
  assert.equal(verifications[0].decision, "recusado");
});

/* =================================================================== *
 * 4 — Muda o teto de desconto de 2% para 5%
 * =================================================================== */

test("4 · mudar o teto de 2% para 5% cria um mandato v2 e desqualifica a Volt", { todo: "Frente A: POST /mandates/:id/supersede não existe" }, async () => {
  const r = await fetch(`${authorityBase}/mandates/${MANDATE_OPERATIONAL_ID}/supersede`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-human-id": DEMO.humanId },
    body: JSON.stringify({ constraints: [{ attr: "desconto_vs_curva_pct", op: "gte", value: 5.0 }] }),
  });
  assert.equal(r.status, 201);
  const { mandateId: v2 } = await r.json();

  // O velho é revogado, não editado: o trilho mostra os dois.
  const velho = await Mandate.findById(MANDATE_OPERATIONAL_ID).lean();
  assert.equal(velho.revoked, true);

  const novo = await Mandate.findById(v2).lean();
  assert.equal(novo.version, 2);
  assert.equal(novo.supersedes, MANDATE_OPERATIONAL_ID);

  // A Volt está 2,01% abaixo da curva — passava em 2%, não passa em 5%.
  const volt = assessOffer({
    offer: await offerFrom("volt_andina"),
    mandate: novo,
    ...world(),
    quantity: DEMO.contract.volumeRemanescenteMwh,
  });
  assert.equal(volt.verdict, VERDICT.REJECTED);
  assert.ok(volt.failures.some((f) => f.attr === "desconto_vs_curva_pct"));
});

/* =================================================================== *
 * 5 — Melhora a oferta da Cerrado para R$210
 * =================================================================== */

test("5 · o MELHOR preço do dia é recusado — e a razão é o rating, não o preço", { todo: "Frente A: sem o `rating` injetado, a recusa sai como attribute_missing e não como a regra que decidiu" }, async () => {
  // A banca mexe no painel do operador da Cerrado.
  const cerrado = stores.find((s) => s.id === "cerrado_power");
  const r = await fetch(`${cerrado.url}/catalog/CERR-SECO-2027`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ price: 21000 }),
  });
  assert.equal(r.status, 200);

  const cycle = await runCycle(agentDeps());
  const run = cycle.mandates.find((m) => m.mandateId === MANDATE_OPERATIONAL_ID);

  // O agente a coloca em primeiro — ela é de longe a mais rentável.  E toma um
  // não.  É o teste mais contraintuitivo do conjunto: o mandato governa o
  // agente, e "mais barato" não é argumento contra uma regra de crédito.
  assert.equal(run.attempts[0].merchantId, "cerrado_power");
  assert.equal(run.attempts[0].decision, "recusado");
  assert.equal(run.attempts[0].reason.params.attr, "rating");
  assert.equal(run.attempts[0].reason.params.actual, "BB");
});

/* =================================================================== *
 * 6 — Aceita a oferta da Helios manualmente
 * =================================================================== */

test("6 · a Helios forçada na mão é recusada pela COMISSÃO, que é a manchete", async () => {
  const helios = await offerFrom("helios_trading");
  const mandate = await mandateDoc();

  // O ciclo nunca a escolheria.  Mas a defesa não pode depender do agente ter
  // bom gosto: forçar é a única forma de mostrar que a recusa vem da Autoridade
  // e não do pré-filtro do agente.
  const { assessed, result } = await attemptOffer({ mandate, offer: helios, ...world(), deps: agentDeps() });

  assert.equal(result.ok, false);
  assert.equal(result.reason.code, "constraint_failed");
  assert.equal(result.reason.params.attr, "comissao_terceiro");
  assert.equal(result.reason.params.actual, 1400);

  // A Autoridade dá UMA razão e marca o resto como não avaliado — e está certa:
  // dizer "ok" sobre o que não se olhou seria mentira.  Quem mostra o quadro
  // completo é a tabela do agente, que não decide nada.
  const naoAvaliadas = result.trace.filter((t) => t.verdict === "not_evaluated");
  assert.ok(naoAvaliadas.length > 0);
  assert.deepEqual(assessed.failures.map((f) => f.attr).sort(), [
    "comissao_terceiro",
    "desconto_vs_curva_pct",
    "flexibilidade_pct",
    "prazo_meses",
    "take_or_pay_pct",
  ]);
});

test("6b · a Helios anuncia R$239 e o preço EFETIVO é R$253 — é o que a torna a pior oferta", async () => {
  const helios = await offerFrom("helios_trading");

  assert.equal(helios.preco_energia, 23900); // a manchete
  assert.equal(helios.comissao_terceiro, 1400);
  assert.equal(helios.price, 25300); // o que sai da conta

  const assessed = assessOffer({
    offer: helios,
    mandate: await mandateDoc(),
    ...world(),
    quantity: DEMO.contract.volumeRemanescenteMwh,
  });
  assert.equal(assessed.gain, -16800000); // destrói R$ 168.000
});

/* =================================================================== *
 * 7 — Força uma compra de 130% da carga
 * =================================================================== */

test("7 · 130% da carga é recusado por COBERTURA, não por teto de volume", { todo: "Frente A: `cobertura_pct` ainda não é injetado no introspect" }, async () => {
  const mandate = await mandateDoc();
  const excesso = Math.round(DEMO.contract.consumoPrevistoPeriodoMwh * 1.3); // 54.600 MWh

  const { result } = await attemptOffer({
    mandate,
    offer: await offerFrom("volt_andina"),
    ...world(),
    quantity: excesso,
    deps: agentDeps(),
  });

  assert.equal(result.ok, false);
  // A diferença que importa: "você ia me deixar sobrecontratado" é uma resposta
  // de RISCO; "você passou de um número" é uma resposta de contabilidade.  A
  // ordem das constraints no mandato é o que garante a primeira.
  assert.equal(result.reason.params.attr, "cobertura_pct");
});

/* =================================================================== *
 * 8 — Envia mandato com assinatura forjada
 * =================================================================== */

test("8 · bilhete assinado com o segredo errado é recusado, e a tentativa fica registrada", async () => {
  const volt = await offerFrom("volt_andina");

  const result = await attemptPurchase({
    mandateId: MANDATE_OPERATIONAL_ID,
    item: volt,
    quantity: DEMO.contract.volumeRemanescenteMwh,
    agentId: DEMO.agentId,
    // Um impostor que conhece o id do agente e o do mandato — e não tem o
    // segredo.  É tudo o que separa ele do agente de verdade, e é o bastante.
    agentSecret: "segredo-de-quem-se-passa-pelo-agente",
    idempotencyKey: "fire-drill-8",
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason.code, "ticket_bad_signature");

  // O merchant recusa e registra: a tentativa de impostura é um FATO no trilho
  // dele, não um evento que sumiu porque deu errado.
  const { verifications } = await verificationsOf("volt_andina");
  assert.equal(verifications[0].decision, "recusado");
});

test("8b · o mandato não é tocado por uma tentativa forjada", async () => {
  const antes = await mandateDoc();
  await attemptPurchase({
    mandateId: MANDATE_OPERATIONAL_ID,
    item: await offerFrom("volt_andina"),
    quantity: DEMO.contract.volumeRemanescenteMwh,
    agentId: DEMO.agentId,
    agentSecret: "outro-segredo-qualquer",
    idempotencyKey: "fire-drill-8b",
  });
  const depois = await mandateDoc();

  assert.equal(depois.usedCount, antes.usedCount);
  assert.equal(depois.revoked, false);
});

/* =================================================================== *
 * 9 — Pede a rescisão do contrato vigente
 * =================================================================== */

test("9 · rescisão nunca é automática: escala, com a multa aberta na tela", { todo: "Frente A: precisa dos derivados; e a Frente B precisa publicar uma oferta com operacao=rescisao" }, async () => {
  const rescisao = { ...(await offerFrom("volt_andina")), operacao: "rescisao" };
  const { result } = await attemptOffer({
    mandate: await mandateDoc(),
    offer: rescisao,
    ...world(),
    deps: agentDeps(),
  });

  // `operacao eq novo_contrato` com `on_fail: escalate`: uma ação irreversível
  // que expõe a empresa no curto prazo não se delega a um relógio.
  assert.equal(result.action, "escalate");
  assert.equal(result.reason.params.attr, "operacao");
  assert.ok(result.approvalRequestId);
});

/* =================================================================== *
 * 10 — Adianta o relógio até a janela de denúncia
 * =================================================================== */

test("10 · alerta em D−30/−15/−7, e passada a janela a oportunidade é dada como PERDIDA", async () => {
  /*
   * Contradição nos dados congelados, sinalizada ao grupo: o mandato
   * operacional expira em 31/12/2026 e a data-limite da denúncia é 02/10/2027.
   * Com os números como estão, o mandato morre 9 meses antes de a janela
   * chegar, e este teste seria inalcançável.  Estico a validade AQUI, no
   * arranjo do teste, sem tocar em `seed.js` (congelado, e de outra frente).
   */
  await Mandate.updateOne(
    { _id: MANDATE_OPERATIONAL_ID },
    { $set: { expiresAt: new Date("2027-12-31T23:59:59Z") } }
  );

  const limite = new Date("2027-10-02T23:59:59Z"); // fim de vigência − 90 dias

  // D−20: dentro da janela, o ciclo alerta e continua trabalhando.
  const antes = await runCycle({ ...agentDeps(), now: new Date(limite.getTime() - 20 * 864e5) });
  const runAntes = antes.mandates.find((m) => m.mandateId === MANDATE_OPERATIONAL_ID);
  assert.equal(runAntes.denuncia.missed, false);
  assert.equal(runAntes.denuncia.level, 30);
  assert.ok(runAntes.offers.length > 0);

  // D+13: a janela fechou.  O contrato rolou por mais um período — a renovação
  // silenciosa que o mandato existe para impedir — e o agente diz isso em voz
  // alta em vez de comprar uma troca que a empresa não pode mais fazer.
  const depois = await runCycle({ ...agentDeps(), now: new Date(limite.getTime() + 13 * 864e5) });
  const runDepois = depois.mandates.find((m) => m.mandateId === MANDATE_OPERATIONAL_ID);
  assert.equal(runDepois.denuncia.missed, true);
  assert.deepEqual(runDepois.attempts, []);
  assert.ok(runDepois.offers.length > 0, "avaliou as ofertas — só não tentou nenhuma");
});

/* =================================================================== *
 * 11 — "Eu nunca autorizei essa troca"
 * =================================================================== */

test("11 · a disputa responde com os elos CALCULADOS, não afirmados", { todo: "Frente A: `delegation_valid` e `curve_at_decision` (dispute.js) + a compra precisa concluir" }, async () => {
  const cycle = await runCycle(agentDeps());
  const run = cycle.mandates.find((m) => m.mandateId === MANDATE_OPERATIONAL_ID);
  assert.ok(run.attempts.length, "precisa de uma compra para contestar");

  const trilho = await auditFor(MANDATE_OPERATIONAL_ID);
  const compra = trilho.find((e) => e.event === "purchase_decision");

  const r = await fetch(`${authorityBase}/disputes`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-human-id": DEMO.humanId },
    body: JSON.stringify({ auditId: compra._id, reason: "eu nunca autorizei essa troca" }),
  });
  const disputa = await r.json();

  const elos = disputa.evidence.map((e) => e.link);
  assert.ok(elos.includes("delegation_valid"), "o outorgante tinha poderes na data");
  assert.ok(elos.includes("curve_at_decision"), "a curva usada foi a congelada no trilho");
});

/* =================================================================== *
 * 12 — Revoga o mandato-pai
 * =================================================================== */

test("12 · revogar o mandato da diretoria derruba o operacional em cascata", { todo: "Frente A: hierarchy.js ainda não é resolvido dentro do introspect" }, async () => {
  await Mandate.updateOne({ _id: MANDATE_UMBRELLA_ID }, { $set: { revoked: true } });

  // O filho continua com `revoked: false` no documento — e é assim que tem que
  // ser: o estado dele não mudou, o do pai mudou.  Quem resolve a cadeia é a
  // Autoridade, na hora, e não um job que sai propagando flags.
  const filho = await Mandate.findById(MANDATE_OPERATIONAL_ID).lean();
  assert.equal(filho.revoked, false);

  const { result } = await attemptOffer({
    mandate: filho,
    offer: await offerFrom("volt_andina"),
    ...world(),
    deps: agentDeps(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason.code, "parent_revoked");
});

/* =================================================================== *
 * Propriedades que atravessam os 12
 * =================================================================== */

test("uma recusa não consome uso do mandato — é o que torna seguro tentar a lista", async () => {
  const antes = await mandateDoc();

  await attemptOffer({
    mandate: antes,
    offer: await offerFrom("helios_trading"),
    ...world(),
    deps: agentDeps(),
  });

  const depois = await mandateDoc();
  assert.equal(depois.usedCount, antes.usedCount);
});

test("a chave de idempotência do ciclo é derivada: o mesmo tique repetido não compra duas vezes", async () => {
  const mandate = await mandateDoc();
  const volt = await offerFrom("volt_andina");
  const qty = DEMO.contract.volumeRemanescenteMwh;

  assert.equal(watchKey(mandate, volt, qty), watchKey(mandate, volt, qty));
  assert.match(watchKey(mandate, volt, qty), /^watch:/);
});

test("o log do ciclo é DADO, não texto: a UI recebe campos, não uma string formatada", async () => {
  const cycle = await runCycle(agentDeps());

  assert.equal(typeof cycle.cycleId, "string");
  assert.ok(Array.isArray(cycle.steps));
  assert.ok(cycle.steps.every((s) => typeof s.step === "string" && typeof s.at === "string"));

  const run = cycle.mandates.find((m) => m.mandateId === MANDATE_OPERATIONAL_ID);
  const volt = run.offers.find((o) => o.merchantId === "volt_andina");
  // Cada oferta carrega a conta ABERTA, regra a regra: é o que a tela do §7.2
  // renderiza, e é o que um auditor consegue refazer.
  assert.ok(Array.isArray(volt.checks) && volt.checks.length > 0);
  assert.equal(typeof volt.projected.multa_rescisoria_brl, "number");
  assert.equal(volt.projected.multa_rescisoria_brl, 79800000); // R$ 798.000
});
