/**
 * API do AGENTE para a UI do humano.  Não confundir com as rotas da Autoridade:
 * este router não escreve estado de mandato nem decide verificação — ele busca,
 * compara e tenta comprar, e repassa o que a Autoridade respondeu.
 *
 * As lojas que o agente conhece são as REGISTRADAS.  A loja fora da allow-list
 * fica aqui de propósito, atrás de uma flag, para a demo do anti-site-fake:
 * o agente até tenta, e a Autoridade recusa na porta.
 */

import express from "express";
import { searchCatalogs, compare, attemptPurchase } from "./agent.js";
import { runTurn, windowHistory } from "./llm.js";
import { runCycle } from "./watcher.js";

// Lidos a cada chamada, não na carga do módulo: os testes sobem tudo em portas
// efêmeras, e config lida cedo demais congela endereços que ainda não existem.
const OFFSET = Number(process.env.PORT_OFFSET ?? 0);
const at = (n, env) => process.env[env] ?? `http://127.0.0.1:${n + OFFSET}`;

const authorityUrl = () => process.env.AUTHORITY_SELF_URL ?? at(3001, "AUTHORITY_URL");

const knownStores = () => [
  { id: "volt_andina", url: at(4001, "STORE_VOLT_URL") },
  { id: "cerrado_power", url: at(4002, "STORE_CERRADO_URL") },
  { id: "helios_trading", url: at(4003, "STORE_HELIOS_URL") },
];
// Uma comercializadora FORA da allow-list, para a demo do anti-slamming: ela
// existe do lado de fora, o agente ate tenta, e a Autoridade recusa na porta.
// Nao ha ninguem escutando em 4004 ate alguem subir uma -- Frente B, se sobrar.
const unregisteredStore = () => ({ id: "nao_credenciada", url: at(4004, "STORE_FAKE_URL") });

// O agente guarda o PRÓPRIO segredo.  Ele não tem, e não precisa ter, acesso ao
// banco da Autoridade — tudo o que sabe do mandato vem da rota pública de leitura.
const agentCredential = () => ({
  id: process.env.AGENT_ID ?? "agent_aurora",
  secret: process.env.AGENT_SECRET ?? "demo-agent-secret-aurora",
  humanId: process.env.HUMAN_ID ?? "user_aurora",
});

/**
 * Histórico de conversa, em memória e por conversa.
 *
 * É estado DO AGENTE, não do mandato — some quando o processo reinicia, e isso
 * não tem consequência nenhuma para a autorização.  Nada aqui autoriza nada:
 * o que autoriza vive no Mongo, escrito só pela Autoridade.
 */
const conversations = new Map();

export function buildAgentRouter() {
  const r = express.Router();

  const storesFor = (includeFake) => (includeFake ? [...knownStores(), unregisteredStore()] : knownStores());

  /**
  /**
   * Roda um ciclo AGORA.
   *
   * A demo não pode depender de esperar o relógio: numa apresentação de cinco
   * minutos, "espere o próximo tique" é tempo morto na frente da banca.
   */
  r.post("/agent/cycles/run", async (_req, res) => {
    const agent = agentCredential();
    try {
      const cycle = await runCycle({
        stores: knownStores(),
        agentId: agent.id,
        agentSecret: agent.secret,
        humanId: agent.humanId,
        authorityUrl: authorityUrl(),
      });
      res.json({ cycle });
    } catch (e) {
      res.status(502).json({ error: "cycle_failed", detail: e.message });
    }
  });

  r.get("/agent/catalogs", async (req, res) => {
    const items = await searchCatalogs(storesFor(req.query.includeUnregistered === "true"), req.query.q ?? "");
    res.json({ items });
  });

  /**
   * Um ciclo do agente: lê o mandato (pela porta pública), busca, compara,
   * escolhe e tenta.  Devolve a comparação junto com o resultado — "por que
   * este e não aquele?" é pergunta que o humano tem direito de fazer.
   */
  r.post("/agent/shop", async (req, res) => {
    const { mandateId, query = "", strategy = "best", includeUnregistered = false } = req.body ?? {};
    if (!mandateId) return res.status(400).json({ error: "missing_mandateId" });

    // Leitura pela MESMA porta pública que qualquer um usa.  Não expõe o
    // paymentMethodRef, e o agente não teria como alcançá-lo de outro jeito.
    const mandate = await fetch(`${authorityUrl()}/mandates/${mandateId}`).then((x) => (x.ok ? x.json() : null));
    if (!mandate) return res.status(404).json({ error: "unknown_mandate" });

    const items = await searchCatalogs(storesFor(includeUnregistered), query);
    const { comparison, chosen } = compare(items, mandate, strategy);

    if (!chosen) {
      return res.json({ mandate, comparison, chosen: null, result: null, note: "no_option_fits" });
    }

    const agent = agentCredential();
    const result = await attemptPurchase({
      mandateId,
      item: chosen,
      agentId: agent.id,
      agentSecret: agent.secret,
    });

    res.json({ mandate, comparison, chosen, result });
  });

  /**
   * A conversa (Fase 5).  O humano escreve em linguagem natural; o modelo busca,
   * pergunta o que falta, propõe, e — quando já existe mandato autorizado —
   * compra.  Toda decisão sobre validade continua na Autoridade.
   */
  r.post("/agent/chat", async (req, res) => {
    const { conversationId = "default", message, mandateId } = req.body ?? {};
    if (!message?.trim()) return res.status(400).json({ error: "empty_message" });

    // O agente lê o mandato pela porta pública, como qualquer cliente.
    //
    // Repare no que NÃO fazemos aqui: filtrar por status.  Se o mandato existe,
    // ele vai para o agente mesmo revogado ou expirado — e o agente TENTA.  Quem
    // recusa é a Autoridade, na hora da compra.
    //
    // Não é detalhe de demo: é a abordagem B levada a sério.  "Ainda vale?" é
    // pergunta cujo lugar de resposta é o instante da compra.  Se o agente
    // pré-checasse o status, ele estaria reimplementando a verificação do lado
    // errado da rede — e um agente com bug simplesmente não a faria.
    let mandate = null;
    if (mandateId) {
      mandate = await fetch(`${authorityUrl()}/mandates/${mandateId}`)
        .then((x) => (x.ok ? x.json() : null))
        .catch(() => null);
    }

    const agent = agentCredential();
    // Saneado também na LEITURA: um histórico já gravado quebrado se cura
    // sozinho, em vez de exigir reiniciar o servidor para conversar de novo.
    const history = windowHistory(conversations.get(conversationId) ?? []);

    try {
      const out = await runTurn({
        history,
        message,
        mandate,
        deps: {
          stores: knownStores(),
          agentId: agent.id,
          agentSecret: agent.secret,
          authorityUrl: authorityUrl(),
          // De quem é a carteira que o agente consulta.  Vem do cadastro do
          // agente, não do corpo da requisição: o agente serve a UMA pessoa.
          humanId: agent.humanId,
        },
      });
      conversations.set(conversationId, windowHistory(out.history)); // janela curta, cortada onde a API aceita
      res.json({ conversationId, text: out.text, events: out.events });
    } catch (e) {
      const missingKey = e.message === "missing_openai_key";
      res.status(missingKey ? 503 : 502).json({
        error: missingKey ? "missing_openai_key" : "agent_unavailable",
        detail: e.message,
      });
    }
  });

  r.post("/agent/reset", (req, res) => {
    conversations.delete(req.body?.conversationId ?? "default");
    res.json({ ok: true });
  });

  return r;
}
