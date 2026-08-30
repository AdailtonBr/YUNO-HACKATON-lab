# Plano de build — Agente de Recontratação de Energia

> Documento de coordenação para **4 pessoas construindo em paralelo**, cada uma com uma instância do
> Claude Code na própria máquina. Hackathon Yuno × Nauta.

---

## Como usar este documento

> ## ✅ A Fase 0 está FEITA e em `main`. Pode começar.
>
> `git pull` e siga o passo 2. Os contratos congelados estão em
> [`docs/12-vocabulario-energia.md`](docs/12-vocabulario-energia.md), e
> `app1/test/freeze.test.js` (14 testes) trava os números da demo. **125 testes verdes.**

1. ~~Uma pessoa executa a Fase 0 e faz merge em `main`.~~ **Feito.**
2. Cada pessoa assume **uma frente** (A, B, C ou D), cria a branch e abre o Claude Code no repo:

   ```bash
   git pull && git checkout -b frente-a-nucleo     # ou frente-b-comercializadoras, etc.
   claude
   ```

   E dá a ele este prompt:

   > Leia `CLAUDE.md`, depois `PLANO-DEMO-ENERGIA.md`. Eu sou a **Frente A**. Implemente
   > exclusivamente a seção "Frente A" do plano. **Não toque em nenhum arquivo fora da sua coluna
   > na Matriz de propriedade.** Escreva os testes junto com o código.

3. As seções **"Contratos congelados"** e **"Matriz de propriedade"** são lidas por todos. O resto da sua
   frente é seu; o resto do documento é contexto.

---

## O que estamos construindo

Um agente que, todo dia, consulta o mercado livre de energia, compara as ofertas contra o contrato de
suprimento vigente da empresa e decide se vale recontratar — **executando dentro de um mandato verificável
ou escalando para aprovação humana**, e nunca decidindo sozinho se pode.

O ponto do produto não é economizar energia. É que a **Carta de Autorização Nível 2** — o documento que
hoje deixa um broker assinar contrato em nome da empresa sem nem dizer o preço — é um mandato sem limites,
e é origem documentada de fraude bilionária. Não estamos criando um risco novo: estamos colocando limites
verificáveis num risco que já existe.

> **O agente é o pretexto; o mandato é o produto.**

---

## A regra de ouro: `engine.js` não muda uma linha

`app1/src/authority/engine.js` é uma função pura, sem nenhum import, com vocabulário aberto
(`{attr, op, value, on_missing, on_fail}`). **Toda a semântica de energia entra como dado:**

| Do PDF | Vira |
|---|---|
| As 6 camadas do mandato | `constraints` |
| Curva, multa MtM, economia líquida | atributos **derivados e atestados pela Autoridade** |
| As alçadas | `on_fail: "escalate"` |
| Volume MWh e valor do contrato | `quantity` e `total`, que já existem |

Isso não é elegância — é o que torna 4 frentes paralelas seguras. `engine.js` é o único arquivo do qual
tudo depende. **Se você acha que precisa mexer nele, pare e avise o grupo.** Quase sempre a resposta é
uma constraint ou um atributo derivado.

### Duas armadilhas conhecidas

**1. O motor para na primeira regra que falha.** O teste 6 quer a Helios rejeitada "por comissão *e* por
prazo". O motor devolve **uma** razão + o `trace` com as demais marcadas `not_evaluated` — e está certo:
dizer "ok" sobre o que não se olhou seria mentira. Quem mostra a lista completa de falhas é a **tabela de
comparação do agente** (Frente C), que é pré-filtro e cortesia. A Autoridade dá o veredito único.
**Não tente fazer o motor coletar todas as falhas.**

**2. A ordem das constraints importa.** A alçada (`economia_liquida_brl`) é a **última**, para que todas as
regras duras sejam avaliadas antes de escalar. A comissão é das **primeiras**, porque é a manchete do caso
*Expert Tooling v. Engie*.

---

## Quem atesta o quê

Extensão da invariante 4 do `CLAUDE.md`, com uma torção nova: **quem tem interesse não atesta.**

| Atributo | Quem atesta | Por quê |
|---|---|---|
| `preco_energia`, `comissao_terceiro`, `prazo_meses`, `flexibilidade_pct`, `take_or_pay_pct`, `submercado`, `fonte`, `estrutura_preco`, `periodo_suprimento` | **Comercializadora** | é a fonte de verdade sobre a própria oferta |
| `rating`, `garantia` | **Autoridade** | a contraparte é parte interessada no próprio rating. É o que derruba Cerrado e Helios |
| `curva_ref_brl_mwh`, `desconto_vs_curva_pct`, `multa_rescisoria_brl`, `economia_liquida_brl`, `cobertura_pct`, `exposicao_pld_brl`, `concentracao_pct` | **Autoridade** (derivados) | dependem do contrato vigente do cliente e da curva — nenhum dos dois é dado da comercializadora |
| `price`, `quantity`, `total` | **assinados pelo agente** no bilhete | segunda fonte independente (D16), já implementado |

`comissao_terceiro` com `on_missing: "deny"`: **recusar-se a declarar a comissão vale o mesmo que ser
recusado.** É exatamente para isso que `on_missing` existe.

**Mantemos HMAC**, não migramos para Ed25519 (o PDF pede em §4.1). Na abordagem B quem verifica é a
Autoridade, não o merchant — assimetria não compra nada aqui e custa uma frente inteira.

---

## Contratos congelados

> Tudo nesta seção é definido na **Fase 0** e **não muda** durante o trabalho paralelo.
> Se precisar mudar, avise no canal antes.

### Vocabulário de atributos

```js
// Atestado pela COMERCIALIZADORA (viaja em purchase.attributes)
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

// Injetado pela AUTORIDADE antes do evaluate
rating                 : "AAA"|"AA"|"A+"|"A"|"A-"|"BBB"|"BB"|null
garantia               : boolean
curva_ref_brl_mwh      : int      // centavos por MWh
desconto_vs_curva_pct  : number   // 1 casa decimal
multa_rescisoria_brl   : int      // centavos
economia_liquida_brl   : int      // centavos, pode ser negativo
cobertura_pct          : number
exposicao_pld_brl      : int      // centavos
concentracao_pct       : number

// Já existem — NÃO redefinir
price    : int   // EFETIVO em centavos por MWh = preco_energia + comissao_terceiro
quantity : int   // MWh
total    : int   // centavos = price × quantity
```

**`price` é o preço EFETIVO.** A Helios anuncia R$239 e embute R$14: o `price` dela é **25300**. A
Autoridade **refaz a conta** `price == preco_energia + comissao_terceiro` e nega com
`commission_math_mismatch` se não fechar — mesmo idioma do `total_mismatch` que já existe
(`engine.js:104`): *um preço efetivo afirmado não é um preço efetivo verificado.*

### Formato da oferta (o que `GET /catalog` devolve)

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
  "stock": 60000
}
```

`stock` é o volume disponível em MWh — reusa o campo que `store.js` já usa para recusar
`quantity > stock`. **A oferta NÃO carrega `rating` nem `garantia`**: quem os atesta é a Autoridade.

### Os dados da demo (números exatos)

**Cliente — Metalúrgica Aurora S.A.** · 4 UCs · Grupo A4 · SE/CO · 3.500 MWh/mês.
Contrato vigente **Nortis Energia @ R$268/MWh** até 31/12/2027, flex ±5%, ToP 95%, denúncia 90 dias,
**volume remanescente 42.000 MWh**.

> A Nortis é o **contrato vigente**, não um endpoint. É assim que temos 3 comercializadoras sem perder o
> baseline. Custo assumido: o cenário de direito de preferência do incumbente (§6.2 do PDF) sai de escopo.

**Curva SE/CO 2027 = R$249/MWh** — a alavanca que entregamos ao juiz.

| Comercializadora | Rating | Garantia | `preco_energia` | `comissao_terceiro` | `price` efetivo | Prazo | Flex | Papel |
|---|---|---|---|---|---|---|---|---|
| **Volt Andina** | A− | sim | 24400 | 0 | **24400** | 12m | ±10% | A vencedora legítima |
| **Cerrado Power** | BB | não | 23100 | 0 | **23100** | 12m | ±10% | **Melhor preço, recusada** no rating |
| **Helios Trading** | — | não | 23900 | 1400 | **25300** | 60m | ±5% | A fraudadora |

**A conta** (confere com §6.3 do PDF):

```
economia_liquida = (curva − price) × volume
Volt   : (24900 − 24400) × 42.000 =  + R$ 210.000  → > R$50k → ESCALA para o gestor
Helios : (24900 − 25300) × 42.000 =  − R$ 168.000  → nega
Cerrado: desconto 7,2% ótimo, mas rating BB        → nega

multa_rescisoria = max(0, 26800 − 24900) × 42.000 = R$ 798.000
```

> **Correção ao PDF.** O §8, teste 6 diz "R$239 = R$225 + R$14". Está errado: contradiz o −R$168.000 do
> §6.3 e o "R$4 acima do mercado" do §9. O correto é **R$253 = R$239 + R$14**. Com a leitura do §8, a
> Helios viraria a *melhor* oferta e a demo se desmontaria.

> **Sobre a taxa administrativa e o piso da multa** (ressalva do §3.2): `mtm()` recebe os dois como
> parâmetro e os implementa. O contrato da Aurora os define como **zero**, para que a aritmética na tela
> bata exatamente com o slide. O código não é ingênuo; a demo é limpa.

### Os dois mandatos da Aurora (hierarquia)

Com um cliente só, é a hierarquia que dá o contraste "executa sozinho vs. escala" e habilita o teste 12.

```js
// MND-GUARDA-CHUVA — outorgante: Diretoria. Anual.
{
  mode: "autonomo", currency: "BRL", maxUses: 20,
  expiresAt: "2026-12-31T23:59:59Z", parentMandateId: null,
  constraints: [
    { attr: "submercado", op: "eq",  value: "SECO",                     on_missing: "deny", on_fail: "deny" },
    { attr: "total",      op: "lte", value: 1100000000,                 on_missing: "deny", on_fail: "deny" }, // R$ 11M
    { attr: "prazo_meses",op: "lte", value: 24,                         on_missing: "deny", on_fail: "deny" },
    { attr: "rating",     op: "in",  value: ["AAA","AA","A+","A","A-"], on_missing: "deny", on_fail: "deny" },
  ],
}

// MND-OPERACIONAL — outorgante: Gestor de energia. Deriva do guarda-chuva.
{
  mode: "autonomo", currency: "BRL", maxUses: 2,
  expiresAt: "2026-12-31T23:59:59Z", parentMandateId: "<id do guarda-chuva>",
  constraints: [
    // Camada 5 — a manchete: comissão declarada e zero
    { attr: "comissao_terceiro",     op: "eq",  value: 0,                          on_missing: "deny", on_fail: "deny" },
    // Camada 2 — escopo
    { attr: "submercado",            op: "eq",  value: "SECO",                     on_missing: "deny", on_fail: "deny" },
    { attr: "fonte",                 op: "in",  value: ["convencional","I-5"],     on_missing: "deny", on_fail: "deny" },
    { attr: "estrutura_preco",       op: "eq",  value: "fixo",                     on_missing: "deny", on_fail: "deny" },
    { attr: "prazo_meses",           op: "lte", value: 24,                         on_missing: "deny", on_fail: "deny" },
    // Camada 5 — contraparte (atestada pela AUTORIDADE)
    { attr: "rating",                op: "in",  value: ["AAA","AA","A+","A","A-"], on_missing: "deny", on_fail: "deny" },
    { attr: "garantia",              op: "eq",  value: true,                       on_missing: "deny", on_fail: "deny" },
    { attr: "concentracao_pct",      op: "lte", value: 60,                         on_missing: "deny", on_fail: "deny" },
    // Camada 4 — risco (cobertura ANTES de volume, para o teste 7 falhar por cobertura)
    { attr: "cobertura_pct",         op: "gte", value: 95,                         on_missing: "deny", on_fail: "deny" },
    { attr: "cobertura_pct",         op: "lte", value: 105,                        on_missing: "deny", on_fail: "deny" },
    { attr: "flexibilidade_pct",     op: "gte", value: 10,                         on_missing: "deny", on_fail: "deny" },
    { attr: "take_or_pay_pct",       op: "lte", value: 90,                         on_missing: "deny", on_fail: "deny" },
    { attr: "exposicao_pld_brl",     op: "lte", value: 40000000,                   on_missing: "deny", on_fail: "deny" }, // R$400k
    // Camada 3 — quantitativos
    { attr: "quantity",              op: "lte", value: 42000,                      on_missing: "deny", on_fail: "deny" },
    { attr: "total",                 op: "lte", value: 1100000000,                 on_missing: "deny", on_fail: "deny" },
    { attr: "desconto_vs_curva_pct", op: "gte", value: 2.0,                        on_missing: "deny", on_fail: "deny" },
    // Camada 6 — governança. SEMPRE por último.
    { attr: "operacao",              op: "eq",  value: "novo_contrato",            on_missing: "deny", on_fail: "escalate" },
    { attr: "economia_liquida_brl",  op: "lte", value: 5000000,                    on_missing: "deny", on_fail: "escalate" }, // R$50k
  ],
}
```

> O `total` é **obrigatório**: `engine.js:107-112` já recusa `quantity > 1` em mandato sem teto de total
> (`quantity_uncapped`). O "orçamento máximo do mandato" do §4 já é exigido pelo motor que existe.

---

## Fase 0 — O congelamento ✅ FEITA

Entregue em `main`. **125 testes verdes** (`npm test`), incluindo 14 novos em
`app1/test/freeze.test.js` que travam os números da demo contra o motor real.

### O que mudou em relação ao que este plano previa

Quatro desvios, todos por um motivo que apareceu ao executar:

| Previsto | Feito | Por quê |
|---|---|---|
| `energy.js` e `hierarchy.js` só com assinaturas | **implementados** | eram a única forma de o teste do congelamento provar que os contratos fecham. E o formato do que eles devolvem é o que B, C e D consomem — congelar a assinatura sem congelar o comportamento não congelava nada. **A Frente A continua dona deles**, e ainda tem introspect, `routes.energy.js`, supersede e os elos da disputa |
| `app2/src/catalogs.js` só com portas por env | **esqueleto das 3 comercializadoras** | com os catálogos de tênis e ids fora da allow-list, `npm run dev` nasceria quebrado e C e D ficariam bloqueadas esperando B. O esqueleto tem **uma** oferta por comercializadora e **um** formato interno compartilhado — a Frente B ainda faz os três formatos distintos (é o que prova o adaptador), o RFQ, o painel e o bilhete forjado |
| apagar `watcher.test.js` | **mantido** | é puro, passa, e serve de referência para a Frente C reescrever |
| manter `profile.test.js` | **apagado** | importava `STORES.store_a`, que deixou de existir. `llm.js` segue dormente, agora sem testes |
| 12 variáveis de porta | **uma só: `PORT_OFFSET`** | `0/10/20/30` reproduz a tabela inteira dos 3 dispositivos |

### Duas decisões que o próprio teste forçou

- **Os mandatos não são semeados.** Semeá-los quebrou o teste *"o agente deposita proposta, não
  mandato"* — e o teste estava certo: um sistema que nasce com autorizações já concedidas contradiz a
  primeira cena da demo. Use `SEED_MANDATES=1` para desenvolver sem clicar.
- **A regra de `concentracao_pct` saiu do mandato operacional.** Com um contrato substituindo outro,
  100% do volume vai para uma contraparte por construção, e qualquer teto recusaria até a oferta boa.
  O atributo continua no vocabulário. Regra que nunca casa não protege, atrapalha.

<details>
<summary>O que a Fase 0 entregou, item a item</summary>

1. `docs/12-vocabulario-energia.md` — copiar a seção "Contratos congelados" deste documento.
2. `app1/src/authority/models.js` — **todas** as mudanças de schema de uma vez:
   - `mandates` ganha `parentMandateId`, `version` (default 1), `supersedes` (default null);
   - `merchants` ganha `rating`, `garantia`, `whitelisted`;
   - novas coleções `supply_contracts` e `market_curves`.
3. `app1/src/shared/messages.js` — códigos de razão novos nos dois locales (stubs bastam):
   `commission_math_mismatch`, `parent_revoked`, `unknown_curve`, `no_active_contract`.
4. `app1/src/seed.js` — Aurora, os 2 mandatos, as 3 comercializadoras (com rating e garantia), o contrato
   Nortis, a curva SE/CO.
5. `app1/src/authority/energy.js` e `hierarchy.js` — **só as assinaturas**, com
   `throw new Error("not_implemented")`.
6. **Portas por env**, senão 3 máquinas não rodam em paralelo:
   - `app2/src/catalogs.js:158-173` — hoje `port: 4001` fixo → `Number(process.env.STORE_VOLT_PORT ?? 4001)`;
   - `ui/vite.config.js:13-15` — hoje `127.0.0.1:3001` fixo → ler de env.
7. **Remover a demo de tênis**: apagar `app1/test/e2e.test.js` e `app1/test/watcher.test.js` (a Frente C
   reescreve). **Sobrevivem** `engine.test.js`, `ticket.test.js`, `quantity.test.js`,
   `introspect.test.js`, `dispute.test.js` — testam o motor, não os tênis.
   `app1/src/agent/llm.js` e `profile.test.js` ficam **dormentes** no repo: não custam nada e são
   argumento de defesa ("IA rascunha, determinístico decide").

</details>

O walking skeleton acabou sendo **melhor** que o previsto: em vez de "o teste 1 passa com dados
falsos", `freeze.test.js` prova os números **verdadeiros** do escopo (multa de R$798.000, economia de
R$210.000 na Volt, −R$168.000 na Helios) contra o motor de constraints real, sem rede e sem banco.

---

## Matriz de propriedade de arquivos

**Você só edita a sua coluna.** Se precisar de uma mudança fora dela, peça no canal — não edite.

| Arquivo / diretório | Dono |
|---|---|
| `app1/src/authority/engine.js` | **NINGUÉM — congelado** |
| `app1/src/authority/energy.js` *(novo)* | A |
| `app1/src/authority/hierarchy.js` *(novo)* | A |
| `app1/src/authority/routes.energy.js` *(novo)* | A |
| `app1/src/authority/introspect.js` | A |
| `app1/src/authority/dispute.js` | A |
| `app2/**` | B |
| `app1/src/agent/**` | C |
| `ui/**` | D |
| `app1/src/shared/messages.js` | D |
| `app1/src/authority/routes.js` | D *(só o middleware e o escopo do `/audit`)* |
| `app1/src/authority/models.js`, `app1/src/seed.js` | **congelados na Fase 0** |

**Endpoint novo nunca entra em `routes.js`** — vai em `routes.energy.js`, montado ao lado no `app.js`.
**Um arquivo de teste por frente**, nunca dois donos no mesmo arquivo.

---

## Frente A — Núcleo de energia (Autoridade)

> A mais pesada e a chave de abóbada. `energy.js` e `hierarchy.js` já vieram implementados da Fase 0;
> o que falta é ligá-los ao caminho da compra.

### Comece por aqui: onde a compra para hoje

Tudo já responde por HTTP — as 3 comercializadoras servem o catálogo, o agente assina o bilhete, a
loja repassa e chama `/introspect`. A compra para num ponto só, e é o seu primeiro commit:

```
ok=false  action=reject
The store did not report "rating", and the mandate requires it.
```

A loja **não** informou o `rating` — e não deve mesmo informar, nunca. Falta a Autoridade injetar os
atributos derivados antes de chamar `evaluate`. No instante em que `introspect.js` fizer isso, a
Volt Andina passa em todas as regras duras e escala pela alçada: é o teste 1 inteiro.

### `app1/src/authority/energy.js` *(novo)* — funções **puras**, sem I/O

Mesmo padrão de `engine.js`: recebe tudo o que precisa, não toca no banco, testável sozinho.

```js
export function mtm({ pContrato, pMercado, volumeRemanescente, taxaAdmin = 0, piso = 0 })
// Multa mark-to-market em centavos.
// Trata pMercado > pContrato → multa ZERO (nunca negativa).
// Aplica piso e soma taxaAdmin.

export function derivedAttributes({ offer, contract, curve, merchant, quantity, portfolio })
// Devolve o objeto de atributos que a AUTORIDADE atesta (lista congelada acima).
// economia_liquida_brl = (curve − offer.price) × quantity − taxaAdmin
// desconto_vs_curva_pct = (curve − offer.price) / curve × 100
// cobertura_pct = quantity / contract.consumoPrevistoPeriodoMwh × 100
// rating e garantia vêm de `merchant`, NUNCA de `offer`.
```

### `app1/src/authority/hierarchy.js` *(novo)*

`effectiveStatus(mandate, ancestors)` — resolve a cadeia de ancestrais. Se qualquer ancestral está
revogado ou expirado, o filho não vale. **Resolvido antes do `evaluate`, para manter o motor puro.**

### `app1/src/authority/introspect.js` *(edita)*

Ordem nova, encaixada nas amarras que já existem:

1. carrega o contrato vigente e a curva do submercado da oferta;
2. valida `price === preco_energia + comissao_terceiro` → nega `commission_math_mismatch`;
3. resolve a cadeia de ancestrais → nega `parent_revoked`;
4. injeta `derivedAttributes(...)` em `purchase.attributes`;
5. **só então** chama `evaluate` — que não muda.

### `app1/src/authority/routes.energy.js` *(novo)*

| Rota | Auth | Para quê |
|---|---|---|
| `PATCH /curves/:submercado` | humano | **a alavanca do juiz** (teste 2) |
| `GET /curves` | — | leitura |
| `GET /contracts` · `POST /contracts` | humano | contrato vigente |
| `POST /mandates/:id/supersede` | humano | **teste 4** |

> **Supersede, não editar.** Mudar o teto de 2% para 5% cria um mandato `version: 2` com `supersedes`
> apontando para o anterior e **revoga o velho**. Preserva D4 — mandato não se edita — e o trilho mostra
> os dois. É a resposta pronta para "e se eu quiser mudar um limite ao vivo?".

### `app1/src/authority/dispute.js` *(edita)*

Dois elos novos na cadeia (hoje são 5): `delegation_valid` (o outorgante tinha poderes na data) e
`curve_at_decision` (a curva usada foi congelada no trilho, não recalculada depois).

### Testes seus

`test/energy.test.js` · `test/hierarchy.test.js` · `test/dispute-energy.test.js`

---

## Frente B — As 3 comercializadoras (App 2)

> Boa notícia: **o contrato de `store.js` com a Autoridade não muda.** Uma oferta é um item de catálogo.
> É quase tudo dado e adaptador.

### `app2/src/catalogs.js` *(substitui os catálogos)*

Três comercializadoras no lugar de `store_a`/`store_b`/`store_fake`, reusando o padrão de adaptador que já
existe (`toCommon` + `setPrice`/`setAvailable`, ver `catalogs.js:122-145`):

| id | Nome | Porta padrão | Formato interno |
|---|---|---|---|
| `volt_andina` | Volt Andina | 4001 | português, R$/MWh em reais |
| `cerrado_power` | Cerrado Power | 4002 | inglês, centavos |
| `helios_trading` | Helios Trading | 4003 | outro formato ainda |

**Cada uma com formato interno diferente de propósito** — é o que prova que o adaptador basta. Nenhum
campo em comum entre elas.

**Não exponha `rating` nem `garantia` na oferta.** Quem os atesta é a Autoridade. Uma comercializadora que
declara o próprio rating é exatamente o furo que estamos fechando.

### `app2/src/store.js` *(edita, pouco)*

- `GET /catalog?submercado=&periodo=&volume_mwh=` — é o RFQ. Filtra por submercado e período.
- `POST /buy` — inalterado no essencial: monta os atributos reais, repassa o bilhete **intacto**, chama
  `/introspect`.
- Painel do operador (`PATCH /catalog/:productId`) ganha `comissao_terceiro` e `prazo_meses` editáveis
  além do preço — é o que o juiz mexe nos testes 5 e 6.

### A Helios e o teste 8

Uma rota ou flag no painel que faz a Helios enviar um **bilhete forjado** (assinatura inválida) à
Autoridade. `verifyTicket` já recusa (`ticket.js:100-129`); o valor está em mostrar a tentativa registrada.

### Testes seus

`test/merchants-energy.test.js` — adaptador nos dois sentidos, RFQ por submercado, bilhete forjado
recusado, volume acima do estoque recusado pela loja.

---

## Frente C — Agente do ciclo diário + suíte dos testes de fogo

> Você **não** vai mexer em LLM. O ciclo diário é determinístico, e isso é arquitetura, não economia:
> decidir "cabe no mandato?" é o motor; o modelo só serviria para rascunhar.

### `app1/src/agent/watcher.js` *(reescreve)* — de vigia de preço para **ciclo diário**

Mantenha o que já está certo: tique sem sobreposição, **um** retrato do catálogo compartilhado por todos os
mandatos, chave de idempotência **derivada** (`watchKey`), teto de operações por tique.

O tique passa a ser:

```
1. puxa a curva do submercado          (GET /curves)
2. lê o contrato vigente               (GET /contracts)
3. dispara RFQ nas 3 comercializadoras (GET /catalog, em paralelo)
4. avalia cada oferta contra o mandato (pré-filtro — cortesia, não autorização)
5. tenta a melhor                      (POST /buy → /introspect)
6. registra o resultado, inclusive a recusa
```

### `app1/src/agent/cycle-log.js` *(novo)* — a saída do §7.2

O bloco `08:00 → 08:05` do PDF, como **dado estruturado** para a UI renderizar (não string formatada).
Cada oferta com o seu veredito e a razão. É aqui que aparecem **todas** as falhas de uma oferta — a
Autoridade dá uma só, e está certa; a tabela do agente é que mostra o quadro completo.

### Alerta da janela de denúncia (teste 10)

D−30 / D−15 / D−7 a partir de `contract.denunciaDias`. Passada a janela, marca a oportunidade como perdida
até o ciclo seguinte.

### Você é dono dos 12 testes de fogo

`test/fire-drill.test.js` — os 12 cenários do §8, cada um como um teste nomeado. **São os critérios de
aceite do projeto inteiro**, e precisam de dono. Escreva-os cedo, mesmo falhando: eles guiam as outras
frentes.

### Testes seus

`test/cycle.test.js` · `test/fire-drill.test.js`

---

## Frente D — Portal do Gestor e trilha (UI)

### `ui/src/App.jsx` e `ui/src/components/**` *(substitui as abas)*

Saem: `AgentChat`, `Proposals`, `Wallet`. Entram:

| Tela | Conteúdo | Serve ao teste |
|---|---|---|
| **Emitir mandato** | as 6 camadas em formulário + **"o que NÃO está neste mandato"** (§5 do PDF) | é o slide do §9 |
| **Ciclo diário** | o bloco `08:00→08:05` da Frente C, com a tabela das 3 ofertas e o porquê de cada recusa | 1, 5, 6 |
| **Escalonamentos** | a compra exata + **a alçada que a exigiu** + aprovar/recusar | 1, 9 |
| **Mandatos** | hierarquia visível, revogar com **prévia da cascata** | 3, 12 |
| **Curva de mercado** | editar R$/MWh ao vivo | **2** — a alavanca do juiz |
| **Trilha** | 3 visões (empresa · comercializadora · auditor) + disputa com os 7 elos | 11 |

> A tela de "o que NÃO está no mandato" é a mais barata e a mais persuasiva do projeto. O §5 do PDF é uma
> lista pronta de anti-padrões; renderize-a ao lado do mandato emitido.

### `app1/src/shared/messages.js` *(dono)*

Todos os códigos de razão novos, PT-BR e EN. A entrega final é em **inglês** (ver `CLAUDE.md`).

### `app1/src/authority/routes.js` *(só isto)*

**`GET /audit` hoje não tem autenticação nenhuma** (`routes.js:360`). Passa a exigir `requireHuman` e
escopo por titular. É a única coisa que você toca neste arquivo.

### Testes seus

`test/audit-scope.test.js` + verificação manual no navegador.

---

## Mapa dos 3 dispositivos

**`npm test` já sobe tudo em portas efêmeras** (`app.listen(0)`, ver `e2e.test.js:24-48`) — os 3
dispositivos testam ao mesmo tempo, sem conflito, hoje. Só o `npm run dev` precisa do offset da Fase 0.

| Dispositivo | Frente | `PORT` | Comercializadoras | UI |
|---|---|---|---|---|
| 1 | **A** (sozinho — é a chave de abóbada) | 3001 | 4001-4003 | 5173 |
| 2 | **B e C** (dois processos, dois terminais) | 3011 / 3021 | 4011-4013 / 4021-4023 | 5183 / 5193 |
| 3 | **D** | 3031 | 4031-4033 | 5203 |

B e C juntos de propósito: são as duas pontas da costura RFQ → contrato, e o defeito de integração aparece
na mesma máquina, não no dia da apresentação.

Cada dispositivo roda com **Mongo em memória** (sem `MONGODB_URI`, ver `server.js:38-44`): nenhuma
infraestrutura compartilhada, nenhum estado cruzado entre as frentes.

---

## Os 12 testes de fogo → dono

| # | O que a banca faz (§8) | Dono | Mecanismo |
|---|---|---|---|
| 1 | Deixa o dia rodar | C | `on_fail: escalate` em `economia_liquida_brl` |
| 2 | Sobe a curva 249 → 262 | A + D | `PATCH /curves` + consulta viva no introspect |
| 3 | Revoga o mandato ao vivo | C | **já existe** |
| 4 | Muda o teto de 2% → 5% | A | `supersede`, não edição |
| 5 | Melhora a Cerrado para R$210 | B + A | `rating` atestado pela **Autoridade** |
| 6 | Aceita a Helios manualmente | A + B | `comissao_terceiro eq 0` com `on_missing: deny` |
| 7 | Força 130% da carga | A | `cobertura_pct` derivado, avaliado antes de `quantity` |
| 8 | Assinatura forjada | B | `verifyTicket`, **já existe** |
| 9 | Pede rescisão | A | `operacao eq novo_contrato`, `on_fail: escalate` |
| 10 | Adianta até a janela de denúncia | C | alertas D−30/−15/−7 |
| 11 | "Eu nunca autorizei essa troca" | A + D | `resolveDispute` + 2 elos novos |
| 12 | Revoga o mandato-pai | A | `hierarchy.js` |

---

## Ritual e ordem de merge

- **Rebase todo dia de manhã:** `git pull --rebase origin main`.
- **Ordem de merge:** A → B → C → D. Como os arquivos são disjuntos, a ordem quase não importa; A vem
  primeiro porque as outras dependem dos atributos derivados.
- **Merge exige `npm test` verde na sua máquina.**
- Mudança em arquivo congelado (`models.js`, `seed.js`, `messages.js` fora da Frente D): avisa no canal
  **antes** de escrever.

### Fases

| Fase | Quem | Meta |
|---|---|---|
| 0 | 1 pessoa, bloqueante | O congelamento + teste 1 verde com dados falsos |
| 1 | 4 em paralelo | Vertical slice de cada frente; teste 1 verde de verdade |
| 2 | 4 em paralelo | Testes de fogo 2–11 |
| 3 | todos juntos | Teste 12, dupla aprovação (**stretch**), ensaio do roteiro de 5 min |

**Dupla aprovação (CFO + jurídico) é stretch de propósito:** é a única coisa do PDF que exigiria mexer em
`approvalMatches`, dentro do `engine.js`. Fica para a Fase 3, quando o paralelismo já acabou. A alçada de
nível 1 (aprovação única) usa o mecanismo que já existe.

---

## Riscos

1. **O congelamento errado.** 4 pessoas sobre um contrato ruim custa muito mais que meio dia perdido.
   A Fase 0 só termina com o teste 1 verde.
2. **Mexer no `engine.js`.** Mata o paralelismo e o argumento de defesa junto.
3. **Extração de contrato em PDF por LLM.** O próprio documento avisa (§7.3): *metade das equipes de
   hackathon morre aqui*. Contratos entram como JSON. No máximo **um** PDF passando por extração, só para
   provar que o caminho existe.
4. **Substituir a demo de tênis quebra os testes de uma vez.** Por isso a remoção é da Fase 0, num commit
   só, e o repo volta ao verde antes de qualquer frente começar.

## Verificação

Em qualquer dispositivo, sem infraestrutura externa:

```bash
npm test      # unidades + os 12 testes de fogo, Mongo em memória
npm run dev   # Autoridade + 3 comercializadoras + Portal
```

Ponta a ponta, na ordem da apresentação (§9):

1. Portal → emitir os dois mandatos; conferir a frase em linguagem natural e a lista do que **não** está lá.
2. Esperar o ciclo diário → Volt Andina vence com R$210.000 e **escala**; Cerrado e Helios recusadas, cada
   uma com a regra que decidiu.
3. Aprovar no Portal → o ciclo seguinte conclui o contrato.
4. **Entregar o teclado ao juiz:** teste 5 (melhor preço recusado), 8 (impostor), 3 (revogação ao vivo),
   2 (mudar a curva), 12 (revogar o mandato-pai).
5. Trilha → "eu nunca autorizei essa troca" → os elos aparecem **calculados**, não afirmados.

**Critério de pronto:** os 12 testes de fogo passam **sem ninguém do time tocar em nada.**
