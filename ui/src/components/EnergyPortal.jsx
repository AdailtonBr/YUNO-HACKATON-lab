import { useMemo, useState } from "react";
import { AGENT_ID, api, money } from "../api.js";
import { DECISION_LABEL, t } from "../i18n.js";
import { Button, Chip, Empty, Field, Input, Label, Panel, ScreenHead, Select } from "./ui.jsx";

const policy = (attr, op, value, onFail = "deny") => ({ attr, op, value, on_missing: "deny", on_fail: onFail });
const asNumber = (value) => Number(value || 0);

function Layer({ title, note, children }) {
  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-line bg-surface-2 px-4 py-2.5">
        <h2 className="font-sans text-[14px] font-semibold text-ink">{title}</h2>
        <p className="mt-0.5 font-mono text-[11.5px] text-ink-dim">{note}</p>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2">{children}</div>
    </Panel>
  );
}

export function Issuer({ locale, methods, reload }) {
  const T = (key) => t(locale, key);
  const [form, setForm] = useState({
    submarket: "SECO", source: "convencional", structure: "fixo", term: 24,
    volume: 42000, total: 1100000000, discount: 2, coverageMin: 95, coverageMax: 105,
    flexibility: 10, takeOrPay: 90, pld: 40000000, rating: "A-", operation: "novo_contrato",
    netSaving: 5000000, uses: 2, method: methods[0]?.methodId ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const set = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));

  const draft = useMemo(() => ({
    agentId: AGENT_ID,
    mode: "autonomo",
    currency: "BRL",
    paymentMethodId: form.method || methods[0]?.methodId,
    maxUses: asNumber(form.uses),
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    constraints: [
      policy("comissao_terceiro", "eq", 0),
      policy("submercado", "eq", form.submarket),
      policy("fonte", "in", [form.source]),
      policy("estrutura_preco", "eq", form.structure),
      policy("prazo_meses", "lte", asNumber(form.term)),
      policy("rating", "in", ["AAA", "AA", "A+", "A", form.rating]),
      policy("garantia", "eq", true),
      policy("cobertura_pct", "gte", asNumber(form.coverageMin)),
      policy("cobertura_pct", "lte", asNumber(form.coverageMax)),
      policy("flexibilidade_pct", "gte", asNumber(form.flexibility)),
      policy("take_or_pay_pct", "lte", asNumber(form.takeOrPay)),
      policy("exposicao_pld_brl", "lte", asNumber(form.pld)),
      policy("quantity", "lte", asNumber(form.volume)),
      policy("total", "lte", asNumber(form.total)),
      policy("desconto_vs_curva_pct", "gte", asNumber(form.discount)),
      policy("operacao", "eq", form.operation, "escalate"),
      policy("economia_liquida_brl", "lte", asNumber(form.netSaving), "escalate"),
    ],
  }), [form, methods]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const response = await api.createMandate(draft, locale);
      setResult({ tone: "allow", text: response.humanReadable ?? T("energy.issued") });
      await reload();
    } catch (error) {
      setResult({ tone: "deny", text: error.data?.error ?? error.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ScreenHead title={T("energy.issue.title")} note={T("energy.issue.note")} />
      <form onSubmit={submit} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-3">
          <Layer title={T("energy.layer.scope")} note={T("energy.layer.scopeNote")}>
            <Field label={T("energy.field.submarket")}><Select value={form.submarket} onChange={(e) => set("submarket", e.target.value)}><option>SECO</option><option>S</option><option>NE</option><option>N</option></Select></Field>
            <Field label={T("energy.field.source")}><Select value={form.source} onChange={(e) => set("source", e.target.value)}><option value="convencional">{T("energy.option.conventional")}</option><option value="I-5">I-5</option><option value="I-0">I-0</option><option value="I-100">I-100</option></Select></Field>
            <Field label={T("energy.field.structure")}><Select value={form.structure} onChange={(e) => set("structure", e.target.value)}><option value="fixo">{T("energy.option.fixed")}</option><option value="indexado">{T("energy.option.indexed")}</option><option value="hibrido">{T("energy.option.hybrid")}</option></Select></Field>
            <Field label={T("energy.field.term")}><Input type="number" min="1" value={form.term} onChange={(e) => set("term", e.target.value)} /></Field>
          </Layer>
          <Layer title={T("energy.layer.volume")} note={T("energy.layer.volumeNote")}>
            <Field label={T("energy.field.volume")}><Input type="number" min="1" value={form.volume} onChange={(e) => set("volume", e.target.value)} /></Field>
            <Field label={T("energy.field.total")} hint={T("energy.field.cents")}><Input type="number" min="1" value={form.total} onChange={(e) => set("total", e.target.value)} /></Field>
            <Field label={T("energy.field.discount")}><Input type="number" step="0.1" min="0" value={form.discount} onChange={(e) => set("discount", e.target.value)} /></Field>
            <Field label={T("energy.field.uses")}><Input type="number" min="1" value={form.uses} onChange={(e) => set("uses", e.target.value)} /></Field>
          </Layer>
          <Layer title={T("energy.layer.risk")} note={T("energy.layer.riskNote")}>
            <Field label={T("energy.field.coverageMin")}><Input type="number" value={form.coverageMin} onChange={(e) => set("coverageMin", e.target.value)} /></Field>
            <Field label={T("energy.field.coverageMax")}><Input type="number" value={form.coverageMax} onChange={(e) => set("coverageMax", e.target.value)} /></Field>
            <Field label={T("energy.field.flexibility")}><Input type="number" value={form.flexibility} onChange={(e) => set("flexibility", e.target.value)} /></Field>
            <Field label={T("energy.field.takeOrPay")}><Input type="number" value={form.takeOrPay} onChange={(e) => set("takeOrPay", e.target.value)} /></Field>
            <Field label={T("energy.field.pld")} hint={T("energy.field.cents")}><Input type="number" value={form.pld} onChange={(e) => set("pld", e.target.value)} /></Field>
          </Layer>
          <Layer title={T("energy.layer.counterparty")} note={T("energy.layer.counterpartyNote")}>
            <Field label={T("energy.field.rating")}><Select value={form.rating} onChange={(e) => set("rating", e.target.value)}><option>AAA</option><option>AA</option><option>A+</option><option>A</option><option>A-</option></Select></Field>
            <div className="rounded border border-line bg-surface-2 px-3 py-2.5 font-mono text-[12px] text-ink-dim">{T("energy.guarantee")}</div>
          </Layer>
          <Layer title={T("energy.layer.governance")} note={T("energy.layer.governanceNote")}>
            <Field label={T("energy.field.operation")}><Select value={form.operation} onChange={(e) => set("operation", e.target.value)}><option value="novo_contrato">{T("energy.option.newContract")}</option><option value="renovacao">{T("energy.option.renewal")}</option><option value="rescisao">{T("energy.option.termination")}</option></Select></Field>
            <Field label={T("energy.field.netSaving")} hint={T("energy.field.cents")}><Input type="number" value={form.netSaving} onChange={(e) => set("netSaving", e.target.value)} /></Field>
          </Layer>
          <Layer title={T("energy.layer.integrity")} note={T("energy.layer.integrityNote")}>
            <div className="rounded border border-line bg-surface-2 px-3 py-2.5 font-mono text-[12px] text-ink-dim">{T("energy.noCommission")}</div>
            <Field label={T("energy.field.payment")}>
              <Select value={form.method || methods[0]?.methodId || ""} onChange={(e) => set("method", e.target.value)}>
                {!methods.length && <option value="">{T("energy.noMethod")}</option>}
                {methods.map((method) => <option key={method.methodId} value={method.methodId}>{method.label}</option>)}
              </Select>
            </Field>
          </Layer>
          {result && <Panel tone={result.tone} className="px-4 py-3 font-mono text-[12.5px]">{result.text}</Panel>}
          <Button disabled={busy || !methods.length} type="submit">{busy ? T("energy.issuing") : T("energy.issue.button")}</Button>
        </div>
        <aside className="h-fit rounded-lg border border-wait-line bg-wait-bg p-5">
          <Label>{T("energy.notIncluded.title")}</Label>
          <p className="mt-2 font-sans text-[15px] font-semibold text-wait-ink">{T("energy.notIncluded.lead")}</p>
          <ul className="mt-3 space-y-2 font-sans text-[13px] leading-relaxed text-wait-ink">
            {T("energy.notIncluded.items").map((item) => <li key={item}>• {item}</li>)}
          </ul>
        </aside>
      </form>
    </>
  );
}

const toneFor = (decision) => decision === "valido" || decision === "allowed" ? "allow" : decision === "escalado" || decision === "escalate" ? "wait" : "deny";

/**
 * A curva de mercado — a alavanca que se entrega ao juiz.
 *
 * A tela existe para tornar VISÍVEL o que o número faz.  Um campo de input
 * solto não diz nada; ao lado do teto relativo do mandato, ele vira a frase
 * inteira: "2% abaixo desta curva significa, hoje, no máximo R$ X/MWh".  É
 * onde se vê que o limite não é um número congelado — é uma função do mercado,
 * lida no instante da decisão.
 */
export function Curves({ locale, curves, reload, mandate }) {
  const T = (key) => t(locale, key);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(null);

  // O teto relativo que este mandato impõe, se houver: é ele que dá sentido
  // ao número da curva.
  const floorPct =
    mandate?.constraints?.find((c) => c.attr === "desconto_vs_curva_pct" && c.op === "gte")?.value ?? null;

  const save = async (curve) => {
    setBusy(curve.submercado);
    try {
      const brl = Number(values[curve.submercado] ?? curve.precoBrlMwh / 100);
      await api.updateCurve(curve.submercado, Math.round(brl * 100), locale);
      await reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <ScreenHead title={T("energy.curve.title")} note={T("energy.curve.note")} />

      {curves.length === 0 ? (
        <Panel>
          <Empty>{T("energy.curve.empty")}</Empty>
        </Panel>
      ) : (
        <div className="grid gap-4">
          {curves.map((curve) => {
            const draft = values[curve.submercado];
            const live = curve.precoBrlMwh / 100;
            const shown = draft === undefined ? live : Number(draft);
            const dirty = draft !== undefined && Number(draft) !== live;
            // O que a curva de HOJE deixa passar, dado o teto do mandato.
            const qualifies = floorPct == null ? null : shown * (1 - floorPct / 100);

            return (
              <Panel key={`${curve.submercado}:${curve.periodo}`}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
                  <div className="flex items-baseline gap-3">
                    <h3 className="font-sans text-[15px] font-semibold tracking-tight text-ink">
                      {curve.submercado}
                    </h3>
                    <span className="font-mono text-[12px] text-ink-faint">{curve.periodo}</span>
                  </div>
                  <Chip tone={dirty ? "wait" : "brand"} dot>
                    {dirty ? T("energy.curve.unsaved") : T("energy.curve.live")}
                  </Chip>
                </div>

                <div className="grid gap-6 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div>
                    <Label>{T("energy.curve.value")}</Label>
                    <div className="mt-2 flex items-end gap-3">
                      <span className="font-mono text-[15px] text-ink-faint">R$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={shown}
                        onChange={(e) =>
                          setValues((old) => ({ ...old, [curve.submercado]: e.target.value }))
                        }
                        className="tnum w-44 border-0 border-b-2 border-line-strong bg-transparent pb-1 font-mono text-[34px] font-medium tracking-tight text-ink outline-none transition focus:border-brand"
                      />
                      <span className="pb-2 font-sans text-[13px] text-ink-faint">/MWh</span>
                    </div>

                    <div className="mt-4 flex items-center gap-3">
                      <Button onClick={() => save(curve)} disabled={busy === curve.submercado || !dirty}>
                        {busy === curve.submercado ? T("energy.curve.saving") : T("energy.curve.save")}
                      </Button>
                      {dirty && (
                        <button
                          onClick={() => setValues((old) => ({ ...old, [curve.submercado]: undefined }))}
                          className="font-sans text-[12.5px] text-ink-faint transition hover:text-ink"
                        >
                          {T("energy.curve.reset")}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* O que o número significa para o mandato em vigor. */}
                  <div className="rounded-xl border border-brand-line bg-brand-soft px-4 py-4">
                    <Label>{T("energy.curve.meaning")}</Label>
                    {qualifies == null ? (
                      <p className="mt-2 font-mono text-[12px] leading-relaxed text-ink-dim">
                        {T("energy.curve.noMandate")}
                      </p>
                    ) : (
                      <>
                        <p className="tnum mt-2 font-mono text-[22px] font-medium tracking-tight text-brand-ink">
                          R$ {qualifies.toFixed(2)}
                          <span className="ml-1 font-sans text-[12px] font-normal">/MWh</span>
                        </p>
                        <p className="mt-2 font-mono text-[11px] leading-relaxed text-ink-dim">
                          {T("energy.curve.explain").replace("{pct}", floorPct)}
                        </p>
                      </>
                    )}
                  </div>
                </div>

                <div className="border-t border-line bg-surface-2 px-5 py-3">
                  <p className="font-mono text-[11px] leading-relaxed text-ink-faint">
                    {T("energy.curve.oracle")}
                  </p>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}

export default { Issuer, Curves };
