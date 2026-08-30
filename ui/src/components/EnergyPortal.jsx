import { useMemo, useState } from "react";
import { AGENT_ID, api, money } from "../api.js";
import { DECISION_LABEL, t } from "../i18n.js";
import { Button, Chip, Empty, Field, Input, Label, Panel, ScreenHead, Select } from "./ui.jsx";

const policy = (attr, op, value, onFail = "deny") => ({ attr, op, value, on_missing: "deny", on_fail: onFail });
const asNumber = (value) => Number(value || 0);

function Layer({ title, note, children }) {
  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-stone-200 bg-stone-50 px-4 py-2.5">
        <h2 className="font-sans text-[14px] font-semibold text-stone-900">{title}</h2>
        <p className="mt-0.5 font-mono text-[11.5px] text-stone-500">{note}</p>
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
    netSaving: 5000000, uses: 2,
    // Vazio, e vazio de proposito.
    //
    // Antes isto era `methods[0]?.methodId`, avaliado na montagem -- quando a
    // carteira ainda nao tinha carregado.  O campo ficava "" para sempre, o
    // select EXIBIA a primeira conta como se estivesse escolhida, e o envio
    // usava a primeira conta.  Com duas cadastradas, o mandato saia pagando
    // pela que ninguem apontou.
    //
    // Com que dinheiro se paga e decisao do humano.  E a mesma regra que o
    // `docs/ARCHITECTURE.md` impoe ao agente ("o agente nao escolhe como voce paga"), e o
    // Portal nao pode ser a porta dos fundos dela.
    method: "",
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const set = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));

  const draft = useMemo(() => ({
    agentId: AGENT_ID,
    mode: "autonomo",
    currency: "BRL",
    // Sem `|| methods[0]`: uma escolha que ninguem fez nao e uma escolha.
    paymentMethodId: form.method,
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
            <div className="rounded border border-stone-200 bg-stone-50 px-3 py-2.5 font-mono text-[12px] text-stone-600">{T("energy.guarantee")}</div>
          </Layer>
          <Layer title={T("energy.layer.governance")} note={T("energy.layer.governanceNote")}>
            <Field label={T("energy.field.operation")}><Select value={form.operation} onChange={(e) => set("operation", e.target.value)}><option value="novo_contrato">{T("energy.option.newContract")}</option><option value="renovacao">{T("energy.option.renewal")}</option><option value="rescisao">{T("energy.option.termination")}</option></Select></Field>
            <Field label={T("energy.field.netSaving")} hint={T("energy.field.cents")}><Input type="number" value={form.netSaving} onChange={(e) => set("netSaving", e.target.value)} /></Field>
          </Layer>
          <Layer title={T("energy.layer.integrity")} note={T("energy.layer.integrityNote")}>
            <div className="rounded border border-stone-200 bg-stone-50 px-3 py-2.5 font-mono text-[12px] text-stone-600">{T("energy.noCommission")}</div>
            <Field label={T("energy.field.payment")}>
              <Select value={form.method} onChange={(e) => set("method", e.target.value)}>
                <option value="">{methods.length ? T("energy.chooseMethod") : T("energy.noMethod")}</option>
                {methods.map((method) => <option key={method.methodId} value={method.methodId}>{method.label}</option>)}
              </Select>
            </Field>
          </Layer>
          {result && <Panel tone={result.tone} className="px-4 py-3 font-mono text-[12.5px]">{result.text}</Panel>}
          <Button disabled={busy || !methods.length || !form.method} type="submit">{busy ? T("energy.issuing") : T("energy.issue.button")}</Button>
          {methods.length > 0 && !form.method && (
            <p className="font-mono text-[11.5px] text-stone-500">{T("energy.chooseMethodHint")}</p>
          )}
        </div>
        <aside className="h-fit rounded-lg border border-amber-200 bg-amber-50 p-5">
          <Label>{T("energy.notIncluded.title")}</Label>
          <p className="mt-2 font-sans text-[15px] font-semibold text-amber-950">{T("energy.notIncluded.lead")}</p>
          <ul className="mt-3 space-y-2 font-sans text-[13px] leading-relaxed text-amber-900">
            {T("energy.notIncluded.items").map((item) => <li key={item}>• {item}</li>)}
          </ul>
        </aside>
      </form>
    </>
  );
}

const toneFor = (decision) =>
  decision === "valido" || decision === "allowed" || decision === "eligible" ? "allow"
    : decision === "escalado" || decision === "escalate" ? "wait"
    : "deny";

/**
 * Por que esta oferta caiu — a regra que decidiu, com o valor que veio.
 *
 * A ordem nao e arbitraria: uma REGRA DURA violada e o motivo real da recusa;
 * uma escalada e "cabe, mas precisa de gente"; um atributo desconhecido e o
 * o on_missing mordendo. Mostrar a primeira dura antes da escalada evita dizer
 * "precisa de aprovacao" sobre uma oferta que ja estava fora do mandato.
 */
function motivoDaOferta(offer, locale) {
  const pt = locale === "pt";
  const mostra = (v) => (Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? String(v) : v);
  const regra = offer.failures?.[0] ?? offer.escalations?.[0] ?? offer.unknowns?.[0];
  if (!regra) return pt ? "passa em todas as regras" : "passes every rule";
  if (regra.actual == null) {
    return pt
      ? `${regra.attr}: nao informado`
      : `${regra.attr}: not reported`;
  }
  return `${regra.attr} ${regra.op} ${mostra(regra.value)} — ${pt ? "veio" : "got"} ${mostra(regra.actual)}`;
}

export function DailyCycle({ locale, cycle, trail }) {
  const T = (key) => t(locale, key);
  const snapshot = cycle?.cycle ?? cycle;

  /*
   * As ofertas vivem sob `mandates[].offers` -- uma avaliacao por mandato.
   *
   * Esta tela e escrita contra um formato que o ciclo nao produzia, e o
   * fallback para o trilho escondia isso: ela mostrava o que JA tinha sido
   * decidido, nao o que o agente considerou.  A diferenca e o produto: a
   * tabela completa, com as nove ofertas e o porque de cada recusa, e onde o
   * raciocinio aparece.  O trilho continua sendo o fallback quando ainda nao
   * houve ciclo nenhum.
   */
  const doCiclo = (snapshot?.mandates ?? []).flatMap((run) =>
    (run.offers ?? []).map((offer) => ({
      ...offer,
      decision: offer.verdict,
      reasonText: motivoDaOferta(offer, locale),
    }))
  );
  const offers = doCiclo.length ? doCiclo : snapshot?.offers ?? snapshot?.comparison ?? [];
  const visibleOffers = offers.length ? offers : trail.filter((entry) => entry.event === "purchase_decision").map((entry) => ({
    name: entry.purchase?.name ?? entry.purchase?.productId,
    merchantId: entry.merchantId,
    price: entry.purchase?.price,
    currency: entry.purchase?.currency,
    decision: entry.decision,
    reasonText: entry.reasonText,
  }));
  return (
    <>
      <ScreenHead title={T("energy.cycle.title")} note={snapshot?.window ?? T("energy.cycle.note")} />
      <Panel className="overflow-hidden">
        {visibleOffers.length === 0 ? <Empty>{T("energy.cycle.empty")}</Empty> : <div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b border-stone-200 bg-stone-50 text-left"><th className="px-4 py-2.5"><Label>{T("energy.cycle.offer")}</Label></th><th className="px-3 py-2.5"><Label>{T("energy.cycle.merchant")}</Label></th><th className="px-3 py-2.5"><Label>{T("energy.cycle.price")}</Label></th><th className="px-3 py-2.5"><Label>{T("energy.cycle.outcome")}</Label></th><th className="px-3 py-2.5"><Label>{T("energy.cycle.reason")}</Label></th></tr></thead><tbody>{visibleOffers.map((entry, index) => {
          const offer = entry.offer ?? entry.item ?? entry;
          const decision = entry.decision ?? entry.verdict ?? entry.result?.decision ?? "recusado";
          return <tr key={offer.productId ?? index} className="border-b border-stone-100 last:border-0"><td className="px-4 py-3 font-sans text-[13px] text-stone-900">{offer.name ?? offer.productId}</td><td className="px-3 py-3 font-mono text-[12px] text-stone-600">{offer.merchantId ?? offer.merchant ?? entry.merchantId}</td><td className="px-3 py-3 font-mono text-[12px]">{offer.price == null ? "—" : money(offer.price, offer.currency ?? "BRL", locale)}</td><td className="px-3 py-3"><Chip tone={toneFor(decision)} dot>{DECISION_LABEL[locale]?.[decision] ?? decision}</Chip></td><td className="px-3 py-3 font-sans text-[12.5px] text-stone-600">{entry.reasonText ?? entry.reason ?? entry.result?.reasonText ?? "—"}</td></tr>;
        })}</tbody></table></div>}
      </Panel>
    </>
  );
}

export function Curves({ locale, curves, reload }) {
  const T = (key) => t(locale, key);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(null);
  const save = async (curve) => {
    setBusy(curve.submercado);
    try {
      const brl = Number(values[curve.submercado] ?? curve.precoBrlMwh / 100);
      await api.updateCurve(curve.submercado, Math.round(brl * 100), locale);
      await reload();
    } finally { setBusy(null); }
  };
  return <><ScreenHead title={T("energy.curve.title")} note={T("energy.curve.note")} />
    <div className="space-y-3">{curves.length === 0 ? <Panel><Empty>{T("energy.curve.empty")}</Empty></Panel> : curves.map((curve) => <Panel key={`${curve.submercado}:${curve.periodo}`} className="flex flex-wrap items-end gap-3 p-4"><div className="min-w-36 flex-1"><Label>{T("energy.field.submarket")}</Label><p className="mt-1 font-mono text-[15px] text-stone-900">{curve.submercado} · {curve.periodo}</p></div><Field label={T("energy.curve.value")}><Input type="number" step="0.01" value={values[curve.submercado] ?? curve.precoBrlMwh / 100} onChange={(e) => setValues((old) => ({ ...old, [curve.submercado]: e.target.value }))} /></Field><Button onClick={() => save(curve)} disabled={busy === curve.submercado}>{busy === curve.submercado ? T("energy.curve.saving") : T("energy.curve.save")}</Button></Panel>)}</div>
  </>;
}

export default { Issuer, DailyCycle, Curves };
