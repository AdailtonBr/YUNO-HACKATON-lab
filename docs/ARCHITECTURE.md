# Architecture

Roles, the end-to-end flow, and the trust model. This is the source for deliverable #4, the architecture
diagram.

---

## 1. Four roles, not two

The wrong intuition is "agent ↔ counterparty". There are four roles, and the separation between them *is*
the security.

| Role | Where | Does | Does **not** |
|---|---|---|---|
| **Human** (energy manager, board) | Portal | Issues the mandate, approves escalations, revokes live | — |
| **Authority** | App 1 (backend) | Holds state and the payment pointer; **attests** counterparty and market; **verifies**; revokes; **fires** the payment | Never sells, never negotiates |
| **Agent** | App 1 (a separate role) | Runs the daily cycle: reads the curve and the contract, sends the RFQ, compares, attempts | Never creates or widens a mandate; never decides whether a purchase is valid; never sees the instrument |
| **Counterparty** | App 2 (×3) | Describes its own offer in the common vocabulary; relays the agent's ticket **untouched**; calls the Authority | Never judges; **never asserts who the agent is**; never attests its own rating |

### The internal boundary that matters

Agent and Authority share a deployment but are separate roles. `app1/src/agent/` reaches the Authority
**only over HTTP**: it does not import the models, does not open Mongo, does not call `evaluate`, and
never names the `paymentMethodRef`. It reads mandates through the same public route any client would use
— which returns the constraints and the frame, and never the payment pointer.

It does share two **pure functions** with the Authority: status derivation and the economics projection.
That is deliberate and is not a leak — sharing a pure function is not sharing authority. It is what makes
the comparison table the human sees match the number the Authority will compute.

**This is checked, not asserted.** `app1/test/boundary.test.js` reads the agent's source and fails if any
of it imports the models, touches mongoose, queries a collection, calls `evaluate`, writes state, or
mentions the payment pointer. The claim was false once — the daily cycle read `Mandate.find({})` straight
from Mongo, which returns the whole document, pointer included. Nobody noticed, because the sentence lived
in a document and the shortcut lived in another file. The test is what stops it becoming false again.

If asked *"they're the same app — what stops the agent from authorising itself?"*: authorisation state is
written only by the human, through the Portal; the agent reads an id and the limits; verification and
revocation read that state; **the agent has no write path into it, and no say in the verdict**.

---

## 2. Verification model: introspection, not a signed token

The agent carries an **opaque, high-entropy id** (`mnd_9f3a…`), not a JWT with the limits inside. When the
counterparty needs to verify, it **calls** `POST /introspect` and the Authority resolves everything
server-side.

**Why.** Live revocation is trivial (a flag read on the next call), the counterparty gets selective
disclosure (it asks "does this fit?", it never sees the limits), and there is far less cryptographic
surface to get wrong. Accepted trade-off: one network call per purchase, and a dependency on the Authority
being up.

**And in this domain, a signed token could not carry the mandate at all.** The ceiling is *relative*:
"at least 2% below the market curve". The curve moves daily and is not a fact about the agent — a token
minted last month cannot know today's number. See §2.3 of the [Decision Log](DECISION-LOG.md).

Scaling path: [`SCALING.md`](SCALING.md).

---

## 3. The end-to-end flow

```mermaid
sequenceDiagram
    actor H as Energy manager
    participant PT as Portal (App 1 UI)
    participant AG as Agent (App 1)
    participant AU as Authority (App 1)
    participant CP as Counterparty (App 2)
    participant PS as Payment executor<br/>(mock today · Yuno in production)

    H->>PT: registers the settlement account
    Note over PT,AU: the raw credential enters the vault<br/>and becomes an opaque paymentMethodRef
    H->>PT: issues the mandate — six layers
    PT->>AU: creates it (state in Mongo)
    Note over AU: the agent is not involved.<br/>The mandate is born from the human's hand.

    loop every day
        AG->>AU: GET /curves · GET /contracts
        AG->>CP: RFQ — the three counterparties, in parallel
        CP-->>AG: offers in the common vocabulary
        Note over AG: compares and picks the best that fits.<br/>A courtesy filter — it authorises nothing.

        AG->>AG: signs a purchaseTicket (HMAC)
        AG->>CP: POST /buy { offerId, mandateId, purchaseTicket }
        Note over CP: attests the REAL offer;<br/>relays the ticket UNTOUCHED

        CP->>AU: POST /introspect (its own API key)
        AU->>AU: verifies the ticket → DERIVES the agentId
        AU->>AU: injects rating, guarantee, curve, penalty, net saving
        AU->>AU: resolves the delegation chain
        AU->>AU: the engine: limits? owner? revoked? expired?
        AU->>AU: consumes the use atomically (closes TOCTOU)

        alt valid
            AU->>PS: charges the paymentMethodRef · the VERIFIED amount
            PS-->>AU: receipt
            AU-->>CP: { valid: true, receiptId }
            CP-->>AG: contract signed
        else out of mandate
            AU-->>CP: { valid: false, action: "reject", reason }
        else needs a human
            AU->>AU: records the pending approval, with the exact numbers frozen
            AU-->>CP: { valid: false, action: "escalate", approvalRequestId }
            H->>AU: approves in the Portal
            Note over AG: the next cycle retries; now it matches
        end
    end

    Note over H,AU: Revocation: H revokes → the next /introspect fails
```

---

## 4. The trust model

**Counterparty → Authority.** It trusts because it **calls** and gets an answer. There is nothing to
verify offline.

**Authority → Counterparty.** The Authority only talks to **registered, authenticated** counterparties
(API key + allow-list). One that is not registered never participates — this is the anti-slamming
mechanism.

**Agent → Authority.** The agent **proves** who it is by signing a `purchaseTicket` per attempt (HMAC,
with a secret only it and the Authority know) describing exactly the purchase requested. The counterparty
relays it untouched and the Authority verifies it: the `agentId` is **derived from the ticket**, never
read from a body field — not the agent's, not the counterparty's.

> Why the counterparty authenticating the agent and telling us is not enough: a registered counterparty
> that served one legitimate purchase knows the `mandateId` and the `agentId`, and could call
> `/introspect` later — **with no agent present** — and have the Authority charge the account holder in
> its favour. See §2.7 of the [Decision Log](DECISION-LOG.md).

**Human → everything.** The root of authorisation. Only the human issues, widens or revokes a mandate, on
a screen the agent cannot reach.

### Who attests what

The extension that carries this domain, and the sharpest idea in the project: **the interested party does
not attest.**

| Attribute | Attested by | Why |
|---|---|---|
| `preco_energia`, `comissao_terceiro`, `prazo_meses`, `flexibilidade_pct`, `take_or_pay_pct`, `submercado`, `fonte`, `estrutura_preco` | **Counterparty** | it is the source of truth about its own offer |
| **`rating`, `garantia`** | **Authority** (allow-list) | a seller is the last party that should declare its own credit risk. Counterparty failure is what bankrupted 54 UK suppliers between 2018 and 2025 |
| `curva_ref_brl_mwh`, `desconto_vs_curva_pct`, `multa_rescisoria_brl`, `economia_liquida_brl`, `cobertura_pct`, `exposicao_pld_brl` | **Authority** (derived) | they depend on the client's current contract and on the market — data the seller does not have and should not have |
| `price`, `quantity`, `total` | **agent**, signed | an independent second source for the number |

An offer that carries its own `rating` is wrong by construction. Full vocabulary:
[`ENERGY-VOCABULARY.md`](ENERGY-VOCABULARY.md).

---

## 5. The hierarchy of mandates

The board opens an annual **umbrella**; the energy manager operates inside it through a derived
**operational** mandate. This is what answers the question the consumer case never had to ask: **who
authorised the authoriser?**

- Issued through `POST /mandates/:id/derive` — delegation is a different act from authorising, and the
  trail records it as such.
- **A child cannot outlive its parent.** An authorisation that survives whoever granted it is the
  "indefinite validity" anti-pattern by another road.
- **Revoking the parent kills the children**, resolved live in `hierarchy.js` before the engine runs — so
  `evaluate` stays a pure function of one mandate.
- **A mandate that is a parent is a frame, not a permit.** The cycle never operates under it: the umbrella
  has four rules and the operational one seventeen, and picking the looser authorisation when a tighter one
  exists is widening the mandate through the back door.

---

## 6. Where the money moves

There is exactly **one arrow** out of this system to a payment service, it leaves the **Authority**, and
it leaves **after** the yes.

| | |
|---|---|
| **Our system = authorisation** | Agent + counterparties + Authority decide **IF** it may be paid: the mandate exists, belongs to this agent, is not revoked, has not expired, has a use left, and the contract fits the limits |
| **Yuno / PSP = execution** | Moves the money, **after** the yes, and only then |

That is not decoration — it is the topology that makes everything else true. The **agent** does not have
that arrow; the **counterparty** does not either, it receives a receipt and does not pull money. Swapping
the mock for Yuno changes the endpoint URL and the receipt format. It does not change the data model, the
engine, introspection, revocation, the trail, or who calls whom.

The B2B honesty: in energy the money does not leave at signature — it leaves against an invoice at 30/60/90
days. Splitting `commit` (reserve) from `settle` (pay) is named as an open decision in §5 of the
[Decision Log](DECISION-LOG.md), and it is where an orchestrator earns more, not less: settlement is
batched, netted and multi-counterparty.

---

## 7. Producing the diagram

For deliverable #4, export a visual version (draw.io / Excalidraw / rendered Mermaid) containing: the four
roles, App 1's internal boundary (Agent vs Authority), the counterparty→Authority introspection call, the
Authority→executor payment arrow, and the human→Authority revocation loop. The `sequenceDiagram` above is
the base.
