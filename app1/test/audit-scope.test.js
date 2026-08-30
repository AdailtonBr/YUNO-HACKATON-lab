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
  server?.close();
  await mongoose.disconnect();
  await mongod?.stop();
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
