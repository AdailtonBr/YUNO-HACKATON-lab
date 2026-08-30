/**
 * O ciclo diário — o bloco `08:00 → 08:05` do escopo, como tela.
 *
 * O agente devolve DADO, não texto: cada oferta traz a conta aberta, regra a
 * regra.  A tela é só a renderização disso, e é por isso que ela consegue
 * mostrar o que a Autoridade não mostra — **todas** as falhas de uma oferta.
 * A Autoridade para na primeira regra que falha e dá uma razão só, e está
 * certa: dizer "ok" sobre o que não se olhou seria mentira.  Quem não decide
 * nada é que pode se dar ao luxo de olhar tudo.
 *
 * As duas visões aparecem lado a lado de propósito.  A projeção do agente fica
 * no corpo do cartão; o veredito da Autoridade fica numa faixa própria, com a
 * cor da decisão.  É assim que se vê, sem explicação, que o segundo não é o
 * primeiro — e é a resposta visual para "e se o agente mentir?".
 */

import { money } from "../api.js";
import { DECISION_LABEL, t } from "../i18n.js";
import { Chip, Empty, Label, Panel, ScreenHead } from "./ui.jsx";

const toneFor = (decision) =>
  decision === "valido" ? "allow" : decision === "escalado" ? "wait" : "deny";

const VERDICT_TONE = { eligible: "allow", rejected: "deny", discarded: "mute" };

/** Valor com sinal e cor: economizar é verde, destruir valor é vermelho. */
const Signed = ({ cents, locale, size = "20px" }) => {
  if (cents == null) return <span className="text-ink-faint">—</span>;
  const tone = cents > 0 ? "text-allow-ink" : cents < 0 ? "text-deny-ink" : "text-ink-dim";
  return (
    <span className={`tnum font-mono font-medium tracking-tight ${tone}`} style={{ fontSize: size }}>
      {cents > 0 ? "+" : ""}
      {money(cents, "BRL", locale)}
    </span>
  );
};

const StatCard = ({ label, value, sub, accent = false }) => (
  <div
    className={`rounded-xl border px-4 py-3.5 ${
      accent ? "border-brand-line bg-brand-soft" : "border-line bg-surface shadow-card"
    }`}
  >
    <Label>{label}</Label>
    <p
      className={`tnum mt-1.5 truncate font-mono text-[17px] font-medium tracking-tight ${
        accent ? "text-brand-ink" : "text-ink"
      }`}
    >
      {value}
    </p>
    {sub && <p className="mt-1 truncate font-mono text-[10.5px] text-ink-faint">{sub}</p>}
  </div>
);

/** Uma regra que barrou — ou que pede um humano — escrita como o motor a leu. */
const RuleLine = ({ check, tone }) => (
  <li className="flex flex-wrap items-baseline gap-x-1.5 font-mono text-[11.5px] leading-relaxed">
    <span className={tone === "wait" ? "text-wait-ink" : "text-deny-ink"}>{tone === "wait" ? "!" : "×"}</span>
    <span className="text-ink">{check.attr}</span>
    <span className="text-ink-faint">{check.op}</span>
    <span className="text-ink-dim">{JSON.stringify(check.value)}</span>
    <span className="text-ink-faint">→</span>
    <span className={tone === "wait" ? "text-wait-ink" : "text-deny-ink"}>{JSON.stringify(check.actual)}</span>
  </li>
);

function OfferCard({ offer, attempt, locale, T }) {
  const p = offer.projected ?? {};
  const commission =
    offer.checks?.find((c) => c.attr === "comissao_terceiro")?.actual ?? 0;
  const tone = attempt ? toneFor(attempt.decision) : VERDICT_TONE[offer.verdict] ?? "mute";
  const band =
    tone === "allow"
      ? "border-allow-line bg-allow-bg text-allow-ink"
      : tone === "wait"
        ? "border-wait-line bg-wait-bg text-wait-ink"
        : "border-deny-line bg-deny-bg text-deny-ink";

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h3 className="truncate font-sans text-[14.5px] font-semibold tracking-tight text-ink">
            {offer.merchantName ?? offer.merchantId}
          </h3>
          <p className="mt-0.5 truncate font-mono text-[11px] text-ink-faint">
            {offer.name ?? offer.productId}
          </p>
        </div>
        <Chip tone={tone} dot>
          {attempt
            ? DECISION_LABEL[locale]?.[attempt.decision] ?? attempt.decision
            : T(`energy.cycle.verdict.${offer.verdict}`)}
        </Chip>
      </div>

      {/* O preço, e a decomposição dele quando há comissão embutida.  É a linha
          que desmonta o caso Helios: a manchete não é o preço. */}
      <div className="flex flex-wrap items-end gap-x-10 gap-y-4 px-5 py-4">
        <div>
          <Label>{T("energy.cycle.effective")}</Label>
          <p className="tnum mt-1 font-mono text-[22px] font-medium tracking-tight text-ink">
            {money(offer.price, "BRL", locale)}
            <span className="ml-1 font-sans text-[12px] font-normal text-ink-faint">/MWh</span>
          </p>
          {commission > 0 && (
            <p className="mt-1 font-mono text-[11px] text-deny-ink">
              {money(offer.price - commission, "BRL", locale)} + {money(commission, "BRL", locale)}{" "}
              {T("energy.cycle.commission")}
            </p>
          )}
        </div>

        <div>
          <Label>{T("energy.cycle.vsCurve")}</Label>
          <p
            className={`tnum mt-1 font-mono text-[16px] font-medium ${
              (p.desconto_vs_curva_pct ?? 0) >= 0 ? "text-allow-ink" : "text-deny-ink"
            }`}
          >
            {p.desconto_vs_curva_pct == null
              ? "—"
              : `${p.desconto_vs_curva_pct > 0 ? "+" : ""}${p.desconto_vs_curva_pct}%`}
          </p>
        </div>

        <div className="ml-auto text-right">
          <Label>{T("energy.cycle.net")}</Label>
          <p className="mt-1">
            <Signed cents={p.economia_liquida_brl} locale={locale} />
          </p>
          <p className="mt-1 font-mono text-[10.5px] text-ink-faint">
            {T("energy.cycle.gross")} {money(p.economia_bruta_brl ?? 0, "BRL", locale)} − {T("energy.cycle.penalty")}{" "}
            {money(p.multa_rescisoria_brl ?? 0, "BRL", locale)}
          </p>
        </div>
      </div>

      {(offer.failures?.length > 0 || offer.escalations?.length > 0 || offer.unknowns?.length > 0) && (
        <div className="border-t border-line bg-surface-2 px-5 py-3.5">
          <ul className="space-y-1">
            {offer.failures?.map((c, i) => <RuleLine key={`f${i}`} check={c} tone="deny" />)}
            {offer.escalations?.map((c, i) => <RuleLine key={`e${i}`} check={c} tone="wait" />)}
          </ul>
          {offer.unknowns?.length > 0 && (
            <p className="mt-2 font-mono text-[10.5px] leading-relaxed text-ink-faint">
              {T("energy.cycle.onlyAuthority")} {offer.unknowns.map((u) => u.attr).join(", ")}
            </p>
          )}
        </div>
      )}

      {attempt && (
        <div className={`border-t px-5 py-3.5 ${band}`}>
          <Label>{T("energy.cycle.authoritySaid")}</Label>
          <p className="mt-1 font-mono text-[12px] leading-relaxed">{attempt.reasonText ?? attempt.decision}</p>
        </div>
      )}
    </Panel>
  );
}

export default function DailyCycle({ locale, cycle, trail = [] }) {
  const T = (key) => t(locale, key);
  const snapshot = cycle?.cycle ?? cycle;
  const run = snapshot?.mandates?.[0] ?? null;
  const steps = snapshot?.steps ?? [];
  const stepOf = (code) => steps.find((s) => s.step === code);

  /*
   * Sem o ciclo rico, cai na trilha — e DEDUPLICA.  O mesmo veredito repetido a
   * cada tique não é informação nova, é o relógio batendo; uma tela que os
   * empilha faz parecer que aconteceram cinco coisas quando aconteceu uma.
   */
  if (!run) {
    const seen = new Set();
    const rows = trail
      .filter((e) => e.event === "purchase_decision")
      .filter((e) => {
        const key = `${e.merchantId}:${e.purchase?.productId}:${e.decision}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    return (
      <>
        <ScreenHead title={T("energy.cycle.title")} note={T("energy.cycle.note")} />
        <Panel>
          {rows.length === 0 ? (
            <Empty>{T("energy.cycle.waiting")}</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((e) => (
                <li key={e.auditId} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <Chip tone={toneFor(e.decision)} dot>
                    {DECISION_LABEL[locale]?.[e.decision] ?? e.decision}
                  </Chip>
                  <span className="font-mono text-[12px] text-ink">{e.merchantId}</span>
                  <span className="tnum font-mono text-[12px] text-ink-dim">
                    {e.purchase?.price == null ? "—" : money(e.purchase.price, "BRL", locale)}
                  </span>
                  <span className="min-w-0 flex-1 font-sans text-[12.5px] text-ink-dim">{e.reasonText}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </>
    );
  }

  const curve = stepOf("curve_read");
  const contract = stepOf("contract_read");
  const d = run.denuncia ?? {};
  const attemptFor = (o) =>
    run.attempts?.find((a) => a.merchantId === o.merchantId && a.productId === o.productId) ?? null;

  // A ordem da tela é a ordem da DECISÃO: quem foi tentado vem primeiro, na
  // ordem em que foi tentado; o resto vem depois, por economia projetada.
  const rank = (o) => {
    const i = run.attempts?.findIndex((a) => a.productId === o.productId) ?? -1;
    return i === -1 ? 99 : i;
  };
  const ordered = [...(run.offers ?? [])].sort(
    (a, b) => rank(a) - rank(b) || (b.gain ?? -Infinity) - (a.gain ?? -Infinity)
  );

  return (
    <>
      <ScreenHead
        title={T("energy.cycle.title")}
        note={T("energy.cycle.note")}
        right={
          snapshot.startedAt && (
            <span className="rounded-full border border-line bg-surface px-3 py-1.5 font-mono text-[11px] text-ink-dim">
              {new Date(snapshot.startedAt).toLocaleTimeString(locale === "pt" ? "pt-BR" : "en-US")}
            </span>
          )
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          accent
          label={T("energy.cycle.curveRead")}
          value={curve ? `${money(curve.precoBrlMwh, "BRL", locale)} /MWh` : "—"}
          sub={curve ? `${curve.submercado} ${curve.periodo}` : undefined}
        />
        <StatCard
          label={T("energy.cycle.standing")}
          value={contract ? `${money(contract.precoBrlMwh, "BRL", locale)} /MWh` : "—"}
          sub={
            contract
              ? `${contract.fornecedor} · ${contract.volumeRemanescenteMwh?.toLocaleString()} MWh`
              : undefined
          }
        />
        <StatCard
          label={T("energy.cycle.window")}
          value={d.missed ? T("energy.cycle.windowMissed") : `${d.daysLeft ?? "—"} ${T("energy.cycle.days")}`}
          sub={d.level ? `${T("energy.cycle.alert")} D−${d.level}` : undefined}
        />
        <StatCard
          label={T("energy.cycle.evaluated")}
          value={`${run.offers?.length ?? 0}`}
          sub={`${run.attempts?.length ?? 0} ${T("energy.cycle.attempted")}`}
        />
      </div>

      <div className="grid gap-4">
        {ordered.map((offer) => (
          <OfferCard
            key={`${offer.merchantId}/${offer.productId}`}
            offer={offer}
            attempt={attemptFor(offer)}
            locale={locale}
            T={T}
          />
        ))}
      </div>

      {/* A trilha do próprio ciclo: a ordem em que ele olhou para o mundo.
          "Leu a curva ANTES de avaliar" é parte do que se está afirmando. */}
      <details className="mt-5 rounded-xl border border-line bg-surface px-5 py-4">
        <summary className="cursor-pointer font-sans text-[13px] font-semibold text-ink-dim transition hover:text-ink">
          {T("energy.cycle.steps")}
        </summary>
        <ol className="mt-3.5 space-y-2 border-l border-line pl-4">
          {steps.map((s, i) => (
            <li key={i} className="relative font-mono text-[11.5px] leading-relaxed text-ink-dim">
              <span className="absolute -left-[21px] top-1.5 h-1.5 w-1.5 rounded-full bg-line-strong" />
              <span className="text-ink-faint">{s.step}</span>
              {s.note && <span className="ml-2">{s.note}</span>}
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}
