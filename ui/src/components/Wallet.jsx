/**
 * As contas de liquidação da empresa.
 *
 * Faz parte da Trusted Surface, e pela mesma razão dela: o instrumento cru
 * entra **aqui**, com o humano presente, e não volta.  Esta tela lista
 * rótulos — `financeiro@aurora.com.br`, `•••• 4242` — nunca a credencial.
 *
 * É a única tela que prova, e não afirma, o "sem entregar o cartão cru" do
 * enunciado: o dado sensível atravessa esta caixa uma vez, vira um
 * `paymentMethodRef` opaco, e a partir daí nem o agente nem a comercializadora
 * voltam a vê-lo.  Quem traduz o id no ponteiro que cobra é a Autoridade, no
 * instante em que você autoriza um mandato.
 *
 * O agente enxerga exatamente o que esta tela mostra: que existe uma conta
 * chamada `financeiro@aurora.com.br`.  Ele não conhece a chave, e não conhece
 * o ponteiro.
 *
 * Sem painel de endereços, de propósito: energia não se entrega num endereço.
 * O mandato de suprimento nasce com `shippingAddressId: null`, e as rotas
 * `/wallet/addresses` seguem de pé para quem precisar delas noutra vertical.
 */

import { useState } from "react";
import { api } from "../api.js";
import { t } from "../i18n.js";
import { Button, Chip, Field, Input, Label, Panel, PanelHead, ScreenHead, Select, Empty, Mono } from "./ui.jsx";

export default function Wallet({ locale, methods, reload }) {
  const T = (k) => t(locale, k);
  const [busy, setBusy] = useState(false);
  const [conta, setConta] = useState({ rail: "pix", number: "4242424242424242", key: "financeiro@aurora.com.br" });

  const addMethod = async () => {
    setBusy(true);
    try {
      await api.addMethod(
        conta.rail,
        conta.rail === "card" ? { number: conta.number, exp: "12/29" } : { key: conta.key },
        locale
      );
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const remove = (id) => async () => {
    setBusy(true);
    try {
      await api.removeMethod(id, locale);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ScreenHead title={T("wallet.title")} note={T("wallet.note")} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel>
          <PanelHead title={T("wallet.methods")} note={T("wallet.methodsNote")} />

          {methods.length === 0 ? (
            <Empty>{T("wallet.noMethods")}</Empty>
          ) : (
            <ul className="divide-y divide-stone-100">
              {methods.map((m) => (
                <li key={m.methodId} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Chip tone={m.rail === "card" ? "allow" : "wait"}>{m.rail}</Chip>
                      <span className="font-mono text-[14px] text-stone-900">{m.label}</span>
                    </div>
                    <p className="mt-1">
                      <Mono value={m.methodId} />
                    </p>
                  </div>
                  <Button variant="refuse" onClick={remove(m.methodId)} disabled={busy}>
                    {T("wallet.remove")}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-3 border-t border-stone-200/70 px-5 py-4">
            <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
              <Field label={T("wallet.rail")}>
                <Select value={conta.rail} onChange={(e) => setConta({ ...conta, rail: e.target.value })}>
                  <option value="pix">pix</option>
                  <option value="card">card</option>
                </Select>
              </Field>
              {conta.rail === "card" ? (
                <Field label={T("wallet.cardNumber")} hint={T("wallet.rawHint")}>
                  <Input value={conta.number} onChange={(e) => setConta({ ...conta, number: e.target.value })} />
                </Field>
              ) : (
                <Field label={T("wallet.pixKey")} hint={T("wallet.rawHint")}>
                  <Input value={conta.key} onChange={(e) => setConta({ ...conta, key: e.target.value })} />
                </Field>
              )}
            </div>
            <Button onClick={addMethod} disabled={busy} className="w-full">
              {T("wallet.addMethod")}
            </Button>
          </div>
        </Panel>

        {/* O que NÃO fica guardado aqui — o contraponto do painel do mandato. */}
        <aside className="h-fit rounded border border-amber-200/70 bg-amber-50/40 px-5 py-4">
          <Label>{T("wallet.notStored")}</Label>
          <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-stone-700">
            <li>• {T("wallet.notStored1")}</li>
            <li>• {T("wallet.notStored2")}</li>
            <li>• {T("wallet.notStored3")}</li>
          </ul>
        </aside>
      </div>

      <p className="mt-4 font-mono text-[11.5px] text-stone-500">{T("wallet.footer")}</p>
    </>
  );
}
