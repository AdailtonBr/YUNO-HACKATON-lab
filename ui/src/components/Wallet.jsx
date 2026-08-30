/**
 * As contas de liquidação da empresa.
 *
 * Faz parte da Trusted Surface, e pela mesma razão dela: a credencial crua
 * entra **aqui**, com o humano presente, e não volta.  Esta tela lista
 * rótulos — `financeiro@aurora.com.br`, `•••• 4242` — nunca a credencial.
 *
 * É a única tela que PROVA, e não afirma, o "sem entregar o cartão cru" do
 * enunciado: o dado sensível atravessa esta caixa uma vez, vira um
 * `paymentMethodRef` opaco, e a partir daí nem o agente nem a comercializadora
 * voltam a vê-lo.  Quem traduz o id no ponteiro que cobra é a Autoridade, no
 * instante em que você autoriza um mandato.
 *
 * O agente enxerga exatamente o que esta tela mostra: que existe uma conta
 * chamada `financeiro@aurora.com.br`.  Ele não conhece a chave, e não conhece
 * o ponteiro — e há um teste que lê o código dele para garantir isso.
 *
 * Sem painel de endereços, de propósito: energia não se entrega num endereço.
 * O mandato de suprimento nasce com `shippingAddressId: null`, e as rotas
 * `/wallet/addresses` seguem de pé para quem precisar delas noutra vertical.
 */

import { useState } from "react";
import { api } from "../api.js";
import { t } from "../i18n.js";
import { Button, Chip, Empty, Field, Input, Label, Mono, Panel, ScreenHead, Select } from "./ui.jsx";

export default function Wallet({ locale, methods, reload }) {
  const T = (key) => t(locale, key);
  const [busy, setBusy] = useState(null);
  const [conta, setConta] = useState({
    rail: "pix",
    number: "4242424242424242",
    key: "financeiro@aurora.com.br",
  });

  const add = async () => {
    setBusy("add");
    try {
      await api.addMethod(
        conta.rail,
        conta.rail === "card" ? { number: conta.number, exp: "12/29" } : { key: conta.key },
        locale
      );
      await reload();
    } finally {
      setBusy(null);
    }
  };

  const remove = (id) => async () => {
    setBusy(id);
    try {
      await api.removeMethod(id, locale);
      await reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <ScreenHead title={T("wallet.title")} note={T("wallet.note")} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          {/* -------------------------- as contas -------------------------- */}
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <h3 className="font-sans text-[15px] font-semibold tracking-tight text-ink">
                  {T("wallet.methods")}
                </h3>
                <p className="mt-1 font-sans text-[12.5px] leading-relaxed text-ink-dim">
                  {T("wallet.methodsNote")}
                </p>
              </div>
              <Chip tone={methods.length ? "brand" : "mute"} dot>
                {methods.length}
              </Chip>
            </div>

            {methods.length === 0 ? (
              <Empty>{T("wallet.noMethods")}</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {methods.map((method) => (
                  <li key={method.methodId} className="flex items-center justify-between gap-4 px-5 py-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5">
                        <Chip tone="mute">{method.rail}</Chip>
                        <span className="truncate font-mono text-[14px] text-ink">{method.label}</span>
                      </div>
                      {/* O id que a UI e o agente veem.  O ponteiro nao esta aqui. */}
                      <p className="mt-1.5">
                        <Mono value={method.methodId} copy />
                      </p>
                    </div>
                    <Button variant="refuse" onClick={remove(method.methodId)} disabled={busy !== null}>
                      {T("wallet.remove")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="border-t border-line bg-surface-2 px-5 py-3">
              <p className="font-mono text-[11px] leading-relaxed text-ink-faint">{T("wallet.footer")}</p>
            </div>
          </Panel>

          {/* ----------------------- cadastrar conta ----------------------- */}
          <Panel>
            <div className="border-b border-line px-5 py-4">
              <h3 className="font-sans text-[15px] font-semibold tracking-tight text-ink">
                {T("wallet.add.title")}
              </h3>
              <p className="mt-1 font-sans text-[12.5px] leading-relaxed text-ink-dim">
                {T("wallet.add.note")}
              </p>
            </div>

            <div className="grid gap-4 px-5 py-5 sm:grid-cols-[130px_minmax(0,1fr)]">
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

            <div className="border-t border-line px-5 py-4">
              <Button onClick={add} disabled={busy !== null}>
                {busy === "add" ? T("wallet.adding") : T("wallet.addMethod")}
              </Button>
            </div>
          </Panel>
        </div>

        {/*
         * O que NUNCA fica guardado aqui.
         *
         * Mesmo tom do painel "o que nao esta neste mandato", porque e a mesma
         * natureza: uma afirmacao de limite.  A tela ganha mais dizendo o que
         * se recusa a saber do que listando o que sabe.
         */}
        <aside className="h-fit rounded-lg border border-wait-line bg-wait-bg p-5">
          <Label>{T("wallet.notStored")}</Label>
          <p className="mt-2 font-sans text-[15px] font-semibold text-wait-ink">{T("wallet.notStoredLead")}</p>
          <ul className="mt-3 space-y-2 font-sans text-[13px] leading-relaxed text-wait-ink">
            <li>• {T("wallet.notStored1")}</li>
            <li>• {T("wallet.notStored2")}</li>
            <li>• {T("wallet.notStored3")}</li>
          </ul>
        </aside>
      </div>
    </>
  );
}
