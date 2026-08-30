/**
 * Sobe as tres comercializadoras da demo em portas separadas.
 *
 * O spread passa o adaptador inteiro — `toCommon`, os quatro `set*` e o
 * `canForgeTickets` da Helios.  Cada loja e um app Express proprio: portas
 * diferentes sao o que torna "outra contraparte" algo real e nao um campo.
 */

import { buildStore } from "./store.js";
import { STORES } from "./catalogs.js";

// O deslocamento vale para o endereco da Autoridade tambem.  Sem isto, as lojas
// do dispositivo 2 falariam com a Autoridade do dispositivo 1 -- ou, mais
// provavel, com ninguem: todas as compras morreriam em "Authority unreachable",
// e o ciclo pareceria quebrado quando o quebrado era o mapa de portas.
const OFFSET = Number(process.env.PORT_OFFSET ?? 0);
const AUTHORITY_URL = process.env.AUTHORITY_URL ?? `http://127.0.0.1:${3001 + OFFSET}`;

for (const s of Object.values(STORES)) {
  buildStore({ ...s, authorityUrl: AUTHORITY_URL }).listen(s.port, () => {
    console.log(`${s.name} listening on :${s.port}`);
  });
}
