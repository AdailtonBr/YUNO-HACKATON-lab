/**
 * Frente B — as três comercializadoras (App 2).
 *
 * O que este arquivo prova, sem Mongo e sem a Autoridade de verdade:
 *
 *  1. o ADAPTADOR funciona nos dois sentidos, para três formatos internos que
 *     não têm um único nome de campo em comum;
 *  2. nenhuma comercializadora declara o próprio `rating` ou `garantia`;
 *  3. o RFQ (`?submercado=&periodo=&volume_mwh=`) filtra pelos três eixos;
 *  4. volume acima do estoque morre NA LOJA, sem incomodar a Autoridade;
 *  5. o bilhete forjado da Helios é recusado pela verificação real de HMAC.
 *
 * A Autoridade aqui é um dublê que usa o `verifyTicket` VERDADEIRO
 * (`app1/src/authority/ticket.js`).  É o que dá valor ao teste 8: a recusa não
 * é encenada, é o mesmo HMAC do sistema real dizendo que a assinatura não
 * fecha.  O resto da Autoridade (mandatos, motor, cofre) tem dono e testes
 * próprios; repeti-los aqui só criaria dois lugares para consertar a mesma
 * coisa.
 */

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { buildStore, tamperTicket } from "../../app2/src/store.js";
import { STORES } from "../../app2/src/catalogs.js";
import { issueTicket, verifyTicket } from "../src/authority/ticket.js";

const AGENT_SECRET = "segredo-de-teste-agente";
const AGENT_ID = "agt_test";

/** O que o dublê da Autoridade viu na última chamada. */
let lastIntrospect = null;
let authorityUrl;
const servers = [];
const bases = {};

const listen = (app) =>
  new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
    servers.push(s);
  });

const urlOf = (s) => `http://127.0.0.1:${s.address().port}`;

/**
 * Dublê da Autoridade.  Não conhece mandatos: só verifica o bilhete de
 * verdade e devolve um veredito.  É exatamente o recorte que interessa à
 * Frente B — o que a LOJA manda para o outro lado.
 */
function fakeAuthority() {
  const app = express();
  app.use(express.json());
  app.post("/introspect", (req, res) => {
    lastIntrospect = req.body;
    const check = verifyTicket(req.body.purchaseTicket, AGENT_SECRET);
    if (!check.ok) {
      return res.json({
        valid: false,
        action: "reject",
        reason: { code: check.code, params: {} },
        reasonText: "The purchase ticket did not verify.",
      });
    }
    return res.json({ valid: true, receiptId: "rcp_stub", trace: [] });
  });
  return app;
}

before(async () => {
  authorityUrl = urlOf(await listen(fakeAuthority()));
  for (const [key, s] of Object.entries(STORES)) {
    bases[key] = urlOf(await listen(buildStore({ ...s, authorityUrl })));
  }
});

after(() => {
  for (const s of servers) s.close();
});

/* ------------------------------ helpers ------------------------------ */

const get = async (key, path) => {
  const r = await fetch(`${bases[key]}${path}`);
  return { status: r.status, body: await r.json() };
};

const send = async (key, path, body, method = "POST") => {
  const r = await fetch(`${bases[key]}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};

/** Offer canônica de cada loja, pelo adaptador dela. */
const canonical = (key) => STORES[key].toCommon(STORES[key].catalog[0]);

/** Um bilhete legítimo para a compra que a loja vai montar. */
const ticketFor = (key, quantity) => {
  const o = canonical(key);
  return issueTicket(
    {
      agentId: AGENT_ID,
      mandateId: "mnd_test",
      merchantId: key,
      productId: o.productId,
      price: o.price,
      quantity,
      total: o.price * quantity,
      currency: o.currency,
    },
    AGENT_SECRET
  );
};

/** Restaura o catálogo entre testes que mexem no painel. */
const restore = async (key, productId, patch) => send(key, `/catalog/${productId}`, patch, "PATCH");

/* ==================================================================== */
/* 1. O adaptador para FORA                                             */
/* ==================================================================== */

test("as tres ofertas canonicas saem no vocabulario comum, com os numeros do escopo", () => {
  assert.deepEqual(canonical("volt_andina"), {
    productId: "VOLT-SECO-2027",
    name: "Volt Andina · SE/CO 2027 · fixo 12m",
    price: 24400,
    currency: "BRL",
    preco_energia: 24400,
    comissao_terceiro: 0,
    submercado: "SECO",
    fonte: "convencional",
    estrutura_preco: "fixo",
    periodo_suprimento: "2027-01/2027-12",
    prazo_meses: 12,
    flexibilidade_pct: 10,
    take_or_pay_pct: 90,
    operacao: "novo_contrato",
    stock: 60000,
  });

  const cerrado = canonical("cerrado_power");
  assert.equal(cerrado.price, 23100);
  assert.equal(cerrado.submercado, "SECO"); // interno: "SE/CO"
  assert.equal(cerrado.estrutura_preco, "fixo"); // interno: "FIXED"
  assert.equal(cerrado.periodo_suprimento, "2027-01/2027-12"); // interno: {from,to}

  const helios = canonical("helios_trading");
  // O comparador ingenuo ve 239; o preco que sai da conta e 253.
  assert.equal(helios.preco_energia, 23900);
  assert.equal(helios.comissao_terceiro, 1400);
  assert.equal(helios.price, 25300);
  assert.equal(helios.submercado, "SECO"); // interno: codigo 1 da ONS
  assert.equal(helios.prazo_meses, 60); // interno: a string "60"
});

test("os tres formatos internos nao tem UM nome de campo em comum", () => {
  // Se tivessem, o adaptador estaria sendo assumido e nao testado: o
  // vocabulario comum passaria por coincidencia de nomenclatura.
  const keys = Object.values(STORES).map((s) => Object.keys(s.catalog[0]));
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const shared = keys[i].filter((k) => keys[j].includes(k));
      assert.deepEqual(shared, [], `formatos ${i} e ${j} compartilham ${shared}`);
    }
  }
});

test("NENHUMA oferta declara o proprio rating ou a propria garantia", () => {
  // A linha que derruba a Cerrado e a Helios: quem tem interesse nao atesta.
  for (const [key, s] of Object.entries(STORES)) {
    for (const raw of s.catalog) {
      const offer = s.toCommon(raw);
      assert.equal(offer.rating, undefined, `${key} declarou rating`);
      assert.equal(offer.garantia, undefined, `${key} declarou garantia`);
    }
  }
});

/* ==================================================================== */
/* 2. O adaptador para DENTRO                                           */
/* ==================================================================== */

test("o painel escreve em centavos e meses, e cada loja guarda do jeito dela", async () => {
  for (const key of Object.keys(STORES)) {
    const pid = canonical(key).productId;
    const antes = canonical(key);

    // Preco EFETIVO: a comissao fica onde esta e a energia absorve a diferenca.
    const r1 = await restore(key, pid, { price: 21000 });
    assert.equal(r1.status, 200);
    assert.equal(canonical(key).price, 21000, key);
    assert.equal(canonical(key).comissao_terceiro, antes.comissao_terceiro, key);
    assert.equal(canonical(key).preco_energia, 21000 - antes.comissao_terceiro, key);

    // Comissao: ACRESCENTA. Mexer nela sobe o efetivo, e e por isso que ela e
    // uma alavanca separada do preco.
    await restore(key, pid, { comissao_terceiro: 1000 });
    assert.equal(canonical(key).comissao_terceiro, 1000, key);
    assert.equal(canonical(key).price, 21000 - antes.comissao_terceiro + 1000, key);

    // Prazo.
    await restore(key, pid, { prazo_meses: 18 });
    assert.equal(canonical(key).prazo_meses, 18, key);

    // Estoque: sai do catalogo publico e volta.
    await restore(key, pid, { available: false });
    assert.equal(STORES[key].isAvailable(STORES[key].catalog[0]), false, key);
    const semEla = await get(key, "/catalog");
    assert.equal(semEla.body.items.find((i) => i.productId === pid), undefined, key);

    // Devolve tudo ao estado congelado da demo.
    await restore(key, pid, {
      available: true,
      comissao_terceiro: antes.comissao_terceiro,
      price: antes.price,
      prazo_meses: antes.prazo_meses,
    });
    assert.deepEqual(canonical(key), antes, `${key} nao voltou ao estado inicial`);
  }
});

test("zerar a comissao da Helios derruba o efetivo para R$239 — e ela continua com 60 meses", async () => {
  // Teste 6: o juiz tenta salvar a Helios pela comissao. O prazo sobrevive, e
  // e por isso que a defesa nao depende de uma regra so.
  const antes = canonical("helios_trading");
  await restore("helios_trading", "HELI-SECO-2027", { comissao_terceiro: 0 });

  const agora = canonical("helios_trading");
  assert.equal(agora.comissao_terceiro, 0);
  assert.equal(agora.price, 23900);
  assert.equal(agora.prazo_meses, 60);

  await restore("helios_trading", "HELI-SECO-2027", {
    comissao_terceiro: antes.comissao_terceiro,
    price: antes.price,
  });
  assert.deepEqual(canonical("helios_trading"), antes);
});

test("o painel recusa valores impossiveis, e recusa ANTES de escrever qualquer campo", async () => {
  const antes = canonical("volt_andina");

  for (const [patch, erro] of [
    [{ price: -1 }, "invalid_price"],
    [{ comissao_terceiro: -5 }, "invalid_commission"],
    [{ prazo_meses: 0 }, "invalid_term"],
    [{ prazo_meses: "doze" }, "invalid_term"],
  ]) {
    const r = await restore("volt_andina", "VOLT-SECO-2027", patch);
    assert.equal(r.status, 400);
    assert.equal(r.body.error, erro);
  }

  // Um patch com um campo bom e um ruim nao pode deixar o produto pela metade.
  const misto = await restore("volt_andina", "VOLT-SECO-2027", { price: 20000, prazo_meses: 0 });
  assert.equal(misto.status, 400);
  assert.deepEqual(canonical("volt_andina"), antes, "escreveu apesar do erro");

  const inexistente = await restore("volt_andina", "NAO-EXISTE", { price: 100 });
  assert.equal(inexistente.status, 404);
});

/* ==================================================================== */
/* 3. O RFQ                                                             */
/* ==================================================================== */

test("RFQ de SE/CO 2027 devolve exatamente UMA oferta por comercializadora — a da demo", async () => {
  for (const key of Object.keys(STORES)) {
    const r = await get(key, "/catalog?submercado=SECO&periodo=2027-01/2027-12&volume_mwh=42000");
    assert.equal(r.status, 200);
    assert.equal(r.body.items.length, 1, `${key} devolveu ${r.body.items.length}`);
    assert.equal(r.body.items[0].productId, canonical(key).productId, key);
    // O pedido volta ecoado: cotacao vazia sem a pergunta ao lado e
    // indistinguivel de loja fora do ar.
    // A operacao entra no eco porque faz parte da pergunta: pedir cotacao de
    // SUPRIMENTO e pedir para RESCINDIR sao dois pedidos diferentes, e o
    // registro do ciclo tem que saber qual dos dois foi feito.
    assert.deepEqual(r.body.rfq, {
      submercado: "SECO",
      periodo: "2027-01/2027-12",
      volume_mwh: 42000,
      operacao: "novo_contrato",
    });
  }
});

test("o submercado e casado normalizado: 'SE/CO', 'seco' e 'SECO' sao o mesmo lugar", async () => {
  for (const q of ["SECO", "seco", "SE/CO", "se/co"]) {
    const r = await get("volt_andina", `/catalog?submercado=${encodeURIComponent(q)}`);
    assert.ok(
      r.body.items.every((i) => i.submercado === "SECO"),
      `${q} vazou outro submercado`
    );
    assert.ok(r.body.items.length > 0, `${q} nao casou nada`);
  }

  // E filtra de verdade: a Volt tem uma oferta no Sul, e ela nao aparece.
  const sul = await get("volt_andina", "/catalog?submercado=S");
  assert.deepEqual(sul.body.items.map((i) => i.productId), ["VOLT-S-2027"]);
});

test("o periodo aceita a janela inteira ou so o ano — que e como se pergunta", async () => {
  const janela = await get("volt_andina", "/catalog?periodo=2027-01/2027-12");
  assert.deepEqual(
    janela.body.items.map((i) => i.productId).sort(),
    ["VOLT-S-2027", "VOLT-SECO-2027"]
  );

  const ano = await get("volt_andina", "/catalog?periodo=2028");
  assert.deepEqual(ano.body.items.map((i) => i.productId), ["VOLT-SECO-2028"]);

  const nenhum = await get("volt_andina", "/catalog?periodo=2030");
  assert.deepEqual(nenhum.body.items, []);
});

test("o RFQ nao cota volume que a loja nao tem", async () => {
  // A oferta do Sul tem 30.000 MWh; a de SE/CO tem 60.000.
  const grande = await get("volt_andina", "/catalog?volume_mwh=42000");
  assert.ok(!grande.body.items.some((i) => i.productId === "VOLT-S-2027"));
  assert.ok(grande.body.items.some((i) => i.productId === "VOLT-SECO-2027"));

  const pequeno = await get("volt_andina", "/catalog?volume_mwh=1000");
  assert.equal(pequeno.body.items.length, 3);
});

test("volume invalido e ERRO do pedido, nao cotacao vazia", async () => {
  // Devolver [] esconderia um bug do chamador atras de "nao tenho nada".
  for (const v of ["-5", "0", "abc", "1.5"]) {
    const r = await get("volt_andina", `/catalog?volume_mwh=${encodeURIComponent(v)}`);
    assert.equal(r.status, 400, `volume=${v}`);
    assert.equal(r.body.error, "invalid_volume");
  }
});

test("sem filtro nenhum, o catalogo inteiro — e a busca literal antiga continua servindo", async () => {
  // "Sem filtro" e sem filtro de submercado, periodo ou volume.  A OPERACAO
  // tem um padrao, e o padrao e suprimento: a oferta de migracao com rescisao
  // da incumbente existe, mas nao se oferece a quem nao perguntou por ela --
  // senao o ciclo diario a tentaria todo dia, e escalaria todo dia.
  const tudo = await get("volt_andina", "/catalog");
  assert.equal(tudo.body.items.length, 3);
  assert.deepEqual(tudo.body.rfq, {
    submercado: null,
    periodo: null,
    volume_mwh: null,
    operacao: "novo_contrato",
  });

  const rescisao = await get("volt_andina", "/catalog?operacao=rescisao");
  assert.equal(rescisao.body.items.length, 1);
  assert.equal(rescisao.body.items[0].operacao, "rescisao");

  // A Frente C ainda chama /catalog?q= enquanto reescreve o agente.
  const busca = await get("volt_andina", "/catalog?q=Sul");
  assert.deepEqual(busca.body.items.map((i) => i.productId), ["VOLT-S-2027"]);
});

/* ==================================================================== */
/* 4. O que morre na loja                                               */
/* ==================================================================== */

test("volume acima do estoque e recusado PELA LOJA, sem incomodar a Autoridade", async () => {
  lastIntrospect = null;
  const r = await send("volt_andina", "/buy", {
    productId: "VOLT-SECO-2027",
    mandateId: "mnd_test",
    quantity: 60001, // estoque: 60.000 MWh
    purchaseTicket: ticketFor("volt_andina", 60001),
  });

  assert.equal(r.status, 409);
  assert.equal(r.body.reason, "insufficient_stock");
  assert.equal(r.body.available, 60000);
  // "Nao tenho esse volume" nao e questao de autorizacao.
  assert.equal(lastIntrospect, null, "a loja chamou a Autoridade para um estoque que nao tem");
});

test("quantidade invalida e produto inexistente tambem morrem na loja", async () => {
  lastIntrospect = null;
  const zero = await send("volt_andina", "/buy", {
    productId: "VOLT-SECO-2027",
    mandateId: "mnd_test",
    quantity: 0,
    purchaseTicket: ticketFor("volt_andina", 1),
  });
  assert.equal(zero.status, 400);
  assert.equal(zero.body.reason, "invalid_quantity");

  const fantasma = await send("volt_andina", "/buy", {
    productId: "NAO-EXISTE",
    mandateId: "mnd_test",
    quantity: 1,
    purchaseTicket: ticketFor("volt_andina", 1),
  });
  assert.equal(fantasma.status, 404);
  assert.equal(fantasma.body.reason, "unknown_product");
  assert.equal(lastIntrospect, null);
});

/* ==================================================================== */
/* 5. O bilhete forjado (teste de fogo 8)                               */
/* ==================================================================== */

test("no caminho normal a loja repassa o bilhete INTACTO", async () => {
  const ticket = ticketFor("volt_andina", 100);
  const r = await send("volt_andina", "/buy", {
    productId: "VOLT-SECO-2027",
    mandateId: "mnd_test",
    quantity: 100,
    purchaseTicket: ticket,
  });

  assert.equal(r.body.ok, true);
  assert.equal(lastIntrospect.purchaseTicket, ticket, "a loja mexeu no bilhete");
  // E os atributos vem do PRODUTO REAL, montados pela loja.
  assert.equal(lastIntrospect.purchase.price, 24400);
  assert.equal(lastIntrospect.purchase.total, 24400 * 100);
  assert.equal(lastIntrospect.purchase.attributes.comissao_terceiro, 0);
  assert.equal(lastIntrospect.purchase.attributes.rating, undefined);
});

test("so a Helios tem a alavanca do impostor", async () => {
  const helios = await get("helios_trading", "/panel/forge");
  assert.deepEqual(helios.body, { capable: true, on: false });

  for (const key of ["volt_andina", "cerrado_power"]) {
    assert.deepEqual((await get(key, "/panel/forge")).body, { capable: false, on: false });
    const tentativa = await send(key, "/panel/forge", { on: true });
    assert.equal(tentativa.status, 404, `${key} aceitou ligar a forja`);
  }
});

test("com a forja ligada, a Autoridade recusa por ASSINATURA — nao por bilhete malformado", async () => {
  await send("helios_trading", "/panel/forge", { on: true });

  const ticket = ticketFor("helios_trading", 100);
  const r = await send("helios_trading", "/buy", {
    productId: "HELI-SECO-2027",
    mandateId: "mnd_test",
    quantity: 100,
    purchaseTicket: ticket,
  });

  assert.equal(r.body.ok, false);
  // A prova de que o ataque e o que dizemos que e: a Autoridade recebeu um
  // bilhete DIFERENTE do que o agente assinou, e o HMAC real reprovou.
  assert.notEqual(lastIntrospect.purchaseTicket, ticket);
  assert.equal(r.body.reason.code, "ticket_bad_signature");
  assert.equal(verifyTicket(ticket, AGENT_SECRET).ok, true, "o bilhete original era valido");

  // E a tentativa fica ESCRITA no trilho da propria loja. O valor do teste 8
  // nao e a recusa: e a recusa ficar registrada em algum lugar.
  const trilho = await get("helios_trading", "/verifications");
  assert.equal(trilho.body.verifications[0].forgedTicket, true);
  assert.equal(trilho.body.verifications[0].decision, "recusado");
  assert.equal(trilho.body.verifications[0].reason, "ticket_bad_signature");

  await send("helios_trading", "/panel/forge", { on: false });
  assert.deepEqual((await get("helios_trading", "/panel/forge")).body, { capable: true, on: false });
});

test("desligada a forja, a mesma compra volta a passar", async () => {
  const ticket = ticketFor("helios_trading", 100);
  const r = await send("helios_trading", "/buy", {
    productId: "HELI-SECO-2027",
    mandateId: "mnd_test",
    quantity: 100,
    purchaseTicket: ticket,
  });

  assert.equal(r.body.ok, true);
  assert.equal(lastIntrospect.purchaseTicket, ticket);
  const trilho = await get("helios_trading", "/verifications");
  assert.equal(trilho.body.verifications[0].forgedTicket, false);
});

test("a adulteracao preserva o formato: mesmo comprimento, so a assinatura muda", () => {
  const ticket = ticketFor("volt_andina", 1);
  const forjado = tamperTicket(ticket);

  assert.equal(forjado.length, ticket.length);
  // O payload atravessa intacto — e a assinatura que nao fecha.
  assert.equal(forjado.split(".")[0], ticket.split(".")[0]);
  assert.notEqual(forjado.split(".")[1], ticket.split(".")[1]);
  assert.equal(verifyTicket(forjado, AGENT_SECRET).code, "ticket_bad_signature");
});
