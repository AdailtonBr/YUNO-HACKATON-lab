/**
 * A COMPOSIÇÃO de deploy, montada e dirigida.
 *
 * `api/` é o único código do repositório que nenhum teste alcançava, e é
 * justamente onde um erro não aparece: as suítes sobem `buildApp()` e
 * `buildStore()` direto, então o dia em que o prefixo de montagem mudar, ou o
 * porteiro do banco parar de deixar passar, tudo continua verde — e só a Vercel
 * fica quebrada.
 *
 * Este teste monta as DUAS funções como os rewrites do `vercel.json` montam
 * (um domínio, quatro prefixos) e exercita o que a serverless muda de verdade:
 *
 *   - a Autoridade responde sob `/api`, as três comercializadoras sob os seus
 *     prefixos, e o painel do operador sobrevive a ser servido fora da raiz;
 *   - o ciclo diário, que sem processo vivo não tem quem o dispare, roda pela
 *     rota do cron — e o cron exige o segredo;
 *   - o rascunho do ciclo é DEPOSITADO na Autoridade.  Ele morava na memória do
 *     processo, e numa função que morre ao responder a tela nasceria vazia para
 *     sempre.  É a asserção mais importante do arquivo.
 */

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

let mongod;
let server;
let base;
const CRON_SECRET = "test-cron-secret";

before(async () => {
  mongod = await MongoMemoryServer.create();

  // O endereço tem que existir ANTES do import: os dois módulos leem `selfUrl()`
  // na carga (é assim que o agente descobre onde ficam as comercializadoras).
  // Daí o handler mutável — a porta é efêmera e só se sabe depois do listen.
  let handler = (_req, res) => res.end();
  server = http.createServer((req, res) => handler(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));

  base = `http://127.0.0.1:${server.address().port}`;
  process.env.PUBLIC_URL = base;
  process.env.MONGODB_URI = mongod.getUri("mandato_agentico");
  process.env.SEED_MANDATES = "1";
  process.env.CRON_SECRET = CRON_SECRET;

  const [{ default: authorityFn }, { default: storeFn }] = await Promise.all([
    import("../../api/index.js"),
    import("../../api/store.js"),
  ]);

  // O roteamento por prefixo é o que o `vercel.json` faz com rewrites.
  const app = express();
  app.use((req, res, next) =>
    /^\/(volt|cerrado|helios)(\/|$)/.test(req.url) ? storeFn(req, res, next) : authorityFn(req, res, next)
  );
  handler = app;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  await mongod.stop();
});

const call = (method, path, headers = {}) =>
  fetch(base + path, { method, headers: { "x-human-id": "user_aurora", ...headers } });

test("a Autoridade responde sob /api", async () => {
  const r = await call("GET", "/api/health");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test("as tres comercializadoras respondem cada uma sob o seu prefixo", async () => {
  for (const [prefixo, nome] of [
    ["/volt", "volt_andina"],
    ["/cerrado", "cerrado_power"],
    ["/helios", "helios_trading"],
  ]) {
    const r = await call("GET", `${prefixo}/products`);
    assert.equal(r.status, 200, `${prefixo} nao respondeu`);
    const body = await r.json();
    assert.equal(body.merchantId, nome);
    assert.ok(body.items.length > 0, `${prefixo} veio sem ofertas`);
  }
});

test("o painel do operador funciona servido FORA da raiz", async () => {
  // Ele chamava `/products` em caminho absoluto; sob `/volt` isso bate na
  // Autoridade e o painel abre vazio, sem erro visivel.  A base sai do
  // proprio endereco -- e isto e o que garante que continue saindo.
  const html = await (await call("GET", "/volt/")).text();

  // COMPILAR primeiro.  A base entrou com a barra desescapada uma vez --
  // `replace(//+$/, ...)` -- e `//` em JS abre um comentario: o painel servia
  // 200 OK com um script que nao rodava, e uma asserção de texto nao percebia.
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "o painel nao trouxe script nenhum");
  assert.doesNotThrow(() => new Function(script), "o script do painel nao compila");

  assert.match(script, /location\.pathname/, "o painel nao deriva a propria base");
  assert.match(script, /BASE \+ '\/products'/, "o painel voltou a chamar caminho absoluto");
});

test("o cron do ciclo exige o segredo", async () => {
  assert.equal((await call("GET", "/api/cron/cycle")).status, 401);
});

test("um ciclo rodado pelo cron fica LEGIVEL depois — nao mora na memoria do processo", async () => {
  assert.equal((await (await call("GET", "/api/cycles/latest")).json()).cycle, null);

  const r = await call("GET", "/api/cron/cycle", { authorization: `Bearer ${CRON_SECRET}` });
  assert.equal(r.status, 200);
  const { ok, cycle } = await r.json();
  assert.equal(ok, true);
  assert.ok(cycle?.steps?.some((s) => s.step === "rfq_sent"), "o ciclo nao consultou as comercializadoras");

  // O ponto do teste: outra requisicao -- que numa funcao e outro processo --
  // enxerga o ciclo.  Ele foi depositado na Autoridade, nao guardado no agente.
  const depois = await (await call("GET", "/api/cycles/latest")).json();
  assert.equal(depois.cycle?.cycleId, cycle.cycleId);
  assert.ok(depois.at, "o deposito nao registrou quando aconteceu");
});
