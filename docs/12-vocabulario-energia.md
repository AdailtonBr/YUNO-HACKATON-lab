# 12 — Vocabulário congelado (energia)

> **Este documento é contrato entre as quatro frentes.** Foi congelado na Fase 0.
> Mudar qualquer coisa aqui exige avisar o grupo **antes** de escrever código —
> as outras três frentes já estão construindo em cima.
>
> O plano de trabalho está em `PLANO-DEMO-ENERGIA.md`. Este arquivo é só o vocabulário.

## A regra que organiza tudo: quem atesta o quê

A invariante 4 do `CLAUDE.md` diz que valores nunca são auto-declarados. Em energia ela ganha
uma torção que é a espinha do produto: **quem tem interesse não atesta.**

| Atributo | Quem atesta | Por quê |
|---|---|---|
| `preco_energia`, `comissao_terceiro`, `prazo_meses`, `flexibilidade_pct`, `take_or_pay_pct`, `submercado`, `fonte`, `estrutura_preco`, `periodo_suprimento`, `operacao` | **Comercializadora** | é a fonte de verdade sobre a própria oferta |
| `rating`, `garantia` | **Autoridade** (allow-list) | a vendedora é parte interessada no próprio risco de crédito. Preço ela atesta; o próprio balanço, não |
| `curva_ref_brl_mwh`, `desconto_vs_curva_pct`, `multa_rescisoria_brl`, `economia_bruta_brl`, `economia_liquida_brl`, `cobertura_pct`, `exposicao_pld_brl` | **Autoridade** (derivados) | dependem do contrato vigente do cliente e da curva de mercado — nada disso é dado da vendedora |
| `price`, `quantity`, `total` | **agente**, assinados no bilhete | segunda fonte independente (D16), já implementado |

Consequência prática, e é a linha que derruba duas das três comercializadoras da demo:
**uma oferta que traz o próprio `rating` está errada por construção.** A Frente B não pode expor
esses campos; a Frente A os injeta a partir de `merchants`.

## Atributos

```js
// ---- Atestado pela COMERCIALIZADORA (viaja em purchase.attributes) ----
submercado         : "SECO" | "S" | "NE" | "N"
fonte              : "convencional" | "I-5" | "I-0" | "I-100"
estrutura_preco    : "fixo" | "indexado" | "hibrido"
periodo_suprimento : "2027-01/2027-12"
prazo_meses        : int
flexibilidade_pct  : int
take_or_pay_pct    : int
preco_energia      : int    // centavos por MWh
comissao_terceiro  : int    // centavos por MWh, 0 se não há
operacao           : "novo_contrato" | "rescisao" | "renovacao"

// ---- Injetado pela AUTORIDADE antes do evaluate ----
rating                : "AAA"|"AA"|"A+"|"A"|"A-"|"BBB"|"BB"|null
garantia              : boolean
curva_ref_brl_mwh     : int      // centavos por MWh
desconto_vs_curva_pct : number   // 2 casas decimais
multa_rescisoria_brl  : int      // centavos
economia_bruta_brl    : int      // centavos
economia_liquida_brl  : int      // centavos, pode ser NEGATIVO
cobertura_pct         : number   // 2 casas decimais
exposicao_pld_brl     : int      // centavos, no cenário de teto do PLD

// ---- Já existiam. NÃO redefinir. ----
price    : int   // EFETIVO, centavos por MWh = preco_energia + comissao_terceiro
quantity : int   // MWh
total    : int   // centavos = price × quantity
```

### `price` é o preço **efetivo**

A Helios anuncia R$239 e embute R$14: o `price` dela é **25300**, não 23900. Os dois componentes
viajam junto para a Autoridade poder **refazer a conta**:

```
price === preco_energia + comissao_terceiro     // senão: commission_math_mismatch
```

É o mesmo idioma do `total_mismatch` que já existe em `engine.js`: *um preço efetivo afirmado não é
um preço efetivo verificado.* O comparador ingênuo vê 239 e escolhe a Helios; o agente com mandato vê
253 e a recusa.

### `comissao_terceiro` e `on_missing: "deny"`

A constraint é `{ attr: "comissao_terceiro", op: "eq", value: 0, on_missing: "deny" }`. O `on_missing`
é o que importa tanto quanto a regra: **recusar-se a declarar a comissão vale o mesmo que ser
recusado.** É a defesa contra o mecanismo do caso *Expert Tooling and Automation Ltd v. Engie Power
Ltd* [2025] EWCA Civ 292, em que comissão totalmente oculta foi tratada como suborno.

Honestidade sobre o limite: a comissão é **declarada pela parte interessada**. Se a Helios mentir e
declarar zero, a verificação passa. O que o sistema garante é que a declaração fica **congelada no
trilho** — descobrir depois que era falsa vira fraude provável, que é exatamente como o caso inglês
foi ganho. Não vendemos mais do que isso.

## Formato da oferta (`GET /catalog`)

```json
{
  "productId": "VOLT-SECO-2027",
  "name": "Volt Andina · SE/CO 2027 · fixo 12m",
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

`stock` é volume disponível em MWh — `store.js` já recusa `quantity > stock`, e "não tenho esse
volume" não é uma questão de autorização, então morre na loja sem incomodar a Autoridade.

## Os dados da demo

**Metalúrgica Aurora S.A.** — 4 UCs, Grupo A4, SE/CO, 3.500 MWh/mês. Contrato vigente
**Nortis Energia @ R$268/MWh** até 31/12/2027, flex ±5%, ToP 95%, denúncia 90 dias,
**remanescente 42.000 MWh**.

> A Nortis é o **contrato vigente**, não um endpoint. É assim que a demo tem três comercializadoras
> sem perder o baseline. Custo assumido: o cenário de direito de preferência do incumbente sai de escopo.

**Curva SE/CO 2027 = R$249/MWh** — a alavanca do juiz.

| Comercializadora | Rating | Garantia | `preco_energia` | `comissao_terceiro` | `price` | Prazo | Flex | Papel |
|---|---|---|---|---|---|---|---|---|
| Volt Andina | A− | sim | 24400 | 0 | **24400** | 12m | ±10% | vencedora legítima |
| Cerrado Power | BB | não | 23100 | 0 | **23100** | 12m | ±10% | melhor preço, **recusada** |
| Helios Trading | — | não | 23900 | 1400 | **25300** | 60m | ±5% | fraudadora |

```
economia_liquida = (curva − price) × volume
Volt   : (24900 − 24400) × 42.000 = + R$ 210.000  → passa tudo, ESCALA pela alçada
Cerrado: desconto 7,79% (o melhor)               → NEGA no rating BB
Helios : (24900 − 25300) × 42.000 = − R$ 168.000  → NEGA na comissão

multa_rescisoria = max(0, 26800 − 24900) × 42.000 = R$ 798.000
```

Tudo isso está travado em `app1/test/freeze.test.js`. **Se um desses números mudar, aquele teste cai.**

> ### Correção ao documento de escopo
> O §8, teste 6 do PDF diz *"R$239 = R$225 + R$14"*. Está errado: contradiz os −R$168.000 do §6.3 e o
> *"R$4 acima do mercado"* do §9. O correto é **R$253 = R$239 + R$14** — a comissão é **por cima** do
> anunciado. Com a leitura do §8, a Helios viraria a *melhor* oferta e a demo se desmontaria.

> ### Sobre piso e taxa administrativa
> Cláusulas mark-to-market puras são raras — quase sempre há piso, teto ou taxa. `mtm()` implementa os
> dois como parâmetro (`multaPisoBrl`, `taxaAdminBrl` no contrato). Na demo valem **zero**, para a
> aritmética na tela bater com a do slide. O código não é ingênuo; a demo é limpa.

## Os dois mandatos

Vivem em `app1/src/seed.js` como `UMBRELLA_DRAFT` e `OPERATIONAL_DRAFT`. **Importe de lá, não copie.**

- **Guarda-chuva** (diretoria, anual): submercado, teto de R$11M, prazo ≤24m, rating mínimo.
- **Operacional** (gestor de energia, `parentMandateId` = guarda-chuva): as seis camadas completas,
  `maxUses: 2`, alçada de R$50k.

Duas coisas sobre a **ordem** das constraints, e as duas são semânticas, não estéticas:

1. **`comissao_terceiro` é a primeira.** O motor para na primeira regra que falha; queremos que a
   Helios seja recusada pela comissão, que é a manchete.
2. **A alçada é a última.** Assim todas as regras duras são avaliadas antes de escalar — escalar uma
   compra que já seria recusada seria fazer o humano decidir uma questão que não é dele.

### Por que **não** há regra de `concentracao_pct`

Com um contrato substituindo outro, 100% do volume vai para uma contraparte por construção. Qualquer
teto de concentração recusaria até a oferta boa. O atributo fica derivável e no vocabulário; a regra só
faz sentido num mandato de **portfólio**, que compra em fatias. **Regra que nunca casa não protege,
atrapalha.**

## Os mandatos não são semeados

`seed()` cria o elenco (agente, allow-list, contrato, curva, instrumento de liquidação) e **para aí**.
Um sistema que nasce com autorizações já concedidas contradiz a primeira cena da demo — e um mandato
existir sem ninguém o ter emitido é precisamente o que este projeto existe para impedir.

Para desenvolver sem clicar a cada restart: `SEED_MANDATES=1`.

## Portas: um único deslocamento

`PORT_OFFSET` move Autoridade, comercializadoras e UI juntas.

| Dispositivo | Frente | `PORT_OFFSET` | Autoridade | Comercializadoras | UI |
|---|---|---|---|---|---|
| 1 | A | `0` | 3001 | 4001-4003 | 5173 |
| 2 | B | `10` | 3011 | 4011-4013 | 5183 |
| 2 | C | `20` | 3021 | 4021-4023 | 5193 |
| 3 | D | `30` | 3031 | 4031-4033 | 5203 |

`npm test` **não precisa disto**: os testes sobem tudo em portas efêmeras.

## Códigos de razão novos

`commission_math_mismatch` · `parent_revoked` · `unknown_curve` · `no_active_contract`
— nos dois locales, em `app1/src/shared/messages.js`.

## Decisões deixadas em aberto (de propósito)

| Questão | Quem decide | Nota |
|---|---|---|
| **Empenho vs. liquidação** | Frente A, se sobrar tempo | Em B2B o dinheiro não sai na assinatura: sai contra a nota, em 30/60/90. Hoje `/introspect` cobra na hora, que é o comportamento herdado do B2C. Dividir em `commit` + `settle` reescreve a invariante 5 para *"o cobrado é o comprometido, e o comprometido é o verificado"*. É **stretch**. |
| **Dupla aprovação (CFO + jurídico)** | Fase 3 | É a única exigência do escopo que tocaria `approvalMatches`, dentro do `engine.js`. Fica para quando o paralelismo acabar. |
| **Ed25519 no lugar de HMAC** | resolvido: **não** | O escopo pede Ed25519, mas na abordagem B quem verifica é a Autoridade, não o merchant. Assimetria não compra nada aqui e custa uma frente. |
