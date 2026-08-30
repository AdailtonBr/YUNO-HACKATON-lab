/**
 * Resolução de disputa — "eu nunca autorizei isso".
 *
 * A promessa do trilho append-only só vale se alguém conseguir *usá-lo* para
 * responder essa frase.  Este módulo faz isso: dado o trilho de um mandato e a
 * compra contestada, ele **reconstitui** a cadeia de autorização e diz de que
 * lado o registro está.
 *
 * O ponto que torna isto defensável: o veredito é **calculado do log**, não
 * afirmado.  Ninguém escreve "essa compra era legítima" em lugar nenhum — a
 * legitimidade é derivada de fatos carimbados em ordem, cada um com um dono:
 *
 *   1. o humano criou o mandato, e com quais limites   (mandate_created)
 *   2. quem pediu a compra provou ser o agente do mandato (agentIdAuthenticated,
 *      derivado do purchaseTicket assinado — ver D16)
 *   3. as regras foram avaliadas, e passaram              (trace, regra a regra)
 *   4. se o mandato exigia, houve um sim específico       (approval_granted)
 *   5. o que foi cobrado é o que foi verificado           (payment_result)
 *
 * Falte um elo e o registro está do lado do titular.  Estejam todos, e o
 * registro está do lado da loja — e o titular pode ver exatamente por quê.
 *
 * Função PURA: recebe o trilho e o mandato, devolve o veredito.  Quem lê o
 * banco é a rota.
 */

import { descontoVsCurva } from "./energy.js";

/** Elos que precisam existir para a cobrança se sustentar. */
const LINKS = [
  "mandate_created",
  // Quem autorizou o autorizador.  E a pergunta que o caso pessoal nunca
  // precisou fazer: numa empresa, quem assina precisa ter poderes para assinar.
  "delegation_valid",
  "agent_identity",
  "rules_passed",
  // O numero que decidiu e o numero que ficou no registro.
  "curve_at_decision",
  "human_approval",
  "charged_what_was_verified",
];

const link = (key, ok, detail = {}) => ({ key, ok, ...detail });

/**
 * @param disputed  o evento `purchase_decision` contestado (do audit_log)
 * @param trail     todos os eventos daquele mandato, em ordem cronológica
 * @param mandate   o mandato como está hoje (para o modo e o dono)
 * @param extra     { parent, parentTrail } -- o mandato do qual este deriva e o
 *                  trilho DELE, quando existe.  Sem isso não há como verificar
 *                  a delegação, e um elo que não se pode verificar não é um elo.
 */
export function resolveDispute(disputed, trail, mandate, { parent = null, parentTrail = [] } = {}) {
  // Nada foi cobrado: não há o que disputar.  Vale dizer explicitamente, porque
  // "o agente tentou e foi recusado" é uma memória fácil de confundir com
  // "o agente comprou".
  if (!disputed || disputed.decision !== "valido") {
    return {
      verdict: "nothing_charged",
      charged: null,
      evidence: [],
      brokenLink: null,
    };
  }

  const charged = {
    ts: disputed.ts,
    merchantId: disputed.merchantId,
    productId: disputed.purchase?.productId,
    price: disputed.purchase?.price,
    currency: disputed.purchase?.currency,
    receiptId: disputed.receiptId,
    agentId: disputed.agentIdAuthenticated,
  };

  const before = (e) => new Date(e.ts) <= new Date(disputed.ts);

  // 1) O humano criou o mandato — e o fez ANTES desta compra.
  const created = trail.find((e) => e.event === "mandate_created" && before(e));
  const evidence = [
    link("mandate_created", !!created, {
      ts: created?.ts ?? null,
      by: created?.actor?.id ?? null,
      // Os limites que o humano leu e aceitou, na frase que ele viu.
      terms: mandate?.humanReadable ?? null,
      rules: mandate?.constraints ?? [],
    }),
  ];

  // 1.5) A DELEGAÇÃO: quem emitiu este mandato tinha poderes para emiti-lo?
  //
  //      Num mandato pessoal a pergunta não existe -- o titular é a raiz da
  //      autorização e não presta contas a ninguém.  Numa empresa ela é a
  //      primeira: o gestor de energia opera dentro de uma moldura que a
  //      diretoria abriu, e se a moldura não existia, ou já tinha sido
  //      retirada, o que ele assinou não compromete a empresa.
  //
  //      `null` quando o mandato não deriva de ninguém: não se aplica.
  const needsDelegation = !!mandate?.parentMandateId;
  const parentCreated = parentTrail.find((e) => e.event === "mandate_created" && before(e));
  const parentRevokedBefore = parentTrail.find((e) => e.event === "mandate_revoked" && before(e));

  evidence.push(
    link("delegation_valid", needsDelegation ? !!parent && !!parentCreated && !parentRevokedBefore : null, {
      required: needsDelegation,
      parentMandateId: mandate?.parentMandateId ?? null,
      // Os limites da moldura, na frase que a diretoria leu e aceitou.
      terms: parent?.humanReadable ?? null,
      ts: parentCreated?.ts ?? null,
      by: parentCreated?.actor?.id ?? null,
      // Se o pai já estava revogado quando a compra aconteceu, o elo quebra --
      // e a data está aqui para ninguém precisar acreditar na palavra de nada.
      revokedBefore: parentRevokedBefore?.ts ?? null,
    })
  );

  // 2) Quem comprou provou ser o agente deste mandato.  Não é comparação de
  //    campo declarado: o agentId veio do bilhete assinado (D16).
  const agentMatches = !!mandate && disputed.agentIdAuthenticated === mandate.agentId;
  evidence.push(
    link("agent_identity", agentMatches, {
      claimed: disputed.agentIdAuthenticated ?? null,
      mandateHolder: mandate?.agentId ?? null,
    })
  );

  // 3) As regras foram avaliadas e passaram — com o veredito de cada uma.
  //
  //    Uma regra DISPENSADA por um sim humano explícito não quebra este elo:
  //    ela migra para o elo da aprovação, logo abaixo, que é onde a
  //    responsabilidade de fato passou a morar.  O trace continua mostrando
  //    qual regra foi, para ninguém precisar acreditar na palavra de nada.
  const trace = disputed.trace ?? [];
  const waived = trace.filter((t) => t.verdict === "approved_by_human");
  const allOk =
    trace.length > 0 && trace.every((t) => ["ok", "missing_allowed", "approved_by_human"].includes(t.verdict));
  evidence.push(link("rules_passed", allOk, { trace, waived: waived.map((t) => t.attr) }));

  // 3.5) A CURVA: o número que decidiu é o número que ficou no registro?
  //
  //      O mandato limita o desconto CONTRA o mercado, então a decisão inteira
  //      pendura-se num número externo que muda todo dia.  Congelamos a curva
  //      usada no trilho; aqui a conta é REFEITA a partir dela.  Bate, e o
  //      desconto que aprovou a compra é verificável meses depois; não bate, e
  //      alguém aprovou contra um mercado diferente do que registrou.
  //
  //      `null` quando a compra não é de energia: não se aplica.
  const curva = disputed.purchase?.attributes?.curva_ref_brl_mwh;
  const registrado = disputed.purchase?.attributes?.desconto_vs_curva_pct;
  const recalculado = curva != null ? descontoVsCurva(curva, disputed.purchase.price) : null;

  evidence.push(
    link("curve_at_decision", curva == null ? null : registrado === recalculado, {
      required: curva != null,
      curva,
      precoEfetivo: curva != null ? disputed.purchase.price : null,
      registrado: registrado ?? null,
      recalculado,
    })
  );

  // 4) Se o mandato exigia aprovação por compra, tem que existir um sim
  //    específico — e específico daquela compra, não um sim genérico.
  // A aprovação é exigida por duas origens, e o elo cobre as duas: o mandato
  // pedir um sim a cada compra, OU uma regra ter sido dispensada por um sim.
  const needsApproval = mandate?.mode === "aprovacao" || waived.length > 0;
  const granted = trail.find(
    (e) =>
      e.event === "approval_granted" &&
      before(e) &&
      e.purchase?.productId === charged.productId &&
      e.purchase?.price === charged.price
  );
  evidence.push(
    link("human_approval", needsApproval ? !!granted : null, {
      required: needsApproval,
      // Por que foi exigido: o modo do mandato, ou a regra que alguém dispensou.
      because: waived.length ? { waived: waived.map((t) => t.attr) } : mandate?.mode === "aprovacao" ? { mode: "aprovacao" } : null,
      ts: granted?.ts ?? null,
      by: granted?.actor?.id ?? null,
    })
  );

  // 5) O verificado é o cobrado: o recibo existe e é do mesmo valor.
  const payment = trail.find(
    (e) => e.event === "payment_result" && e.receiptId && e.receiptId === disputed.receiptId
  );
  const amountMatches = !!payment && payment.purchase?.price === charged.price;
  evidence.push(
    link("charged_what_was_verified", amountMatches, {
      verified: charged.price,
      charged: payment?.purchase?.price ?? null,
      receiptId: payment?.receiptId ?? null,
    })
  );

  // `null` é "não se aplica" (aprovação num mandato autônomo), não uma falha.
  const broken = evidence.find((e) => e.ok === false);

  return {
    verdict: broken ? "not_authorized" : "authorized",
    charged,
    evidence,
    brokenLink: broken?.key ?? null,
  };
}

export const DISPUTE_LINKS = LINKS;
