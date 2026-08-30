# Scaling the opaque-id model

This answers the question a panel asks right after understanding introspection: *"and if it were a million
purchases a minute?"* **Nothing here is in the MVP, and nothing here should be.** It exists to answer
"and at scale?" with a concrete path rather than a shrug.

The only structural cost of introspection is **one live call per purchase**: the counterparty has to ask
the Authority "does this still hold?". Scaling it is therefore **absorbing or removing that call without
losing live revocation** — the property that made us choose introspection in the first place
(§2.2 of the [Decision Log](DECISION-LOG.md)).

Everything below follows from that one sentence. Each section takes more work off the critical path; none
gives up on *"this mandate is dead"* reaching the place where verification happens.

---

## 1. Stateless Authority, sharded by id — the free win

`/introspect` does exactly two things in the database: a **point lookup** by `_id` and an **atomic
`findOneAndUpdate` on the same document**. No join, no scan, no cross-document transaction. And the
Authority keeps no state between requests — all the truth is in the database.

Immediate consequence: **N replicas behind a load balancer, with no coordination between them**. Any
replica answers any request, and adding one requires agreeing nothing with the others.

The bottleneck moves to the database — and the database scales because the `mandateId` is an **opaque,
high-entropy id** (128 bits). Ids like that distribute uniformly across the hash space, so with the shard
key set to `_id`:

- **uniform load** across shards, no hot shard;
- every verification touches **a single shard** (lookup + update on the same document);
- **zero** cross-shard traffic, zero joins, zero scans.

It is embarrassingly parallel: doubling the shards doubles throughput, rewriting nothing.

> **Worth citing in the defence:** the ideal partition key came **free, from a security decision**. The id
> had to be unpredictable to stop enumeration; unpredictable is exactly the property that makes a good
> shard key. There was no trade-off between security and scale here — the same choice paid both bills.

---

## 2. Separate the immutable from the mutable

A mandate mixes two natures in one document:

| Part | Fields | Changes after creation? |
|---|---|---|
| **Immutable** | `constraints`, `humanId`, `agentId`, `mode`, `paymentMethodRef`, `maxUses`, `expiresAt`, `parentMandateId` | **No.** Mandates are not edited — tightening a limit means issuing a new version (§2.10 of the Decision Log) |
| **Mutable** | `revoked`, `usedCount` | Yes |

This matters because the **expensive** part of verification — matching the constraint list against the
attributes, checking the owner, checking the ceiling — uses **only the immutable part**. And immutable data
is **cacheable forever, with no staleness risk**: there is no newer version for it to fall behind.

In a verifier with a warm cache, the live work reduces to two questions: *has this mandate been revoked?*
and *does it still have a use left?* Even `expiresAt` leaves the live path — it is immutable data compared
against the local clock.

We have reduced "verify a mandate" to "know whether an id is dead". Section 3 attacks that residue.

---

## 3. Invert revocation — a propagated deny-list

Purchases are many; revocations are few. Asking "does this still hold?" on every purchase is **querying
the state of millions of live mandates to learn something about a handful of dead ones**. The question is
on the wrong side.

Invert it. Keep a **set of revoked ids** — small, precisely because revocation is rare — replicated close
to each verifier. The purchase becomes a **cheap in-memory membership test**:

- **fast path:** a bloom filter over the deny-list. If it says "not present", the mandate is definitely
  alive → approve **with no network call** (a bloom filter has no false negatives).
- **slow path:** if it says "maybe", confirm against the exact list — the cost is paid only in that rare
  case (a false positive, or an actual revocation).

And revocation becomes **push, not poll**: when the human revokes, the Authority publishes the id on a
channel that **pushes** it to every verifier's deny-list. Nobody sits there asking.

Real-world analogues worth naming: **CRL** and **OCSP stapling** in TLS, and revoked-refresh-token lists in
OAuth. This is the industry's answer to exactly this problem.

> **Honest trade-off, name it before they ask:** revocation stops being instantaneous and acquires
> **propagation latency** — sub-second to a few seconds, depending on fan-out. Irrelevant at hackathon
> scale (one Authority, direct read, instant revocation). At global scale, it is the price.

---

## 4. TTL as a per-mandate risk policy

Caching the introspection **result** for a short TTL (1–5s) absorbs bursts from the same mandate: an agent
firing ten attempts in a row causes one verification, not ten.

This reintroduces staleness **on purpose** — and the difference from a signed-token model is decisive. With
a JWT, the staleness window is **imposed by the cryptography**: the token is valid until it expires and
there is no way to shorten it without reissuing. Here it is **a tunable parameter, and tunable per
mandate**.

That fits the pattern already running through the system: `on_missing`/`on_fail` let the mandate decide its
rigidity in the face of absence and failure; `mode` lets it decide whether it demands approval per
purchase. TTL is the same idea applied to freshness — **the mandate decides how much staleness it
tolerates.**

| Mandate profile | TTL | Why |
|---|---|---|
| Low value, `autonomo`, recurring | 1–5s | The possible loss in a window of seconds is smaller than the cost of verifying everything live |
| High value, or `mode: "aprovacao"` | 0 (always live) | Here revocation has to hold **now**; the extra call is cheap next to the risk |

Revocation freshness thus becomes **a dimension of risk** — set by whoever creates the mandate, in the same
place they set the ceiling and the validity.

---

## 5. Convergence with signed tokens at the limit

Push sections 2, 3 and 4 to the extreme and see where you land:

- the immutable part is cacheable forever → why not **sign it** and let the counterparty verify limits and
  ownership **offline**, without touching the database?
- the live residue is only revocation → kept as a propagated deny-list plus a TTL.

The result is **a signed token carrying the immutable part, plus a revocation list**. In other words: **the
maximally scalable version of introspection *is* the hybrid.**

That is not an accident. A signed-token model already pays the cost of signing in order to verify offline,
and then has to bolt a live status mechanism on top — which is exactly AP2's secondary problem.
Introspection starts with live state and pushes the immutable outward. **The two arrive at the same place
from opposite sides.**

> **Line for the defence:** *"we chose introspection for trivially live revocation in the MVP; the scaling
> path is to sign the immutable part and introspect only revocation — which is where the two models meet."*

Strategic corollary: choosing introspection now **closes no doors**. The migration is additive, not a
rewrite.

---

## A caveat this domain adds

In energy the ceiling is **relative** — "at least 2% below the market curve" — and the curve moves daily.
A signed token cannot carry that mandate at all: a token minted last month cannot know today's number. So
in this vertical, the convergence of §5 is **partial**: what can be signed and pushed to the edge is the
scope, the counterparty and the term; the *economics* stay a live read, because the number they compare
against is not a fact about the agent.

That is not a weakness of the model — it is the domain telling you which part of the decision is genuinely
live. See §2.3 of the [Decision Log](DECISION-LOG.md).

---

## The irreducible trade-off

There is no such thing as **instantaneous global revocation** together with **fully local verification with
zero coordination**. The reason is simple and does not depend on implementation: for a verification to
refuse a revoked mandate, the fact *"this mandate died"* has to have **arrived** where the verification
happens. That is communication, and communication has latency.

All scaling engineering here is choosing a point on this curve:

```
revocation freshness  <──────────────────────────>  verification locality
(always live,                                        (offline, cached,
 one call per purchase,                               no network call,
 instant revocation)                                  propagation in seconds)
        ^                                                      ^
    our MVP                                        the scaling limit (section 5)
```

The insight — and what makes it defensible — is that **this point need not be a single one**. Like rigidity
(`on_missing`/`on_fail`) and mode (`autonomo`/`aprovacao`), it can be chosen **per mandate**, according to
the value at risk. A recurring R$50 mandate and a R$50,000 one have no reason to buy the same guarantee.

---

> **Scope:** none of this is implemented, nor should it be. The MVP runs the version with no cache, no
> deny-list and no TTL — one Authority, direct read, instant revocation.
