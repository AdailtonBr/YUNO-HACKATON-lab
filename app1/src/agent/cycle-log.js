/**
 * O ciclo diário como DADO, não como texto.
 *
 * É o bloco `08:00 → 08:05` do §7.2 do escopo.  A tentação é montar a string
 * bonita aqui e mandar para a tela; seria errado por dois motivos.  O primeiro
 * é banal: a UI é de outra frente e precisa renderizar do jeito dela.  O
 * segundo importa — uma linha de log é uma afirmação sobre uma decisão de
 * dinheiro, e afirmação que só existe formatada não se audita, não se compara e
 * não se testa.  Aqui saem campos; `formatCycle` no fim é a única concessão à
 * apresentação, e é para o terminal.
 *
 * ## O que este módulo pode e o que não pode afirmar
 *
 * Tudo aqui é **pré-filtro e cortesia**.  Nada nesta tabela autoriza coisa
 * alguma: quem diz sim ou não é a Autoridade, do outro lado da rede, com o
 * bilhete assinado na mão e a curva lida no instante da compra.  Se esta
 * projeção estiver errada — ou for burlada —, o pior que acontece é o agente
 * tentar a oferta errada e ouvir não.
 *
 * A diferença de propósito com o motor: **o motor para na primeira regra que
 * falha e está certo** (dizer "ok" sobre o que não se olhou seria mentira).
 * Quem mostra o quadro completo é esta tabela, que não decide nada e por isso
 * pode se dar ao luxo de olhar tudo.  As duas visões convivem: uma razão única
 * e assinada da Autoridade, uma lista completa do agente.
 */

import { OPS } from "./agent.js";
import { derivedAttributes } from "../authority/energy.js";

/**
 * Os dois atributos que o agente **não tem como** projetar, e não deve tentar.
 *
 * `rating` e `garantia` são juízo sobre a contraparte, e a torção da invariante
 * 4 é justamente essa: quem tem interesse não atesta.  A comercializadora não
 * pode declarar o próprio crédito — mas o agente também não pode adivinhá-lo,
 * senão a Autoridade deixa de ser a fonte e vira conferente de um palpite.
 *
 * Então eles não entram na projeção: entram como PERGUNTA ABERTA, e a oferta é
 * tentada mesmo assim.  Pré-rejeitar por um atributo que só a Autoridade atesta
 * seria o agente decidindo — exatamente o que este projeto existe para impedir.
 */
export const AUTHORITY_ONLY = new Set(["rating", "garantia"]);

/** Códigos de passo do ciclo.  A UI casa por código, nunca por frase. */
export const STEP = {
  CURVE: "curve_read",
  CONTRACT: "contract_read",
  DENUNCIA: "denuncia_window",
  RFQ: "rfq_sent",
  ASSESS: "offers_assessed",
  ATTEMPT: "purchase_attempted",
  OUTCOME: "cycle_outcome",
  BLOCKED: "cycle_blocked",
};

/** Vereditos do PRÉ-FILTRO.  Não confundir com o veredito da Autoridade. */
export const VERDICT = {
  /** Viola uma regra que o agente consegue conferir.  Nem se tenta. */
  REJECTED: "rejected",
  /** Passa nas regras, mas não há ganho: trocar para perder não é oportunidade. */
  DISCARDED: "discarded",
  /** Tentável.  Pode ter perguntas abertas — quem as responde é a Autoridade. */
  ELIGIBLE: "eligible",
};

/**
 * O que a AUTORIDADE vai derivar, projetado com os mesmos números.
 *
 * Repare que chamamos a função pura de `authority/energy.js` em vez de refazer
 * a conta aqui.  Uma segunda implementação da aritmética do dinheiro divergiria
 * da primeira, e divergiria em silêncio — e a divergência apareceria como "o
 * agente disse R$210 mil e a Autoridade cobrou outra coisa", que é precisamente
 * o defeito que a invariante 5 existe para impedir.  Uma conta só.
 *
 * O que continua diferente é a ENTRADA: a curva aqui é a que o agente leu no
 * começo do ciclo; a que decide é a que a Autoridade lê no instante da compra.
 * Se o mercado se mexer entre uma e outra, a Autoridade ganha — e é para isso
 * que a abordagem B existe.
 */
export function project({ offer, contract, curve, quantity }) {
  // `merchant: null` de propósito: ver AUTHORITY_ONLY.  O que sai daqui com
  // rating/garantia é descartado logo abaixo.
  const all = derivedAttributes({ offer, contract, curve, merchant: null, quantity });
  const projected = {};
  for (const [k, v] of Object.entries(all)) {
    if (!AUTHORITY_ONLY.has(k)) projected[k] = v;
  }
  return projected;
}

/**
 * Confere UMA oferta contra TODAS as regras do mandato.
 *
 * @returns { checks, failures, escalations, unknowns, verdict, ... }
 *   `checks`      uma linha por constraint, na ordem do mandato
 *   `failures`    as que falharam e RECUSAM — é o que a tela mostra ao lado da oferta
 *   `escalations` as que falharam e PEDEM UM HUMANO (`on_fail: escalate`)
 *   `unknowns`    as que dependem da Autoridade e ficaram em aberto
 */
export function assessOffer({ offer, mandate, contract, curve, quantity }) {
  const { name, price, currency, stock, ...attested } = offer;
  const total = price * quantity;
  const projected = project({ offer, contract, curve, quantity });

  // A MESMA ordem de montagem que a Autoridade usa: a loja atesta, os derivados
  // entram por cima, e preço/quantidade/total são refeitos.  Montar diferente
  // aqui faria a projeção responder uma pergunta que ninguém vai fazer.
  const attrs = { ...attested, ...projected, price, quantity, total };

  const checks = (mandate.constraints ?? []).map((c) => {
    const base = { attr: c.attr, op: c.op, value: c.value, on_missing: c.on_missing ?? "deny", on_fail: c.on_fail ?? "deny" };

    if (AUTHORITY_ONLY.has(c.attr)) {
      return { ...base, actual: null, ok: null, source: "authority" };
    }
    const actual = attrs[c.attr];
    const source = c.attr in projected ? "derived" : "attested";

    // Ausência não é falha: é ausência, e o eixo que a trata é OUTRO
    // (`on_missing`).  O agente só registra que não veio e deixa a política do
    // mandato dizer o que isso significa.
    if (actual === undefined) {
      const policy = base.on_missing;
      return { ...base, actual: undefined, ok: policy === "allow", missing: true, policy, source };
    }

    const op = OPS[c.op];
    const ok = !!op && op(actual, c.value);
    return { ...base, actual, ok, policy: ok ? null : base.on_fail, source };
  });

  /*
   * Falhar não é uma coisa só — e confundir as duas quebraria a demo inteira.
   *
   * Uma regra com `on_fail: "escalate"` que não bate NÃO recusa a oferta: ela
   * pede um humano.  A alçada da Aurora é exatamente isso (`economia_liquida_brl
   * lte R$50k`), e a Volt Andina a estoura com os R$210 mil — que é o resultado
   * BOM.  Tratar esse estouro como recusa faria o agente descartar justamente a
   * oferta vencedora, e o ciclo terminaria sem nada a mostrar.
   *
   * Mesma lógica na ausência: `on_missing: "escalate"` pergunta, não nega.
   */
  const failures = checks.filter((c) => c.ok === false && c.policy === "deny");
  const escalations = checks.filter((c) => c.ok === false && c.policy === "escalate");
  const unknowns = checks.filter((c) => c.ok === null);
  const gain = projected.economia_liquida_brl ?? null;

  // Ordem de precedência: violar o mandato vence não ter ganho.  Uma oferta que
  // fere uma regra E não economiza é REJEITADA, não descartada — a razão que o
  // humano precisa ouvir é a da regra, não a da aritmética.
  const verdict = failures.length
    ? VERDICT.REJECTED
    : gain !== null && gain <= 0
      ? VERDICT.DISCARDED
      : VERDICT.ELIGIBLE;

  return {
    merchantId: offer.merchantId ?? null,
    merchantName: offer.merchantName ?? null,
    // Para onde a compra vai.  Viaja junto porque a linha avaliada É o que o
    // ciclo entrega a `attemptPurchase` — sem isto o agente sabe o que escolheu
    // e não sabe a quem pedir.
    storeUrl: offer.storeUrl ?? null,
    productId: offer.productId,
    name,
    price,
    currency,
    quantity,
    total,
    projected,
    checks,
    failures,
    escalations,
    unknowns,
    verdict,
    gain,
  };
}

/**
 * Ordena o que sobrou pela ECONOMIA, não pelo preço.
 *
 * É a linha que separa este agente de um comparador ingênuo.  No varejo o mais
 * barato que cabe é o melhor; numa recontratação, não: a multa de rescisão é
 * mark-to-market, o preço do contrato antigo cancela, e o que decide é a oferta
 * contra a CURVA.  Uma oferta pode ser a mais barata da tela e destruir
 * dinheiro — é literalmente o caso da Helios.
 */
export function rankOffers(assessed) {
  return [...assessed]
    .filter((o) => o.verdict === VERDICT.ELIGIBLE)
    .sort((a, b) => (b.gain ?? -Infinity) - (a.gain ?? -Infinity));
}

/**
 * O alerta da janela de denúncia (teste 10).
 *
 * A data-limite real da decisão não é o fim da vigência: é o fim da vigência
 * menos o aviso prévio.  Passada a janela, o contrato rola por mais um período
 * — a renovação silenciosa que o mandato existe para impedir.  Por isso
 * `missed` não é um erro: é uma oportunidade perdida, dita em voz alta.
 */
export function denunciaAlert(daysLeft, thresholds = [30, 15, 7]) {
  if (daysLeft < 0) return { daysLeft, level: null, missed: true };
  // O menor limiar já cruzado é o que vale: faltando 10 dias, o alerta é o de
  // 15, e não o de 30 — a urgência é a mais recente, não a mais antiga.
  const level = [...thresholds].sort((a, b) => a - b).find((t) => daysLeft <= t) ?? null;
  return { daysLeft, level, missed: false };
}

/* ------------------------------------------------------------------ *
 * O acumulador do ciclo
 * ------------------------------------------------------------------ */

/**
 * `steps` é append-only dentro do tique, pela mesma razão que o `audit_log` é:
 * a ordem faz parte do que se está afirmando.  "Leu a curva ANTES de avaliar"
 * é a frase inteira, e ela some se as linhas puderem ser reordenadas depois.
 */
export function startCycle({ cycleId, now = new Date() }) {
  return { cycleId, startedAt: now.toISOString(), steps: [], mandates: [] };
}

export function step(cycle, code, data = {}) {
  cycle.steps.push({ at: new Date().toISOString(), step: code, ...data });
  return cycle;
}

/** Um mandato dentro do ciclo: o que foi avaliado, o que foi tentado, e o fim. */
export function mandateRun(cycle, { mandateId, offers = [], denuncia = null }) {
  const run = { mandateId, denuncia, offers, attempts: [], outcome: null };
  cycle.mandates.push(run);
  return run;
}

/**
 * O resultado de UMA tentativa, com o veredito da Autoridade ao lado da
 * projeção do agente.  Os dois lado a lado de propósito: é assim que se vê que
 * o segundo não é o primeiro — e é o que responde "e se o agente mentir?".
 */
export function attemptResult({ offer, result }) {
  const decision = result?.ok ? "valido" : (result?.action === "escalate" ? "escalado" : "recusado");
  return {
    merchantId: offer.merchantId,
    productId: offer.productId,
    price: offer.price,
    quantity: offer.quantity,
    total: offer.total,
    projectedGain: offer.gain,
    decision,
    // A razão vem da AUTORIDADE, inteira, sem o agente reescrever.  Um agente
    // que resume o próprio "não" é um agente que pode amaciá-lo.
    reason: result?.reason ?? null,
    reasonText: result?.reasonText ?? null,
    receiptId: result?.receiptId ?? null,
    approvalRequestId: result?.approvalRequestId ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Apresentação — só para o terminal
 * ------------------------------------------------------------------ */

const brl = (cents) =>
  cents == null ? "—" : `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MARK = { [VERDICT.ELIGIBLE]: "✓", [VERDICT.REJECTED]: "×", [VERDICT.DISCARDED]: "·" };

/**
 * O bloco do §7.2, para quem está olhando o terminal.  Existe separado do dado
 * porque é a única parte que pode mudar sem que nada tenha mudado.
 */
export function formatCycle(cycle) {
  const lines = [`cycle ${cycle.cycleId} · ${cycle.startedAt}`];

  for (const s of cycle.steps) {
    lines.push(`  ${s.step.padEnd(20, ".")} ${s.note ?? ""}`.trimEnd());
  }

  for (const run of cycle.mandates) {
    lines.push(`  mandate ${run.mandateId}`);
    for (const o of run.offers) {
      const head = `    ${MARK[o.verdict]} ${(o.merchantId ?? "?").padEnd(16)} ${brl(o.price)}/MWh`;
      lines.push(`${head}  net ${brl(o.gain)}`);
      for (const f of o.failures) {
        lines.push(`        × ${f.attr} ${f.op} ${JSON.stringify(f.value)} — got ${JSON.stringify(f.actual)}`);
      }
      for (const e of o.escalations) {
        lines.push(`        ! ${e.attr} ${e.op} ${JSON.stringify(e.value)} — got ${JSON.stringify(e.actual)} · needs a human`);
      }
      for (const u of o.unknowns) {
        lines.push(`        ? ${u.attr} — only the Authority attests this`);
      }
    }
    for (const a of run.attempts) {
      lines.push(`    → ${a.merchantId}/${a.productId} ${a.decision}${a.reasonText ? ` (${a.reasonText})` : ""}`);
    }
  }
  return lines;
}
