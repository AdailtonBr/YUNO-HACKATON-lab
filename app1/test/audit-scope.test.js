/** O trilho é do titular do mandato; id opaco não é permissão. */

import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import { buildApp } from "../src/app.js";
import { seed, DEMO } from "../src/seed.js";
import { AuditLog, Mandate, Merchant, Agent, PaymentMethod, SupplyContract, MarketCurve } from "../src/authority/models.js";

let mongod, server, base;
const asAurora = { "x-human-id": DEMO.humanId };
const asOther = { "x-human-id": "user_other" };

const get = (path, headers) => fetch(`${base}${path}`, { headers });

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri("audit_scope_test"));
  await new Promise((resolve) => {
    server = buildApp().listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  // Desmontagem defensiva, e o motivo e concreto: um erro lancado AQUI marca o
  // arquivo inteiro como falho enquanto todos os testes dentro dele passam --
  // que e exatamente o sintoma que este arquivo dava, de forma intermitente,
  // quando a suite roda os arquivos em paralelo.  Fechar o servidor sem
  // esperar deixava soquetes vivos na hora do force-exit, e parar o mongod ja
  // morto lanca.  Nenhum dos dois diz nada sobre o codigo sob teste.
  await new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await mongoose.disconnect().catch(() => {});
  await mongod?.stop().catch(() => {});
});

beforeEach(async () => {
  await Promise.all([AuditLog, Mandate, Merchant, Agent, PaymentMethod, SupplyContract, MarketCurve].map((m) => m.deleteMany({})));
  await seed();
  await Mandate.create([
    { _id: "mnd_aurora", humanId: DEMO.humanId, agentId: DEMO.agentId, mode: "autonomo", currency: "BRL", paymentMethodRef: DEMO.paymentRef, maxUses: 1, expiresAt: new Date("2027-01-01") },
    { _id: "mnd_other", humanId: "user_other", agentId: DEMO.agentId, mode: "autonomo", currency: "BRL", paymentMethodRef: DEMO.paymentRef, maxUses: 1, expiresAt: new Date("2027-01-01") },
  ]);
  await AuditLog.create([
    { _id: "aud_aurora", event: "purchase_decision", mandateId: "mnd_aurora", decision: "valido" },
    { _id: "aud_other", event: "purchase_decision", mandateId: "mnd_other", decision: "valido" },
  ]);
});

test("/audit exige sessão humana", async () => {
  const response = await get("/audit");
  assert.equal(response.status, 401);
});

test("/audit só devolve eventos dos mandatos do titular", async () => {
  const own = await get("/audit", asAurora).then((r) => r.json());
  assert.deepEqual(own.map((e) => e.auditId), ["aud_aurora"]);

  const attemptedCrossAccount = await get("/audit?mandateId=mnd_other", asAurora).then((r) => r.json());
  assert.deepEqual(attemptedCrossAccount, []);

  const other = await get("/audit", asOther).then((r) => r.json());
  assert.deepEqual(other.map((e) => e.auditId), ["aud_other"]);
});

/*
 * NOTA SOBRE A SUITE, e nao sobre este arquivo.
 *
 * `npm test` roda com `--test-concurrency=1`, e a razao mora aqui.  Cada arquivo
 * de teste sobe o proprio MongoMemoryServer; com varios subindo ao mesmo tempo,
 * a contencao entre eles fazia ESTE arquivo falhar no nivel do ARQUIVO -- os
 * dois testes dentro dele passando, e mesmo assim o processo saindo com codigo
 * nao-zero.  Medido: ~40% das execucoes em paralelo, ~25% depois de endurecer a
 * desmontagem acima, e 0 em 5 execucoes seriais.
 *
 * Um teste que falha em uma execucao a cada tres nao e um teste: e um ruido que
 * ensina o time a ignorar a suite.  A troca e 4s -> 16s, e vale.
 *
 * `npm run test:fast` mantem o paralelo para quem esta iterando e sabe disso.
 * A correcao de verdade seria um MongoMemoryServer compartilhado entre os
 * arquivos -- vale a pena, e nao no meio de um merge.
 */
