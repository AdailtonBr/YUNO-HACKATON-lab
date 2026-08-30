# Como o sistema funciona

Guia de defesa. Agente de recontratação de energia no mercado livre (ACL), Hackathon Yuno × Nauta.

> **A frase que organiza tudo:** o agente é o pretexto; **o mandato é o produto**.
> A LOA Nível 2 — o documento que hoje deixa um broker assinar contrato de energia em nome da empresa
> **sem nem dizer o preço** — é um mandato sem limites, e é origem documentada de fraude bilionária.
> Não criamos um risco novo: colocamos limites verificáveis num risco que já existe.

---

## 1 · O elenco, e o que cada um **não** pode

| Papel | Faz | **Não** faz |
|---|---|---|
| **Humano** (gestor/diretoria) | Emite o mandato no Portal, aprova escalonamentos, revoga ao vivo | — |
| **Autoridade** | Guarda o estado, atesta contraparte e mercado, **verifica**, revoga, dispara o pagamento | Nunca vende, nunca negocia |
| **Agente** | Roda o ciclo diário: lê curva e contrato, faz RFQ, compara, tenta contratar | Nunca cria/alarga mandato, nunca decide se a compra vale, nunca vê o instrumento |
| **Comercializadora** | Descreve a própria oferta, repassa o bilhete **intacto**, chama a Autoridade | Nunca julga, **nunca afirma quem é o agente**, nunca atesta o próprio rating |

**Fronteira interna:** Agente e Autoridade compartilham o deploy, mas o agente só fala **HTTP**. Ele não
importa os modelos, não abre o Mongo, não chama o motor. A separação não é disciplina — é o que o
arquivo alcança.

---

## 2 · O fluxo de uma contratação

```
08:00  o agente puxa a CURVA de referência do submercado          GET /curves
08:01  lê o CONTRATO vigente (Nortis @ R$268, 42.000 MWh)         GET /contracts
       calcula quantos dias faltam para a janela de denúncia
08:02  dispara o RFQ nas 3 comercializadoras, em paralelo         GET /catalog?submercado=&periodo=
08:04  compara as ofertas contra o mandato  (pré-filtro, cortesia)
08:05  assina um purchaseTicket (HMAC) e tenta a melhor           POST /buy
       └─ a loja monta os atributos REAIS e chama                 POST /introspect
          └─ a Autoridade decide:  valid · reject · escalate
             └─ se valid: lê o paymentMethodRef e cobra
```

Só **uma seta** sai do sistema para um executor de pagamento, ela sai da **Autoridade**, e **depois** do
sim. O agente não tem essa seta; a loja também não. É aí que a Yuno entra em produção — trocar o mock
pela Yuno é trocar a URL de um endpoint.

---

## 3 · Onde a IA atua — e onde **não**

**No caminho do dinheiro, nenhum LLM.** O ciclo diário é 100% determinístico: quem decide "cabe no
mandato?" é o motor de constraints. Isso é arquitetura, não economia — se o vigia rodasse um LLM por
mandato por tique seriam centenas de milhares de chamadas por dia; do jeito certo, é zero.

| Onde | O que | Por quê ali |
|---|---|---|
| **Autonomia do agente** | Age sozinho, todo dia, escolhe entre ofertas, calcula a economia | É a propriedade agêntica que importa: um comprador que não é humano |
| **Rascunho do mandato** (LLM, dormente) | Conversa e propõe as constraints; o humano confirma | O modelo **rascunha**; a mão do humano cria |
| **Reconciliação de nomes** (fora de escopo) | `liga` ≈ `liga_cimento`, no cadastro da loja | Offline, com revisão humana, congelado como mapa determinístico |

> **Se o modelo alucinar ou for manipulado**, ele chama `buy`, a loja atesta o produto real, o motor
> avalia e a Autoridade recusa. **Ele não escreve a resposta da verificação.** Tire o modelo e o sistema
> fica burro, não inseguro — e é por isso que trocar de provedor não exige reavaliar nenhuma
> propriedade de segurança.

---

## 4 · As barreiras, na ordem em que a Autoridade as aplica

Cada linha fecha um ataque com nome.

| # | Barreira | Fecha |
|---|---|---|
| 1 | **Idempotência** — mesma chave, mesma resposta gravada | Cobrança dupla na retentativa |
| 2 | **Mandato existe?** id opaco de 128 bits | Enumeração de ids |
| 3 | **Bilhete assinado** — assinatura, `nonce` de uso único, `exp` ~120s, loja amarrada | Agente impostor; **loja registrada cobrando sozinha**; replay |
| 4 | **Enriquecimento** — a Autoridade injeta rating, garantia, curva, multa, economia | Contraparte atestando o próprio crédito; oferta mentindo sobre o mercado |
| 5 | **Cadeia de delegação** — pai revogado mata o filho | Mandato derivado sobrevivendo à moldura que o autorizou |
| 6 | **Motor de constraints** — regra a regra, com `trace` | Fora do mandato, em qualquer eixo |
| 7 | **Nonce + consumo atômicos** (`findOneAndUpdate` condicional) | TOCTOU: revogar entre verificar e cobrar |
| 8 | **Cobrança + compensação** | Falha de pagamento queimando um uso sem entregar nada |
| 9 | **Trilho append-only** | "Eu nunca autorizei isso" |

**A allow-list de comercializadoras** é a barreira zero: quem não está registrado não fala com a
Autoridade. É o anti-slamming.

### Quem atesta o quê — a torção que sustenta o produto

| Atributo | Atesta | Por quê |
|---|---|---|
| preço da energia, comissão, prazo, flexibilidade, take-or-pay, submercado, fonte | **Comercializadora** | é a fonte de verdade sobre a própria oferta |
| **rating, garantia** | **Autoridade** | a vendedora é parte interessada no próprio risco de crédito |
| **curva, multa MtM, desconto, economia líquida, cobertura, exposição ao PLD** | **Autoridade** (derivados) | dependem do contrato vigente do cliente — dado que ela não tem |
| preço, volume, total | **agente**, assinados | segunda fonte independente do número |

> **Uma oferta que traz o próprio rating está errada por construção.** É o que derruba a Cerrado.

---

## 5 · O mandato: seis camadas, zero código novo

O motor é genérico (`{attr, op, value, on_missing, on_fail}`, operadores `eq ne lte gte in`). **As seis
camadas do mandato entraram como dado — `engine.js` não mudou uma linha para entender energia.**

| Camada | Vira |
|---|---|
| 1 · Identidade e poder | `agentId` provado por assinatura + `parentMandateId` (a delegação) |
| 2 · Escopo do produto | `submercado`, `fonte`, `estrutura_preco`, `prazo_meses` |
| 3 · Limites quantitativos | `quantity`, `total`, **`desconto_vs_curva_pct`** (teto **relativo**) |
| 4 · Risco | `cobertura_pct` (95–105%), `flexibilidade_pct`, `take_or_pay_pct`, `exposicao_pld_brl` |
| 5 · Contraparte | `rating in [...]`, `garantia eq true` |
| 6 · Governança (alçada) | `economia_liquida_brl lte 50k` com **`on_fail: escalate`** |

**Dois detalhes que não são estéticos:**

- **A comissão é a primeira regra.** O motor para na primeira falha; queremos que a Helios caia pela
  comissão, que é a manchete do caso *Expert Tooling v. Engie*. E ela usa `on_missing: "deny"`:
  **recusar-se a declarar a comissão vale o mesmo que ser recusado.**
- **A alçada é a última.** Assim todas as regras duras são avaliadas antes de escalar — escalar uma
  compra que já seria recusada seria fazer o humano decidir uma questão que não é dele.

**Teto relativo, não absoluto:** R$250/MWh é restritivo hoje e permissivo em três meses. O mandato
limita o desconto **contra a curva**, e a curva é **consulta viva** — mudar o mercado remonta a decisão
sem tocar na autorização.

**Mandato não se edita.** Apertar um limite emite uma **versão nova** que revoga a anterior
(`supersede`). Se fosse editável, "sob quais limites isto foi comprado?" deixaria de ter resposta — e a
disputa vive dessa pergunta.

---

## 6 · A conta que decide (e por que a comissão oculta é devastadora)

Com multa mark-to-market, os dois primeiros termos se cancelam:

```
economia_líquida = (P_mercado − P_oferta) × Volume
```

**A economia não depende do preço do contrato antigo** — depende de quanto a oferta bate a curva.

| | Anunciado | Comissão | **Efetivo** | Economia líquida | Veredito |
|---|---|---|---|---|---|
| **Volt Andina** (A−, garantia) | R$244 | 0 | **R$244** | **+R$210.000** | passa tudo → **escala** pela alçada |
| **Cerrado Power** (BB, sem garantia) | R$231 | 0 | **R$231** | +R$756.000 | **recusada no rating** — o melhor preço, barrado |
| **Helios Trading** (sem rating) | R$239 | R$14 | **R$253** | **−R$168.000** | **recusada na comissão** |

Curva SE/CO 2027 = R$249. Multa MtM = (268−249) × 42.000 = **R$798.000**.

> *"O comparador ingênuo escolhe a Helios, porque R$239 é menor que R$244. O agente com mandato escolhe
> a Volt Andina, porque o que importa é a oferta contra a curva — e a Helios, descontada a comissão
> embutida, está R$4 acima do mercado."*

A Autoridade ainda **refaz a conta** `preço = energia + comissão`: um preço efetivo afirmado não é um
preço efetivo verificado.

---

## 7 · Os 12 testes de fogo → o que cada um prova

Todos automatizados (`app1/test/fire-drill.test.js`). **202 testes verdes.**

| # | O que a banca faz | Prova |
|---|---|---|
| 1 | Deixa o dia rodar | Circuito feliz: escala, humano aprova, contrato registrado |
| 2 | Sobe a curva 249 → 262 | Limites são **vivos**, não retrato |
| 3 | **Revoga ao vivo** | Falha na verificação da **loja**, não no agente |
| 4 | Aperta o teto 2% → 5% | Mandato não se edita: nasce a v2, morre a v1 |
| 5 | **Melhora a Cerrado para R$210** | **O mandato governa o agente** — o melhor preço é recusado pelo rating |
| 6 | Força a Helios na mão | Defesa contra comissão oculta |
| 7 | Força 130% da carga | Risco é limite de primeira classe (recusa por **cobertura**, não por preço) |
| 8 | **Assinatura forjada** | Agente impostor / anti-slamming |
| 9 | Pede rescisão | Ação irreversível **sempre** escala |
| 10 | Avança até a janela de denúncia | Renovação silenciosa neutralizada |
| 11 | *"Eu nunca autorizei"* | Disputa resolvida por **7 elos calculados**, não afirmados |
| 12 | Revoga o mandato da diretoria | Hierarquia: cascata |

**Os 7 elos da disputa:** mandato criado → **delegação válida** → identidade do agente → regras passaram
→ **curva no momento da decisão** → aprovação humana → cobrado = verificado. Falte um, e o registro está
do lado do titular. O elo da curva **refaz a conta** a partir do número congelado no trilho.

---

## 8 · Como o enunciado é atendido

| O enunciado pede | Onde está |
|---|---|
| Humano cria mandato **sem entregar o cartão cru** | Portal → `paymentMethodRef` opaco; o instrumento vive no cofre |
| Merchant **verifica antes de aceitar** | `POST /buy` → `POST /introspect`, do lado da loja |
| Compra de ponta a ponta | Ciclo diário → contrato + recibo + registro para o humano |
| **Fora do mandato → recusado ou escalado** | `on_fail` por constraint; nunca aprovado em silêncio |
| **Revogação ao vivo** | Flag lida no instante da compra (abordagem B) |
| Agente impostor | Bilhete HMAC; a loja **transporta** a identidade, não a produz |
| Cada parte vê o seu | 3 visões: registro do titular, verificação da loja, trilho do auditor |
| Trilho auditável | `audit_log` append-only |
| **Bonus** — disputa | 7 elos calculados do trilho, congelados com a evidência |
| **Bonus** — condições ricas | Teto relativo à curva, `maxUses`, janela de denúncia, banda de cobertura |
| **Bonus** — agente adversarial | **Não existe ferramenta que crie ou alargue mandato.** Por mais que manipulem a conversa, não há caminho da conversa até o estado de autorização |

---

## 9 · Real vs mock, sem eufemismo

**Real:** mandato como fonte da verdade no servidor; verificação determinística com estado vivo;
identidade **provada** por assinatura; atributos atestados pela parte de direito; `paymentMethodRef` no
mandato disparado pela Autoridade; allow-list; trilho append-only; cálculo MtM completo.

**Mock:** movimento do dinheiro (recibo falso); catálogos e preços; tokenização do instrumento; registro
na CCEE; medição.

---

## 10 · Perguntas difíceis, respostas curtas

**"Agente e Autoridade são o mesmo app — o que impede ele de se autorizar?"**
O estado de autorização só é escrito pelo humano. O agente lê um id e fala HTTP; ele não tem caminho de
escrita para o mandato nem para a revogação.

**"E se o LLM alucinar?"**
Ele chama `buy`, a loja atesta o produto real, o motor recusa. Ele não escreve a resposta da verificação.

**"Por que introspecção e não JWT assinado (AP2)?"**
Revogação ao vivo trivial, *selective disclosure* (a loja pergunta "cabe?", não vê os limites), e menos
superfície de cripto. Custo assumido: uma chamada por compra e dependência da Autoridade de pé.

**"E em escala?"**
Assinar a parte imutável e introspectar só a revogação (deny-list propagada). É onde a abordagem B e o
AP2 se encontram — escolher B agora não fecha porta nenhuma.

**"Uma loja registrada não pode cobrar sozinha?"**
Ela conhece o `mandateId`, mas não consegue **assinar** o bilhete. Sem o segredo do agente, a Autoridade
recusa. Foi o furo que encontramos e fechamos.

**"Quem paga se o agente errar?"**
O trilho determina: dentro do mandato, o risco é do titular; fora, do operador do agente; mandato
inválido aceito pela loja, da loja.

**"E se a Helios mentir e declarar comissão zero?"**
A verificação passa — a declaração é da parte interessada. O que garantimos é que ela fica **congelada
no trilho**: descobrir depois que era falsa vira fraude provável, que é exatamente como o caso inglês
foi ganho. Não vendemos mais que isso.
