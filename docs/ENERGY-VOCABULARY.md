# The energy vocabulary

The frozen contract between the Authority, the agent and the counterparties. Attribute names are
identifiers: they never change casually, because a rule that stops matching stops protecting.

---

## Who attests what

Invariant: values are never self-declared. In this domain it gains a twist that carries the whole product:
**the interested party does not attest.**

| Attribute | Attested by | Why |
|---|---|---|
| `preco_energia`, `comissao_terceiro`, `prazo_meses`, `flexibilidade_pct`, `take_or_pay_pct`, `submercado`, `fonte`, `estrutura_preco`, `periodo_suprimento`, `operacao` | **Counterparty** | it is the source of truth about its own offer |
| `rating`, `garantia` | **Authority** (allow-list) | a seller is the last party that should declare its own credit risk. Counterparty failure bankrupted 54 UK suppliers between 2018 and 2025 |
| `curva_ref_brl_mwh`, `desconto_vs_curva_pct`, `multa_rescisoria_brl`, `economia_bruta_brl`, `economia_liquida_brl`, `cobertura_pct`, `exposicao_pld_brl` | **Authority** (derived) | they depend on the client's current contract and on the market — data the seller does not have and should not have |
| `price`, `quantity`, `total` | **agent**, signed in the ticket | an independent second source for the number |

**An offer that carries its own `rating` is wrong by construction.** The counterparties must not expose
those fields; the Authority injects them from `merchants`.

---

## The attributes

```js
// ---- Attested by the COUNTERPARTY (travels in purchase.attributes) ----
submercado         : "SECO" | "S" | "NE" | "N"
fonte              : "convencional" | "I-5" | "I-0" | "I-100"
estrutura_preco    : "fixo" | "indexado" | "hibrido"
periodo_suprimento : "2027-01/2027-12"
prazo_meses        : int
flexibilidade_pct  : int
take_or_pay_pct    : int
preco_energia      : int    // cents per MWh
comissao_terceiro  : int    // cents per MWh, 0 when there is none
operacao           : "novo_contrato" | "rescisao" | "renovacao"

// ---- Injected by the AUTHORITY before evaluate ----
rating                : "AAA"|"AA"|"A+"|"A"|"A-"|"BBB"|"BB"|null
garantia              : boolean
curva_ref_brl_mwh     : int      // cents per MWh
desconto_vs_curva_pct : number   // two decimals
multa_rescisoria_brl  : int      // cents
economia_bruta_brl    : int      // cents
economia_liquida_brl  : int      // cents, may be NEGATIVE
cobertura_pct         : number   // two decimals
exposicao_pld_brl     : int      // cents, in the PLD-ceiling scenario

// ---- Pre-existing. Do NOT redefine. ----
price    : int   // EFFECTIVE, cents per MWh = preco_energia + comissao_terceiro
quantity : int   // MWh
total    : int   // cents = price × quantity
```

### `price` is the **effective** price

Helios quotes R$239 and embeds R$14: its `price` is **25300**, not 23900. Both components travel so the
Authority can **redo the arithmetic**:

```
price === preco_energia + comissao_terceiro     // otherwise: commission_math_mismatch
```

Same idiom as the `total_mismatch` already in the engine: *an asserted effective price is not a verified
effective price*. The naive comparator sees 239 and picks Helios; the agent with a mandate sees 253 and
refuses it.

### `comissao_terceiro` and `on_missing: "deny"`

The rule is `{ attr: "comissao_terceiro", op: "eq", value: 0, on_missing: "deny" }`. The `on_missing`
matters as much as the rule: **refusing to declare the commission counts the same as being refused.** It
is the defence against the mechanism in *Expert Tooling and Automation Ltd v. Engie Power Ltd* [2025] EWCA
Civ 292, where a fully hidden commission was treated as a bribe.

Honest about the limit: the commission is **declared by an interested party**. If a counterparty lies and
declares zero, verification passes. What the system guarantees is that the declaration is **frozen in the
trail** — discovering later that it was false becomes provable fraud, which is exactly how the English
case was won. We do not sell more than that.

---

## The offer format (`GET /catalog`)

```json
{
  "productId": "VOLT-SECO-2027",
  "name": "Volt Andina · SE/CO 2027 · fixed 12m",
  "price": 24400,
  "currency": "BRL",
  "preco_energia": 24400,
  "comissao_terceiro": 0,
  "submercado": "SECO",
  "fonte": "convencional",
  "estrutura_preco": "fixo",
  "periodo_suprimento": "2027-01/2027-12",
  "prazo_meses": 12,
  "flexibilidade_pct": 10,
  "take_or_pay_pct": 90,
  "operacao": "novo_contrato",
  "stock": 60000
}
```

`stock` is available volume in MWh — the counterparty refuses `quantity > stock` itself, because *"I don't
have that volume"* is not a question of authorisation and dies before it reaches the Authority.

---

## The demo's cast

**Metalúrgica Aurora S.A.** — 4 sites, Group A4, SE/CO submarket, 3,500 MWh/month. Current contract with
**Nortis Energia at R$268/MWh** until 31/12/2027, ±5% flexibility, 95% take-or-pay, 90 days notice,
**42,000 MWh remaining**.

> Nortis is the **current contract**, not an endpoint. That is how the demo has three counterparties
> without losing the baseline. Accepted cost: the incumbent's right-of-first-refusal scenario is out of
> scope.

**SE/CO reference curve for 2027 = R$249/MWh** — the judges' lever.

| Counterparty | Rating | Guarantee | `preco_energia` | `comissao_terceiro` | `price` | Term | Flex | Role |
|---|---|---|---|---|---|---|---|---|
| Volt Andina | A− | yes | 24400 | 0 | **24400** | 12m | ±10% | the legitimate winner |
| Cerrado Power | BB | no | 23100 | 0 | **23100** | 12m | ±10% | best price, **refused** |
| Helios Trading | — | no | 23900 | 1400 | **25300** | 60m | ±5% | the fraudster |

```
net saving = (curve − price) × volume
Volt   : (24900 − 24400) × 42,000 = + R$ 210,000   → passes everything, ESCALATES on governance
Cerrado: discount 7.79% (the best)                 → REFUSED on rating BB
Helios : (24900 − 25300) × 42,000 = − R$ 168,000   → REFUSED on the commission

exit penalty = max(0, 26800 − 24900) × 42,000 = R$ 798,000
```

All of it is locked in `app1/test/freeze.test.js`. **If one of these numbers changes, that suite fails.**

> **A correction we made to our own scope document.** It stated *"R$239 = R$225 + R$14"*, which contradicts
> both the −R$168,000 figure and the "R$4 above market" claim elsewhere in it. The correct reading is
> **R$253 = R$239 + R$14** — the commission sits **on top** of the quote. Under the other reading, Helios
> becomes the *best* offer and the demo collapses.

> **On the penalty floor and the administrative fee.** Pure mark-to-market clauses are rare — there is
> almost always a floor, a cap or a fee. `mtm()` implements both as parameters (`multaPisoBrl`,
> `taxaAdminBrl` on the contract). In the demo they are **zero**, so the arithmetic on screen matches the
> slide. The code is not naive; the demo is clean.

---

## The two mandates

They live in `app1/src/seed.js` as `UMBRELLA_DRAFT` and `OPERATIONAL_DRAFT`. **Import them; do not copy
them.**

- **Umbrella** (board, annual): submarket, R$11M cap, term ≤24m, minimum rating.
- **Operational** (energy manager, `parentMandateId` = umbrella): all six layers, `maxUses: 2`, a
  R$50k governance threshold.

Two things about the **order** of the constraints, both semantic:

1. **`comissao_terceiro` is first.** The engine stops at the first failure, and we want Helios refused on
   the commission — the headline.
2. **The governance threshold is last.** Every hard rule is evaluated before escalating; escalating a
   purchase that would be refused anyway hands the human a question that is not theirs.

### Why there is **no** `concentracao_pct` rule

With one contract replacing another, 100% of the volume goes to one counterparty by construction, so any
concentration ceiling would refuse even the good offer. The attribute stays derivable and in the
vocabulary; the rule belongs in a **portfolio** mandate that buys in slices. **A rule that never matches
does not protect. It gets in the way.**

### Mandates are not seeded

`seed()` creates the cast — agent, allow-list, contract, curve, settlement account — and stops there. A
system that boots with authorisations already granted contradicts the first scene of the demo, and a
mandate existing without anyone having issued it is precisely what this project exists to prevent.

For development without clicking on every restart: `SEED_MANDATES=1`.

---

## Ports

`PORT_OFFSET` moves the Authority, the counterparties and the Portal together.

| `PORT_OFFSET` | Authority | Counterparties | Portal |
|---|---|---|---|
| `0` | 3001 | 4001-4003 | 5173 |
| `10` | 3011 | 4011-4013 | 5183 |
| `20` | 3021 | 4021-4023 | 5193 |
| `30` | 3031 | 4031-4033 | 5203 |

Do **not** set `PORT` or `AUTHORITY_URL`: a pinned value beats the offset and cancels it. The boot warns
loudly when that happens, because the failure is otherwise silent and costs half an hour to find.

`npm test` needs none of this — the suite binds ephemeral ports.

---

## Reason codes added by this domain

`commission_math_mismatch` · `parent_revoked` · `unknown_curve` · `no_active_contract` — in both locales,
in `app1/src/shared/messages.js`.

---

## Open decisions

| Question | Note |
|---|---|
| **Commit vs. settle** | In B2B the money does not leave at signature: it leaves against an invoice at 30/60/90 days. Today `/introspect` charges immediately, inherited from the consumer case. Splitting `commit` + `settle` rewrites invariant 6 into *"what is charged is what was committed, and what was committed is what was verified"*. It is where an orchestrator earns more, not less. |
| **Dual approval** (CFO + legal) | The only requirement that would touch `approvalMatches` inside the frozen engine. |
| **Ed25519 instead of HMAC** | Resolved: **no**. In an introspection model the Authority verifies, not the counterparty. Asymmetry buys nothing here. Argued in §2.7 of the [Decision Log](DECISION-LOG.md). |
