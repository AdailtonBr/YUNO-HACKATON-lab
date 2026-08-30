/**
 * A Autoridade (e o agente) sob /api.
 *
 * `buildApp()` e o MESMO app que sobe no `npm run dev` -- ele nao sabe que esta
 * numa funcao, e nao deveria saber.  A unica diferenca e que aqui ele e montado
 * sob um prefixo, porque na Vercel os quatro processos da demo dividem um
 * dominio so.
 *
 * Isso tambem mantem uma propriedade que a demo precisa: a UI continua chamando
 * `/api/mandates`, exatamente como chama atras do proxy do Vite.  O cliente nao
 * muda entre dev e producao.
 */

import express from "express";
import { buildApp } from "../app1/src/app.js";
import { dbGate, selfUrl, wireEnv } from "./_bootstrap.js";

wireEnv();

const app = express();

/**
 * O relogio do ciclo diario.
 *
 * Nao ha vigia numa funcao sem processo, entao quem bate o tique e o cron da
 * Vercel -- e ele so sabe fazer GET.  Esta rota e cola de deploy e nada mais:
 * ela nao conhece mandato, comercializadora nem credencial, so chama a MESMA
 * rota que o botao "rodar ciclo" do Portal chama.  Um caminho para o ciclo, e
 * nao dois que podem divergir em silencio.
 *
 * O `CRON_SECRET` e o que impede qualquer um na internet de fazer o agente
 * sair cotando.  Sem ele configurado a rota fica aberta -- barulhento no log,
 * porque numa demo publica isso e uma escolha, nao um esquecimento.
 */
app.get("/api/cron/cycle", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.get("authorization") !== `Bearer ${secret}`) {
      return res.status(401).json({ error: "unauthorized" });
    }
  } else {
    console.warn("[cron] CRON_SECRET is not set — /api/cron/cycle is open to anyone.");
  }

  try {
    const r = await fetch(`${selfUrl()}/api/agent/cycles/run`, { method: "POST" });
    const body = await r.json().catch(() => null);
    res.status(r.ok ? 200 : 502).json({ ok: r.ok, cycle: body?.cycle ?? null, error: body?.error });
  } catch (e) {
    res.status(502).json({ error: "cycle_failed", detail: e.message });
  }
});

app.use(dbGate);
app.use("/api", buildApp());

export default app;
