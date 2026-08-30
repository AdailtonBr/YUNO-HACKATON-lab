/**
 * Primitivas visuais.  Sem lógica de domínio.
 *
 * A regra que atravessa todas: valor medido ou decidido pelo sistema aparece em
 * mono; texto dirigido à pessoa aparece em sans.  Se está em mono, dá para
 * conferir contra o mandato.
 *
 * Nenhuma primitiva escolhe um cinza.  Todas escolhem um PAPEL — `surface`,
 * `ink`, `line`, `brand` — e o papel resolve para claro ou escuro em
 * `index.css`.  É por isso que os dois temas não custam uma segunda árvore de
 * componentes.
 */

import { useState } from "react";

/* --------------------------- semântica ----------------------------- */

export const TONE = {
  allow: {
    chip: "bg-allow-bg text-allow-ink border-allow-line",
    panel: "bg-allow-bg border-allow-line",
    dot: "bg-allow-dot",
    ink: "text-allow-ink",
  },
  deny: {
    chip: "bg-deny-bg text-deny-ink border-deny-line",
    panel: "bg-deny-bg border-deny-line",
    dot: "bg-deny-dot",
    ink: "text-deny-ink",
  },
  wait: {
    chip: "bg-wait-bg text-wait-ink border-wait-line",
    panel: "bg-wait-bg border-wait-line",
    dot: "bg-wait-dot",
    ink: "text-wait-ink",
  },
  brand: {
    chip: "bg-brand-soft text-brand-ink border-brand-line",
    panel: "bg-brand-soft border-brand-line",
    dot: "bg-brand",
    ink: "text-brand-ink",
  },
  mute: {
    chip: "bg-surface-2 text-ink-dim border-line",
    panel: "bg-surface-2 border-line",
    dot: "bg-ink-faint",
    ink: "text-ink-dim",
  },
};

/** Etiqueta técnica em caixa alta — o rótulo padrão da interface. */
export const Label = ({ children, className = "" }) => (
  <span className={`label-tech ${className}`}>{children}</span>
);

/** Chip de estado.  `dot` acende o ponto colorido à esquerda. */
export const Chip = ({ tone = "mute", dot = false, children, className = "" }) => (
  <span
    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] ${TONE[tone].chip} ${className}`}
  >
    {dot && (
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE[tone].dot}`} aria-hidden="true" />
    )}
    {children}
  </span>
);

/* ----------------------------- estrutura --------------------------- */

export const Panel = ({ tone, className = "", children }) => (
  <section
    className={`overflow-hidden rounded-xl border shadow-card ${
      tone ? TONE[tone].panel : "border-line bg-surface"
    } ${className}`}
  >
    {children}
  </section>
);

export const PanelHead = ({ title, note, right }) => (
  <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
    <div className="min-w-0">
      <h2 className="font-sans text-[13.5px] font-semibold tracking-tight text-ink">{title}</h2>
      {note && <p className="mt-1 font-mono text-[11.5px] leading-relaxed text-ink-dim">{note}</p>}
    </div>
    {right}
  </header>
);

/**
 * Cabeçalho de tela.  A régua da marca por cima do título é o único ornamento
 * da interface, e existe para dar um ponto de entrada ao olho — sem ela, todas
 * as telas começam iguais e a pessoa perde onde está.
 */
export const ScreenHead = ({ title, note, right }) => (
  <div className="mb-6">
    <div className="brand-rule mb-4 h-px w-full" aria-hidden="true" />
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-sans text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          {title}
        </h1>
        {note && (
          <p className="mt-1.5 max-w-2xl font-mono text-[12px] leading-relaxed text-ink-dim">{note}</p>
        )}
      </div>
      {right}
    </div>
  </div>
);

export const Empty = ({ children }) => (
  <p className="px-5 py-12 text-center font-mono text-[12px] text-ink-faint">{children}</p>
);

/* ----------------------------- controles --------------------------- */

const CONTROL =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 font-mono text-[13px] text-ink " +
  "outline-none transition placeholder:text-ink-faint " +
  "hover:border-ink-faint focus:border-brand focus:ring-4 focus:ring-brand-soft " +
  "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-faint";

export const Input = ({ className = "", ...p }) => (
  <input {...p} className={`${CONTROL} tnum ${className}`} />
);

export const Select = ({ children, className = "", ...p }) => (
  <select {...p} className={`${CONTROL} cursor-pointer appearance-none pr-8 ${className}`}>
    {children}
  </select>
);

export const Field = ({ label, children, hint }) => (
  <label className="block">
    <Label className="mb-1.5 block">{label}</Label>
    {children}
    {hint && <span className="mt-1.5 block font-mono text-[10.5px] leading-relaxed text-ink-faint">{hint}</span>}
  </label>
);

/*
 * `primary` é a marca; `danger` é vermelho e só aparece onde a ação não volta
 * atrás.  Um botão de revogar que parecesse com os outros seria uma armadilha.
 */
const BUTTON = {
  primary:
    "bg-brand text-white shadow-sm hover:bg-brand-hover active:translate-y-px disabled:bg-line-strong disabled:text-ink-faint disabled:shadow-none",
  danger:
    "bg-deny-dot text-white shadow-sm hover:brightness-110 active:translate-y-px disabled:bg-line-strong disabled:text-ink-faint disabled:shadow-none",
  approve:
    "bg-allow-dot text-white shadow-sm hover:brightness-110 active:translate-y-px disabled:bg-line-strong disabled:text-ink-faint disabled:shadow-none",
  refuse:
    "border border-deny-line bg-surface text-deny-ink hover:bg-deny-bg active:translate-y-px disabled:opacity-40",
  ghost:
    "border border-line-strong bg-surface text-ink-dim hover:border-ink-faint hover:text-ink active:translate-y-px disabled:opacity-40",
};

export const Button = ({ variant = "primary", className = "", ...p }) => (
  <button
    {...p}
    className={`rounded-lg px-4 py-2 font-sans text-[13px] font-semibold tracking-tight transition disabled:cursor-not-allowed ${BUTTON[variant]} ${className}`}
  />
);

/* ------------------------------ dados ------------------------------ */

/** Célula de métrica: rótulo técnico em cima, valor grande em mono embaixo. */
export const Metric = ({ label, value, tone, sub }) => (
  <div className="min-w-0 px-5 py-4">
    <Label>{label}</Label>
    <p
      className={`tnum mt-1.5 truncate font-mono text-[17px] font-medium tracking-tight ${
        tone && TONE[tone] ? TONE[tone].ink : "text-ink"
      }`}
    >
      {value}
    </p>
    {sub && <p className="mt-1 truncate font-mono text-[10.5px] text-ink-faint">{sub}</p>}
  </div>
);

export const Meter = ({ value, max, tone = "allow" }) => {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const fill = tone === "wait" ? "bg-wait-dot" : tone === "deny" ? "bg-deny-dot" : "bg-brand";
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemax={max}
    >
      <div className={`h-full rounded-full transition-[width] duration-500 ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  );
};

/**
 * Id/hash truncado com botão de copiar.
 *
 * O botão confirma na própria etiqueta em vez de abrir um toast: a confirmação
 * pertence ao lugar onde a ação aconteceu, e um aviso que voa pela tela é uma
 * peça a mais para ninguém ler.
 */
export function Mono({ value, copy = false, className = "" }) {
  const [done, setDone] = useState(false);
  if (!value) return <span className="font-mono text-[11px] text-ink-faint">—</span>;
  const short = value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-4)}` : value;

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="font-mono text-[11px] text-ink-dim" title={value}>
        {short}
      </span>
      {copy && (
        <button
          onClick={() => {
            navigator.clipboard?.writeText(value);
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          }}
          className={`label-tech rounded-md border px-1.5 py-0.5 transition ${
            done ? "border-allow-line bg-allow-bg text-allow-ink" : "border-line hover:bg-surface-2 hover:text-ink-dim"
          }`}
        >
          {done ? "copied" : "copy"}
        </button>
      )}
    </span>
  );
}
