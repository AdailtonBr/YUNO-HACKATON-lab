/**
 * As três comercializadoras da demo (App 2).
 *
 * >>> ESQUELETO DA FASE 0 — a Frente B substitui este arquivo. <<<
 *
 * O que está aqui é o mínimo para o sistema andar de ponta a ponta enquanto as
 * frentes trabalham em paralelo: uma oferta por comercializadora, no formato
 * congelado de `docs/12-vocabulario-energia.md`, e um formato interno único.
 *
 * O que a Frente B ainda deve fazer:
 *  - dar a cada comercializadora um formato interno DIFERENTE (é o que prova
 *    que o adaptador basta — hoje as três compartilham o mesmo, e isso não
 *    prova nada);
 *  - o RFQ de verdade em `GET /catalog?submercado=&periodo=&volume_mwh=`;
 *  - mais ofertas por comercializadora, e o painel do operador editando
 *    comissão e prazo;
 *  - o caminho do bilhete forjado da Helios (teste 8).
 *
 * A regra que NÃO pode ser quebrada aqui: a oferta **não carrega `rating` nem
 * `garantia`**.  Quem os atesta é a Autoridade, a partir da allow-list.  Uma
 * vendedora que declara o próprio rating é exatamente o furo que este projeto
 * existe para fechar.
 */

/** Todas as portas deslocam juntas, para 3 máquinas rodarem em paralelo. */
const OFFSET = Number(process.env.PORT_OFFSET ?? 0);

/* ---------------------------- Volt Andina ---------------------------- */
/* A vencedora legítima: dentro da whitelist, comissão declarada como zero.  */

const CATALOG_VOLT = [
  {
    id: "VOLT-SECO-2027",
    titulo: "Volt Andina · SE/CO 2027 · fixo 12m",
    preco_energia_centavos: 24400,
    comissao_centavos: 0,
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
];

/* --------------------------- Cerrado Power --------------------------- */
/* O melhor preço, e mesmo assim recusada: rating BB, sem garantia.        */

const CATALOG_CERRADO = [
  {
    id: "CERR-SECO-2027",
    titulo: "Cerrado Power · SE/CO 2027 · fixo 12m",
    preco_energia_centavos: 23100,
    comissao_centavos: 0,
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
];

/* --------------------------- Helios Trading -------------------------- */
/*
 * A fraudadora.  Anuncia R$239 e embute R$14 de comissão: o preço EFETIVO é
 * R$253, que é R$4 acima da curva.  O comparador ingênuo escolhe a Helios
 * porque 239 < 244; o agente com mandato não, porque o que importa é a oferta
 * contra a curva.  Some-se o prazo de 60 meses, incentivado pela comissão
 * adiantada, e são três regras violadas de uma vez.
 */

const CATALOG_HELIOS = [
  {
    id: "HELI-SECO-2027",
    titulo: "Helios Trading · SE/CO 2027 · fixo 60m",
    preco_energia_centavos: 23900,
    comissao_centavos: 1400,
    submercado: "SECO",
    fonte: "convencional",
    estrutura: "fixo",
    periodo: "2027-01/2027-12",
    prazo: 60,
    flex: 5,
    top: 95,
    volume_disponivel: 60000,
    ativo: true,
  },
];

/**
 * O adaptador: formato interno -> vocabulário comum.
 *
 * `price` é o preço EFETIVO (energia + comissão) porque é ele que sai da conta.
 * Os dois componentes viajam junto para a Autoridade poder REFAZER a conta —
 * um preço efetivo afirmado não é um preço efetivo verificado.
 */
const toCommon = (p) => ({
  productId: p.id,
  name: p.titulo,
  price: p.preco_energia_centavos + p.comissao_centavos,
  currency: "BRL",
  preco_energia: p.preco_energia_centavos,
  comissao_terceiro: p.comissao_centavos,
  submercado: p.submercado,
  fonte: p.fonte,
  estrutura_preco: p.estrutura,
  periodo_suprimento: p.periodo,
  prazo_meses: p.prazo,
  flexibilidade_pct: p.flex,
  take_or_pay_pct: p.top,
  operacao: "novo_contrato",
  // Volume disponível em MWh: `store.js` já recusa quantidade acima do estoque.
  stock: p.volume_disponivel,
  // NUNCA `rating` nem `garantia`: quem atesta a contraparte é a Autoridade.
});

const setPrice = (p, cents) => {
  p.preco_energia_centavos = cents - p.comissao_centavos;
};
const setAvailable = (p, available) => {
  p.ativo = available;
};
const isAvailable = (p) => p.ativo !== false;

const shared = { toCommon, setPrice, setAvailable, isAvailable };

export const STORES = {
  volt_andina: {
    id: "volt_andina",
    name: "Volt Andina",
    port: 4001 + OFFSET,
    apiKey: "demo-key-volt",
    catalog: CATALOG_VOLT,
    ...shared,
  },
  cerrado_power: {
    id: "cerrado_power",
    name: "Cerrado Power",
    port: 4002 + OFFSET,
    apiKey: "demo-key-cerrado",
    catalog: CATALOG_CERRADO,
    ...shared,
  },
  helios_trading: {
    id: "helios_trading",
    name: "Helios Trading",
    port: 4003 + OFFSET,
    apiKey: "demo-key-helios",
    catalog: CATALOG_HELIOS,
    ...shared,
  },
};
