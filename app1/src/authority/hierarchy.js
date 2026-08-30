/**
 * Hierarquia de mandatos.
 *
 * Um mandato operacional deriva de um mandato guarda-chuva: a diretoria abre a
 * moldura anual, o gestor de energia opera dentro dela.  É como a delegação de
 * poder funciona numa empresa, e é o que responde à pergunta que o caso pessoal
 * nunca precisou responder: **quem autorizou o autorizador?**
 *
 * A consequência que importa: revogar o pai mata os filhos, na mesma leitura.
 * Sem isso, a diretoria retiraria a moldura e os mandatos derivados seguiriam
 * comprando — cada um "válido" por conta própria.
 *
 * Resolvido AQUI, e não dentro de `evaluate`, para o motor continuar sendo uma
 * função pura de um mandato só.  A Autoridade carrega a cadeia e decide antes.
 */

import { mandateStatus } from "./engine.js";

/**
 * O status EFETIVO de um mandato, dada a cadeia de ancestrais.
 *
 * O status próprio manda quando ele mesmo já está morto; se ele está vivo, o
 * primeiro ancestral morto decide.  Devolvemos qual ancestral quebrou, porque
 * "por que este mandato parou de valer?" merece uma resposta que aponte o dedo.
 *
 * @param mandate    o mandato
 * @param ancestors  do pai à raiz, em ordem
 * @returns { status, brokenBy }  brokenBy é null quando a própria folha decide
 */
export function effectiveStatus(mandate, ancestors = [], now = new Date()) {
  const own = mandateStatus(mandate, now);
  if (own !== "active") return { status: own, brokenBy: null };

  for (const parent of ancestors) {
    const s = mandateStatus(parent, now);
    if (s !== "active") return { status: s, brokenBy: parent._id };
  }
  return { status: "active", brokenBy: null };
}

/**
 * Sobe a cadeia a partir de `parentMandateId`.
 *
 * `load` é injetado — este módulo não conhece o Mongo.  O teto de profundidade
 * não é paranoia: um ciclo (A pai de B, B pai de A) travaria a verificação de
 * toda compra, e um dado ruim não pode derrubar o caminho do dinheiro.
 */
export async function loadAncestors(mandate, load, maxDepth = 8) {
  const chain = [];
  const seen = new Set([mandate._id]);
  let current = mandate;

  for (let i = 0; i < maxDepth && current?.parentMandateId; i++) {
    if (seen.has(current.parentMandateId)) break; // ciclo: para, não estoura
    seen.add(current.parentMandateId);
    const parent = await load(current.parentMandateId);
    if (!parent) break;
    chain.push(parent);
    current = parent;
  }
  return chain;
}
