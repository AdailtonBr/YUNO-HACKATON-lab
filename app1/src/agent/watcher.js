/**
 * O ciclo diário do agente de recontratação.
 *
 * Era um vigia de preço de varejo; virou o ciclo do §7.2: puxa a curva, lê o
 * contrato vigente, dispara RFQ nas comercializadoras, avalia cada oferta
 * contra o mandato, tenta a melhor e registra tudo — inclusive as recusas.
 *
 * **Sem LLM, e isso não é economia — é arquitetura.**  Decidir "cabe no
 * mandato?" é o motor de constraints; o modelo só serviria para rascunhar um
 * mandato, e mandato quem cria é o humano.  Um ciclo que chamasse o modelo por
 * mandato por tique seriam centenas de milhares de chamadas por dia para
 * responder uma pergunta que uma comparação determinística responde melhor.
 *
 * **Sem privilégio novo.**  O ciclo é mais um cliente do mesmo caminho
 * `/buy` → `/introspect`.  Ele não alarga mandato, não escreve estado, e a
 * revogação o mata na tentativa seguinte.  Autonomia não adiciona autoridade —
 * é o que responde "e um agente que roda sozinho de madrugada?".
 *
 * O nome do módulo e o de `startWatcher` ficam como estavam: `server.js` e a UI
 * já os chamam, e renomear custaria coordenação com duas frentes para não
 * mudar comportamento nenhum.
 */

import { searchCatalogs, attemptPurchase } from "./agent.js";
import {
  STEP,
  VERDICT,
  assessOffer,
  rankOffers,
  denunciaAlert,
  startCycle,
  step,
  mandateRun,
  attemptResult,
  formatCycle,
} from "./cycle-log.js";
import { Mandate } from "../authority/models.js";
import { mandateStatus } from "../authority/engine.js";
import { diasParaDenuncia } from "../authority/energy.js";

const OFFSET = Number(process.env.PORT_OFFSET ?? 0);

/** Mesmo endereço que `agent/routes.js` resolve, e pela mesma razão: tarde. */
const authorityUrl = () =>
  process.env.AUTHORITY_SELF_URL ?? process.env.AUTHORITY_URL ?? `http://127.0.0.1:${3001 + OFFSET}`;

/**
 * Chave derivada, nunca aleatória.
 *
 * Estável dentro de uma mesma oportunidade — se um tique repetir, ou se a
 * resposta se perder na rede, a idempotência da Autoridade reconhece e não
 * cobra de novo.  E muda quando `usedCount` avança, para um mandato de dois
 * usos conseguir de fato os dois.
 *
 * A quantidade entra na chave desde que o ciclo compra VOLUME: o mesmo produto
 * pelo mesmo preço, em 42.000 MWh ou em 10.000, são duas operações diferentes,
 * e uma chave que não as distingue faria a segunda ser respondida com o recibo
 * da primeira.
 */
export const watchKey = (mandate, item, quantity = 1) =>
  `watch:${mandate._id}:${mandate.usedCount}:${item.merchantId}:${item.productId}:${item.price}:${quantity}`;

/**
 * O tique, como função pura o quanto dá: recebe os mandatos e o retrato do
 * mundo, devolve o que avaliou e o que deve ser tentado.  Quem faz I/O é
 * `runCycle`.  É esta separação que deixa a lógica do ciclo ser testada sem
 * rede, sem banco e sem relógio.
 *
 * O retrato do catálogo é UM só, compartilhado por todos os mandatos — um RFQ
 * por mandato seria O(mandatos × comercializadoras) de rede para perguntar a
 * mesma coisa.
 *
 * @param contract  o contrato vigente do cliente (base de todo o cálculo)
 * @param curve     a curva do submercado, lida no início do ciclo
 */
export function planCycle({
  mandates,
  offers,
  contract,
  curve,
  now = new Date(),
  maxMandates = 5,
  maxAttemptsPerMandate = 3,
}) {
  const plans = [];

  /*
   * Um mandato que é PAI de outro é moldura, não permissão de operar.
   *
   * O guarda-chuva da diretoria tem quatro regras; o operacional que deriva
   * dele tem dezessete.  Se o ciclo operasse sob o pai, ele compraria sob o
   * conjunto MAIS FROUXO tendo um mais apertado disponível — sem comissão
   * declarada, sem banda de cobertura, sem teto de desconto, sem alçada.  A
   * Autoridade continuaria impondo as regras do pai (não é um furo nela), mas o
   * agente teria escolhido a autorização mais permissiva, que é alargar o
   * mandato pela porta dos fundos.  A invariante 2 diz que ele nunca faz isso.
   *
   * A regra sai dos dados e é determinística: quem tem filho é moldura.  E erra
   * para o lado restritivo — na dúvida, opera-se sob menos poder, não mais.
   */
  const molduras = new Set(mandates.map((m) => m.parentMandateId).filter(Boolean));

  for (const mandate of mandates) {
    if (plans.length >= maxMandates) break;
    if (molduras.has(mandate._id)) continue;

    // Revogado, expirado e esgotado saem sozinhos: `active` já significa "vale
    // agora e ainda tem uso".  Não é pré-autorização — é não gastar rede para
    // ouvir um não que já se sabe.  Se o estado mudar entre isto e a compra,
    // quem recusa é a Autoridade, e é ela que tem a palavra.
    if (mandateStatus(mandate, now) !== "active") continue;

    // O volume da operação é o REMANESCENTE do contrato, não uma unidade.  É o
    // que faz `quantity`, `total` e `cobertura_pct` quererem dizer alguma coisa
    // — comprar "1" num mandato de energia não significa nada.
    const quantity = contract.volumeRemanescenteMwh;

    const assessed = offers.map((offer) =>
      assessOffer({ offer, mandate, contract, curve, quantity })
    );

    const denuncia = denunciaAlert(diasParaDenuncia(contract, now));

    // Passada a janela, a oportunidade está perdida até o próximo período: o
    // contrato já rolou.  Tentar assim mesmo seria o agente comprando uma coisa
    // que a empresa não pode mais trocar.
    const ranked = denuncia.missed ? [] : rankOffers(assessed);

    plans.push({
      mandate,
      quantity,
      denuncia,
      assessed,
      attempts: ranked.slice(0, maxAttemptsPerMandate).map((offer) => ({
        offer,
        idempotencyKey: watchKey(mandate, offer, quantity),
      })),
    });
  }

  return plans;
}

/** Lê a curva e o contrato pela porta pública da Autoridade.  Só HTTP. */
async function readWorld(base) {
  const get = async (path) => {
    try {
      const r = await fetch(`${base}${path}`);
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  };
  const [curves, contracts] = await Promise.all([get("/curves"), get("/contracts")]);
  return {
    curve: curves?.curves?.[0] ?? curves?.curve ?? null,
    contract: contracts?.contracts?.[0] ?? contracts?.contract ?? null,
  };
}

/**
 * Um ciclo completo, com I/O.
 *
 * @param deps { stores, agentId, agentSecret, authorityUrl?, maxMandates?,
 *               maxAttemptsPerMandate?, now?, world? }
 *
 * `now` existe para a banca poder adiantar o relógio até a janela de denúncia
 * (teste 10) sem mexer no relógio da máquina.  `world` injeta curva e contrato
 * já lidos — é a costura que deixa o ciclo ser testado sem depender das rotas
 * da Autoridade estarem de pé; em produção ninguém a passa, e a leitura é a
 * HTTP logo abaixo.
 *
 * @returns o log do ciclo — dado estruturado, para a UI renderizar
 */
export async function runCycle(deps) {
  const base = deps.authorityUrl ?? authorityUrl();
  const now = deps.now ?? new Date();
  const cycle = startCycle({ cycleId: `cyc_${Date.now().toString(36)}`, now });

  const { curve, contract } = deps.world ?? (await readWorld(base));

  // Sem curva ou sem contrato, o ciclo NÃO tenta nada.
  //
  // Não é robustez defensiva: é a mesma regra do `on_missing: deny` do mandato,
  // um nível acima.  Comprar energia sem saber o preço de mercado é comprar sem
  // o número que decide se a troca vale — e o lado seguro de "não sei" é parar,
  // não seguir com o último valor que passou pela mão.
  if (!curve || !contract) {
    step(cycle, STEP.BLOCKED, {
      note: "no market curve or no active supply contract — nothing attempted",
      curve: !!curve,
      contract: !!contract,
    });
    return cycle;
  }

  step(cycle, STEP.CURVE, {
    submercado: curve.submercado,
    periodo: curve.periodo,
    precoBrlMwh: curve.precoBrlMwh,
    note: `${curve.submercado} ${curve.periodo} @ ${curve.precoBrlMwh}`,
  });
  step(cycle, STEP.CONTRACT, {
    fornecedor: contract.fornecedor,
    precoBrlMwh: contract.precoBrlMwh,
    volumeRemanescenteMwh: contract.volumeRemanescenteMwh,
    note: `${contract.fornecedor} @ ${contract.precoBrlMwh} · ${contract.volumeRemanescenteMwh} MWh`,
  });

  const mandates = await Mandate.find({ revoked: false }).lean();
  if (mandates.length === 0) {
    step(cycle, STEP.OUTCOME, { note: "no active mandate" });
    return cycle;
  }

  // O RFQ: uma pergunta, as três comercializadoras em paralelo.
  const offers = await searchCatalogs(deps.stores, "");
  step(cycle, STEP.RFQ, {
    merchants: deps.stores.map((s) => s.id),
    offers: offers.length,
    note: `${deps.stores.length} counterparties · ${offers.length} offers`,
  });
  if (offers.length === 0) {
    step(cycle, STEP.OUTCOME, { note: "no offers came back" });
    return cycle;
  }

  const plans = planCycle({
    mandates,
    offers,
    contract,
    curve,
    now,
    maxMandates: deps.maxMandates ?? 5,
    maxAttemptsPerMandate: deps.maxAttemptsPerMandate ?? 3,
  });

  for (const plan of plans) {
    const run = mandateRun(cycle, {
      mandateId: plan.mandate._id,
      offers: plan.assessed,
      denuncia: plan.denuncia,
    });

    step(cycle, STEP.DENUNCIA, {
      mandateId: plan.mandate._id,
      ...plan.denuncia,
      note: plan.denuncia.missed
        ? "notice window closed — opportunity lost until the next cycle"
        : `notice window closes in ${plan.denuncia.daysLeft} days`,
    });

    step(cycle, STEP.ASSESS, {
      mandateId: plan.mandate._id,
      eligible: plan.assessed.filter((o) => o.verdict === VERDICT.ELIGIBLE).length,
      rejected: plan.assessed.filter((o) => o.verdict === VERDICT.REJECTED).length,
      discarded: plan.assessed.filter((o) => o.verdict === VERDICT.DISCARDED).length,
    });

    /*
     * Tenta a lista ordenada até a Autoridade dizer sim ou pedir um humano.
     *
     * Tentar mais de uma é seguro e é informativo: uma recusa não consome uso,
     * não queima o bilhete e não cobra nada — e, ao contrário do palpite do
     * agente, ela é um veredito assinado que entra no trilho.  É assim que a
     * melhor oferta do dia sendo recusada pelo rating vira um FATO na tela, e
     * não uma opinião do comparador.
     *
     * Paramos no primeiro `valido` ou `escalado` porque os dois já resolveram o
     * ciclo: ou comprou, ou a bola está com o humano.  Continuar seria comprar
     * duas vezes a mesma coisa.
     */
    for (const { offer, idempotencyKey } of plan.attempts) {
      const result = await attemptPurchase({
        mandateId: plan.mandate._id,
        item: offer,
        quantity: plan.quantity,
        agentId: deps.agentId,
        agentSecret: deps.agentSecret,
        idempotencyKey,
      });

      const record = attemptResult({ offer, result });
      run.attempts.push(record);
      step(cycle, STEP.ATTEMPT, {
        mandateId: plan.mandate._id,
        merchantId: record.merchantId,
        decision: record.decision,
        note: `${record.merchantId} → ${record.decision}${record.reasonText ? ` (${record.reasonText})` : ""}`,
      });

      if (record.decision !== "recusado") break;
    }

    run.outcome = run.attempts.at(-1) ?? { decision: "nada_tentado" };
    step(cycle, STEP.OUTCOME, {
      mandateId: plan.mandate._id,
      decision: run.outcome.decision,
      note: `${plan.mandate._id} → ${run.outcome.decision}`,
    });
  }

  return cycle;
}

/**
 * Uma tentativa AVULSA, fora da ordem do ciclo.
 *
 * É o teste 6: o gestor olha a Helios, acha o R$239 atraente e manda comprar
 * mesmo assim.  O ciclo nunca a escolheria — mas a defesa do sistema não pode
 * depender do agente ter bom gosto.  Forçar a tentativa é a única forma de
 * mostrar que a recusa vem da Autoridade, e não do pré-filtro.
 */
export async function attemptOffer({ mandate, offer, contract, curve, deps, quantity }) {
  const qty = quantity ?? contract.volumeRemanescenteMwh;
  const assessed = assessOffer({ offer, mandate, contract, curve, quantity: qty });
  const result = await attemptPurchase({
    mandateId: mandate._id,
    item: offer,
    quantity: qty,
    agentId: deps.agentId,
    agentSecret: deps.agentSecret,
    idempotencyKey: deps.idempotencyKey ?? watchKey(mandate, offer, qty),
  });
  return { assessed, result, record: attemptResult({ offer: assessed, result }) };
}

/**
 * O laço.  Um ciclo por vez — sem sobreposição, porque dois ciclos correndo
 * juntos tentariam a mesma oportunidade duas vezes.  (Com várias instâncias da
 * Autoridade seria preciso uma trava no Mongo; fora do escopo do MVP, e o
 * consumo atômico ainda impediria a compra dupla, só desperdiçaria chamadas.)
 *
 * O intervalo é de DEMO.  Em produção o ciclo é diário, na janela de mesa do
 * §4.6 — e o número aqui não muda nada além de com que frequência se pergunta.
 */
export function startWatcher(deps) {
  const interval = Number(process.env.WATCHER_INTERVAL_MS ?? 5000);
  const maxMandates = Number(process.env.WATCHER_MAX_PURCHASES_PER_TICK ?? 5);
  let running = false;
  let last = null;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      last = await runCycle({ ...deps, maxMandates });
      for (const line of formatCycle(last)) console.log(`[cycle] ${line}`);
    } catch (e) {
      console.warn("[cycle] tick failed:", e.message);
    } finally {
      running = false;
    }
  };

  const handle = setInterval(tick, interval);
  handle.unref?.(); // não segura o processo de pé sozinho
  console.log(
    `  daily cycle: every ${interval}ms, at most ${maxMandates} mandates per tick` +
      "  (demo pacing — production would be once a day, in the trading window)"
  );

  const stop = () => clearInterval(handle);
  stop.lastCycle = () => last;
  return stop;
}
