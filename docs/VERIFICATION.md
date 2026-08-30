# Verification

The constraint engine, the nine barriers, and every attack with the exact place where it dies.

> **Parent principle:** authorisation is enforced on the server, never in the agent. The agent only
> *tries*. And **identity and values are never self-declared** — only what was *proved* (identity, by the
> agent's own signature) or *attested by the party entitled to* (the offer, by the counterparty; the
> rating and the market, by the Authority) counts. Almost every attack below is a variation of *"someone
> declared something they should have proved"*.

---

## 1. The engine

Generic by construction. It does not know what electricity is. It evaluates a list of
`{attr, op, value, on_missing, on_fail}` against the attributes of the purchase.

```js
const OPS = {
  eq:  (a, b) => a === b,
  ne:  (a, b) => a !== b,
  lte: (a, b) => a <= b,
  gte: (a, b) => a >= b,
  in:  (a, b) => Array.isArray(b) && b.includes(a),
};
```

Stateful conditions are not attributes of the offer and are checked separately: `maxUses`/`usedCount`
("at most N contracts") and `expiresAt`.

`evaluate` is a **pure function** — it receives everything it needs and touches no I/O. The Authority
fetches the mandate, verifies the ticket and looks up any approval, then passes them in `ctx`. Crypto
happens **before**, outside: the engine compares fields, it does not verify signatures. Two layers with
separate jobs — one proves who spoke, the other decides whether what was said fits.

### Two independent axes

`on_missing` answers *"what if the attribute never came?"*. `on_fail` answers a **different** question:
*"what if it came and did not match?"*

| Situation | Field | Values | Default |
|---|---|---|---|
| The attribute **did not come** | `on_missing` | `deny` · `escalate` · `allow` | `deny` |
| It came and **fails** the rule | `on_fail` | `deny` · `escalate` | `deny` |

Two rules of the same mandate want opposite policies on the two axes. If a counterparty **does not
declare** its commission, denying is right — silence about payment to a third party is exactly what the
rule exists to catch. If the *net saving* exceeds the governance threshold, denying would be wrong: that
is precisely the case for asking a human.

**`on_fail` has no `allow`.** That would be "the rule failed, carry on" — a constraint that does not
constrain. If a rule can be ignored, it should not be in the mandate.

**Both default to `deny`**, on the whitelist logic that runs through the whole system: **forgetting a rule
blocks, it does not release.**

### Escalating is a question, and a question can already have an answer

`escalate` hands the decision back to the human, who approves **that specific purchase** — it never widens
the mandate. Two origins, one mechanism: a mandate in `aprovacao` mode, and an `on_fail: "escalate"` rule.

The match is deliberately narrow and single-use: same mandate, counterparty, offer, price **and quantity**,
not consumed, not expired. A loose approval would be a blank cheque.

> This was a real bug: `on_fail: "escalate"` returned `escalate` **without ever consulting the approval**,
> so the human approved and the next attempt escalated again, forever. The docs had always described "one
> mechanism, two origins"; the code honoured only one of them. A rule waived by a human yes is recorded in
> the trace as `approved_by_human` — never erased. *"The rules passed"* and *"a rule failed and someone
> took responsibility"* are different facts.

### The quantity gate

Before the constraints, the engine asks something no human rule would cover: **does this mandate know how
to cap spending?**

```js
if (quantity > 1 && !mandate.constraints.some((c) => c.attr === "total")) {
  return deny("quantity_uncapped", { quantity });
}
```

`price` is the price of **one** unit. A mandate that only caps `price` caps nothing once quantity moves:
twenty units inside the unit ceiling are twenty times the ceiling leaving the account. Since there is no
way to guess which of the two the human meant, the engine refuses the quantity instead of choosing for
them — and the refusal says what to do. The engine also **redoes the arithmetic** (`total == price ×
quantity`): the total is what leaves the account, so it cannot be asserted by anyone.

### The trace never lies about what it did not look at

Every rule gets a verdict: `ok`, `violated`, `missing`, `missing_allowed`, `approved_by_human`,
`invalid_rule`, or `not_evaluated`. The engine stops at the first failure, and everything after it is
marked `not_evaluated` — saying "ok" about a rule that was never checked would be a lie, and the dispute
is built on this record.

**Consequence for the demo:** the Authority gives **one** reason. The full list of an offer's violations
comes from the **agent's comparison table**, which is a courtesy pre-filter. Do not try to make the engine
collect every failure.

---

## 2. The nine barriers of `POST /introspect`

In this order. Each closes a named attack.

| | Barrier | Closes | Refusal |
|---|---|---|---|
| 1 | **Idempotency** — the same key returns the same recorded answer, without re-evaluating, consuming a use or charging | double charge on retry | *(the stored answer)* |
| 2 | **The mandate exists** — 128-bit opaque id, never sequential | id enumeration | `unknown_mandate` |
| 3 | **The signed ticket** — signature, canonical form, single-use `nonce`, ~120s expiry, bound to the authenticated counterparty | impostor agent · a registered counterparty charging alone · replay | `unknown_agent` · `ticket_bad_signature` · `ticket_malformed` · `ticket_expired` · `ticket_replayed` · `ticket_merchant_mismatch` |
| 4 | **Enrichment** — the Authority injects rating, guarantee, curve, penalty, net saving, coverage | a counterparty attesting its own credit; an offer lying about the market | `commission_math_mismatch` · `no_active_contract` · `unknown_curve` |
| 5 | **The delegation chain** — a revoked parent kills its children | a derived mandate outliving its frame | `parent_revoked` |
| 6 | **The engine** — rule by rule, with the trace | out of mandate, on any axis | `constraint_failed` · `attribute_missing` · `revoked` · `expired` · `uses_exhausted` · `agent_not_owner` |
| 7 | **Nonce + use consumed atomically** (`findOneAndUpdate` conditional on `{ _id, revoked:false, usedCount < maxUses }`) | TOCTOU: revoking between check and charge | `uses_exhausted` |
| 8 | **Charge, with compensation** — the use is consumed *before* the charge; if the vault refuses, the Authority returns the use and reopens the approval | a failed payment burning a use with nothing delivered | `payment_declined` |
| 9 | **Append-only trail** | *"I never authorised this"* | — |

**Barrier zero** is the allow-list: a counterparty that is not registered never speaks to the Authority.
This is the anti-slamming mechanism.

### Why price, quantity and total travel signed

Constraints are **ceilings, not exact values**. Under "at most R$250/MWh", both R$244 and R$249.99 pass —
and only the agent knows which it chose. Without the price in the ticket, the counterparty could attest a
higher figure than it quoted, still inside the ceiling, and the Authority would have nothing to compare
against. The ticket is the **independent second source** for that number.

`quantity` and `total` are there for the same reason, and the hole they close is larger: with the unit
price pinned but the volume loose, a registered counterparty would serve a ticket for *"42,000 MWh"* as
*"84,000 MWh"* — every unit inside the ceiling, and double leaving the account.

The **effective price** must also add up: `price == preco_energia + comissao_terceiro`, or
`commission_math_mismatch`. Same idiom as `total_mismatch`: an asserted effective price is not a verified
effective price.

---

## 3. The attacks, and where each dies

Everything below is automated in `app1/test/adversarial.test.js` — **24 attacks over HTTP, black-box.**
The strongest attacker modelled is not a stranger: it is a **registered counterparty** with a valid API
key that knows the `mandateId` and `agentId` from a purchase it served.

### Agent identity

| Attack | Dies at | Refusal |
|---|---|---|
| Signs as an agent that does not exist | the registry lookup | `unknown_agent` |
| Right name, guessed secret | the signature | `ticket_bad_signature` |
| Edits the payload after signing | the signature | `ticket_bad_signature` |
| Adds an **extra field** and signs it correctly | the **canonical-form** check | `ticket_malformed` |
| Reuses an expired ticket | `exp` | `ticket_expired` |
| Presents a ticket from one counterparty at another | `merchantId` bound to the authenticated key | `ticket_merchant_mismatch` |
| Replays a ticket after a completed purchase | the single-use nonce | `ticket_replayed` |

> **The canonical-form check looks like paranoia and is not.** Verifying the signature *over the canonical
> form* would not be enough: a payload with extra fields would sign identically, and the extra would reach
> whoever read it later intact. Requiring the bytes to be exactly canonical means **no field escapes the
> signature**. `verifyTicket` also returns the canonical form, never the raw object off the wire.

> The Authority reads the `agentId` from the ticket **without trusting it** — only to know which secret to
> check against. Trust comes from the signature closing.

### The registered counterparty as attacker

| Attack | Refusal |
|---|---|
| Inflates the attested price above what the agent signed | `ticket_price_mismatch` |
| Multiplies the volume | `ticket_quantity_mismatch` |
| Asserts a total that does not match price × quantity | `ticket_total_mismatch` |
| Hides the commission (`price ≠ energy + commission`) | `commission_math_mismatch` |
| **Declares its own rating as AAA** | the Authority overwrites it from the allow-list → `constraint_failed: rating` |
| Charges with no agent present | it cannot forge the ticket |
| Is not on the allow-list | `unknown_merchant` (401) |

### Tenant isolation

Identity never comes from the body: counterparty → API key; human → session; agent → secret and signature.

| Attack | Result |
|---|---|
| Intruder issues a mandate naming someone else's agent | `not_your_agent` |
| Intruder issues a mandate paying from someone else's account | `unknown_payment_method` |
| Intruder reads the trail of a `mandateId` they know | empty — a known id is not a permission |
| Reads the trail with no session | 401 |
| Lists or revokes someone else's mandates | empty / 404, and the mandate is untouched |

### Buying on someone else's account

Three ties, none depending on the others:

1. **The `paymentMethodRef` does not travel.** It lives on the mandate, inside the Authority. **There is no
   loose pointer to steal.**
2. **Stealing the `mandateId` is not enough** — without the agent's secret there is no valid ticket. This
   holds for a registered counterparty that saw the id on a legitimate purchase.
3. **The pointer is directional.** It only authorises charging *the holder's source → in favour of a
   registered counterparty*. **There is no operation anywhere in the system that credits anyone.**

The third is topological, not cryptographic: it is demonstrated by who-calls-whom, and it stays true when
the mock becomes Yuno, because the arrow keeps leaving the same place.

### Live state

| Attack | Refusal |
|---|---|
| Buys under a revoked mandate | `revoked` |
| Buys under a mandate whose **parent** was revoked | `parent_revoked`, naming which parent broke |
| Guesses a `mandateId` | `unknown_mandate` |
| Reuses a human approval | escalates again — the yes is single-use |

---

## 4. What the guarantee actually is

**"Impossible" is not the right word.** The right word is: **impersonating an agent requires its secret.**
Without it, every path above is closed by a named check. With it, the impersonation works — because that
is what a key is.

Said plainly:

- **Security rests on the secrecy of the HMAC key**, and on nothing else. There is no security by
  obscurity here.
- **In the MVP** the secret lives in `.env`, outside git. In production it would be one secret per agent,
  in a vault, with rotation.
- **The blast radius is bounded and auditable.** The trail records `agentIdAuthenticated` on every attempt,
  so a compromised secret leaves a record of what it did, under which mandate and when. And the mandate
  still holds: even signing correctly, the impostor buys only **within the limits** — ceiling, term,
  counterparty, governance threshold — and revocation kills it on the next cycle.

**A stolen key does not become a blank cheque**, because identity is only the first of nine barriers.

### Structural weaknesses, named

- **DoS on the Authority** stops every verification. It is the structural cost of introspection.
  Mitigation path in [`SCALING.md`](SCALING.md).
- **A declared commission is declared by an interested party.** If a counterparty lies and declares zero,
  verification passes. What the system guarantees is that the declaration is **frozen in the trail** —
  discovering later that it was false becomes provable fraud, which is exactly how the English case was
  won. We do not sell more than that.
- **The human session is a header** in the MVP. What is real is that `humanId` comes from the
  authentication layer and never from the body; swapping in a real session changes no other line.

---

## 5. The dispute

*"I never authorised this."* You cannot stop anyone from denying a charge. What you can do is make the
denial **answerable** — and answer it by **calculating** from the record, not asserting.

Seven links. Miss one and the record sides with the account holder.

| Link | Proves | Breaks when |
|---|---|---|
| `mandate_created` | the human authorised those limits, **before** the purchase | there is no human act recorded, or it came after |
| `delegation_valid` | whoever issued it had the power to | the parent does not exist, or was already revoked **before** the purchase |
| `agent_identity` | whoever bought **proved** to be the mandate's agent | `agentIdAuthenticated` does not match the holder |
| `rules_passed` | the rules were evaluated and passed | a rule failed without a waiver |
| `curve_at_decision` | the number that decided is the number in the record | the recorded discount does not follow from the recorded curve |
| `human_approval` | there was a yes for **that** purchase | required (by mode or by waiver) and absent |
| `charged_what_was_verified` | the amount charged is the amount verified | no receipt, or a different amount |

**Order matters.** A `mandate_created` **after** the purchase does not legitimise it. A parent revoked
**before** the purchase breaks delegation; revoked **after**, it does not — withdrawing the frame tomorrow
does not de-authorise what was bought under it yesterday.

**The curve is recomputed, not re-read.** `curve_at_decision` redoes the discount arithmetic from the
curve frozen in the trail, with the **same function** the Authority used. It matches, and the number that
approved the contract is verifiable months later; it does not, and someone decided against a different
market than the one they recorded.

**The verdict is frozen with its evidence.** Recalculating months later over a trail that has grown would
give a different answer, and a resolution that changes on its own resolves nothing.

Disputing a refused attempt returns `nothing_charged` — *"the agent tried and was refused"* is an easy
memory to confuse with *"the agent bought"*, and the system says the difference out loud.
