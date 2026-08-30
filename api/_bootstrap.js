/**
 * A cola de deploy: o que a serverless muda -- e o que ela nao muda.
 *
 * Nada aqui e arquitetura.  Os quatro papeis continuam os mesmos, a Autoridade
 * continua sendo a unica a escrever estado, e o agente continua falando com ela
 * por HTTP como qualquer cliente.  O que muda e onde cada papel ATENDE: em vez
 * de quatro processos em quatro portas, sao duas funcoes atras de um dominio
 * so, distinguidas pelo prefixo do caminho (`/api`, `/volt`, `/cerrado`,
 * `/helios`).  Os enderecos ja eram lidos de variavel de ambiente -- este
 * arquivo so preenche as variaveis com o que o deploy revelou sobre si mesmo.
 *
 * Duas coisas a serverless quebra de verdade, e as duas estao tratadas:
 *
 *  1. NAO HA PROCESSO VIVO.  `startWatcher` depende de um `setInterval` que so
 *     existe enquanto alguem esta rodando; numa funcao que morre ao responder,
 *     o tique nunca chega.  O relogio passa a ser o cron da Vercel, que bate na
 *     mesma rota que o botao "rodar ciclo" da UI.
 *
 *  2. NAO HA MEMORIA ENTRE CHAMADAS.  Por isso o Mongo deixa de ser opcional:
 *     o banco em memoria do dev nasceria vazio a cada requisicao, e "revoguei
 *     ontem" precisa continuar valendo hoje.  Sem `MONGODB_URI` isto falha alto,
 *     na primeira chamada, em vez de servir um sistema que esquece.
 */

import mongoose from "mongoose";
import { seed } from "../app1/src/seed.js";

/**
 * A origem publica deste deploy, descoberta do proprio ambiente.
 *
 * Em producao preferimos o dominio estavel do projeto: a URL especifica do
 * deployment muda a cada push, e o agente guardaria o endereco da versao
 * anterior.  Em preview so existe a do deployment -- e e a certa, porque cada
 * preview deve falar consigo mesmo, nao com a producao.
 */
export function selfUrl() {
  const fromEnv = process.env.PUBLIC_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (process.env.VERCEL_ENV === "production" && prod) return `https://${prod}`;

  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://127.0.0.1:${Number(process.env.PORT ?? 3001)}`;
}

/**
 * Preenche os enderecos que os modulos ja liam de ambiente.
 *
 * `??=` de proposito: um valor explicito na configuracao do projeto vence a
 * deducao.  E o que permite apontar o agente para comercializadoras hospedadas
 * noutro lugar sem tocar em codigo -- a topologia continua sendo dado.
 */
export function wireEnv() {
  const base = selfUrl();
  const fill = (key, value) => {
    if (!process.env[key]) process.env[key] = value;
  };

  // A Autoridade atende sob /api; o agente e as lojas precisam saber disso.
  fill("AUTHORITY_SELF_URL", `${base}/api`);
  fill("AUTHORITY_URL", `${base}/api`);

  fill("STORE_VOLT_URL", `${base}/volt`);
  fill("STORE_CERRADO_URL", `${base}/cerrado`);
  fill("STORE_HELIOS_URL", `${base}/helios`);

  // O vigia nao sobe aqui: quem bate o relogio e o cron (ver vercel.json).
  fill("WATCHER", "off");
}

/**
 * Uma conexao por instancia, reaproveitada entre invocacoes.
 *
 * O escopo do modulo sobrevive enquanto a instancia estiver quente, entao a
 * promessa fica guardada: chamadas simultaneas esperam a MESMA conexao em vez
 * de abrirem uma cada.  Sem isso, um pico de trafego esgota o pool do Atlas com
 * conexoes que ninguem vai usar duas vezes.
 *
 * A falha limpa o cache de proposito -- uma promessa rejeitada guardada seria
 * um erro permanente ate a instancia morrer.
 */
let connecting = null;

export async function connect() {
  if (mongoose.connection.readyState === 1) return;

  if (!connecting) {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
    if (!uri) {
      throw new Error(
        "MONGODB_URI is required on a serverless deploy: there is no process to hold an in-memory database between requests."
      );
    }
    connecting = mongoose
      .connect(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 5 })
      // A semeadura e toda de upserts, entao repeti-la a cada instancia fria e
      // barato e idempotente -- e garante que a allow-list de contrapartes
      // exista antes da primeira introspeccao.
      .then(() => seed())
      .catch((e) => {
        connecting = null;
        throw e;
      });
  }
  await connecting;
}

/** Porteiro: nenhuma rota corre antes de o banco estar de pe. */
export const dbGate = async (_req, res, next) => {
  try {
    await connect();
    next();
  } catch (e) {
    res.status(503).json({ error: "database_unavailable", detail: e.message });
  }
};
