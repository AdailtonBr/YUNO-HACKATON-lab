/**
 * Rotas da vertical de energia.
 *
 * Vivem separadas de `routes.js` por uma razão de coordenação, não de estilo:
 * quatro frentes estão construindo em paralelo, e endpoint novo em arquivo
 * compartilhado é conflito garantido.  Mesma autenticação, mesmas regras.
 *
 * O que está aqui:
 *  - a CURVA de mercado, que é a alavanca do juiz na prova de fogo;
 *  - o CONTRATO vigente, que é o baseline de todo o cálculo;
 *  - o SUPERSEDE, que é como um limite muda sem que ninguém edite um mandato.
 */

import express from "express";
import { Mandate, SupplyContract, MarketCurve, AuditLog, AgentCycle, nextAuditSeq } from "./models.js";
import { requireHuman, requireAgent } from "./routes.js";
import { opaqueId } from "./ticket.js";
import { mandateStatus } from "./engine.js";
import { curveKeyFor, diasParaDenuncia } from "./energy.js";
import { humanReadable } from "../shared/messages.js";

export function buildEnergyRouter() {
  const r = express.Router();
  const locale = (req) => (req.get("accept-language")?.startsWith("pt") ? "pt-BR" : "en");
  const audit = (entry) => AuditLog.create({ _id: opaqueId("aud"), seq: nextAuditSeq(), ...entry });

  /* --------------------------- o ciclo do agente --------------------------- */
  /*
   * O agente DEPOSITA o rascunho aqui; ele nao escreve no banco.  E o mesmo
   * padrao das propostas de mandato: ele autentica como agente, e quem grava e
   * a Autoridade.  A fronteira continua sendo topologia -- ha um teste que le o
   * codigo do agente para garantir que ele nao alcanca uma colecao.
   */
  r.post("/cycles", requireAgent, async (req, res) => {
    const cycle = req.body?.cycle;
    if (!cycle) return res.status(400).json({ error: "missing_cycle" });
    await AgentCycle.updateOne(
      { _id: req.agentId },
      { $set: { cycle, at: new Date() } },
      { upsert: true }
    );
    res.status(201).json({ ok: true });
  });

  /**
   * O ultimo ciclo, para a tela.
   *
   * `cycle: null` explicito quando nao houve nenhum -- a tela mostra "esperando
   * o primeiro ciclo" em vez de inventar uma tabela vazia que parece erro.
   */
  r.get("/cycles/latest", async (_req, res) => {
    const doc = await AgentCycle.findOne({}).sort({ at: -1 }).lean();
    res.json({ cycle: doc?.cycle ?? null, at: doc?.at ?? null });
  });

  /* ------------------------------ a curva ------------------------------ */
  /*
   * Pública para leitura, de propósito: a curva de referência de um submercado
   * não é segredo de ninguém, e o agente precisa dela a cada ciclo.  O que é
   * segredo é o mandato -- e esse continua atrás da sessão do humano.
   */

  r.get("/curves", async (_req, res) => {
    const list = await MarketCurve.find({}).sort({ _id: 1 }).lean();
    res.json(list.map((c) => ({ submercado: c.submercado, periodo: c.periodo, precoBrlMwh: c.precoBrlMwh, updatedAt: c.updatedAt })));
  });

  /**
   * A alavanca da prova de fogo.
   *
   * O juiz muda a curva e a decisão inteira se remonta no ciclo seguinte, sem
   * ninguém tocar em mandato nenhum.  É por isso que o teto do mandato é
   * RELATIVO: um teto absoluto em R$/MWh ficaria obsoleto em semanas, e a
   * pergunta "esta oferta é boa?" só tem resposta contra o mercado de hoje.
   *
   * Mexer na curva NÃO é mexer na autorização.  O mandato continua dizendo a
   * mesma coisa; o que mudou foi o mundo contra o qual ele é lido.
   */
  r.patch("/curves/:submercado", requireHuman, async (req, res) => {
    let { periodo, precoBrlMwh } = req.body ?? {};
    if (!Number.isInteger(precoBrlMwh) || precoBrlMwh <= 0) {
      return res.status(400).json({ error: "invalid_curve" });
    }

    // O periodo e OPCIONAL quando nao ha ambiguidade.  Quem mexe na curva no
    // meio de uma demo esta dizendo "o mercado do SE/CO mudou", e obriga-lo a
    // digitar o ano e transformar uma alavanca numa formalidade.  Com mais de
    // uma curva no submercado a pergunta volta a ter duas respostas, e ai sim
    // ela precisa ser feita -- com a lista do que existe, para nao adivinhar.
    if (!periodo) {
      const existing = await MarketCurve.find({ submercado: req.params.submercado }).lean();
      if (existing.length === 1) periodo = existing[0].periodo;
      else {
        return res.status(400).json({
          error: existing.length ? "periodo_ambiguo" : "periodo_required",
          periodos: existing.map((c) => c.periodo),
        });
      }
    }

    const _id = `${req.params.submercado}:${periodo}`;
    const before = await MarketCurve.findById(_id).lean();

    const curve = await MarketCurve.findOneAndUpdate(
      { _id },
      { $set: { submercado: req.params.submercado, periodo, precoBrlMwh, updatedAt: new Date() } },
      { new: true, upsert: true }
    ).lean();

    // No trilho, porque uma decisão de compra vai citar este número depois.
    await audit({
      event: "curve_updated",
      actor: { type: "human", id: req.humanId },
      decision: "valido",
      reason: { code: "curve_updated", params: { submercado: curve.submercado, periodo, de: before?.precoBrlMwh ?? null, para: precoBrlMwh } },
    });

    res.json({ submercado: curve.submercado, periodo: curve.periodo, precoBrlMwh: curve.precoBrlMwh });
  });

  /* --------------------------- o contrato vigente --------------------------- */

  r.get("/contracts", requireHuman, async (req, res) => {
    const list = await SupplyContract.find({ humanId: req.humanId }).sort({ createdAt: -1 }).lean();
    res.json(
      list.map((c) => ({
        contractId: c._id,
        fornecedor: c.fornecedor,
        submercado: c.submercado,
        precoBrlMwh: c.precoBrlMwh,
        fimVigencia: c.fimVigencia,
        denunciaDias: c.denunciaDias,
        renovacaoAutomatica: c.renovacaoAutomatica,
        volumeRemanescenteMwh: c.volumeRemanescenteMwh,
        consumoPrevistoPeriodoMwh: c.consumoPrevistoPeriodoMwh,
        flexibilidadePct: c.flexibilidadePct,
        takeOrPayPct: c.takeOrPayPct,
        // Os termos da multa saem junto: sem eles, quem le o contrato pela rota
        // nao consegue reproduzir a conta que a Autoridade faz na hora da
        // compra -- e um numero que so uma parte sabe calcular nao e auditavel.
        multaPisoBrl: c.multaPisoBrl ?? 0,
        taxaAdminBrl: c.taxaAdminBrl ?? 0,
        ativo: c.ativo,
        // O gatilho operacional REAL da decisão -- não é o fim da vigência.
        // Passada a janela, o contrato rola por mais um período, e é essa a
        // renovação silenciosa que o mandato existe para impedir.
        diasParaDenuncia: diasParaDenuncia(c),
      }))
    );
  });

  r.post("/contracts", requireHuman, async (req, res) => {
    const b = req.body ?? {};
    if (!b.submercado || !Number.isInteger(b.precoBrlMwh) || !b.fimVigencia) {
      return res.status(400).json({ error: "missing_fields" });
    }
    const c = await SupplyContract.create({
      _id: opaqueId("ctr"),
      humanId: req.humanId,
      fornecedor: b.fornecedor ?? null,
      submercado: b.submercado,
      precoBrlMwh: b.precoBrlMwh,
      inicioVigencia: b.inicioVigencia ?? null,
      fimVigencia: b.fimVigencia,
      denunciaDias: b.denunciaDias ?? 90,
      renovacaoAutomatica: b.renovacaoAutomatica ?? true,
      volumeRemanescenteMwh: b.volumeRemanescenteMwh ?? 0,
      consumoPrevistoPeriodoMwh: b.consumoPrevistoPeriodoMwh ?? 0,
      flexibilidadePct: b.flexibilidadePct ?? null,
      takeOrPayPct: b.takeOrPayPct ?? null,
      multaPisoBrl: b.multaPisoBrl ?? 0,
      taxaAdminBrl: b.taxaAdminBrl ?? 0,
      ativo: true,
    });
    res.status(201).json({ contractId: c._id });
  });

  /* -------------------------------- derivar -------------------------------- */

  /**
   * Emitir um mandato DERIVADO de outro -- o ato de delegação.
   *
   * Existe como rota própria, e não como um campo em `POST /mandates`, porque
   * delegar é um ato diferente de autorizar.  Quem chama está dizendo "dentro da
   * moldura que eu já abri, abro esta janela menor" -- e a rota deixa isso
   * explícito no trilho, que é de onde a disputa vai tirar o elo da delegação.
   *
   * O filho não pode viver mais que o pai.  Não é detalhe: uma moldura anual da
   * diretoria com um operacional que expira depois dela seria uma autorização
   * que sobrevive a quem a concedeu -- exatamente o anti-padrão da "validade
   * indeterminada" do escopo, por outro caminho.
   *
   * O resto da contenção não é aqui: é viva, na hora da compra.  Revogar o pai
   * mata o filho na leitura seguinte, e é o `/introspect` que garante isso.
   */
  r.post("/mandates/:id/derive", requireHuman, async (req, res) => {
    const parent = await Mandate.findOne({ _id: req.params.id, humanId: req.humanId }).lean();
    if (!parent) return res.status(404).json({ error: "unknown_mandate" });
    if (parent.revoked) return res.status(409).json({ error: "parent_revoked" });

    const b = req.body ?? {};
    if (!b.mode || !b.expiresAt) return res.status(400).json({ error: "missing_fields" });

    const expiresAt = new Date(b.expiresAt);
    if (expiresAt <= new Date()) return res.status(400).json({ error: "expiresAt_in_the_past" });
    if (expiresAt > new Date(parent.expiresAt)) {
      return res.status(400).json({ error: "outlives_parent", parentExpiresAt: parent.expiresAt });
    }

    const draft = {
      mode: b.mode,
      constraints: b.constraints ?? [],
      currency: b.currency ?? parent.currency,
      maxUses: b.maxUses ?? 1,
      expiresAt,
    };

    const child = await Mandate.create({
      _id: opaqueId("mnd"),
      humanId: req.humanId,
      agentId: b.agentId ?? parent.agentId,
      ...draft,
      // O instrumento é o da moldura: delegar poder de comprar não é delegar a
      // escolha de com o que se paga.
      paymentMethodRef: parent.paymentMethodRef,
      shippingAddressId: parent.shippingAddressId ?? null,
      parentMandateId: parent._id,
      humanReadable: humanReadable(draft, locale(req)),
    });

    await audit({
      event: "mandate_created",
      actor: { type: "human", id: req.humanId },
      mandateId: child._id,
      decision: "valido",
      reason: { code: "mandate_derived", params: { parent: parent._id } },
    });

    res.status(201).json({
      mandateId: child._id,
      parentMandateId: parent._id,
      status: mandateStatus(child),
      humanReadable: child.humanReadable,
    });
  });

  /* ------------------------------- supersede ------------------------------- */

  /**
   * Mudar um limite emite uma VERSÃO NOVA; nunca edita a anterior.
   *
   * A diferença não é cosmética.  Se um mandato fosse editável, a pergunta
   * "sob quais limites esta compra foi autorizada?" deixaria de ter resposta —
   * o registro diria os limites de hoje, e não os de quando se comprou.  A
   * disputa vive inteira dessa pergunta.
   *
   * O escopo lista "poder de alterar o próprio mandato" como anti-padrão.  Este
   * endpoint não o contradiz: quem chama é o HUMANO autenticado, na Trusted
   * Surface, e o resultado é um mandato novo assinado por ele.  O agente não
   * alcança esta rota, e alargar continua sendo ato de gente.
   */
  r.post("/mandates/:id/supersede", requireHuman, async (req, res) => {
    const old = await Mandate.findOne({ _id: req.params.id, humanId: req.humanId }).lean();
    if (!old) return res.status(404).json({ error: "unknown_mandate" });
    if (old.revoked) return res.status(409).json({ error: "already_revoked" });

    const b = req.body ?? {};
    const draft = {
      mode: b.mode ?? old.mode,
      constraints: b.constraints ?? old.constraints,
      currency: b.currency ?? old.currency,
      maxUses: b.maxUses ?? old.maxUses,
      expiresAt: new Date(b.expiresAt ?? old.expiresAt),
    };
    if (draft.expiresAt <= new Date()) return res.status(400).json({ error: "expiresAt_in_the_past" });

    const next = await Mandate.create({
      _id: opaqueId("mnd"),
      humanId: req.humanId,
      agentId: old.agentId,
      ...draft,
      // O que NÃO se herda por escolha do chamador: instrumento, entrega e
      // moldura continuam os do mandato anterior.  Trocar a forma de pagamento
      // é outro ato, e não deve pegar carona numa mudança de teto.
      paymentMethodRef: old.paymentMethodRef,
      shippingAddressId: old.shippingAddressId ?? null,
      parentMandateId: old.parentMandateId ?? null,
      // O contador NÃO se herda: usos gastos sob os limites antigos foram
      // gastos sob outra autorização.  A versão nova começa do zero, e é por
      // isso que `maxUses` precisa ser reafirmado a cada versão.
      usedCount: 0,
      version: (old.version ?? 1) + 1,
      supersedes: old._id,
      humanReadable: humanReadable(draft, locale(req)),
    });

    await Mandate.updateOne({ _id: old._id }, { $set: { revoked: true } });

    await audit({
      event: "mandate_created",
      actor: { type: "human", id: req.humanId },
      mandateId: next._id,
      decision: "valido",
      reason: { code: "mandate_superseded", params: { supersedes: old._id, version: next.version } },
    });
    await audit({
      event: "mandate_revoked",
      actor: { type: "human", id: req.humanId },
      mandateId: old._id,
      decision: "valido",
      reason: { code: "mandate_superseded", params: { supersededBy: next._id, version: next.version } },
    });

    res.status(201).json({
      mandateId: next._id,
      version: next.version,
      supersedes: old._id,
      status: mandateStatus(next),
      humanReadable: next.humanReadable,
    });
  });

  return r;
}
