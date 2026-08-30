/**
 * A moldura: barra superior + navegação lateral.
 *
 * Três decisões de layout que são decisões de produto:
 *  - o estado do mandato fica na barra superior, visível em TODAS as telas.
 *    Quem opera precisa saber a todo momento sob que autorização está.
 *  - REVOKE fica sempre à mão, no canto, em vermelho.  É o freio; um freio que
 *    precisa ser procurado não é um freio.  É também o que o juiz aperta na
 *    prova de fogo, sem ninguém do time tocar em nada.
 *  - a curva de mercado tem lugar fixo na barra, ao lado do mandato.  O limite
 *    desta empresa é RELATIVO ao mercado, então esconder o mercado numa aba
 *    seria esconder metade do que decide.
 */

import { t } from "../i18n.js";
import { Chip, Label, Meter, TONE } from "./ui.jsx";

const NAV = ["issue", "cycle", "approvals", "mandates", "curve", "audit"];

/* ------------------------------ ícones ------------------------------ */
/*
 * Inline e minúsculos de propósito: um pacote de ícones inteiro para seis
 * glifos seria mais bytes que o resto da interface.  `currentColor` faz todos
 * herdarem o tema sem uma linha de tema neles.
 */
const Icon = ({ d, className = "" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`h-[15px] w-[15px] shrink-0 ${className}`}
    aria-hidden="true"
  >
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

const NAV_ICON = {
  issue: ["M8 3h6l4 4v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z", "M14 3v4h4", "M9 13h6", "M9 16.5h4"],
  cycle: ["M3.5 12a8.5 8.5 0 0 1 14.6-5.9M20.5 12a8.5 8.5 0 0 1-14.6 5.9", "M18 3v3.5h-3.5", "M6 21v-3.5h3.5"],
  approvals: ["M4 5.5h16", "M4 12h16", "M4 18.5h9", "M16.5 18 18 19.5l3-3.5"],
  mandates: ["M12 3.5 4.5 6.5v5c0 4.2 3 8 7.5 9.2 4.5-1.2 7.5-5 7.5-9.2v-5L12 3.5Z", "M9.2 12l2 2 3.6-3.8"],
  curve: ["M4 19V5", "M4 19h16", "M7 15.5l3.5-4 3 2.8L20 8"],
  audit: ["M6 3.5h9l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z", "M15 3.5v4h4", "M8.5 12h7", "M8.5 15.5h7", "M8.5 8.5h3"],
};

/**
 * A marca: um raio sob um teto.
 *
 * É o produto inteiro num glifo — energia, e um limite acima dela.  O teto é
 * uma linha reta e o raio não a atravessa: nenhuma versão do desenho deixa a
 * corrente passar por cima da barra.
 */
const Mark = ({ className = "" }) => (
  <svg viewBox="0 0 28 28" className={`h-7 w-7 ${className}`} aria-hidden="true">
    <rect x="1" y="1" width="26" height="26" rx="8" className="fill-brand" />
    <path d="M7.5 8.5h13" stroke="white" strokeOpacity="0.55" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M15.4 11.2 10 17.4h3.6l-1 4.4 5.4-6.5h-3.5l.9-4.1Z" fill="white" />
  </svg>
);

const SunIcon = () => (
  <Icon d={["M12 4.5v-2M12 21.5v-2M4.5 12h-2M21.5 12h-2M6.5 6.5 5 5M19 19l-1.5-1.5M6.5 17.5 5 19M19 5l-1.5 1.5", "M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z"]} />
);
const MoonIcon = () => <Icon d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.5 8.5 0 1 0 10.2 10.2Z" />;

/* ------------------------------- shell ------------------------------ */

export default function Shell({
  locale,
  setLocale,
  theme,
  setTheme,
  tab,
  setTab,
  mandate,
  mandates = [],
  usable = [],
  onSelectMandate,
  counts = {},
  onRevoke,
  curve,
  children,
}) {
  const T = (k) => t(locale, k);
  const status = mandate?.status ?? "none";
  const offered =
    mandate && !usable.some((m) => m.mandateId === mandate.mandateId) ? [mandate, ...usable] : usable;
  const tone = status === "active" ? "allow" : status === "none" ? "mute" : "deny";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ---------------------------- barra superior --------------------------- */}
      <header className="z-20 shrink-0 border-b border-line bg-surface">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3 lg:px-6">
          <div className="flex items-center gap-2.5">
            <Mark />
            <div className="leading-none">
              <div className="font-sans text-[15px] font-semibold tracking-[-0.01em] text-ink">
                {T("brand")}
              </div>
              <div className="label-tech mt-1">{T("brandTag")}</div>
            </div>
          </div>

          <div className="hidden h-8 w-px bg-line sm:block" />

          {/* Com mais de um mandato o chip vira seletor: sob qual deles se opera
              é escolha da pessoa, não do primeiro da lista.  Só os vivos são
              oferecidos; o selecionado entra mesmo morto, para não sumir
              debaixo da mão de quem está olhando para ele. */}
          {offered.length > 1 ? (
            <label className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE[tone].dot}`} />
              <select
                value={mandate?.mandateId ?? ""}
                onChange={(e) => onSelectMandate?.(e.target.value)}
                className="max-w-[260px] truncate rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 font-mono text-[11.5px] text-ink outline-none transition hover:border-ink-faint focus:border-brand"
                title={T("topbar.pick")}
              >
                {offered.map((m) => (
                  <option key={m.mandateId} value={m.mandateId}>
                    {T(`status.${m.status}`)} · {m.humanReadable?.slice(0, 44) ?? m.mandateId}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <Chip tone={tone} dot>
              {mandate ? `${T(`status.${status}`)} · ${mandate.mandateId.slice(0, 12)}` : T("status.none")}
            </Chip>
          )}

          {mandate && (
            <div className="hidden min-w-[150px] max-w-[220px] flex-1 lg:block">
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <Label>{T("topbar.uses")}</Label>
                <span className="tnum font-mono text-[11.5px] text-ink">
                  {mandate.usedCount} / {mandate.maxUses}
                </span>
              </div>
              <Meter
                value={mandate.usedCount}
                max={mandate.maxUses}
                tone={mandate.usedCount >= mandate.maxUses ? "wait" : "allow"}
              />
            </div>
          )}

          {/* O mercado ao lado do mandato: o teto desta empresa é relativo a
              este número, então ele não pode viver escondido numa aba. */}
          {curve && (
            <button
              onClick={() => setTab("curve")}
              className="hidden items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-1.5 transition hover:border-brand-line hover:bg-brand-soft xl:flex"
              title={T("nav.curve")}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              <Label>{curve.submercado} {curve.periodo}</Label>
              <span className="tnum font-mono text-[12px] font-medium text-ink">
                R$ {(curve.precoBrlMwh / 100).toFixed(2)}
              </span>
            </button>
          )}

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden font-mono text-[11px] text-ink-faint xl:inline">
              {T("topbar.agent")} <span className="text-ink-dim">agent_aurora</span>
            </span>

            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink-dim transition hover:border-ink-faint hover:text-ink"
              title={T(theme === "dark" ? "topbar.themeLight" : "topbar.themeDark")}
              aria-label={T(theme === "dark" ? "topbar.themeLight" : "topbar.themeDark")}
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>

            <div className="flex overflow-hidden rounded-lg border border-line-strong">
              {["en", "pt"].map((l) => (
                <button
                  key={l}
                  onClick={() => setLocale(l)}
                  className={`px-2.5 py-1.5 font-mono text-[11px] font-medium uppercase transition ${
                    locale === l ? "bg-ink text-ink-invert" : "bg-surface text-ink-faint hover:text-ink"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>

            <button
              onClick={onRevoke}
              disabled={!mandate || mandate.revoked}
              className="flex items-center gap-2 rounded-lg bg-deny-dot px-3.5 py-2 font-sans text-[12.5px] font-semibold uppercase tracking-wide text-white shadow-sm transition hover:brightness-110 active:translate-y-px disabled:bg-line-strong disabled:text-ink-faint disabled:shadow-none"
            >
              <span className="h-2 w-2 rounded-[2px] bg-white/90" />
              {T("revoke.button")}
            </button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ------------------------------ lateral ----------------------------- */}
        <nav className="hidden w-60 shrink-0 overflow-y-auto border-r border-line bg-surface px-3 py-5 md:block">
          <Label className="px-3">{T("nav.section")}</Label>
          <ul className="mt-3 space-y-1">
            {NAV.map((k) => {
              const on = tab === k;
              return (
                <li key={k}>
                  <button
                    onClick={() => setTab(k)}
                    className={`group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left font-sans text-[13.5px] transition ${
                      on
                        ? "bg-brand-soft font-semibold text-brand-ink"
                        : "text-ink-dim hover:bg-surface-2 hover:text-ink"
                    }`}
                  >
                    <span className={on ? "text-brand" : "text-ink-faint group-hover:text-ink-dim"}>
                      <Icon d={NAV_ICON[k]} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{T(`nav.${k}`)}</span>
                    {counts[k] > 0 && (
                      <span className="tnum rounded-full border border-wait-line bg-wait-bg px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-wait-ink">
                        {counts[k]}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-8 rounded-xl border border-line bg-surface-2 px-3.5 py-3.5">
            <Label>{T("nav.enforcedBy")}</Label>
            <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-ink-dim">
              {T("nav.enforcedByNote")}
            </p>
          </div>
        </nav>

        {/* tabs no mobile, já que a lateral some */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-surface px-2 md:hidden">
            {NAV.map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 font-sans text-[13px] transition ${
                  tab === k
                    ? "border-brand font-semibold text-ink"
                    : "border-transparent text-ink-faint"
                }`}
              >
                <Icon d={NAV_ICON[k]} />
                {T(`nav.${k}`)}
              </button>
            ))}
          </div>

          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-6 lg:px-8 lg:py-8">
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
