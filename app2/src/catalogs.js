/**
 * As três comercializadoras da demo (App 2) — Frente B.
 *
 * Cada uma guarda o catálogo num formato interno DIFERENTE, de propósito, e
 * **nenhum nome de campo se repete entre as três**.  Não é enfeite: é a prova
 * de que o adaptador basta.  Se as três falassem o mesmo idioma internamente,
 * o vocabulário comum de `docs/12-vocabulario-energia.md` não estaria sendo
 * testado por nada — estaria sendo assumido.
 *
 *   volt_andina    português, R$/MWh em reais decimais
 *   cerrado_power  inglês, centavos, janela de suprimento como objeto
 *   helios_trading exportação de ERP: MAIÚSCULAS, milésimos de real, códigos
 *
 * O adaptador é fronteira nos DOIS sentidos: `toCommon` traduz para fora, e
 * `setPrice`/`setCommission`/`setTermMonths`/`setAvailable` traduzem de volta
 * para dentro.  O painel do operador fala centavos e meses; nenhuma das três
 * guarda os dados assim.
 *
 * A regra que não se quebra aqui: **a oferta não carrega `rating` nem
 * `garantia`**.  Quem atesta a contraparte é a Autoridade, a partir da
 * allow-list.  Uma vendedora que declara o próprio risco de crédito é
 * exatamente o furo que este projeto existe para fechar.
 *
 * `catalog[0]` de cada loja é a oferta canônica da demo (§6.3 do escopo) e os
 * números dela estão travados em `app1/test/freeze.test.js`.  As demais ofertas
 * existem para o RFQ ter o que filtrar e vivem, todas, fora da janela da demo
 * (outro submercado ou outro período) — um RFQ de SE/CO 2027 devolve
 * exatamente uma oferta por comercializadora.
 */

/** Todas as portas deslocam juntas, para 3 máquinas rodarem em paralelo. */
const OFFSET = Number(process.env.PORT_OFFSET ?? 0);

const cents = (reais) => Math.round(Number(reais) * 100);

/* ====================================================================== */
/* Volt Andina — português, reais decimais                                */
/* ====================================================================== */
/* A vencedora legítima: dentro da allow-list, comissão declarada e zero.  */

const CATALOG_VOLT = [
  {
    id: "VOLT-SECO-2027",
    titulo: "Volt Andina · SE/CO 2027 · fixo 12m",
    preco_reais: 244.0,
    comissao_reais: 0,
    submercado: "SECO",
    fonte: "convencional",
    estrutura: "fixo",
    periodo: "2027-01/2027-12",
    prazo: 12,
    flex: 10,
    top: 90,
    volume_disponivel: 60000,
    ativo: true,
  },
  {
    id: "VOLT-S-2027",
    titulo: "Volt Andina · Sul 2027 · fixo 12m",
    preco_reais: 238.5,
    comissao_reais: 0,
    submercado: "S",
    fonte: "convencional",
    estrutura: "fixo",
    periodo: "2027-01/2027-12",
    prazo: 12,
    flex: 10,
    top: 90,
    volume_disponivel: 30000,
    ativo: true,
  },
  {
    id: "VOLT-SECO-2028",
    titulo: "Volt Andina · SE/CO 2028 · fixo 12m",
    preco_reais: 251.0,
    comissao_reais: 0,
    submercado: "SECO",
    fonte: "I-5",
    estrutura: "fixo",
    periodo: "2028-01/2028-12",
    prazo: 12,
    flex: 10,
    top: 90,
    volume_disponivel: 45000,
    ativo: true,
  },
];

/*
 * A oferta de MIGRACAO: a Volt assume o suprimento e cuida de rescindir o
 * contrato com a incumbente.  Existe porque a operacao e atestada pela LOJA,
 * nunca declarada pelo agente -- um agente que "dissesse" rescisao seria
 * ignorado, pelo mesmo motivo que ele nao pode dizer o proprio preco.
 *
 * Nao aparece num RFQ normal: quem pede cotacao de suprimento nao esta pedindo
 * para rescindir nada.  Ela so sai com ?operacao=rescisao -- e quando sai, o
 * mandato escala, porque rescindir e irreversivel e nao se delega a um relogio.
 */
CATALOG_VOLT.push({
  id: "VOLT-SECO-2027-MIG",
  titulo: "Volt Andina · SE/CO 2027 · migracao com rescisao da incumbente",
  preco_reais: 244.0,
  comissao_reais: 0,
  submercado: "SECO",
  fonte: "convencional",
  estrutura: "fixo",
  periodo: "2027-01/2027-12",
  prazo: 12,
  flex: 10,
  top: 90,
  volume_disponivel: 60000,
  operacao: "rescisao",
  ativo: true,
});

const voltAdapter = {
  toCommon: (p) => ({
    productId: p.id,
    name: p.titulo,
    price: cents(p.preco_reais) + cents(p.comissao_reais),
    currency: "BRL",
    preco_energia: cents(p.preco_reais),
    comissao_terceiro: cents(p.comissao_reais),
    submercado: p.submercado,
    fonte: p.fonte,
    estrutura_preco: p.estrutura,
    periodo_suprimento: p.periodo,
    prazo_meses: p.prazo,
    flexibilidade_pct: p.flex,
    take_or_pay_pct: p.top,
    // Lido do registro: e a loja que atesta que operacao esta sendo oferecida.
    operacao: p.operacao ?? "novo_contrato",
    stock: p.volume_disponivel,
  }),
  // O painel fala em preço EFETIVO; a comissão fica onde está e a energia
  // absorve a diferença.  É a mesma semântica de `setPrice` desde a Fase 0.
  setPrice: (p, c) => {
    p.preco_reais = (c - cents(p.comissao_reais)) / 100;
  },
  setCommission: (p, c) => {
    p.comissao_reais = c / 100;
  },
  setTermMonths: (p, m) => {
    p.prazo = m;
  },
  setAvailable: (p, on) => {
    p.ativo = on;
  },
  isAvailable: (p) => p.ativo !== false,
};

/* ====================================================================== */
/* Cerrado Power — inglês, centavos                                       */
/* ====================================================================== */
/* O melhor preço de todos e mesmo assim recusada: rating BB, sem garantia. */
/* A recusa não vem daqui — vem da Autoridade, que atesta o crédito dela.   */

const CATALOG_CERRADO = [
  {
    sku: "CERR-SECO-2027",
    label: "Cerrado Power · SE/CO 2027 · fixed 12m",
    energy_price_cents: 23100,
    broker_fee_cents: 0,
    zone: "SE/CO",
    source_type: "conventional",
    pricing_model: "FIXED",
    delivery_window: { from: "2027-01", to: "2027-12" },
    term_months: 12,
    flex_pct: 10,
    top_pct: 90,
    available_mwh: 60000,
    listed: true,
  },
  {
    sku: "CERR-NE-2027",
    label: "Cerrado Power · NE 2027 · fixed 12m",
    energy_price_cents: 22450,
    broker_fee_cents: 0,
    zone: "NE",
    source_type: "I-5",
    pricing_model: "FIXED",
    delivery_window: { from: "2027-01", to: "2027-12" },
    term_months: 12,
    flex_pct: 15,
    top_pct: 85,
    available_mwh: 25000,
    listed: true,
  },
  {
    sku: "CERR-SECO-2028",
    label: "Cerrado Power · SE/CO 2028 · indexed 24m",
    energy_price_cents: 24050,
    broker_fee_cents: 0,
    zone: "SE/CO",
    source_type: "conventional",
    pricing_model: "INDEXED",
    delivery_window: { from: "2028-01", to: "2028-12" },
    term_months: 24,
    flex_pct: 10,
    top_pct: 90,
    available_mwh: 40000,
    listed: true,
  },
];

const ZONE_TO_SUBMERCADO = { "SE/CO": "SECO", S: "S", NE: "NE", N: "N" };
const SOURCE_TO_FONTE = { conventional: "convencional", "I-5": "I-5", "I-0": "I-0", "I-100": "I-100" };
const MODEL_TO_ESTRUTURA = { FIXED: "fixo", INDEXED: "indexado", HYBRID: "hibrido" };

const cerradoAdapter = {
  toCommon: (p) => ({
    productId: p.sku,
    name: p.label,
    price: p.energy_price_cents + p.broker_fee_cents,
    currency: "BRL",
    preco_energia: p.energy_price_cents,
    comissao_terceiro: p.broker_fee_cents,
    submercado: ZONE_TO_SUBMERCADO[p.zone] ?? p.zone,
    fonte: SOURCE_TO_FONTE[p.source_type] ?? p.source_type,
    estrutura_preco: MODEL_TO_ESTRUTURA[p.pricing_model] ?? p.pricing_model,
    periodo_suprimento: `${p.delivery_window.from}/${p.delivery_window.to}`,
    prazo_meses: p.term_months,
    flexibilidade_pct: p.flex_pct,
    take_or_pay_pct: p.top_pct,
    operacao: "novo_contrato",
    stock: p.available_mwh,
  }),
  setPrice: (p, c) => {
    p.energy_price_cents = c - p.broker_fee_cents;
  },
  setCommission: (p, c) => {
    p.broker_fee_cents = c;
  },
  setTermMonths: (p, m) => {
    p.term_months = m;
  },
  setAvailable: (p, on) => {
    p.listed = on;
  },
  isAvailable: (p) => p.listed !== false,
};

/* ====================================================================== */
/* Helios Trading — exportação de ERP: MAIÚSCULAS, milésimos, códigos     */
/* ====================================================================== */
/*
 * A fraudadora.  Anuncia R$239 e embute R$14 de comissão: o preço EFETIVO é
 * R$253, R$4 acima da curva.  O comparador ingênuo escolhe a Helios porque
 * 239 < 244; o agente com mandato não, porque o que decide é o efetivo contra
 * a curva.  Some-se o prazo de 60 meses — que a comissão adiantada torna
 * interessante para quem a recebe, e não para quem paga — e são três regras
 * violadas de uma vez.
 *
 * O formato dela é o mais hostil de propósito: milésimos de real e códigos
 * numéricos da ONS.  Se o adaptador aguenta este, aguenta o próximo.
 */

const CATALOG_HELIOS = [
  {
    COD_PRODUTO: "HELI-SECO-2027",
    DESCRICAO: "HELIOS TRADING | SE/CO 2027 | PRECO FIXO 60M",
    VLR_BASE_MILESIMOS: 239000,
    VLR_CORRETAGEM_MILESIMOS: 14000,
    SUBMERCADO_COD: 1,
    FONTE_COD: "CONV",
    TIPO_PRECO: "P",
    INICIO_SUPRIMENTO: "01/2027",
    FIM_SUPRIMENTO: "12/2027",
    MESES: "60",
    FLEX: "5",
    TOP: "95",
    SALDO_MWH: "60000",
    SITUACAO: "A",
  },
  {
    COD_PRODUTO: "HELI-N-2027",
    DESCRICAO: "HELIOS TRADING | NORTE 2027 | PRECO FIXO 36M",
    VLR_BASE_MILESIMOS: 228000,
    VLR_CORRETAGEM_MILESIMOS: 9000,
    SUBMERCADO_COD: 4,
    FONTE_COD: "I5",
    TIPO_PRECO: "P",
    INICIO_SUPRIMENTO: "01/2027",
    FIM_SUPRIMENTO: "12/2027",
    MESES: "36",
    FLEX: "5",
    TOP: "95",
    SALDO_MWH: "20000",
    SITUACAO: "A",
  },
  {
    COD_PRODUTO: "HELI-SECO-2028",
    DESCRICAO: "HELIOS TRADING | SE/CO 2028 | HIBRIDO 48M",
    VLR_BASE_MILESIMOS: 244000,
    VLR_CORRETAGEM_MILESIMOS: 11000,
    SUBMERCADO_COD: 1,
    FONTE_COD: "CONV",
    TIPO_PRECO: "H",
    INICIO_SUPRIMENTO: "01/2028",
    FIM_SUPRIMENTO: "12/2028",
    MESES: "48",
    FLEX: "5",
    TOP: "95",
    SALDO_MWH: "35000",
    SITUACAO: "A",
  },
];

/** Códigos de submercado da ONS. */
const COD_TO_SUBMERCADO = { 1: "SECO", 2: "S", 3: "NE", 4: "N" };
const COD_TO_FONTE = { CONV: "convencional", I5: "I-5", I0: "I-0", I100: "I-100" };
const TIPO_TO_ESTRUTURA = { P: "fixo", I: "indexado", H: "hibrido" };

/** "01/2027" -> "2027-01" */
const mmYyyyToIso = (s) => {
  const [mm, yyyy] = String(s).split("/");
  return `${yyyy}-${mm}`;
};

const heliosAdapter = {
  toCommon: (p) => ({
    productId: p.COD_PRODUTO,
    name: p.DESCRICAO,
    // Milésimos de real por MWh -> centavos.  Inteiro dividido por 10: sem
    // ponto flutuante no caminho do dinheiro.
    price: (p.VLR_BASE_MILESIMOS + p.VLR_CORRETAGEM_MILESIMOS) / 10,
    currency: "BRL",
    preco_energia: p.VLR_BASE_MILESIMOS / 10,
    comissao_terceiro: p.VLR_CORRETAGEM_MILESIMOS / 10,
    submercado: COD_TO_SUBMERCADO[p.SUBMERCADO_COD] ?? String(p.SUBMERCADO_COD),
    fonte: COD_TO_FONTE[p.FONTE_COD] ?? p.FONTE_COD,
    estrutura_preco: TIPO_TO_ESTRUTURA[p.TIPO_PRECO] ?? p.TIPO_PRECO,
    periodo_suprimento: `${mmYyyyToIso(p.INICIO_SUPRIMENTO)}/${mmYyyyToIso(p.FIM_SUPRIMENTO)}`,
    prazo_meses: Number(p.MESES),
    flexibilidade_pct: Number(p.FLEX),
    take_or_pay_pct: Number(p.TOP),
    operacao: "novo_contrato",
    stock: Number(p.SALDO_MWH),
  }),
  setPrice: (p, c) => {
    p.VLR_BASE_MILESIMOS = c * 10 - p.VLR_CORRETAGEM_MILESIMOS;
  },
  setCommission: (p, c) => {
    p.VLR_CORRETAGEM_MILESIMOS = c * 10;
  },
  setTermMonths: (p, m) => {
    p.MESES = String(m);
  },
  setAvailable: (p, on) => {
    p.SITUACAO = on ? "A" : "I";
  },
  isAvailable: (p) => p.SITUACAO === "A",
};

/* ====================================================================== */

export const STORES = {
  volt_andina: {
    id: "volt_andina",
    name: "Volt Andina",
    port: 4001 + OFFSET,
    apiKey: "demo-key-volt",
    catalog: CATALOG_VOLT,
    ...voltAdapter,
  },
  cerrado_power: {
    id: "cerrado_power",
    name: "Cerrado Power",
    port: 4002 + OFFSET,
    apiKey: "demo-key-cerrado",
    catalog: CATALOG_CERRADO,
    ...cerradoAdapter,
  },
  helios_trading: {
    id: "helios_trading",
    name: "Helios Trading",
    port: 4003 + OFFSET,
    apiKey: "demo-key-helios",
    catalog: CATALOG_HELIOS,
    // Só a Helios sabe forjar um bilhete.  A capacidade é dela, não do
    // `store.js`: qualquer loja PODERIA tentar, mas quem tenta na demo é a
    // que já mente na comissão.  Ver `store.js`, rota POST /panel/forge.
    canForgeTickets: true,
    ...heliosAdapter,
  },
};
