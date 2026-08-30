/**
 * Painel do operador da comercializadora — HTML puro, sem build e sem framework.
 *
 * É tela **da loja**, não da Trusted Surface: o vendedor mexendo na própria
 * oferta.  A aparência é deliberadamente diferente do Portal do Gestor, porque
 * o dono é outro — confundir as duas seria confundir quem manda em quê.
 *
 * Quatro alavancas, e cada uma existe para um teste de fogo:
 *
 *   preço efetivo   melhora a Cerrado para R$210 e ela continua recusada, pelo
 *                   rating que a Autoridade atesta e ela não  (teste 5)
 *   comissão        zera a comissão da Helios e ela continua recusada, pelo
 *                   prazo de 60 meses  (teste 6)
 *   prazo           a outra metade do teste 6
 *   estoque         volume que a loja não tem morre na loja
 *
 * E, só na Helios, a alavanca do teste 8: mandar à Autoridade um bilhete com a
 * assinatura adulterada.  Fica no painel da loja, e não num script escondido,
 * porque o ponto é o juiz poder puxá-la com a própria mão.
 *
 * Texto de UI em inglês (ver `CLAUDE.md`).
 */

const CSS = `
  :root { color-scheme: light }
  * { box-sizing: border-box }
  body { margin:0; background:#f4f4f2; color:#1c1917;
         font:14px/1.5 ui-monospace,"SF Mono",Menlo,monospace }
  header { background:#1c1917; color:#fff; padding:14px 20px;
           display:flex; align-items:baseline; gap:14px; flex-wrap:wrap }
  header b { font-size:15px; letter-spacing:.14em; text-transform:uppercase }
  header span { color:#a8a29e; font-size:12px }
  main { padding:20px; max-width:1100px }
  p.lead { color:#57534e; font-size:12.5px; margin:0 0 16px; max-width:72ch }
  table { width:100%; border-collapse:collapse; background:#fff;
          border:1px solid #e7e5e4; border-radius:6px; overflow:hidden }
  th { text-align:left; font-size:11px; letter-spacing:.08em; text-transform:uppercase;
       color:#78716c; font-weight:500; padding:9px 12px; background:#fafaf9;
       border-bottom:1px solid #e7e5e4 }
  td { padding:8px 12px; border-bottom:1px solid #f5f5f4; vertical-align:middle }
  tr:last-child td { border-bottom:0 }
  tr.out { opacity:.45 }
  .name { font-family:ui-sans-serif,system-ui,sans-serif; font-weight:600 }
  .muted { color:#a8a29e; font-size:11.5px }
  .num { text-align:right; white-space:nowrap }
  input { width:96px; padding:5px 8px; font:13px ui-monospace,monospace;
          border:1px solid #d6d3d1; border-radius:4px; text-align:right }
  input.term { width:62px }
  input:focus { outline:none; border-color:#1c1917; box-shadow:0 0 0 3px #1c191712 }
  button { padding:5px 10px; border:1px solid #d6d3d1; background:#fff;
           border-radius:4px; cursor:pointer;
           font:600 12px ui-sans-serif,system-ui,sans-serif }
  button:hover { background:#fafaf9 }
  button.on { border-color:#a7f3d0; background:#ecfdf5; color:#065f46 }
  button.off { border-color:#fecaca; background:#fef2f2; color:#991b1b }
  .saved { color:#047857; font-size:11px; margin-left:6px }
  .forge { margin:18px 0 0; padding:12px 14px; background:#fff;
           border:1px solid #e7e5e4; border-left:3px solid #dc2626; border-radius:6px }
  .forge h2 { margin:0 0 4px; font:600 12px ui-sans-serif,system-ui,sans-serif;
              letter-spacing:.06em; text-transform:uppercase; color:#991b1b }
  .forge p { margin:0 0 10px; color:#57534e; font-size:12px; max-width:72ch }
  .effective { font-weight:600 }
`;

const SCRIPT = String.raw`
async function patch(pid, body, el) {
  const r = await fetch('/catalog/' + encodeURIComponent(pid), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (el) { el.textContent = r.ok ? 'saved' : 'rejected'; setTimeout(() => (el.textContent = ''), 1400); }
  return r.ok;
}

var brl = function (cents) { return (cents / 100).toFixed(2); };

function rowHtml(i) {
  var scope = [i.submercado, i.periodo_suprimento, i.fonte, i.estrutura_preco,
               'flex ' + i.flexibilidade_pct + '%', 'ToP ' + i.take_or_pay_pct + '%']
    .filter(Boolean).join(' · ');
  return '<tr class="' + (i.available ? '' : 'out') + '">' +
    '<td><span class="name">' + i.name + '</span><br><span class="muted">' + i.productId + '</span></td>' +
    '<td class="muted">' + scope + '</td>' +
    '<td class="num"><input type="number" step="0.01" value="' + brl(i.price) +
      '" data-price="' + i.productId + '">' +
      '<span class="saved" data-saved="' + i.productId + '"></span></td>' +
    '<td class="num"><input type="number" step="0.01" value="' + brl(i.comissao_terceiro) +
      '" data-commission="' + i.productId + '"></td>' +
    '<td class="num muted">' + brl(i.preco_energia) + ' + ' + brl(i.comissao_terceiro) +
      ' = <span class="effective">' + brl(i.price) + '</span></td>' +
    '<td class="num"><input type="number" step="1" min="1" class="term" value="' + i.prazo_meses +
      '" data-term="' + i.productId + '"></td>' +
    '<td class="num muted">' + i.stock.toLocaleString('en-US') + '</td>' +
    '<td><button class="' + (i.available ? 'on' : 'off') + '" data-stock="' + i.productId +
      '" data-next="' + (!i.available) + '">' +
      (i.available ? 'listed' : 'withdrawn') + '</button></td>' +
  '</tr>';
}

/* Cada input escreve UM campo. O servidor aplica comissao antes de preco, para
   que mexer nos dois nao produza uma conta que nao fecha -- ver store.js. */
function wireCents(attr, field) {
  document.querySelectorAll('input[data-' + attr + ']').forEach(function (el) {
    var pid = el.dataset[attr];
    var commit = async function () {
      var cents = Math.round(parseFloat(el.value) * 100);
      if (!Number.isFinite(cents)) return;
      var body = {};
      body[field] = cents;
      await patch(pid, body, document.querySelector('[data-saved="' + pid + '"]'));
      load();
    };
    el.addEventListener('change', commit);
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter') el.blur(); });
  });
}

async function load() {
  var data = await (await fetch('/products')).json();
  document.getElementById('rows').innerHTML = data.items.map(rowHtml).join('');

  wireCents('price', 'price');
  wireCents('commission', 'comissao_terceiro');

  document.querySelectorAll('input[data-term]').forEach(function (el) {
    var pid = el.dataset.term;
    var commit = async function () {
      var months = parseInt(el.value, 10);
      if (!Number.isFinite(months)) return;
      await patch(pid, { prazo_meses: months }, document.querySelector('[data-saved="' + pid + '"]'));
      load();
    };
    el.addEventListener('change', commit);
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter') el.blur(); });
  });

  document.querySelectorAll('button[data-stock]').forEach(function (el) {
    el.addEventListener('click', async function () {
      await patch(el.dataset.stock, { available: el.dataset.next === 'true' });
      load();
    });
  });
}

async function loadForge() {
  var s = await (await fetch('/panel/forge')).json();
  if (!s.capable) return;
  var box = document.getElementById('forge');
  box.hidden = false;
  var btn = document.getElementById('forge-btn');
  var paint = function (on) {
    btn.className = on ? 'off' : 'on';
    btn.textContent = on ? 'forging signatures' : 'passing tickets through';
  };
  paint(s.on);
  btn.addEventListener('click', async function () {
    var next = btn.className === 'on';
    var r = await fetch('/panel/forge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ on: next }),
    });
    if (r.ok) paint((await r.json()).on);
  });
}

load();
loadForge();
`;

export function panelHtml(id, name) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${name} — operator</title>
  <style>${CSS}</style>
</head>
<body>
  <header><b>${name}</b><span>${id} · operator panel</span></header>
  <main>
    <p class="lead">
      Your own offers, in your own words. Prices are R$/MWh. The effective price is what the
      buyer's mandate is checked against — energy plus any third-party commission — so raising
      the commission raises the effective price even when the energy price has not moved.
      This panel cannot state your credit rating or whether you post a guarantee: the Authority
      attests those, because a seller is an interested party in its own risk. Changes live in
      memory — restarting restores them.
    </p>
    <table>
      <thead>
        <tr>
          <th>Offer</th><th>Scope</th>
          <th class="num">Effective (BRL)</th>
          <th class="num">Commission</th>
          <th class="num">Energy + commission</th>
          <th class="num">Term (months)</th>
          <th class="num">Available (MWh)</th>
          <th>Listing</th>
        </tr>
      </thead>
      <tbody id="rows"><tr><td colspan="8" class="muted">loading…</td></tr></tbody>
    </table>

    <div class="forge" id="forge" hidden>
      <h2>Impostor mode</h2>
      <p>
        Tamper with the signature on the agent's purchase ticket before forwarding it to the
        Authority. The store never holds the agent's secret, so the Authority recomputes the
        HMAC and refuses — and the attempt is written into this store's verification trail.
      </p>
      <button id="forge-btn" class="on">passing tickets through</button>
    </div>
  </main>
  <script>${SCRIPT}</script>
</body>
</html>`;
}
