/**
 * As tres comercializadoras, sob /volt, /cerrado e /helios.
 *
 * No `npm run dev` sao tres processos em tres portas; aqui sao tres apps
 * montados em tres prefixos.  A diferenca e de hospedagem, nao de papel: cada
 * uma continua com o proprio catalogo, o proprio formato interno e o proprio
 * adaptador, e continua tendo que CHAMAR a Autoridade para saber se pode
 * aceitar a compra.  A verificacao acontece do lado de la em qualquer topologia.
 *
 * Nenhum porteiro de banco aqui, e isso e a arquitetura falando: a
 * comercializadora nao tem acesso ao Mongo da Autoridade.  Nunca teve.
 *
 * Limite conhecido: o que o painel do operador edita (preco, comissao, prazo, o
 * interruptor de forjar bilhete) vive na memoria da instancia.  Numa funcao sem
 * processo, um ajuste pode nao alcancar a proxima invocacao.  As alavancas que
 * a demo precisa ver de pe -- curva de mercado, revogacao, aprovacao, supersede
 * -- sao todas da Autoridade e estao no Mongo.  Ver o README.
 */

import express from "express";
import { STORES } from "../app2/src/catalogs.js";
import { buildStore } from "../app2/src/store.js";
import { selfUrl, wireEnv } from "./_bootstrap.js";

wireEnv();

const MOUNT = {
  volt_andina: "/volt",
  cerrado_power: "/cerrado",
  helios_trading: "/helios",
};

const authorityUrl = `${selfUrl()}/api`;

const app = express();
for (const store of Object.values(STORES)) {
  const path = MOUNT[store.id];
  if (path) app.use(path, buildStore({ ...store, authorityUrl }));
}

export default app;
