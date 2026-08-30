/**
 * A fronteira do agente, verificada no CÓDIGO-FONTE.
 *
 * O projeto afirma, no README e na arquitetura, que a separação entre o Agente
 * e a Autoridade não é disciplina de quem escreve — é o que o arquivo consegue
 * alcançar. Uma afirmação dessas só vale se alguém puder checá-la, e a banca
 * pode: são dois `grep`.
 *
 * Ela já foi falsa uma vez. O ciclo diário lia `Mandate.find({})` direto do
 * Mongo, o que devolve o documento INTEIRO — `paymentMethodRef` incluso — e a
 * invariante diz que o agente nunca vê o instrumento. Ele nunca o usava, mas
 * "nunca vê" tinha deixado de ser verdade, e ninguém percebeu porque a frase
 * morava num documento e o atalho, noutro arquivo.
 *
 * Este teste é o que impede a frase de voltar a ser mentira.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AGENTE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "agent");

const fontes = fs
  .readdirSync(AGENTE)
  .filter((f) => f.endsWith(".js"))
  .map((f) => ({ file: f, code: fs.readFileSync(path.join(AGENTE, f), "utf8") }));

/** Só o que o código executa: comentários explicam a regra, não a violam. */
const semComentarios = (code) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("ha arquivos de agente para inspecionar", () => {
  assert.ok(fontes.length >= 4, `esperava o modulo do agente, achei ${fontes.length} arquivos`);
});

test("o agente NAO alcanca o banco da Autoridade", () => {
  for (const { file, code } of fontes) {
    const exec = semComentarios(code);
    assert.ok(!exec.includes("models.js"), `${file} importa models.js`);
    assert.ok(!/\bmongoose\b/.test(exec), `${file} fala com o mongoose`);
    assert.ok(!/\bMandate\.\w+\(/.test(exec), `${file} consulta a colecao de mandatos direto`);
    assert.ok(!/\bApproval\.\w+\(|\bAuditLog\.\w+\(/.test(exec), `${file} escreve no estado da Autoridade`);
  }
});

test("o agente NAO decide autorizacao — nao chama o motor", () => {
  for (const { file, code } of fontes) {
    const exec = semComentarios(code);
    // `mandateStatus` e `derivedAttributes` sao funcoes PURAS e podem ser
    // compartilhadas: elas projetam, nao autorizam.  `evaluate` e a decisao,
    // e a decisao pertence a um processo que o agente nao controla.
    assert.ok(!/\bevaluate\s*\(/.test(exec), `${file} chama evaluate`);
    assert.ok(!exec.includes("introspect.js"), `${file} importa o introspect`);
  }
});

test("o agente NAO escreve estado nenhum", () => {
  for (const { file, code } of fontes) {
    const exec = semComentarios(code);
    for (const escrita of ["updateOne(", "findOneAndUpdate(", "deleteOne(", "deleteMany("]) {
      assert.ok(!exec.includes(escrita), `${file} usa ${escrita}`);
    }
  }
});

test("o instrumento de pagamento nao e nomeado no modulo do agente", () => {
  // Nao e paranoia de string: e que a unica forma de o agente mencionar o
  // ponteiro seria te-lo em maos, e ele nao deve te-lo.
  for (const { file, code } of fontes) {
    assert.ok(!semComentarios(code).includes("paymentMethodRef"), `${file} menciona paymentMethodRef`);
  }
});
