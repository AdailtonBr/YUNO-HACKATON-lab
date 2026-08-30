/**
 * Uma loja (merchant).  Ver `docs/02` e `docs/03`.
 *
 * O que a loja FAZ:
 *  - descreve os próprios produtos no vocabulário comum (adaptador);
 *  - monta os atributos REAIS da compra a partir do produto real;
 *  - repassa o bilhete do agente INTACTO e chama a Autoridade.
 *
 * O que a loja NÃO faz:
 *  - não conhece as constraints do cliente;
 *  - não julga a compra — ela recebe `valid`/`reject`/`escalate` e obedece;
 *  - **não afirma quem é o agente**: ela transporta a prova, não a produz.
 *    É a diferença que impede uma loja registrada de cobrar sozinha (D16).
 */

import express from "express";
import { panelHtml } from "./panel.js";

/**
 * Adultera a ASSINATURA do bilhete, mantendo o payload e o comprimento — é a
 * forma mais convincente do ataque, e a que prova mais: a Autoridade não está
 * recusando por um bilhete malformado que qualquer parser pegaria, e sim
 * porque refez o HMAC com o segredo do agente e não bateu.
 *
 * A loja não tem esse segredo.  É por isso que ela não consegue forjar nada
 * que passe, e é o motivo de a identidade do agente morar no bilhete e não
 * numa palavra da loja (D16).
 */
export function tamperTicket(ticket) {
  const s = String(ticket);
  const dot = s.lastIndexOf(".");
  if (dot < 0 || dot === s.length - 1) return `${s}.forged`;
  const sig = s.slice(dot + 1);
  const last = sig.at(-1);
  // Trocamos por OUTRO caractere base64url: trocar por um igual não forjaria
  // nada, e a demo mostraria uma compra passando quando deveria falhar.
  return `${s.slice(0, dot + 1)}${sig.slice(0, -1)}${last === "A" ? "B" : "A"}`;
}

export function buildStore({
  id,
  name,
  apiKey,
  catalog,
  toCommon,
  setPrice,
  setCommission,
  setTermMonths,
  setAvailable,
  isAvailable,
  canForgeTickets = false,
  authorityUrl,
}) {
  const app = express();
  app.use(express.json());

  // Trilho da loja: "o merchant vê sua verificação" (resultado esperado nº4).
  const verifications = [];

  // Teste 8: a loja adultera o bilhete do agente antes de repassar.  Começa
  // sempre desligado — é uma alavanca que o juiz puxa, não o estado normal.
  let forging = false;

  // O catalogo publico so mostra o que a loja de fato tem: loja nao anuncia o
  // que esta fora de estoque -- e tirar de estoque e uma das duas alavancas do
  // painel do operador.
  const avail = (p) => (isAvailable ? isAvailable(p) : true);
  const common = () => catalog.filter(avail).map(toCommon);

  // Inclui o indisponivel: e o que o painel precisa ver para poder repor.
  const commonAll = () => catalog.map((p) => ({ ...toCommon(p), available: avail(p) }));
  const findRaw = (productId) => catalog.find((p) => toCommon(p).productId === productId);

  app.get("/health", (_req, res) => res.json({ ok: true, store: id, name }));

  // Busca literal, de proposito: a loja casa strings, ela nao adivinha intencao.
  // Quem faz o casamento semantico ("tenis de corrida" -> "Runner Shoe") e o
  // agente, do outro lado, olhando o catalogo inteiro. E seguro porque descoberta
  // nao e o caminho do dinheiro -- ali quem decide e o motor deterministico.
  const norm = (s) =>
    String(s ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

  /*
   * O RFQ: `GET /catalog?submercado=&periodo=&volume_mwh=`.
   *
   * É a mesma rota da busca literal de antes — energia só acrescentou os três
   * eixos pelos quais uma cotação de fato se pede.  Os filtros são conjuntivos
   * e cada um é opcional; sem nenhum, o catálogo inteiro, que é o que o painel
   * e a exploração precisam.
   *
   * Continua sendo uma loja casando valores, não adivinhando intenção: o
   * submercado é comparado depois de normalizado ("se/co" e "SECO" são o
   * mesmo lugar), e não há nada aqui parecido com julgamento.  Descoberta não
   * é o caminho do dinheiro — ali quem decide é o motor determinístico.
   */
  const normSubmercado = (s) =>
    String(s ?? "").toUpperCase().replace(/[^A-Z]/g, "");

  /**
   * `periodo` aceita duas formas: a janela inteira ("2027-01/2027-12"), casada
   * literalmente, ou só o ano ("2027"), que casa qualquer janela que comece
   * nele.  A segunda existe porque é como um comprador pergunta — "o que você
   * tem para 2027?" — e a primeira porque é como o contrato fala.
   */
  const periodoMatches = (query, periodo) => {
    const q = String(query).trim();
    if (q.includes("/")) return periodo === q;
    if (/^\d{4}$/.test(q)) return periodo.startsWith(`${q}-`);
    return false;
  };

  app.get("/catalog", (req, res) => {
    const { submercado, periodo, volume_mwh: volumeRaw } = req.query;

    // Volume inválido é erro do pedido, não filtro que não casa: devolver
    // catálogo vazio esconderia um bug do chamador atrás de "não tenho nada".
    let volume = null;
    if (volumeRaw != null && String(volumeRaw) !== "") {
      volume = Number(volumeRaw);
      if (!Number.isInteger(volume) || volume < 1) {
        return res.status(400).json({ error: "invalid_volume" });
      }
    }

    // Tokens curtos sao descartados. "fone de ouvido" casava o "de" dentro de
    // "verde" e de "desk", e a busca devolvia um tenis de trilha e uma
    // luminaria -- resultado errado, e pior que resultado nenhum, porque o
    // agente nunca via o catalogo de verdade (o fallback so dispara com zero).
    const tokens = norm(req.query.q).split(/\s+/).filter((t) => t.length >= 3);

    const items = common().filter((p) => {
      if (submercado && normSubmercado(p.submercado) !== normSubmercado(submercado)) return false;
      if (periodo && !periodoMatches(periodo, p.periodo_suprimento)) return false;
      // Volume que a loja não tem morre aqui: "não tenho esse volume" não é
      // questão de autorização, e cotar o que não se pode entregar é ruído.
      if (volume != null && p.stock < volume) return false;
      if (tokens.length === 0) return true; // sem termo util -> catalogo inteiro
      const hay = norm([p.name, p.category, p.product_type, p.brand, p.color, p.ship_country].join(" "));
      return tokens.some((tk) => hay.includes(tk));
    });

    // O RFQ volta ecoado: o registro do ciclo diário mostra o que foi
    // PERGUNTADO, não só o que voltou.  Uma cotação vazia sem a pergunta ao
    // lado é indistinguível de uma loja fora do ar.
    res.json({
      merchantId: id,
      name,
      rfq: {
        submercado: submercado ?? null,
        periodo: periodo ?? null,
        volume_mwh: volume,
      },
      items,
    });
  });

  app.post("/buy", async (req, res) => {
    const { productId, mandateId, purchaseTicket, idempotencyKey, quantity: asked } = req.body ?? {};
    const product = common().find((p) => p.productId === productId);
    if (!product) return res.status(404).json({ ok: false, reason: "unknown_product" });

    // Quantidade: inteiro ≥ 1, e nunca mais do que existe.  Quem sabe o estoque
    // é a loja, então é ela quem recusa — e recusa ANTES de incomodar a
    // Autoridade, porque "não tenho isso" não é uma questão de autorização.
    const quantity = asked ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({ ok: false, reason: "invalid_quantity" });
    }
    if (quantity > product.stock) {
      return res.status(409).json({ ok: false, reason: "insufficient_stock", available: product.stock });
    }

    // Os atributos vêm do PRODUTO REAL, montados pela loja — nunca do agente.
    // É o que fecha o confused deputy: o agente não consegue mentir preço nem
    // categoria para caber no mandato.
    //
    // `productId` entra entre os atributos de propósito: é o que permite um
    // mandato dizer "compre EXATAMENTE este item", que é o limite mais apertado
    // que existe.  Sem ele atestado aqui, uma regra sobre productId nunca casaria
    // e recusaria toda compra — regra que não casa não protege, atrapalha.
    // `stock` sai fora: é inventário da loja, não característica do item.  Se
    // entrasse entre os atributos atestados, o agente veria "o estoque varia
    // entre os candidatos" e passaria a perguntar sobre estoque ao humano.
    const { name, price, currency, stock, ...attributes } = product;
    // `name` viaja FORA de `attributes`: é rótulo para o humano ler na tela de
    // aprovação ("Desk Lamp" diz algo; "ELE-003" não diz nada).  Fora dos
    // atributos porque não é regra — nomes diferem entre lojas, o identificador
    // é o `productId`.
    // `price` é o UNITÁRIO e `total` é o que sai da conta.  Os dois viajam como
    // atributos atestados, então um mandato pode limitar qualquer um dos dois:
    // `price` filtra qualidade ("nada acima de R$150 a unidade"), `total` limita
    // o gasto.  Só o segundo é teto de dinheiro de verdade.
    const total = price * quantity;
    const purchase = {
      productId,
      name,
      price,
      quantity,
      total,
      currency,
      attributes: { ...attributes, price, quantity, total },
    };

    // Normalmente o bilhete atravessa daqui para a Autoridade sem ser tocado —
    // a loja é TRANSPORTE, não fonte.  Com a alavanca do teste 8 ligada, ela
    // deixa de ser: adultera a assinatura e tenta passar assim mesmo.  Quem
    // recusa é a Autoridade, que verifica com o segredo do agente e não com a
    // palavra da loja (`ticket.js`, `verifyTicket`).
    const forged = forging && purchaseTicket != null;
    const sentTicket = forged ? tamperTicket(purchaseTicket) : purchaseTicket;

    let result;
    try {
      const r = await fetch(`${authorityUrl}/introspect`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({ mandateId, purchase, purchaseTicket: sentTicket, idempotencyKey }),
      });
      if (r.status === 401) {
        // Loja fora da allow-list: a Autoridade não fala com ela (anti-site-fake).
        result = { valid: false, action: "reject", reasonText: "This store is not registered with the Authority." };
      } else {
        result = await r.json();
      }
    } catch (e) {
      result = { valid: false, action: "reject", reasonText: `Authority unreachable: ${e.message}` };
    }

    verifications.unshift({
      ts: new Date().toISOString(),
      mandateId,
      productId,
      price,
      quantity,
      total,
      currency,
      decision: result.valid ? "valido" : result.action === "escalate" ? "escalado" : "recusado",
      reasonText: result.reasonText ?? null,
      reason: result.reason?.code ?? null,
      receiptId: result.receiptId ?? null,
      // A tentativa fica registrada no trilho da própria loja.  O valor do
      // teste 8 não é a recusa — é a recusa ficar ESCRITA em algum lugar.
      forgedTicket: forged,
    });

    // A loja repassa o veredito da Autoridade inteiro, inclusive o detalhe por
    // regra.  Ela nao interpreta nem resume: nao e dela a decisao.
    if (result.valid) {
      // `total` volta junto: quem comprou tem o direito de ver o que saiu da
      // conta, e não deduzi-lo multiplicando na cabeça.
      return res.json({
        ok: true,
        receiptId: result.receiptId,
        price,
        quantity,
        total,
        currency,
        trace: result.trace ?? [],
      });
    }
    res.json({
      ok: false,
      action: result.action ?? "reject",
      reasonText: result.reasonText,
      reason: result.reason ?? null,
      trace: result.trace ?? [],
      approvalRequestId: result.approvalRequestId ?? null,
    });
  });

  app.get("/verifications", (_req, res) => res.json({ merchantId: id, name, verifications: verifications.slice(0, 50) }));

  /* ----------------------- painel do operador ----------------------- */
  /*
   * A escrita passa pelo ADAPTADOR (`setPrice`/`setAvailable`), que traduz do
   * vocabulario comum de volta para o formato interno desta loja.  O painel
   * fala em centavos e nao sabe nada de `preco_reais` nem de `amount_cents`:
   * o adaptador e a fronteira nos dois sentidos, nao so na leitura.
   *
   * Mutacao em memoria -- reiniciar restaura o catalogo.  E mock, e assumido.
   */
  app.get("/products", (_req, res) => res.json({ merchantId: id, name, items: commonAll() }));

  app.patch("/catalog/:productId", (req, res) => {
    const raw = findRaw(req.params.productId);
    if (!raw) return res.status(404).json({ error: "unknown_product" });

    const { price, comissao_terceiro, prazo_meses, available } = req.body ?? {};

    // Validação antes de qualquer escrita: uma alavanca inválida não pode
    // deixar o produto meio alterado.  São quatro campos, então o custo de
    // separar validação de aplicação é baixo e o de não separar é um catálogo
    // inconsistente na frente do juiz.
    let cents, commission, months;
    if (price != null) {
      cents = Math.round(Number(price));
      if (!Number.isFinite(cents) || cents < 0) return res.status(400).json({ error: "invalid_price" });
    }
    if (comissao_terceiro != null) {
      commission = Math.round(Number(comissao_terceiro));
      if (!Number.isFinite(commission) || commission < 0) return res.status(400).json({ error: "invalid_commission" });
      if (!setCommission) return res.status(400).json({ error: "unsupported_field" });
    }
    if (prazo_meses != null) {
      months = Math.round(Number(prazo_meses));
      if (!Number.isFinite(months) || months < 1) return res.status(400).json({ error: "invalid_term" });
      if (!setTermMonths) return res.status(400).json({ error: "unsupported_field" });
    }

    // A comissão vem ANTES do preço, e a ordem é semântica, não estética:
    // `setPrice` recebe o preço EFETIVO e desconta a comissão vigente para
    // achar o preço da energia.  Aplicar as duas na ordem inversa faria a
    // segunda escrita usar a comissão velha, e um operador que mexesse nos
    // dois campos de uma vez veria uma conta que não fecha.
    //
    // Mexer só na comissão sobe o preço efetivo — é o que se espera de um
    // custo que se ACRESCENTA.  É por isso que zerar a comissão da Helios no
    // teste 6 derruba o efetivo dela de R$253 para R$239, e ela ainda assim
    // é recusada: sobra o prazo de 60 meses.
    if (commission != null) setCommission(raw, commission);
    if (cents != null) setPrice(raw, cents);
    if (months != null) setTermMonths(raw, months);
    if (available != null) setAvailable(raw, !!available);

    res.json({ ok: true, product: { ...toCommon(raw), available: avail(raw) } });
  });

  /* --------------------- a alavanca do teste 8 ---------------------- */
  /*
   * Só a loja marcada como capaz de forjar expõe isto.  Não é escrúpulo de
   * mock: é o mesmo princípio de todo o resto do projeto — a capacidade mora
   * onde o papel está, e a Helios é a única com o papel de adversária.
   */

  app.get("/panel/forge", (_req, res) => res.json({ capable: !!canForgeTickets, on: forging }));

  app.post("/panel/forge", (req, res) => {
    if (!canForgeTickets) return res.status(404).json({ error: "not_available" });
    const { on } = req.body ?? {};
    if (typeof on !== "boolean") return res.status(400).json({ error: "invalid_state" });
    forging = on;
    res.json({ ok: true, capable: true, on: forging });
  });

  app.get("/", (_req, res) => res.type("html").send(panelHtml(id, name)));

  return app;
}
