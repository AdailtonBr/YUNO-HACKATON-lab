# Decision Log

**NextWave Hackathon 2026 — Challenge 1, "The Buyer Who Isn't Human"**
A verifiable mandate layer for agentic purchasing, demonstrated on B2B energy re-contracting in the Brazilian free market.

This document records what we chose, what we rejected, and what we gave up on purpose. Every entry names an alternative that lost. The thesis is one sentence: **the mandate, not the agent, is the product.** Every decision below exists to keep authorisation verifiable by someone other than the agent — the agent only *tries*, and the Authority is what says no. Two judging criteria shaped the architecture directly: technical defence weighs as much as the demo, and the judges operate the system live.

---

## 1. Summary

| Decision | Alternative rejected | Reason |
|---|---|---|
| B2B energy re-contracting | Consumer retail | The unlimited mandate already exists there, and is litigated |
| Opaque id + `POST /introspect` | Signed JWT / VC verified offline (AP2's model) | Live revocation is what the trial by fire tests |
| Relative ceiling (`desconto_vs_curva_pct gte 2.0`) | Absolute ceiling (`price lte 25000`) | An absolute ceiling stays valid while turning permissive |
| Human creates, agent drafts | Agent creates, since it talks to the human | The thing being limited cannot create the limit |
| Generic engine, open vocabulary | Fixed fields (`maxAmount`, `category`) | A whole domain arrived as data |
| `on_missing` / `on_fail` independent | One field for both | "I don't know" and "I know it fails" deserve different answers |
| `agentId` derived from a signed ticket | Merchant authenticates the agent and tells us | Otherwise one past purchase lets a merchant charge with no agent present |
| HMAC-SHA256 | Ed25519 | The Authority is already the root of trust; fewer moving parts |
| `rating` / `garantia` attested by the Authority | Merchant attests its own attributes | The interested party does not attest |
| Approval gate inside the Authority | Agent reads the mode and waits | Never put the brake inside the thing being braked |
| `total` is the ceiling; no `total` rule buys one unit | Charge `price × quantity` | A "R$150" mandate otherwise passes 20 units at R$3,000 |
| `supersede` and revoke the old | Edit the mandate in place | A mandate records what a human authorised |
| `maxUses` mandatory, default 1; exhausted ≠ revoked | Optional `maxUses`, or auto-revoke | `revoked` must mean only "the human pulled the brake" |
| No LLM on the transaction path | A model judges whether the offer fits | Non-deterministic where money is released |
| Merchant allow-list held internally | External accreditation body | Out of scope; named as the evolution |
| Contracts enter as structured JSON | LLM extraction from PDFs | The documented way hackathon teams lose a weekend |

---

## 2. The decisions in depth

### 2.1 B2B energy re-contracting, not consumer retail

**Alternative.** A consumer agent buying a product, which is the obvious reading of the challenge.

**Why.** In corporate energy procurement the unlimited mandate already exists as a signed document: the **Letter of Authority**. Level 1 lets a broker request information. **Level 2 lets it sign supply contracts in the client's name**, and under it a broker can close a contract without ever telling the client the price, because brokers are usually paid by the supplier with the commission embedded in the unit price of the energy. No ceiling, no expiry, no revocation channel, no disclosure — and it is litigated. The New York Attorney General settled with **Major Energy Services (2022, US$1.5m restitution)**, where salespeople posed as utility employees and customers were switched without consent, and with **Family Energy (2022, US$2.15m)**. In April 2026 the New York Public Service Commission approved a **US$71m** settlement with NRG-affiliated ESCOs over alleged violations of uniform business practices and Commission orders; **NRG denied most of the allegations when signing.** In England, *Expert Tooling and Automation Ltd v Engie Power Ltd* **[2025] EWCA Civ 292** held that a letter of authority creates a **fiduciary relationship**, breached by disclosing that a commission existed without disclosing how it was structured. So an agent introduces no new risk here. It inherits an old one and amplifies it in speed and volume.

**Trade-off.** Domain jargon that must land with a LatAm panel in five minutes, mitigated by reducing the economics to the one line in §2.3.

### 2.2 Verification by introspection, not by signed token

**Alternatives.** (A) The mandate as a signed JWT or Verifiable Credential, verified offline by the merchant against a public key — **AP2's model**. (B) An opaque id (`mnd_...`) the merchant resolves by calling `POST /introspect` at the moment of purchase.

**Why B.** Revocation is a flag read on the next lookup, and **live revocation is what the trial by fire tests**: a judge revokes on the Trusted Surface, and the next attempt must fail with nobody on the team touching anything. A signature cannot be un-signed, so under A revocation needs short expiry plus a status layer bolted on top. B also gives selective disclosure — the merchant asks "does this fit?" and never sees the limits — and removes cryptographic surface we would otherwise have to get right under time pressure.

**Trade-off.** One network call per purchase and a hard dependency on the Authority; a denial-of-service against it stops every purchase. The dispute proof is a centralised log, not a portable token. At very high volume, A verifies offline and scales better.

### 2.3 A relative ceiling — and why a signed token cannot express this mandate

A separate argument from revocation, and the stronger one.

**Alternative.** `price lte 25000`, an absolute ceiling, which is what a token can carry.

**Why not.** An absolute ceiling is correct in August and **permissive in November**: if the curve falls from R$249 to R$230, the rule stays intact and technically valid while authorising a purchase R$20/MWh above market. The ceiling has become the fake badge. Our rule is `desconto_vs_curva_pct gte 2.0`, and a signed token bakes a number at issuance, so expressing it would mean re-issuing every time the market moves — introspection reinvented with cryptography in the middle. **The token model cannot express this mandate at all**, and it fails during normal operation, not during revocation.

The relative form matters because of the arithmetic. Early termination is settled mark-to-market:

```
gross saving = (contract price − offer price) × volume
MtM penalty  = (contract price − curve)       × volume     [floored at zero]
------------------------------------------------------------------------
net saving   = (curve          − offer price) × volume     # contract price cancels
```

What decides a switch is the offer against the **curve**. With the SE/CO 2027 curve at **R$249/MWh** and 42,000 MWh left on a Nortis contract at **R$268/MWh**, the penalty is `max(0, 268 − 249) × 42,000 = R$798,000`; Volt Andina at R$244 gives **+R$210,000**; Helios advertises R$239 with R$14 embedded, so its effective price is **R$253** and it gives **−R$168,000**. The naive comparator picks Helios because R$239 < R$244. The agent with a mandate does not.

**Trade-off.** A derived attribute is only as good as its curve. Ours is a mocked oracle interface; in production an exchange feed, which then joins the trust boundary.

### 2.4 The human creates the mandate; the agent drafts

**Alternative.** The agent creates it, since it is the party talking to the human.

**Why not.** The mandate limits the agent, and the thing being limited cannot create the limit. Concretely, **there is no create-mandate tool in the agent**, so conversation-manipulation attacks ("my boss already approved this") have nothing to call. The agent deposits a proposal; the human confirms on the Trusted Surface. The mandate is shown back in natural language **rendered from the same JSON the engine evaluates** — written in parallel by the agent, that sentence could say R$100 while the rule says R$1,000, and consent would attach to prose rather than to a rule.

**Trade-off.** One extra human step in every flow. That step is what makes the system defensible.

### 2.5 A generic engine with an open vocabulary, and a domain that arrived as data

**Alternatives.** Fixed mandate fields (`maxAmount`, `category`), or an open rule list constrained by a central catalogue of allowed attribute names.

**Why.** A mandate is a list of `{attr, op, value, on_missing, on_fail}` with operators `eq/ne/lte/gte/in`, evaluated by a pure function of ~214 lines with no imports. There is never an `if (product === "x")`, and adding an attribute changes zero lines of code. That paid for itself at the pivot: nothing in the engine changed. The governance layers became `constraints`; curve, penalty and net saving became **derived attributes injected by the Authority before `evaluate`**; "above R$50k of impact, a human decides" became `on_fail: "escalate"`; volume and contract value became `quantity` and `total`, which already existed.

```json
{ "attr": "comissao_terceiro",     "op": "eq",  "value": 0,       "on_missing": "deny", "on_fail": "deny" }
{ "attr": "desconto_vs_curva_pct", "op": "gte", "value": 2.0,     "on_missing": "deny", "on_fail": "deny" }
{ "attr": "rating",                "op": "in",  "value": ["A+","A","A-","BBB"], "on_missing": "deny", "on_fail": "deny" }
{ "attr": "economia_liquida_brl",  "op": "lte", "value": 5000000, "on_missing": "deny", "on_fail": "escalate" }
```

Rule order is design: the commission rule is **first**, because it is the headline of *Expert Tooling v Engie*, and the governance threshold is **last**, so every hard rule runs before anything escalates.

**Trade-off.** An open vocabulary needs shared naming. We solved that by construction rather than governance: the agent derives constraint names from the merchants' real catalogue instead of inventing them, and each merchant writes one thin adapter, once. If a model ever reconciles names, it runs at **onboarding**, offline, with human review, frozen into a deterministic map. Never at transaction time.

### 2.6 `on_missing` and `on_fail` are independent axes

**Alternatives.** One field covering both cases; or a fixed policy where failure always denies and only absence escalates.

**Why.** "I don't know" and "I know it doesn't match" are different states, and two rules in the same mandate want opposite policies. `ship_country eq BR` should *ask* when origin is missing but *refuse* when it comes back `CN`, because the human already answered that. `price lte 10000` wants the reverse: deny when the price is absent, perhaps ask at R$103. One field forces both into the same policy — and "denied **or escalated**" is exactly what the challenge asks for. Both axes default to `deny`: for money, whitelist and deny, so **forgetting a rule blocks rather than releases**.

**Trade-off.** One more field to explain. We also refused the natural third value: there is deliberately **no `on_fail: "allow"`**, because a constraint that can be ignored should not be in the mandate.

### 2.7 Agent identity by signed ticket — a hole we found in our own design and closed

The entry we would defend first, because we got it wrong.

**What we shipped first.** The merchant authenticates the agent and tells the Authority who it is, via an `agentId` field in the `/introspect` body. It satisfied invariant 4 as written, since the agent was not declaring itself.

**The hole.** An allow-listed merchant that has served **one** legitimate purchase now knows the `mandateId` and the `agentId`. With the Authority trusting the merchant's word, that merchant can call `/introspect` later **with no agent involved at all** and get paid by the account holder. Every check passes: valid mandate, allow-listed merchant, attributes attested by the party entitled to attest them. Nothing refuses it; only the audit log records it, after the money moved. Identity was no longer self-declared — it was **declared by an interested third party**, the same hole in a different coat.

**The fix.** On every attempt the agent signs a `purchaseTicket` (HMAC-SHA256, secret shared agent↔Authority) covering `{mandateId, merchantId, productId, price, quantity, total, currency, nonce, iat, exp}`. The merchant relays it **untouched**, demoted from source of truth to transport. The Authority verifies it and **derives** the `agentId` from it.

```
POST /introspect
{ mandateId, merchantId, purchaseTicket, attestedAttributes, idempotencyKey }
// No agentId field. Identity is derived from the ticket, or the call fails.
```

**Why the ticket carries `price`.** Constraints are ceilings, not exact values. Under "at most R$100", both R$98 and R$99.99 pass, and only the agent knows which it picked. Without a signed price, a merchant can attest a higher number still under the ceiling and the Authority has nothing to compare it against. The ticket is the **independent second source** for that number.

**Why HMAC and not Ed25519.** The case for Ed25519 is that not even the Authority could forge a ticket. But the Authority **is** the root of trust: it holds the `paymentMethodRef`, decides every verification, and triggers the payment. If it is hostile, a forged ticket is the least of the account holder's problems. HMAC closes the same attack with far fewer moving parts.

**Trade-off.** A shared secret per agent, with the key management that implies, and no third-party-verifiable proof that a specific agent acted. Ed25519 is the upgrade path, and the ticket's field set does not change.

### 2.8 The interested party does not attest

**Alternative.** Let each merchant attest every attribute of its own offer, since it is the party that knows them.

**Why not.** The merchant attests what only it knows: energy price, commission, term, flexibility, take-or-pay, submarket, source, price structure, supply period. But **`rating` and `garantia` are attested by the Authority** from the allow-list, because a seller declaring its own creditworthiness is the exact failure the system exists to close. A merchant publishing its own rating is wrong by construction, and this one rule is what refuses **Cerrado Power**, whose 7.2% discount against the curve is the best economics on the table and whose rating is BB. A third bucket — curve, discount, penalty, savings, coverage, PLD exposure — is **derived by the Authority**, because it depends on the client's own contract and on the market curve, neither of which is the seller's data. `price` is the **effective** price, so both components travel and the Authority checks `price == preco_energia + comissao_terceiro`: an asserted effective price is not a verified one.

The agent does **not** pre-filter on `rating` or `garantia`. Pre-rejecting on an attribute only the Authority attests would make the agent the decider and the Authority a checker of its guess. So it attempts anyway, and the refusal is a signed fact in the trail rather than an opinion from a comparator — free to obtain, since a refusal consumes no use, burns no ticket and charges nothing.

**Trade-off.** The Authority must maintain rating and guarantee data, which in production is a credit-data dependency we have not priced.

### 2.9 The approval gate lives in the Authority, not in the agent

**Alternative.** The mandate carries a mode (`autonomo` / `aprovacao`), and the **agent** reads it, stops, and waits for the OK. The simpler, obvious path.

**Why not.** It puts the brake inside the thing the brake exists to limit. A bug, a manipulated conversation, or an adversarial agent that simply does not read the field walks straight through. In our design, every purchase under an `aprovacao` mandate returns `escalate` until an approval exists that is **matched to that exact purchase**. The agent cannot skip the step even if it wants to. Topology, not discipline. The binding is deliberately tight — keyed on `(mandateId, merchantId, productId, price, quantity)`, **single use**, short expiry — because loose binding is how approving a R$98 pair of shoes becomes a blank cheque for R$300. The same mechanism serves the `escalate` produced by `on_fail`, which is why the R$50,000 governance threshold cost no new machinery: Volt Andina's +R$210,000 escalates down that same path.

**Trade-off.** Approvals expire, so a slow human means the agent must re-attempt and re-escalate. We prefer a stale approval to fail closed.

### 2.10 Hierarchy, and supersede instead of edit

**Alternatives.** A flat list of independent mandates; and editing a mandate in place when a limit changes.

**Why hierarchy.** An annual umbrella mandate from the board, and an operational mandate derived from it. If any ancestor is revoked or expired, the child does not stand. Resolution happens **before** `evaluate`, which keeps the engine pure. It answers the question the consumer case never faces: **who authorised the authoriser?**

**Why supersede.** Changing the discount floor from 2% to 5% creates a **new mandate at `version: 2`** with `supersedes` pointing at the old one, and revokes the old one. Editing in place would overwrite the record of what a human actually authorised, which is the one thing the Authority exists to preserve. It is also the direct answer to "what if I want to change a limit live?", which is what the judges will do. Relatedly, `maxUses` is mandatory and defaults to 1, and **exhausted is not revoked**: conflating "the mandate did its job" with "the human withdrew authorisation" corrupts the audit trail and the live-revocation demo, where `revoked` must mean exactly one thing.

**Trade-off.** More rows, an extra lookup before every evaluation, and clients must follow `supersedes` to reconstruct history.

---

## 3. Decisions we reversed

**Agent identity (§2.7).** We trusted the merchant's word about who was calling, and stopped when we saw that one past purchase turns an honest merchant into a standing charge on the account.

**Quantity opened a hole.** Accepting `quantity` and charging `price × quantity` means a mandate saying `price lte 15000` — which the human read as "the agent may spend R$150" — passes **twenty units at R$3,000** without violating any rule. Invariant 5 stayed true on paper while the number the human authorised stopped meaning what they thought. `total` is now a separately attested attribute and is the ceiling on spending; `quantity` and `total` are signed in the ticket and the Authority redoes the arithmetic; a mandate with no `total` rule buys **one unit**. We rejected migrating old mandates by copying `price` into `total`, because that is the Authority rewriting what a human authorised.

**The agent was choosing the looser mandate.** Found while smoke-testing: the cycle was also operating under the umbrella mandate, which has 4 rules against the operational mandate's 17. The Authority would still have enforced the parent's rules, so it was not a hole in the Authority — but the agent was picking the **more permissive** authorisation when a tighter one existed, which is widening the mandate through the back door. A mandate that is the parent of another is a frame, not a permit. The rule is derived from `parentMandateId` and errs restrictively.

**A rule that never matched.** We removed `concentracao_pct` from the operational mandate. With one contract replacing another, 100% of the volume goes to one counterparty by construction, so any concentration ceiling refuses even the good offer. The attribute stays in the vocabulary; the rule belongs in a *portfolio* mandate that buys in slices. A rule that never matches does not protect. It gets in the way.

**We corrected our own arithmetic.** Our scope document stated "R$239 = R$225 + R$14", contradicting both the −R$168,000 figure and the "R$4 above market" claim elsewhere in it. The correct reading is **R$253 = R$239 + R$14**. Under the wrong one, Helios becomes the best offer and the demo collapses.

**Seeding.** Mandates are not seeded by default. Seeding broke the test asserting "the agent deposits a proposal, not a mandate", and the test was right: booting with authorisations already granted contradicts the first scene of the demo. `SEED_MANDATES=1` is development-only.

---

## 4. What we deliberately did not build

- **An external accreditation body** for merchants, the real-world analogue of a Certificate Authority. The registry stays inside the Authority, and this is the honest limit of our anti-fake-merchant story.
- **Ed25519 tickets.** Argued and rejected in §2.7; the upgrade needs no schema change.
- **LLM extraction from contract PDFs.** Contracts enter as structured JSON; at most one PDF passes through extraction, to prove the path exists.
- **Dual approval (CFO plus legal).** The one requested feature that would require touching `engine.js`, which is frozen and belongs to nobody. We chose the frozen engine.
- **Real money movement.** Card and Pix are mocked behind the same door; the anchors are **Pix Automático** (Brazilian Central Bank, 2025) and AP2's separation of "was it authorised?" from "is the payment valid?".
- **The incumbent's right of first refusal**, which is real in this market and would have doubled the demo.

---

## 5. Honest limitations

Introspection costs one network call per purchase and makes every merchant hard-dependent on the Authority; a denial-of-service against it halts all purchasing, and at very high volume the signed-token model verifies offline and scales better. The reference curve is a mocked oracle interface — in production an exchange feed, which then joins the trust boundary. Money movement is mocked, so what we demonstrate is topology rather than settlement: who calls whom, and the fact that the agent cannot redirect a charge. The mark-to-market formula is simplified, with the administrative fee and floor exposed as parameters and set to zero so the on-screen arithmetic matches the slide. The merchant allow-list is ours, not an accreditation authority's. And co-locating the agent and the Authority in one deployment demands discipline; we defend it as separate roles sharing a process, and the agent module's absence of any write path is the proof rather than our word.

---

## 6. Where it goes next

The Authority is stateless per request, so it shards on the opaque mandate id — already the ideal partition key, chosen for anti-enumeration before we thought about sharding. The immutable part of a mandate is cacheable, revocation becomes a pushed deny-list rather than a lookup, and a per-mandate freshness TTL covers what the deny-list has not yet reached. Further out, the merchant registry becomes a real accreditation federation.

That path converges with the alternative we rejected. Pushed to its limit, B becomes **A+B**: sign the immutable part, introspect only for revocation. **A and B converge**, so choosing introspection now closes no doors — while choosing the signed token would have closed the one door the trial by fire opens.

---

*Note on one judgement call: the ten decisions required in depth, each with its alternative and trade-off, plus the case citations, do not fit inside a 2,800-word target without dropping either an entry or the specificity that makes an entry defensible. We kept all ten and ran long. Cut §2.9 and §2.10 down to summary-table rows if length matters more.*

*Note on repository references: this log names only the artefacts that are stable across the codebase — the pure `engine.js`, the frozen `freeze.test.js` that pins the demo's real numbers against the real engine with no network and no database, the `approvals` collection, and `POST /introspect`. Exact file paths live in the README, so a refactor cannot falsify this document. State at submission: 202 tests passing, 0 failing, including the 12 fire-drill acceptance tests, each one a thing a judge does live.*
