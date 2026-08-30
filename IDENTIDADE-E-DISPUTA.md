# Identidade e disputa

Como o agente prova quem é, por que um impostor não passa, e como uma disputa se resolve.
Complementa o [DEFESA.md](DEFESA.md) com o detalhe que a banca costuma cutucar.

---

## 1 · O que é uma disputa

**Disputa (ou chargeback) é o titular negando a cobrança:** *"eu nunca autorizei isso"*. Ele reclama ao
banco, o banco estorna, e o merchant perde a venda **e** a mercadoria — mais a taxa do estorno.

É o problema central do comércio agêntico, e é por isso que hoje o merchant fica preso entre duas
opções ruins: **bloquear robôs** (e perder a venda legítima) ou **deixá-los passar como humanos** (e
comer a fraude). Ele não tem como provar que quem comprou estava autorizado.

> ### Não "impedimos" disputas — e prometer isso seria mentira
>
> Qualquer titular pode sempre negar uma cobrança. Ninguém consegue impedir alguém de reclamar.
>
> **O que fazemos é tornar a disputa respondível.** Quando ela chega, o registro reconstitui a cadeia de
> autorização e diz de que lado está — e diz **calculando**, não afirmando. Se a cadeia se sustenta, o
> merchant tem prova; se falta um elo, o estorno é justo e o titular vê exatamente por quê.
>
> A promessa não é "não haverá disputa". É **"a disputa tem resposta, e a resposta é verificável por
> qualquer um dos três lados"**.

---

## 2 · Como o agente se identifica na loja

A parte contraintuitiva primeiro: **a loja nunca diz quem é o agente.** Não existe campo `agentId` no
corpo de `POST /introspect` — a Autoridade não aceita a palavra de ninguém sobre isso.

```js
// introspect.js:39 — o corpo inteiro que a loja envia
const { mandateId, purchase, purchaseTicket, idempotencyKey } = body ?? {};
```

A cada tentativa, o **agente** assina um bilhete que descreve exatamente aquela compra. A loja o
**repassa intacto** — ela é *transporte* da identidade, não *fonte* dela.

### O bilhete

```
purchaseTicket = base64url(payload canônico) + "." + HMAC-SHA256(segredo do agente, payload)
```

Onze campos, e nenhum a mais:

| Campo | Amarra |
|---|---|
| `agentId` | quem está comprando |
| `mandateId` | sob qual autorização |
| `merchantId` | **em qual loja** — um bilhete da Volt não vale na Helios |
| `productId` | qual oferta |
| `price`, `quantity`, `total`, `currency` | **o dinheiro** — segunda fonte independente do número |
| `nonce` | uso único |
| `iat`, `exp` | janela de ~120 segundos |

O segredo do HMAC é conhecido **só pelo agente e pela Autoridade**. A loja nunca o vê — e é isso que a
impede de fabricar um bilhete, mesmo conhecendo todos os campos.

### Por que o preço vai assinado

As constraints são **tetos**, não valores exatos. Com "no máximo R$250/MWh", tanto R$244 quanto R$249,99
passam — e só o agente sabe qual ele escolheu. Sem o preço no bilhete, a loja poderia atestar um valor
maior do que anunciou, ainda dentro do teto, e a Autoridade não teria com o que comparar.

`quantity` e `total` entram pelo mesmo motivo, e o buraco que fecham é maior: com o unitário preso mas a
quantidade solta, uma loja atenderia um bilhete de *"42.000 MWh"* como *"84.000 MWh"* — cada unidade
dentro do teto, e o dobro saindo da conta. **A Autoridade ainda refaz a conta** (`total = price ×
quantity`): um total afirmado não é um total verificado.

---

## 3 · As sete checagens do bilhete

| # | Checagem | Fecha | Recusa |
|---|---|---|---|
| 1 | É uma string no formato `payload.assinatura` | lixo | `ticket_malformed` |
| 2 | O payload é JSON válido | lixo | `ticket_malformed` |
| 3 | **Os bytes são exatamente a forma canônica** | ver abaixo | `ticket_malformed` |
| 4 | A assinatura confere (`timingSafeEqual`) | adulteração, forja | `ticket_bad_signature` |
| 5 | `exp` está no futuro | bilhete guardado para depois | `ticket_expired` |
| 6 | O `agentId` existe e está ativo no registro | agente desconhecido | `unknown_agent` |
| 7 | O `nonce` nunca foi usado (índice único, gravado na operação atômica) | **replay** | `ticket_replayed` |

E depois, dentro do motor, o bilhete precisa descrever **esta** compra:

| Checagem | Recusa |
|---|---|
| `ticket.mandateId` == o mandato consultado | `ticket_mandate_mismatch` |
| `ticket.merchantId` == a loja **autenticada pela apiKey** | `ticket_merchant_mismatch` |
| `ticket.productId / price / currency / quantity / total` == o que a loja atestou | `ticket_*_mismatch` |
| **`ticket.agentId` == `mandate.agentId`** | `agent_not_owner` |

### A checagem 3, que parece paranoia e não é

```js
// ticket.js:114 — os BYTES têm que ser os que um emissor legítimo produziria
if (encoded !== b64url(canonical(payload))) return { ok: false, code: "ticket_malformed" };
```

Conferir a assinatura *sobre a forma canônica* não bastaria: um payload com **campos a mais** assinaria
igual, e o campo extra chegaria intacto a quem lesse depois. Exigindo a forma canônica byte a byte,
**não existe campo que a assinatura não cubra**.

No mesmo espírito, `verifyTicket` devolve a forma canônica — **nunca o objeto cru que veio pela rede**.

### E o `agentId` que a Autoridade lê antes de confiar

```js
// introspect.js:73 — lê SEM confiar, só para saber qual segredo usar
const claimedAgentId = peekAgentId(purchaseTicket);
const agent = await Agent.findById(claimedAgentId).lean();
if (!agent || !agent.active) return reject("unknown_agent");
const verified = verifyTicket(purchaseTicket, agent.hmacSecret);   // aqui nasce a confiança
```

O nome no bilhete é uma **pergunta** ("qual segredo devo usar?"), não uma **afirmação**. A confiança vem
da assinatura fechar.

---

## 4 · Por que o impostor não passa

Cinco caminhos, e onde cada um morre.

| Tentativa | Onde morre |
|---|---|
| **Inventar um agente** — assinar como alguém que não existe | Checagem 6 → `unknown_agent` |
| **Saber o nome certo** e chutar o segredo | Checagem 4 → `ticket_bad_signature`. Saber o nome não é saber assinar |
| **Roubar o `mandateId`** de uma compra alheia | Sem o segredo, não há bilhete válido. E `agent_not_owner` barra mesmo um agente legítimo usando mandato dos outros |
| **Loja registrada cobrando sozinha** | Ela conhece `mandateId` e `agentId` de uma compra que atendeu — e **não consegue assinar**. Era o furo mais grave, e o bilhete existe por causa dele |
| **Reusar um bilhete legítimo** | `nonce` de uso único + `exp` de 120s + `merchantId` amarrado à loja autenticada. Não vale duas vezes, nem em outra loja, nem amanhã |

### Prova ao vivo

Três tentativas contra a Autoridade rodando, com o mesmo mandato e a mesma oferta:

| Assinou como | Resposta | Código |
|---|---|---|
| `agent_michael` (não registrado) | reject | `unknown_agent` |
| `agent_aurora` + segredo certo | **foi ao motor** → escalou pela alçada | `constraint_failed` |
| `agent_aurora` + segredo chutado | reject | `ticket_bad_signature` |

A linha do meio é a única que chega a existir como compra. As outras duas nem entram na conversa.

### O que a garantia realmente é — e do que ela depende

**Impossível não é a palavra certa.** A palavra certa é: **falsificar um agente exige o segredo dele.**
Sem o segredo, todos os caminhos acima estão fechados por uma checagem nomeada. Com o segredo, a
falsificação funciona — porque é exatamente isso que uma chave é.

O que isso implica, dito na cara:

- **A segurança se apoia no sigilo da chave HMAC**, e em mais nada. Não há "por obscuridade" aqui.
- **No MVP** o segredo mora no `.env`, fora do git. Em produção seria um segredo por agente, num cofre,
  com rotação.
- **O estrago é limitado e auditável**: o trilho grava `agentIdAuthenticated` em toda tentativa, então
  um segredo comprometido deixa rastro do que fez, sob qual mandato e quando. E o mandato continua
  valendo: mesmo com a chave, o impostor só compra **dentro dos limites**, com teto, prazo, contraparte
  e alçada — e a revogação o mata na tentativa seguinte.

Essa última linha é a que importa. **Uma chave roubada não vira um cheque em branco**, porque a
identidade é só a primeira das nove barreiras.

---

## 5 · Uma pessoa se passando por outra

Dois eixos diferentes, com defesas diferentes.

### (a) Isolamento entre titulares

A regra é uma só e vale em todo lugar: **quem você é nunca vem do corpo da requisição.**

```
loja    → apiKey  (x-api-key)   → merchantId
humano  → sessão  (x-human-id)  → humanId
agente  → segredo               → agentId (e, na compra, a assinatura)
```

Disso decorre tudo:

| Superfície | Escopo |
|---|---|
| `GET /mandates`, `/approvals`, `/contracts`, `/disputes` | só o que é do `humanId` da sessão |
| `GET /audit` | **só eventos dos mandatos do titular** — um `mandateId` conhecido não vira janela para o trilho de outra empresa |
| `POST /mandates` | o agente tem que ser **seu** (`not_your_agent`) e o meio de pagamento também (`unknown_payment_method`) |
| `POST /approvals/:id/approve` | só o dono do mandato aprova |

> **Honestidade sobre o MVP:** a sessão é um header (`x-human-id`), um mock. O que é **real** e importa é
> que o `humanId` vem da camada de autenticação e nunca do corpo — trocar por uma sessão de verdade não
> muda nenhuma outra linha.

### (b) Comprar na conta de outra pessoa

Três amarras, e nenhuma depende das outras:

1. **O `paymentMethodRef` não viaja.** Ele fica no mandato, dentro da Autoridade. O agente nunca o vê, a
   loja nunca o vê. **Não existe ponteiro solto para roubar.**
2. **Roubar o `mandateId` não basta** — sem o segredo do agente, não há bilhete válido. Vale inclusive
   para uma loja registrada que viu o id numa compra legítima.
3. **O ponteiro é direcional.** Ele só autoriza cobrar *a fonte do titular → a favor da loja
   registrada*. **Não existe, em lugar nenhum do sistema, uma operação que credite alguém.** Ninguém
   consegue se pôr como destino.

A terceira é topológica, não criptográfica: está demonstrada por quem-chama-quem, e continua verdadeira
quando o cofre mock virar Yuno, porque a seta continua saindo do mesmo lugar.

---

## 6 · Como a disputa se resolve

O titular contesta uma compra no trilho. A Autoridade **reconstitui a cadeia** e devolve um veredito
**calculado**, com a evidência que o sustenta.

### Os sete elos

| Elo | Prova | Quebra quando |
|---|---|---|
| `mandate_created` | o humano autorizou aqueles limites, **antes** da compra | não há ato humano registrado, ou ele é posterior |
| `delegation_valid` | quem emitiu tinha poderes para emitir | o mandato-pai não existe, ou já estava revogado **antes** da compra |
| `agent_identity` | quem comprou **provou** ser o agente do mandato | o `agentIdAuthenticated` não bate com o dono |
| `rules_passed` | as regras foram avaliadas e passaram | alguma regra falhou sem dispensa |
| `curve_at_decision` | o número que decidiu é o que ficou no registro | o desconto gravado **não sai** da curva gravada |
| `human_approval` | houve um sim para **aquela** compra | exigido (modo ou dispensa) e ausente |
| `charged_what_was_verified` | o valor cobrado é o verificado | recibo ausente ou valor diferente |

**Falte um, e o registro está do lado do titular.** Estejam todos, e o titular vê exatamente por quê.

### Quatro detalhes que fazem diferença

**A ordem importa.** Um `mandate_created` **posterior** à compra não a legitima. Um pai revogado **antes**
da compra quebra a delegação; revogado **depois**, não — retirar a moldura amanhã não desautoriza o que
foi comprado ontem sob ela.

**A curva é recalculada, não relida.** O elo `curve_at_decision` refaz a conta do desconto a partir da
curva congelada no trilho, com a **mesma função** que a Autoridade usou na hora. Bate, e o número que
aprovou a compra é verificável meses depois; não bate, e alguém decidiu contra um mercado diferente do
que registrou.

**Uma regra dispensada não é apagada.** Quando o humano aprova uma compra que violava um limite, o
`trace` grava `approved_by_human` **naquela regra**, e o elo da aprovação passa a ser exigido, dizendo
por quê. *"As regras passaram"* e *"uma regra falhou e alguém assumiu a responsabilidade"* são fatos
diferentes, e o trilho não os confunde.

**O veredito é congelado com a evidência.** Recalcular meses depois, sobre um trilho que cresceu, daria
outra resposta — e uma resolução que muda sozinha não resolve nada.

### Contestar uma tentativa recusada

Devolve `nothing_charged`. *"O agente tentou e foi recusado"* é uma memória fácil de confundir com *"o
agente comprou"*, e o sistema diz a diferença explicitamente em vez de deixar a pessoa concluir sozinha.

---

## 7 · O que ainda é mock

- **A movimentação do dinheiro.** O cofre devolve recibo falso. O que é real é a topologia: o
  `paymentMethodRef` mora no mandato, e quem o lê e cobra é a Autoridade.
- **A sessão do humano** é um header. Real é o `humanId` vir da autenticação, nunca do corpo.
- **O segredo do agente** é fixo no `.env`. Real é a verificação da assinatura e o que ela fecha.

Nenhum desses mocks sustenta uma das garantias acima. Trocá-los por implementações reais não muda o
raciocínio de nenhuma seção deste documento.
