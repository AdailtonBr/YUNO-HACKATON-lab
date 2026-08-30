# Agentic Mandate

> **NextWave Hackathon 2026** (Yuno × Nauta) — Challenge 1, *"The Buyer Who Isn't Human"*.

An AI agent re-contracts electricity supply for a large industrial consumer on the Brazilian free market.
Every day it reads the market curve, compares offers against the company's current contract, and either
executes inside a **verifiable mandate** or escalates to a human. Everything ugly — out of mandate,
revoked live, impostor agent, hidden broker commission, disputed charge — has an exact place where it dies.

**The agent is the pretext. The mandate is the product.**

---

## Why this problem

Every payment system assumes a person is pressing "pay". That assumption is breaking, and in energy it
already broke.

In the corporate energy market, companies sign a **Letter of Authority** so a broker can act for them. A
**Level 2 LOA** lets the broker sign contracts in the company's name — **without even telling the client
what price was agreed**. The broker is paid by the supplier, with the commission buried inside the unit
price. That is an unlimited mandate, it exists today, and it is the documented origin of billion-dollar
litigation: *Expert Tooling v. Engie* [2025] EWCA Civ 292 in the UK; a US$71m settlement with nine NRG
retailers in New York in April 2026.

We are not inventing a risk to justify a product. We are putting verifiable limits on a risk that is
already there — and that an AI agent operating 24/7 would only amplify.

---

## The invariants

Every one is enforced in code and covered by tests.

1. **Authorisation is enforced on the server, never in the agent.** The agent only *tries*; the Authority
   says no.
2. **The agent never creates or widens a mandate.** There is no such tool. Issuing is a human act on a
   separate screen.
3. **The agent has no write path** to mandate state or revocation. It reads an id; only the Authority writes.
4. **Identity is proved, not declared.** The `agentId` is derived from a ticket the agent **signed**
   (HMAC), verified by the Authority. The merchant relays it untouched — transport, not source.
5. **The interested party does not attest.** The counterparty describes its own offer; its **credit
   rating** is attested by the Authority, and the market curve and the economics are **derived** by it.
6. **What was verified is what is charged.** Retries are idempotent; if the charge fails after the use is
   consumed, the Authority compensates.
7. **The agent never sees the payment instrument.** The mandate holds an opaque `paymentMethodRef`; only
   the Authority resolves it.
8. **Revocation is a live question**, read at the instant of purchase — which is why revoking mid-demo
   actually works.
9. **No LLM on the transaction path.** The deterministic engine decides.

---

## Where the AI is — and where it deliberately is not

The daily cycle is **100% deterministic**. Deciding "does this fit the mandate?" is the rule engine, not a
model. That is architecture, not thrift: a model call per mandate per tick would be hundreds of thousands
of calls a day; done right it is zero.

| Where | What | Why there |
|---|---|---|
| **The agent's autonomy** | Acts alone, daily, compares offers, computes the economics, decides whether to act | This is the agentic property that matters: a buyer who is not human |
| **Drafting a mandate** (LLM, dormant) | Converses and proposes constraints; the human confirms | The model **drafts**; the human's hand creates |
| **Semantic reconciliation** (out of scope) | Mapping a counterparty's field names onto the common vocabulary | Offline, at onboarding, human-reviewed, frozen as a deterministic map |

Assume the worst: the model hallucinates and tries to sign at R$500/MWh under a mandate capped well below
that. It calls the tool, the counterparty attests the real offer, the engine compares, the Authority
refuses, and the trail records the attempt rule by rule. **The model does not write the verification's
answer.** Remove it and the system gets dumb, not unsafe.

`app1/src/agent/llm.js` holds the conversational drafting path from the project's earlier consumer case.
It is kept, dormant, because it costs nothing and it is the proof that the boundary is real.

---

## Getting it running

```bash
npm install
npm test        # 228 tests, including 24 adversarial ones. In-memory Mongo — no Atlas needed
npm run dev     # Authority :3001 · counterparties :4001-4003 · Portal :5173
```

Open **http://localhost:5173**.

With no `MONGODB_URI` the Authority boots an in-memory Mongo and seeds the client, the counterparty
allow-list, the current supply contract and the market curve — no setup. Point `MONGODB_URI` at Atlas to
persist across restarts.

### Configuration

Copy `.env.example` to `.env`. The two settings that matter:

| Variable | What it does |
|---|---|
| `PORT_OFFSET` | Shifts **everything** together — Authority, counterparties and Portal. `0/10/20/30` lets several people run the whole stack on one network without collisions. Do **not** set `PORT` or `AUTHORITY_URL`: a pinned value beats the offset and silently cancels it (the boot warns you if it happens) |
| `AGENT_ID` / `AGENT_SECRET` | The agent's signing credential. It **must** match what the seed registers, or the Authority answers `unknown_agent` and no contract is ever signed |
| `SEED_MANDATES=1` | Development shortcut: seeds the two mandates so the Portal is not empty. Off by default — a system that boots with authorisations already granted contradicts the first scene of the demo |
| `WATCHER=off` | Stops the daily cycle, for working on the engine without anything contracting on its own |

`OPENAI_API_KEY` is **not** needed. The energy demo issues mandates through a form.

### The screens

| Screen | What it is for |
|---|---|
| **Wallet** | Register the settlement account. The raw credential enters here and never comes back out — the screen lists labels, never numbers |
| **Issue mandate** | The six layers of the mandate, plus **what is not in it** — the anti-patterns the mandate deliberately refuses |
| **Daily cycle** | What the agent did today: the curve it read, the RFQ it sent, every offer with its verdict, and what it attempted |
| **Purchase approvals** | One contract at a time waiting for a human yes, with the exact numbers frozen |
| **My mandates** | The hierarchy, live status, and **Revoke** |
| **Market curve** | Change the reference price live. This is the judges' lever |
| **Audit trail** | Every event, and the rule-by-rule verdict behind each decision |

---

## The demo, in five minutes

The client is **Metalúrgica Aurora**, four sites, 3,500 MWh/month in the SE/CO submarket, currently
supplied by **Nortis Energia at R$268/MWh** with 42,000 MWh remaining. The reference curve for 2027 sits
at **R$249/MWh**. Three counterparties answer the RFQ:

| Counterparty | Rating | Quoted | Commission | **Effective** | Outcome |
|---|---|---|---|---|---|
| **Volt Andina** | A− | R$244 | 0 | **R$244** | passes every hard rule → **escalates** on the governance threshold |
| **Cerrado Power** | BB | R$231 | 0 | **R$231** | **the best price, refused** — on rating |
| **Helios Trading** | — | R$239 | R$14 embedded | **R$253** | **refused** — on the commission |

With a mark-to-market exit penalty, the two contract terms cancel out:

```
net saving = (market curve − effective price) × volume
Volt   : (24900 − 24400) × 42,000 =  + R$ 210,000
Helios : (24900 − 25300) × 42,000 =  − R$ 168,000
exit penalty = (26800 − 24900) × 42,000 = R$ 798,000
```

**The saving does not depend on the old contract's price** — only on how far the offer beats today's
market. Which is why a hidden commission is devastating: *the naive comparator picks Helios because R$239
is less than R$244; the agent with a mandate picks Volt Andina, because what counts is the offer against
the curve — and Helios, once the embedded commission is added back, is R$4 above market.*

**Run it:**

1. **Wallet** → register the settlement account. Nothing is picked for you.
2. **Issue mandate** → set the six layers, read the sentence, authorise. Only now does the mandate exist.
3. **Daily cycle** → the agent reads the curve, sends the RFQ, and lands on Volt Andina with R$210,000 —
   above the R$50,000 threshold, so it **escalates**.
4. **Purchase approvals** → approve. The next cycle signs, and the trail shows the receipt.
5. **Audit trail** → *"I never authorised this"* → the seven links, **calculated** from the record.

**Then hand the keyboard to the judges.** Every one of these works with nobody on the team touching
anything:

| | |
|---|---|
| **Revoke live** | The next attempt dies at the Authority, not in the agent |
| **Move the curve** | The same offer stops qualifying. Limits are live, not a snapshot |
| **Raise the discount floor** | A **new version** of the mandate is issued and the old one revoked — mandates are never edited |
| **Improve Cerrado to R$210** | Still refused. The best price loses to the rating. *The mandate governs the agent* |
| **Forge a signature** | Refused on the signature, and the attempt is recorded |
| **Revoke the parent mandate** | The operational mandate falls in cascade |

---

## How a contract gets signed

```
08:00  the agent reads the market CURVE                      GET  /curves
08:01  reads the current supply CONTRACT                      GET  /contracts
       computes how many days until the notice window closes
08:02  sends the RFQ to the three counterparties, in parallel GET  /catalog?submercado=&periodo=
08:04  compares offers against the mandate  (a courtesy filter, not authorisation)
08:05  signs a purchaseTicket (HMAC) and attempts the best    POST /buy
       └─ the counterparty attests the REAL offer and calls   POST /introspect
          └─ the Authority answers: valid · reject · escalate
             └─ if valid: it resolves the paymentMethodRef and charges
```

`POST /introspect` applies nine barriers, in this order. Each closes a named attack:

| | Barrier | Closes |
|---|---|---|
| 1 | **Idempotency** — same key, same recorded answer | double charge on retry |
| 2 | **Mandate exists** — 128-bit opaque id | id enumeration |
| 3 | **Signed ticket** — signature, single-use `nonce`, ~120s expiry, bound to the authenticated merchant | impostor agent; a **registered merchant charging on its own**; replay |
| 4 | **Enrichment** — the Authority injects rating, guarantee, curve, penalty, net saving | a counterparty attesting its own credit |
| 5 | **Delegation chain** — a revoked parent kills its children | a derived mandate outliving its frame |
| 6 | **The constraint engine** — rule by rule, with a `trace` | out of mandate, on any axis |
| 7 | **Nonce + use consumed atomically** | TOCTOU: revoking between check and charge |
| 8 | **Charge, with compensation** | a failed payment burning a use with nothing delivered |
| 9 | **Append-only trail** | *"I never authorised this"* |

Barrier zero is the **allow-list**: a counterparty that is not registered never speaks to the Authority.

### The mandate: six layers, and the engine never changed

`engine.js` is a pure function with no imports and an open vocabulary
(`{attr, op, value, on_missing, on_fail}`, operators `eq ne lte gte in`). **An entire domain arrived as
data.**

| Layer | Becomes |
|---|---|
| 1 · Identity and power | `agentId` proved by signature + `parentMandateId` — the delegation |
| 2 · Product scope | `submercado`, `fonte`, `estrutura_preco`, `prazo_meses` |
| 3 · Quantitative limits | `quantity`, `total`, and **`desconto_vs_curva_pct`** — a **relative** ceiling |
| 4 · Risk | `cobertura_pct` (95–105%), `flexibilidade_pct`, `take_or_pay_pct`, `exposicao_pld_brl` |
| 5 · Counterparty | `rating in [...]`, `garantia eq true` |
| 6 · Governance | `economia_liquida_brl lte 50k` with **`on_fail: escalate`** |

Two details that are semantic, not cosmetic. **The commission rule comes first**, because the engine stops
at the first failure and we want Helios refused on the commission — and it uses `on_missing: "deny"`, so
*refusing to declare a commission counts the same as being refused*. **The governance threshold comes
last**, so every hard rule is evaluated before escalating; escalating a purchase that would be refused
anyway hands the human a question that is not theirs.

**A relative ceiling, not an absolute one.** R$250/MWh is restrictive today and permissive in three
months. The mandate caps the discount **against the curve**, and the curve is a live read.

**Mandates are never edited.** Tightening a limit issues a **new version** and revokes the old one. If a
mandate were editable, *"under what limits was this bought?"* would stop having an answer — and the
dispute lives on that question.

---

## Layout

```
app1/src/authority/
  engine.js        the constraint engine — a PURE function, no imports, no I/O
  energy.js        mark-to-market, derived attributes — pure, testable alone
  hierarchy.js     the delegation chain and cascading revocation
  ticket.js        the agent's signed ticket (HMAC), issue and verify
  introspect.js    the nine barriers, in order
  dispute.js       "I never authorised this" — seven links calculated from the trail
  routes.js        routes + auth: who you are never comes from the body
  routes.energy.js the market curve, contracts, derive and supersede
  vault.js         mock vault/PSP
app1/src/agent/
  watcher.js       the daily cycle — deterministic, no LLM
  cycle-log.js     what the agent did, as structured data for the UI
  llm.js           the conversational drafting path (dormant)
app2/src/          three counterparties, each with a different internal format
ui/src/            the Portal (React + Vite + Tailwind)
```

Stack: Node + Express + Mongoose + MongoDB · React + Vite + Tailwind · `node --test`.

### Tests

```bash
npm test              # 228, serial and deterministic (~16s)
npm run test:fast     # parallel, ~4s, but flaky by ~25% — see the note in audit-scope.test.js
```

| Suite | What it locks |
|---|---|
| `fire-drill.test.js` | **the 12 trial-by-fire scenarios** — the acceptance criteria |
| `adversarial.test.js` | **24 attacks over HTTP**, black-box |
| `freeze.test.js` | the demo's numbers against the real engine |
| `engine.test.js` · `quantity.test.js` · `ticket.test.js` | the pure core |
| `energy.test.js` · `introspect.test.js` · `merchants-energy.test.js` | integration through real HTTP |
| `dispute.test.js` · `dispute-energy.test.js` | the seven links |
| `cycle.test.js` · `audit-scope.test.js` · `history-window.test.js` | the cycle, tenant isolation, the LLM window |

The adversarial suite models the strongest attacker we could think of, and it is not a stranger: it is a
**registered counterparty** with a valid API key that knows the `mandateId` and `agentId` from a purchase
it served. It tries to inflate the price, multiply the volume, assert a total that does not add up, hide
the commission and declare its own rating — and lands on five different doors.

---

## Real vs mock

| Real — the logic being judged | Mock — not worth integrating for a hackathon |
|---|---|
| The mandate as source of truth on the server | The movement of money (fake receipt) |
| Deterministic verification against **live** state | The counterparties' catalogues and prices |
| Agent identity **proved** by signature | Instrument tokenisation (a pointer, not a real PSP token) |
| Offer attributes attested by the counterparty | CCEE registration and metering |
| Rating, curve and economics **derived by the Authority** | |
| The payment pointer in the mandate, fired by the Authority | |
| The allow-list, the append-only trail, dispute resolution | |
| The complete mark-to-market calculation | |

## Where Yuno fits

There is **one arrow** leaving this system for a payment service, and it leaves the **Authority**,
**after** the yes.

```
Agent + Counterparties + Authority     →     Yuno / PSP
decide IF it may be paid                     move the money, after the yes
```

The **agent** does not have that arrow. Neither does the **counterparty** — it receives a receipt, it
does not pull money. Swapping the mock for Yuno is swapping one endpoint URL: the data model, the engine,
revocation and the trail all sit upstream of it.

---

## Documentation

| | |
|---|---|
| [`docs/DECISION-LOG.md`](docs/DECISION-LOG.md) | **the Decision Log** — what we chose, what we rejected, what we gave up on purpose |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | roles, the end-to-end flow, the trust model, the diagram |
| [`docs/VERIFICATION.md`](docs/VERIFICATION.md) | the engine, the barriers, every attack and where it dies |
| [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) | collections and endpoint contracts |
| [`docs/ENERGY-VOCABULARY.md`](docs/ENERGY-VOCABULARY.md) | the frozen attribute vocabulary and who attests each one |
| [`docs/SCALING.md`](docs/SCALING.md) | how the opaque-id model scales — not in the MVP, and why that is fine |

Team preparation material, in Portuguese: [`DEFESA.md`](DEFESA.md) (the whole system in one read) and
[`IDENTIDADE-E-DISPUTA.md`](IDENTIDADE-E-DISPUTA.md) (identity and dispute in depth).

## Deliverables

1. Slides
2. Demo (live or recorded)
3. Public repository with README ← this file
4. Architecture diagram ← [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
5. **Decision Log** ← [`docs/DECISION-LOG.md`](docs/DECISION-LOG.md)

> The technical defence weighs as much as the demo. Every choice here is meant to be defensible — which is
> why the decision log records the alternatives we rejected, and why.
