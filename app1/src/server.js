import mongoose from "mongoose";
import dns from "node:dns";
import { buildApp } from "./app.js";
import { seed } from "./seed.js";
import { startWatcher } from "./agent/watcher.js";

/**
 * Um unico deslocamento move TUDO junto -- Autoridade, comercializadoras e UI.
 * E o que permite tres maquinas rodarem a pilha inteira ao mesmo tempo, sem
 * conflito de porta: PORT_OFFSET=0, 10, 20, 30.
 */
const OFFSET = Number(process.env.PORT_OFFSET ?? 0);
const PORT = Number(process.env.PORT ?? 3001 + OFFSET);
const storeUrl = (n, env) => process.env[env] ?? `http://127.0.0.1:${n + OFFSET}`;

/**
 * Um valor explicito vence o deslocamento -- e e essa a regra certa: quem
 * escreve PORT=8080 quer a 8080.  O problema e o .env HERDADO, que fixa a porta
 * sem ninguem ter pedido e faz o PORT_OFFSET nao ter efeito NENHUM, em silencio.
 *
 * Custou duas subidas frustradas ate alguem entender por que a Autoridade
 * insistia em :3001 com PORT_OFFSET=40.  E como e justamente o PORT_OFFSET que
 * permite tres maquinas rodarem a pilha ao mesmo tempo, um silencio aqui vira
 * meia hora perdida na maquina de cada um.  Entao ele deixou de ser silencio.
 */
const pinned = (name, esperado, atual) => {
  if (!OFFSET || atual == null || String(atual) === String(esperado)) return;
  console.warn("");
  console.warn(`!!  PORT_OFFSET=${OFFSET} pede ${name}=${esperado}, mas o ambiente fixa ${atual}.`);
  console.warn(`!!  Um valor fixo no .env ANULA o deslocamento. Remova ${name} do .env para as`);
  console.warn("!!  tres maquinas conseguirem subir a pilha ao mesmo tempo.");
  console.warn("");
};
pinned("PORT", 3001 + OFFSET, process.env.PORT);
pinned("AUTHORITY_URL", `http://127.0.0.1:${3001 + OFFSET}`, process.env.AUTHORITY_URL);

// Aceita os dois nomes: o do repo e o que aparece em projetos Node por aí.
const uriFromEnv = () => process.env.MONGODB_URI || process.env.MONGO_URL || null;

/**
 * `mongodb+srv://` resolve o cluster por registro SRV, e há redes domésticas
 * (e alguns provedores) cujo DNS não devolve esse tipo de registro — a conexão
 * falha com "querySrv ENOTFOUND" mesmo com a string correta.  Apontar o
 * resolver do processo para um DNS público contorna isso.
 *
 * Só mexemos no DNS quando a URI é `+srv`, e dá para desligar com
 * `MONGODB_DNS_SERVERS=""` em redes que exijam o resolver interno.
 */
function fixSrvDns(uri) {
  if (!uri?.startsWith("mongodb+srv://")) return;
  const servers = (process.env.MONGODB_DNS_SERVERS ?? "1.1.1.1,8.8.8.8")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (servers.length) dns.setServers(servers);
}

/**
 * Sem `MONGODB_URI`, a Autoridade sobe com um Mongo em memória e já semeia a
 * allow-list e o agente da demo.  É conveniência de desenvolvimento — nada aqui
 * muda a arquitetura: o mandato continua sendo estado de servidor, escrito só
 * pela Autoridade.  Aponte `MONGODB_URI` para o Atlas quando quiser persistir.
 */
async function memoryDb() {
  const { MongoMemoryServer } = await import("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri("mandato_agentico"));
  return { ephemeral: true };
}

async function connect() {
  const uri = uriFromEnv();
  if (!uri) return memoryDb();

  fixSrvDns(uri);
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    return { ephemeral: false };
  } catch (e) {
    // Cair em memória em vez de morrer: uma demo não pode acabar porque o IP
    // saiu do allowlist do Atlas.  O aviso é barulhento de propósito — dado que
    // some no restart é uma escolha, não algo para se descobrir depois.
    console.warn(`\n!!  Could not reach the configured MongoDB: ${e.message.split(".")[0]}.`);
    console.warn("!!  Falling back to an in-memory database — DATA WILL NOT PERSIST.");
    console.warn("!!  If this is Atlas, add your IP under Network Access.\n");
    return memoryDb();
  }
}

const { ephemeral } = await connect();
await seed();

// O vigia: o que faz "procure até o fim do mês" valer de verdade.  Desligável
// para quem quiser rodar a Autoridade sem nada comprando sozinho.
if (process.env.WATCHER !== "off") {
  startWatcher({
    stores: [
      { id: "volt_andina", url: storeUrl(4001, "STORE_VOLT_URL") },
      { id: "cerrado_power", url: storeUrl(4002, "STORE_CERRADO_URL") },
      { id: "helios_trading", url: storeUrl(4003, "STORE_HELIOS_URL") },
    ],
    agentId: process.env.AGENT_ID ?? "agent_aurora",
    agentSecret: process.env.AGENT_SECRET ?? "demo-agent-secret-aurora",
    // De quem e a empresa que este agente serve.  Sem isto ele nao consegue ler
    // o proprio contrato vigente, e um ciclo sem contrato nao tenta nada.
    humanId: process.env.HUMAN_ID ?? "user_aurora",
  });
}

buildApp().listen(PORT, () => {
  console.log(`Authority listening on :${PORT}`);
  // Nunca imprimimos a URI: ela carrega usuário e senha.
  console.log(`  mongo: ${ephemeral ? "in-memory (data is lost on restart)" : "connected"}`);
  console.log(`  seeded: volt_andina, cerrado_power, helios_trading (allow-list) + agent_aurora`);
});
