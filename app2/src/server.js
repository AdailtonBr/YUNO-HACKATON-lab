/**
 * Sobe as tres comercializadoras da demo em portas separadas.
 *
 * O spread passa o adaptador inteiro — `toCommon`, os quatro `set*` e o
 * `canForgeTickets` da Helios.  Cada loja e um app Express proprio: portas
 * diferentes sao o que torna "outra contraparte" algo real e nao um campo.
 */

import { buildStore } from "./store.js";
import { STORES } from "./catalogs.js";

const AUTHORITY_URL = process.env.AUTHORITY_URL ?? "http://127.0.0.1:3001";

for (const s of Object.values(STORES)) {
  buildStore({ ...s, authorityUrl: AUTHORITY_URL }).listen(s.port, () => {
    console.log(`${s.name} listening on :${s.port}`);
  });
}
