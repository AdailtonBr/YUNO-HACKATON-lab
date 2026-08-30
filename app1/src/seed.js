/**
 * Seed da demo de energia.  Idempotente: pode rodar quantas vezes quiser.
 *
 * O caso: a Metalúrgica Aurora tem contrato de suprimento vigente com a Nortis
 * a R$268/MWh e 42.000 MWh remanescentes.  A curva SE/CO para 2027 está a
 * R$249/MWh.  Três comercializadoras respondem ao RFQ, e só uma passa.
 *
 * Repare que a Nortis não é um endpoint: ela é o CONTRATO VIGENTE.  É o
 * baseline contra o qual tudo se compara, não alguém que responde cotação.
 *
 * As credenciais são fixas SÓ para a demo.  Em qualquer coisa real cada segredo
 * seria gerado e guardado num cofre.
 */

import mongoose from "mongoose";
import crypto from "node:crypto";
import { Merchant, Agent, Mandate, PaymentMethod, SupplyContract, MarketCurve } from "./authority/models.js";
import { registerRef } from "./authority/vault.js";
import { humanReadable } from "./shared/messages.js";

/* ----------------------------- o elenco ----------------------------- */

export const DEMO = {
  humanId: "user_aurora",
  agentId: "agent_aurora",
  agentSecret: "demo-agent-secret-aurora",

  /**
   * A allow-list.  `rating` e `garantia` vivem AQUI porque quem tem interesse
   * não atesta: a vendedora é a última parte que deveria declarar o próprio
   * risco de crédito.
   */
  merchants: [
    { _id: "volt_andina",    name: "Volt Andina",    apiKey: "demo-key-volt",    rating: "A-", garantia: true,  whitelisted: true },
    { _id: "cerrado_power",  name: "Cerrado Power",  apiKey: "demo-key-cerrado", rating: "BB", garantia: false, whitelisted: false },
    { _id: "helios_trading", name: "Helios Trading", apiKey: "demo-key-helios",  rating: null, garantia: false, whitelisted: false },
  ],

  /** O instrumento de liquidação. O agente nunca o vê; a Autoridade o dispara. */
  paymentRef: "pm_pix_aurora_liquidacao",

  /** Contrato vigente. O volume remanescente é a base de todo o cálculo. */
  contract: {
    _id: "ctr_aurora_nortis",
    fornecedor: "Nortis Energia",
    submercado: "SECO",
    precoBrlMwh: 26800, // R$ 268,00
    inicioVigencia: new Date("2025-01-01T00:00:00Z"),
    fimVigencia: new Date("2027-12-31T23:59:59Z"),
    denunciaDias: 90,
    renovacaoAutomatica: true,
    volumeRemanescenteMwh: 42000,
    consumoPrevistoPeriodoMwh: 42000, // 3.500 MWh/mês x 12
    flexibilidadePct: 5,
    takeOrPayPct: 95,
    // Zero na demo, para a aritmética na tela bater com a do slide.  O cálculo
    // os suporta -- ver `mtm` em `authority/energy.js`.
    multaPisoBrl: 0,
    taxaAdminBrl: 0,
  },

  /** A alavanca do juiz: mudar este número remonta a decisão inteira. */
  curve: { _id: "SECO:2027", submercado: "SECO", periodo: "2027", precoBrlMwh: 24900 },
};

/* ---------------------------- os mandatos --------------------------- */
/*
 * Dois, em hierarquia.  A diretoria abre a moldura anual; o gestor de energia
 * opera dentro dela.  É o que responde à pergunta que o caso pessoal nunca
 * precisou responder: quem autorizou o autorizador?
 *
 * Ids fixos aqui SÓ por idempotência do seed.  Mandato criado pela rota recebe
 * `opaqueId()` de alta entropia, que é o que impede enumeração.
 */

export const MANDATE_UMBRELLA_ID = "mnd_aurora_guarda_chuva";
export const MANDATE_OPERATIONAL_ID = "mnd_aurora_operacional";

const RATINGS_OK = ["AAA", "AA", "A+", "A", "A-"];

export const UMBRELLA_DRAFT = {
  mode: "autonomo",
  currency: "BRL",
  maxUses: 20,
  expiresAt: new Date("2026-12-31T23:59:59Z"),
  constraints: [
    { attr: "submercado",  op: "eq",  value: "SECO",     on_missing: "deny", on_fail: "deny" },
    { attr: "total",       op: "lte", value: 1100000000, on_missing: "deny", on_fail: "deny" }, // R$ 11.000.000
    { attr: "prazo_meses", op: "lte", value: 24,         on_missing: "deny", on_fail: "deny" },
    { attr: "rating",      op: "in",  value: RATINGS_OK, on_missing: "deny", on_fail: "deny" },
  ],
};

export const OPERATIONAL_DRAFT = {
  mode: "autonomo",
  currency: "BRL",
  maxUses: 2,
  expiresAt: new Date("2026-12-31T23:59:59Z"),
  constraints: [
    // A manchete primeiro: o motor para na PRIMEIRA regra que falha, e o caso
    // Expert Tooling v. Engie é o que queremos ver quando a Helios tenta.
    // `on_missing: deny` é o essencial -- recusar-se a declarar a comissão vale
    // o mesmo que ser recusado.
    { attr: "comissao_terceiro",     op: "eq",  value: 0,                       on_missing: "deny", on_fail: "deny" },

    // Camada 2 -- escopo do produto
    { attr: "submercado",            op: "eq",  value: "SECO",                  on_missing: "deny", on_fail: "deny" },
    { attr: "fonte",                 op: "in",  value: ["convencional", "I-5"], on_missing: "deny", on_fail: "deny" },
    { attr: "estrutura_preco",       op: "eq",  value: "fixo",                  on_missing: "deny", on_fail: "deny" },
    { attr: "prazo_meses",           op: "lte", value: 24,                      on_missing: "deny", on_fail: "deny" },

    // Camada 5 -- contraparte (atestada pela AUTORIDADE, nunca pela vendedora)
    { attr: "rating",                op: "in",  value: RATINGS_OK,              on_missing: "deny", on_fail: "deny" },
    { attr: "garantia",              op: "eq",  value: true,                    on_missing: "deny", on_fail: "deny" },

    // Camada 4 -- risco.  Cobertura ANTES de volume, para que forçar 130% da
    // carga seja recusado por RISCO e não por teto de volume: é a diferença
    // entre "você passou de um número" e "você ia me deixar sobrecontratado".
    { attr: "cobertura_pct",         op: "gte", value: 95,                      on_missing: "deny", on_fail: "deny" },
    { attr: "cobertura_pct",         op: "lte", value: 105,                     on_missing: "deny", on_fail: "deny" },
    { attr: "flexibilidade_pct",     op: "gte", value: 10,                      on_missing: "deny", on_fail: "deny" },
    { attr: "take_or_pay_pct",       op: "lte", value: 90,                      on_missing: "deny", on_fail: "deny" },
    { attr: "exposicao_pld_brl",     op: "lte", value: 40000000,                on_missing: "deny", on_fail: "deny" }, // R$ 400.000

    // Camada 3 -- quantitativos
    { attr: "quantity",              op: "lte", value: 42000,                   on_missing: "deny", on_fail: "deny" },
    { attr: "total",                 op: "lte", value: 1100000000,              on_missing: "deny", on_fail: "deny" },
    // O teto RELATIVO.  Um teto absoluto em R$/MWh fica obsoleto em semanas.
    { attr: "desconto_vs_curva_pct", op: "gte", value: 2.0,                     on_missing: "deny", on_fail: "deny" },

    // Camada 6 -- governança.  SEMPRE por último, para que todas as regras
    // duras sejam avaliadas antes de escalar: escalar uma compra que já seria
    // recusada seria fazer o humano decidir uma questão que não é dele.
    { attr: "operacao",              op: "eq",  value: "novo_contrato",         on_missing: "deny", on_fail: "escalate" },
    { attr: "economia_liquida_brl",  op: "lte", value: 5000000,                 on_missing: "deny", on_fail: "escalate" }, // R$ 50.000
  ],
};

/*
 * NÃO há regra de `concentracao_pct` aqui, e a ausência é deliberada.
 *
 * Com um contrato substituindo outro, 100% do volume vai para uma contraparte
 * por construção -- qualquer teto de concentração recusaria até a oferta boa.
 * O atributo continua no vocabulário e derivável; a regra só faz sentido num
 * mandato de PORTFÓLIO, que compra em várias fatias.  Melhor não ter a regra do
 * que ter uma que nunca passa: regra que nunca casa não protege, atrapalha.
 */

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

export async function seed() {
  for (const m of DEMO.merchants) {
    await Merchant.updateOne(
      { _id: m._id },
      {
        $set: {
          name: m.name,
          apiKeyHash: sha256(m.apiKey),
          active: true,
          rating: m.rating,
          garantia: m.garantia,
          whitelisted: m.whitelisted,
        },
      },
      { upsert: true }
    );
  }

  await Agent.updateOne(
    { _id: DEMO.agentId },
    { $set: { humanId: DEMO.humanId, hmacSecret: DEMO.agentSecret, active: true } },
    { upsert: true }
  );

  // O instrumento cru vive no cofre; a Autoridade guarda só o ponteiro e um
  // rótulo.  Ref FIXA, para o ponteiro sobreviver ao restart do processo.
  registerRef(DEMO.paymentRef, {
    rail: "pix",
    label: "financeiro@aurora.com.br",
    instrument: { key: "financeiro@aurora.com.br" },
  });
  await PaymentMethod.updateOne(
    { _id: "pm_aurora_liquidacao" },
    {
      $set: {
        humanId: DEMO.humanId,
        paymentMethodRef: DEMO.paymentRef,
        rail: "pix",
        label: "financeiro@aurora.com.br",
      },
    },
    { upsert: true }
  );

  await SupplyContract.updateOne(
    { _id: DEMO.contract._id },
    { $set: { ...DEMO.contract, humanId: DEMO.humanId, ativo: true } },
    { upsert: true }
  );

  await MarketCurve.updateOne(
    { _id: DEMO.curve._id },
    { $set: { ...DEMO.curve, updatedAt: new Date() } },
    { upsert: true }
  );

  // Os mandatos NAO sao semeados por padrao, e a ausencia e o ponto.
  //
  // Um sistema que nasce com autorizacoes ja concedidas contradiz a primeira
  // cena da demo -- e o mandato existir sem ninguem o ter emitido e exatamente
  // o que este projeto existe para impedir.  Os rascunhos ficam exportados
  // acima: o Portal preenche o formulario com eles, e a mao do humano cria.
  //
  // SEED_MANDATES=1 liga o atalho, para quem esta desenvolvendo e nao quer
  // clicar duas vezes a cada restart.  Fora isso, a tela comeca vazia.
  if (process.env.SEED_MANDATES !== "1") return DEMO;

  for (const [_id, draft, parentMandateId] of [
    [MANDATE_UMBRELLA_ID, UMBRELLA_DRAFT, null],
    [MANDATE_OPERATIONAL_ID, OPERATIONAL_DRAFT, MANDATE_UMBRELLA_ID],
  ]) {
    await Mandate.updateOne(
      { _id },
      {
        $setOnInsert: {
          humanId: DEMO.humanId,
          agentId: DEMO.agentId,
          ...draft,
          parentMandateId,
          paymentMethodRef: DEMO.paymentRef,
          usedCount: 0,
          revoked: false,
          version: 1,
          humanReadable: humanReadable(draft, "en"),
        },
      },
      { upsert: true }
    );
  }

  return DEMO;
}

// `node src/seed.js` roda direto; importado nos testes, só exporta.
if (process.argv[1]?.endsWith("seed.js")) {
  await mongoose.connect(process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/mandato_agentico");
  await seed();
  console.log("seeded:", DEMO.merchants.map((m) => m._id).join(", "), "+", DEMO.agentId);
  await mongoose.disconnect();
}
