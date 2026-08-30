/**
 * Núcleo de energia — os números que a AUTORIDADE atesta.
 *
 * Funções PURAS, no mesmo padrão de `engine.js`: recebem tudo o que precisam,
 * não tocam em I/O, e são testáveis sozinhas.  Quem lê o banco é a rota.
 *
 * A razão de existir deste módulo é a torção da invariante 4:
 * **quem tem interesse não atesta.**  A comercializadora atesta a própria
 * oferta (preço, prazo, flexibilidade) porque é a fonte de verdade sobre ela.
 * Mas o `rating` dela, a curva de mercado e a economia da troca dependem ou do
 * contrato vigente do cliente ou de um juízo sobre a própria contraparte —
 * e nenhum dos dois é dado que a vendedora possa afirmar sobre si mesma.
 *
 * Nada aqui decide nada.  Isto produz ATRIBUTOS; quem decide é o motor de
 * constraints, que não muda uma linha para entender energia.
 */

/** PLD 2026 (Despacho ANEEL nº 3.850/2025), em centavos por MWh. */
export const PLD_TETO_ESTRUTURAL_BRL_MWH = 78527;

/** Duas casas: o suficiente para comparar com um teto de desconto sem mentir. */
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * O desconto da oferta contra a curva, em pontos percentuais.
 *
 * Exportado, e nao inline, porque a disputa RECALCULA este numero a partir da
 * curva congelada no trilho.  Duas copias da formula acabariam divergindo, e a
 * divergencia apareceria como fraude onde so havia bug.
 */
export const descontoVsCurva = (curvaBrlMwh, precoEfetivoBrlMwh) =>
  round2(((curvaBrlMwh - precoEfetivoBrlMwh) / curvaBrlMwh) * 100);

/**
 * Multa rescisória mark-to-market, em centavos.
 *
 * A parte que sai indeniza a contraparte pela diferença entre o preço do
 * contrato e o preço de mercado, sobre o volume remanescente.  Se o mercado
 * subiu acima do contrato, **não há multa** — sair passa a ser bom para a
 * contraparte, e cobrar por isso não se sustenta.
 *
 * `piso` existe porque cláusulas MtM puras são raras: quase sempre há um piso,
 * um teto ou um percentual.  Um piso NÃO se aplica a uma multa que é zero —
 * senão o contrato cobraria para deixar alguém sair quando ninguém perdeu nada.
 */
export function mtm({ pContrato, pMercado, volumeRemanescente, piso = 0 }) {
  const bruto = Math.max(0, pContrato - pMercado) * volumeRemanescente;
  return bruto === 0 ? 0 : Math.max(bruto, piso);
}

/**
 * Os atributos que a Autoridade injeta em `purchase.attributes` antes de
 * chamar `evaluate`.  A lista é a congelada em `docs/ENERGY-VOCABULARY.md`.
 *
 * @param offer     o que a COMERCIALIZADORA atestou sobre a oferta
 * @param contract  o contrato de suprimento vigente do cliente
 * @param curve     a curva de referência do submercado, lida AGORA
 * @param merchant  o registro da contraparte na Autoridade (rating, garantia)
 * @param quantity  MWh que esta operação leva
 */
export function derivedAttributes({ offer, contract, curve, merchant, quantity }) {
  const precoEfetivo = offer.preco_energia + offer.comissao_terceiro;

  const multa = mtm({
    pContrato: contract.precoBrlMwh,
    pMercado: curve.precoBrlMwh,
    volumeRemanescente: contract.volumeRemanescenteMwh,
    piso: contract.multaPisoBrl ?? 0,
  });

  // A conta explícita, e não o atalho.  `(curva − preço) × volume` dá o mesmo
  // número quando o volume novo iguala o remanescente, e é a simplificação que
  // vale o slide — mas o que vai para o trilho tem que ser auditável termo a
  // termo, porque é dele que a disputa se serve.
  const bruta = (contract.precoBrlMwh - precoEfetivo) * quantity;
  const liquida = bruta - multa - (contract.taxaAdminBrl ?? 0);

  // Exposição ao PLD no cenário de teto: o que ficou DESCOBERTO.  Sobrecontratar
  // não expõe ao teto (expõe ao piso, na revenda) — e é a banda de cobertura
  // que trata disso, não este número.
  const descoberto = Math.max(0, contract.consumoPrevistoPeriodoMwh - quantity);

  return {
    // Da contraparte — a Autoridade atesta, a vendedora não.
    rating: merchant?.rating ?? null,
    garantia: !!merchant?.garantia,

    // Do mercado, lido no instante da decisão.
    curva_ref_brl_mwh: curve.precoBrlMwh,
    desconto_vs_curva_pct: descontoVsCurva(curve.precoBrlMwh, precoEfetivo),

    // Da troca.
    multa_rescisoria_brl: multa,
    economia_bruta_brl: bruta,
    economia_liquida_brl: liquida,

    // De risco.
    cobertura_pct: round2((quantity / contract.consumoPrevistoPeriodoMwh) * 100),
    exposicao_pld_brl: descoberto * PLD_TETO_ESTRUTURAL_BRL_MWH,
  };
}

/**
 * Quantos dias faltam para fechar a janela de denúncia.
 *
 * É o gatilho operacional do §3.1: define a data-limite REAL da decisão, que
 * não é o fim da vigência.  Negativo significa que a janela passou e o contrato
 * rola por mais um período — a renovação silenciosa que o mandato existe para
 * impedir.
 */
export function diasParaDenuncia(contract, now = new Date()) {
  const fim = new Date(contract.fimVigencia);
  const limite = new Date(fim.getTime() - contract.denunciaDias * 24 * 60 * 60 * 1000);
  return Math.ceil((limite - now) / (24 * 60 * 60 * 1000));
}

/* ------------------------------------------------------------------ *
 * Utilitários da fronteira: o que a Autoridade precisa saber para
 * decidir SE enriquece, e com quê.  Puros, como o resto do módulo.
 * ------------------------------------------------------------------ */

/**
 * A curva é indexada por submercado e ano de suprimento.
 * `"2027-01/2027-12"` -> `"SECO:2027"`.
 */
export const curveKeyFor = (submercado, periodoSuprimento) =>
  `${submercado}:${String(periodoSuprimento ?? "").slice(0, 4)}`;

/**
 * Isto é uma oferta de energia?
 *
 * A pergunta existe porque a Autoridade é genérica: ela autoriza mandatos, e
 * energia é uma vertical.  Quem diz que a compra é de energia é o DADO — se a
 * oferta traz `preco_energia`, há o que derivar; se não traz, não há.
 *
 * O que torna essa checagem segura, e não um atalho: pular o enriquecimento
 * NUNCA faz uma compra passar.  Se o mandato tem regra sobre `rating` ou
 * `desconto_vs_curva_pct` e os atributos não vierem, o `on_missing: "deny"` do
 * motor recusa.  A rede de proteção já estava armada — esquecer bloqueia.
 */
export const isEnergyOffer = (attributes) => attributes?.preco_energia !== undefined;

/**
 * O preço efetivo tem que FECHAR: é a mesma exigência que o motor já faz sobre
 * o total (`total === price × quantity`).  Um preço efetivo afirmado não é um
 * preço efetivo verificado, e é por dentro dessa fresta que a comissão oculta
 * entraria: bastaria anunciar R$239, cobrar R$253 e declarar zero de comissão.
 */
export const effectivePriceAddsUp = (purchase) =>
  purchase.price === purchase.attributes.preco_energia + purchase.attributes.comissao_terceiro;
