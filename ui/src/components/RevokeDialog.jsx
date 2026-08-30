/**
 * Diálogo de revogação.
 *
 * Revogar é irreversível e encerra o mandato, então a caixa faz três coisas
 * que uma confirmação genérica não faria: diz **o que exatamente será
 * encerrado**, exige o humano digitar a confirmação (evita o clique reflexo),
 * e avisa que o ato fica registrado no trilho.
 *
 * O que ela NÃO faz é decidir qualquer coisa: quem revoga é a Autoridade,
 * quando o humano confirma.  Esta tela só coleta a intenção.
 */

import { useEffect, useState } from "react";
import { t } from "../i18n.js";
import { Button, Label, Mono } from "./ui.jsx";

export default function RevokeDialog({ locale, mandate, descendants = [], onClose, onConfirm }) {
  const T = (k) => t(locale, k);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  // A fricção é proposital — revogar é irreversível, e um clique reflexo não
  // deve bastar.  Mas ela tem que ser VENCÍVEL: a versão anterior pedia o id
  // truncado enquanto o botão de copiar ao lado copiava o id inteiro, então
  // copiar-e-colar (a ação óbvia) deixava o botão cinza para sempre.
  const shortId = mandate?.mandateId?.slice(0, 12) ?? "";
  const phrase = `REVOKE ${shortId}`;

  // Aceita a forma curta OU o id inteiro, sem depender de caixa nem de espaço
  // sobrando.  Quem quis revogar demonstrou intenção nas duas formas.
  const normalize = (v) => v.trim().replace(/\s+/g, " ").toLowerCase();
  const matches =
    normalize(typed) === normalize(phrase) ||
    normalize(typed) === normalize(`REVOKE ${mandate?.mandateId ?? ""}`);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mandate) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      {/*
        * A caixa nunca passa da tela, e o CORPO e que rola -- nao a caixa.
        *
        * Sem teto de altura ela crescia com o conteudo (a lista da cascata pode
        * ter varios filhos) e empurrava o rodape para fora da janela: o botao
        * de confirmar ficava inalcancavel, e so dava para clicar diminuindo o
        * zoom do navegador.  Num dialogo de acao irreversivel, o botao sumir e
        * o pior lugar possivel para um bug de layout.
        *
        * `dvh` e nao `vh` porque no celular a barra do navegador entra na
        * conta.  O `-2rem` desconta o respiro do overlay.  E o `min-h-0` no
        * corpo nao e enfeite: sem ele o filho flex se recusa a encolher, e a
        * rolagem simplesmente nao acontece.
        */}
      <div
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-4 bg-red-700 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 bg-surface" />
            <h2 className="font-sans text-[15px] font-semibold text-white">{T("revoke.title")}</h2>
          </div>
          <span className="font-mono text-[11.5px] text-red-100">{mandate.mandateId.slice(0, 16)}…</span>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <p className="font-sans text-[14px] leading-relaxed text-ink-dim">{T("revoke.lead")}</p>

          <div>
            <Label>{T("revoke.whatEnds")}</Label>
            <ul className="mt-2 space-y-1.5">
              {[
                T("revoke.item1"),
                T("revoke.item2"),
                T("revoke.item3"),
                T("revoke.item4"),
              ].map((line, i) => (
                <li key={i} className="flex gap-2.5 font-mono text-[12.5px] leading-relaxed text-ink-dim">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-red-600" />
                  {line}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded border border-line bg-surface-2 px-4 py-3">
            <Label>{T("revoke.mandate")}</Label>
            <p className="mt-1 font-sans text-[13.5px] leading-relaxed text-ink">{mandate.humanReadable}</p>
            <p className="mt-2">
              <Mono value={mandate.mandateId} copy />
            </p>
          </div>

          {descendants.length > 0 && (
            <div className="rounded border border-wait-line bg-wait-bg px-4 py-3">
              <Label>{T("revoke.cascadeTitle")}</Label>
              <p className="mt-1 font-sans text-[13px] text-wait-ink">{T("revoke.cascadeLead").replace("{n}", descendants.length)}</p>
              <ul className="mt-2 space-y-1 font-mono text-[11.5px] text-wait-ink">
                {descendants.map((child) => <li key={child.mandateId}>↳ {child.humanReadable ?? child.mandateId}</li>)}
              </ul>
            </div>
          )}

          <div>
            <Label>{T("revoke.typeToConfirm")}</Label>
            {/* A frase exigida fica VISÍVEL e selecionável, não só de placeholder:
                o humano não deveria ter que adivinhar o formato. */}
            <p className="mt-1.5 select-all rounded border border-line bg-surface-2 px-3 py-2 font-mono text-[13px] text-ink-dim">
              {phrase}
            </p>
            <div className="mt-2 flex items-center gap-3">
              {/*
                * Sem `autoFocus`, de proposito.
                *
                * Agora que o corpo rola, focar o campo puxava a rolagem ate o
                * fim e a caixa abria no rodape -- pulando exatamente a lista
                * do que sera encerrado.  A friccao desta tela existe para ser
                * lida; abrir no ultimo passo a anula.
                */}
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={phrase}
                className="w-full rounded border border-line-strong bg-surface px-3 py-2.5 font-mono text-[14px] tracking-wide text-ink outline-none focus:border-deny-line focus:ring-2 focus:ring-deny-line"
              />
              {matches && (
                <span className="shrink-0 font-mono text-[12px] font-medium text-allow-ink">
                  {T("revoke.matches")}
                </span>
              )}
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-2 px-5 py-3.5">
          <p className="font-mono text-[11.5px] text-ink-dim">{T("revoke.logged")}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {T("revoke.cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={!matches || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  onClose();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? T("revoke.revoking") : T("revoke.confirm")}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
