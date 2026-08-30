# Data model and API

Every identifier and field name is in English. Text shown to a human is rendered from the data by
`app1/src/shared/messages.js`, never stored as a sentence.

**Every `_id` is an opaque, high-entropy string** (`opaqueId`: prefix + 128 random bits), never sequential.
An opaque id is only safe if it is unpredictable — and, for free, an unpredictable id is also the ideal
shard key when this scales. See [`SCALING.md`](SCALING.md).

---

## Collections

### `mandates` — the authorisation

```js
{
  _id: "mnd_9f3a2b…",
  humanId: "user_aurora",          // from the SESSION, never from the request body
  agentId: "agent_aurora",         // compared against the agent PROVED by the ticket
  mode: "autonomo",                // "autonomo" | "aprovacao" (a human yes per purchase)
  constraints: [                   // an open list of {attr, op, value, on_missing, on_fail}
    { attr: "comissao_terceiro",     op: "eq",  value: 0,     on_missing: "deny", on_fail: "deny" },
    { attr: "rating",                op: "in",  value: [...], on_missing: "deny", on_fail: "deny" },
    { attr: "desconto_vs_curva_pct", op: "gte", value: 2.0,   on_missing: "deny", on_fail: "deny" },
    { attr: "economia_liquida_brl",  op: "lte", value: 5000000, on_missing: "deny", on_fail: "escalate" },
  ],
  currency: "BRL",                 // the attested currency must match this
  paymentMethodRef: "pm_pix_…",    // an opaque POINTER into the vault. Never the instrument
  shippingAddressId: null,         // energy is not delivered to a street
  maxUses: 2,                      // MANDATORY. Default 1 — never "unlimited"
  usedCount: 0,                    // consumed atomically
  expiresAt: ISODate("…"),
  revoked: false,                  // ONLY the human flips this
  parentMandateId: "mnd_…",        // the delegation: this derives from an umbrella
  version: 1,                      // bumped by supersede
  supersedes: null,                // the version this one replaced
  humanReadable: "…",              // derived from the SAME JSON that gets verified
  createdAt: ISODate("…"),
}
```

- `constraints` is **open**. Adding an attribute requires **no code change** — only that the counterparty
  and the mandate use the same name. An entire domain arrived this way.
- `on_missing` (`deny`/`escalate`/`allow`) and `on_fail` (`deny`/`escalate`) are **independent axes**, both
  defaulting to `deny`. Forgetting a rule blocks; it does not release. There is no `on_fail: allow` — a
  rule that can be ignored should not be in the mandate.
- **`status` is derived, never stored:** `revoked` → `revoked`; `expiresAt < now` → `expired`;
  `usedCount >= maxUses` → `exhausted`; otherwise `active`. **Exhausted ≠ revoked** — one did its job, the
  other was withdrawn by hand. Mixing them would blur the audit trail and the live-revocation demo.
- `humanReadable` is **derived** from the same draft that gets stored. If the sentence were written in
  parallel it could say "R$100" while the mandate stored R$1000.
- **A mandate is never edited.** `supersede` issues `version: n+1` and revokes the previous one. If it were
  editable, *"under what limits was this bought?"* would stop having an answer.

### `merchants` — the allow-list, and the counterparty's attested credit

```js
{ _id: "volt_andina", name: "Volt Andina", apiKeyHash: "…", active: true,
  rating: "A-", garantia: true, whitelisted: true }
```

`rating` and `garantia` live **here**, not on the offer. A seller is the last party that should declare
its own credit risk.

### `supply_contracts` — the client's current contract

The baseline for every calculation: without it there is no remaining volume, no exit penalty and no saving.
It is the **buyer's** business data, which is why `GET /contracts` requires the human session.

```js
{ _id, humanId, fornecedor: "Nortis Energia", submercado: "SECO",
  precoBrlMwh: 26800, inicioVigencia, fimVigencia, denunciaDias: 90,
  renovacaoAutomatica: true, volumeRemanescenteMwh: 42000,
  consumoPrevistoPeriodoMwh: 42000, flexibilidadePct: 5, takeOrPayPct: 95,
  multaPisoBrl: 0, taxaAdminBrl: 0, ativo: true }
```

`denunciaDias` is the real operational trigger — the decision deadline is **not** the end of supply.

### `market_curves` — the reference price

```js
{ _id: "SECO:2027", submercado: "SECO", periodo: "2027", precoBrlMwh: 24900, updatedAt }
```

Read at the **instant of the decision**, never baked into the mandate. An absolute ceiling in R$/MWh goes
stale in weeks; the mandate caps the discount **against** this number, and this number is a live query.

### `agents`

```js
{ _id: "agent_aurora", humanId: "user_aurora", hmacSecret: "…", active: true }
```

The raw secret lives only in the agent and the Authority. **The counterparty never sees it** — which is
what stops it from forging a ticket.

### `approvals` — one purchase waiting for a yes

The single mechanism behind both escalation paths: `mode: "aprovacao"` and `on_fail: "escalate"`.

```js
{ _id: "apr_…", mandateId, humanId, merchantId, productId, name,
  price, quantity, total, currency,   // FROZEN — a human approves a number, not a product
  attributes: { … },                  // snapshot of what was attested
  origin: "on_fail",                  // "mode_aprovacao" | "on_fail" | "on_missing"
  reason: { code, params },
  status: "pending",                  // "pending" | "approved" | "rejected"
  consumedAt: null,                   // stamped in the same atomic op that completes the purchase
  expiresAt: ISODate("…"),            // short window
  createdAt }
```

- **Only the Authority writes here.** The agent receives `escalate` and retries later.
- **Narrow and single-use.** Matched on `(mandateId, merchantId, productId, price, quantity)`, not
  consumed, not expired. Without the quantity, approving two units would authorise five.
- **Approving does not widen the mandate.** It releases *that* contract. Limits and validity stay intact.
- A **rejection lasts**: the same purchase at the same price is not asked again.

### `used_nonces` — anti-replay

```js
{ _id: "<nonce>", agentId, usedAt, expiresAt }   // TTL index on expiresAt
```

Written in the **same atomic operation** that consumes the mandate's use — which is what closes TOCTOU.

### `audit_log` — append-only

```js
{ _id, ts, seq, event, actor: { type, id },
  mandateId, merchantId, agentIdAuthenticated,
  purchase: { productId, price, quantity, total, currency, attributes },
  decision, reason: { code, params }, approvalId, receiptId, idempotencyKey,
  trace: [ { attr, op, value, actual, on_missing, on_fail, verdict } ] }
```

`seq` breaks ties inside the same millisecond. In an audit record the order is part of what is being
claimed — *"it charged after it verified"* is the whole sentence — so it cannot come out at random.

| `event` | Actor | Why it is in the trail |
|---|---|---|
| `mandate_created` | human | The authorisation was born from their hand, with these limits |
| `mandate_revoked` | human | The exact moment of the brake |
| `approval_granted` / `approval_rejected` | human | *"I never authorised this"* lands here |
| `purchase_decision` | agent (via counterparty) | What was asked, what was attested, what was decided |
| `payment_result` | Authority | What was actually charged, and from which pointer |
| `curve_updated` | human | A later decision will cite this number |
| `dispute_resolved` | human | Contesting is an act, and acts stay |

`trace` verdicts: `ok` · `violated` · `missing` · `missing_allowed` · `approved_by_human` · `invalid_rule`
· `not_evaluated`.

### `disputes`

The verdict is **calculated** from the trail, then **frozen** with the evidence that supported it.
Recalculating months later over a trail that has grown would give a different answer.

```js
{ _id, humanId, mandateId, auditId, reason,
  verdict: "authorized",        // "authorized" | "not_authorized" | "nothing_charged"
  brokenLink: null,             // which link failed, when one does
  charged: { … }, evidence: [ … ], createdAt }
```

### `payment_methods` and `addresses` — the wallet

```js
{ _id: "pm_…", humanId, paymentMethodRef: "pm_pix_…", rail, label: "financeiro@…", createdAt }
```

Note what this collection holds and what it does **not**: the pointer and a label, **never the
instrument**. The credential lives in the vault — a mock here, the PSP in production — and the Authority's
database never sees it.

**Two identifiers, deliberately.** `paymentMethodRef` is what the Authority charges; `methodId` is what
the UI and the agent see. The translation happens inside the Authority, at the instant the human
authorises a mandate. That is what keeps literal the sentence in
[`VERIFICATION.md`](VERIFICATION.md): *there is no loose pointer to steal*.

### `mandate_proposals` and `idempotency`

Proposals are where the agent **deposits** a draft; it never writes to `mandates`. Idempotency stores one
response per `${merchantId}:${key}` — and stores **only outcomes**: an `escalate` is not an outcome, and
memoising it would leave the purchase hanging forever after the human approves.

---

## Endpoints

### Authority — mandates

```
POST   /mandates                     auth: human session → humanId (never from the body)
       body: { agentId, mode, constraints, currency, paymentMethodId, maxUses, expiresAt }
       → { mandateId, humanReadable }
POST   /mandates/preview             renders the sentence before creating — one renderer, one source
POST   /mandates/:id/derive          issue a DERIVED mandate (delegation). A child cannot outlive its parent
POST   /mandates/:id/supersede       issue version n+1 and revoke the previous one
POST   /mandates/:id/revoke          only the owner
GET    /mandates                     the holder's record
GET    /mandates/:id                 public read — never exposes paymentMethodRef
```

### Authority — the market and the contract

```
GET    /curves                       public read: a reference curve is nobody's secret
PATCH  /curves/:submercado           auth: human. THE JUDGES' LEVER. body: { periodo?, precoBrlMwh }
                                     periodo is optional when the submarket has exactly one curve
GET    /contracts                    auth: human — business data, scoped to the holder
POST   /contracts
```

### Authority — verification

```
POST   /introspect                   auth: merchant API key → merchantId. Refused if not registered
       body: { mandateId, purchase: { productId, price, quantity, total, currency, attributes },
               purchaseTicket, idempotencyKey }
       # There is NO agentId field. It is DERIVED from the verified ticket.
       → { valid: true, receiptId, trace }
        | { valid: false, action: "reject",   reason, reasonText, trace }
        | { valid: false, action: "escalate", reason, approvalRequestId }
```

### Authority — approvals, trail, disputes, wallet

```
GET    /approvals?status=pending     auth: human. The agent has no access to this route
POST   /approvals/:id/approve        only the mandate's owner. Single-use, expires
POST   /approvals/:id/reject
GET    /audit?mandateId=…            auth: human, SCOPED to the holder's mandates —
                                     a known id is not a permission
POST   /disputes                     body: { auditId, reason } → the verdict, calculated
GET    /disputes
POST   /wallet/methods               the raw credential enters HERE and does not leave
       body: { rail: "card"|"pix", instrument: { … } }
       → { methodId, rail, label }   # NEVER returns paymentMethodRef
GET    /wallet/methods · DELETE /wallet/methods/:id
POST   /wallet/addresses · GET · DELETE
```

### Agent

```
GET    /agent/cycles/latest          the last daily cycle, as DATA (204 when none has run)
POST   /agent/cycles/run             run one now — so the demo does not wait on the clock
GET    /agent/catalogs · POST /agent/shop · POST /agent/chat · POST /agent/reset
```

### Counterparties (App 2, ×3)

```
GET    /health
GET    /catalog?submercado=&periodo=&volume_mwh=&operacao=
       # the RFQ. `operacao` defaults to novo_contrato: asking for supply
       # is not asking to terminate anything
POST   /buy                          body: { productId, quantity, mandateId, purchaseTicket, idempotencyKey }
       # the counterparty builds the REAL attributes and calls /introspect,
       # relaying the ticket UNTOUCHED — it does not generate it, alter it, or replace it
GET    /verifications                what THIS counterparty verified — the merchant's view
GET    /products · PATCH /catalog/:productId     the operator panel (price, commission, term, stock)
POST   /panel/forge                  Helios only: the impostor lever, for trial-by-fire #8
```

### Vault / PSP (mock)

```
POST   /vault/tokenize   { rail, instrument }  → { paymentMethodRef, rail, label }
POST   /vault/charge     { paymentMethodRef, amount, currency, merchantId, idempotencyKey }
                         → { receiptId, rail, status: "pago" } | { status: "recusado", reason }
```

**Real vs mock here:** it is real that the `paymentMethodRef` lives on the mandate, that the **Authority**
— not the agent, not the counterparty — reads it and charges, and that the agent never sees it. What is
mocked is the movement of money. The impossibility of the agent redirecting a charge is **topological**,
demonstrated by who calls whom.

---

## The counterparty's catalogue

Each counterparty keeps its **own** internal format and writes a thin adapter to the common vocabulary.
The three share **no field name**, on purpose — if they spoke the same language internally, the adapter
would be assumed rather than tested.

```js
// Volt Andina — Portuguese, reais as decimals
{ id, titulo, preco_reais: 244.0, comissao_reais: 0, submercado, fonte, estrutura, periodo, prazo, flex, top }

// Cerrado Power — English, cents, delivery window as an object
{ sku, label, energy_price_cents: 23100, broker_fee_cents: 0, zone: "SE/CO", source_type,
  pricing_model: "FIXED", delivery_window: { from, to }, term_months, flex_pct, top_pct }
```

The adapter works in **both directions**: `toCommon` reads, and `setPrice`/`setCommission`/`setTermMonths`
write back into the internal format so the operator panel can change a price without knowing anything
about the common vocabulary. The cost is **per counterparty, once** — not per offer, not per client.
