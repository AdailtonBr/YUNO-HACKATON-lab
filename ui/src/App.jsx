import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { t } from "./i18n.js";
import Shell from "./components/Shell.jsx";
import RevokeDialog from "./components/RevokeDialog.jsx";
import ApprovalQueue from "./components/ApprovalQueue.jsx";
import Mandates from "./components/Mandates.jsx";
import AuditTrail from "./components/AuditTrail.jsx";
import EnergyPortal from "./components/EnergyPortal.jsx";
import DailyCycle from "./components/DailyCycle.jsx";
import Wallet from "./components/Wallet.jsx";

const POLL_MS = 5000;

/**
 * O tema.
 *
 * A escolha da pessoa vence; sem escolha, obedecemos ao sistema.  Um portal de
 * mesa de operação é olhado por horas, e impor claro a quem configurou o
 * sistema inteiro em escuro é uma decisão que não é nossa para tomar.
 *
 * Lido de forma sincrona ANTES do primeiro paint, e com `try` porque em janela
 * anonima o acesso ao storage pode simplesmente lancar.
 */
const readTheme = () => {
  try {
    const saved = localStorage.getItem("charter.theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch {}
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

export default function App() {
  const [locale, setLocale] = useState("en");
  const [theme, setTheme] = useState(readTheme);
  const [tab, setTab] = useState("issue");
  const [mandates, setMandates] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [trail, setTrail] = useState([]);
  const [methods, setMethods] = useState([]);
  const [curves, setCurves] = useState([]);
  const [cycle, setCycle] = useState(null);
  const [revoking, setRevoking] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [err, setErr] = useState(null);

  const reload = useCallback(async () => {
    try {
      const [m, a, tr, pm, curveResult, cycleResult] = await Promise.all([
        api.mandates(locale),
        api.approvals(locale),
        api.audit(null, locale),
        api.methods(locale),
        api.curves(locale).catch(() => []),
        // Esta leitura pertence ao ciclo da Frente C. A indisponibilidade dele
        // nao pode impedir o gestor de revogar ou emitir um mandato.
        api.dailyCycle(locale).catch(() => null),
      ]);
      setMandates(m);
      setApprovals(a);
      setTrail(tr);
      setMethods(pm);
      setCurves(Array.isArray(curveResult) ? curveResult : curveResult?.curves ?? []);
      setCycle(cycleResult);
      setErr(null);
    } catch {
      setErr(t(locale, "errors.authorityDown"));
    }
  }, [locale]);

  useEffect(() => { reload(); }, [reload]);

  /**
   * O tema vive no `<html>`, e não num contexto de React: o fundo da página é
   * pintado antes de qualquer componente montar.
   *
   * A transição é ligada só DURANTE a troca (`theme-switching`) e desligada
   * depois — e nunca na primeira montagem, senão a página nasce se colorindo.
   */
  const firstPaint = useRef(true);
  useEffect(() => {
    const root = document.documentElement;
    if (firstPaint.current) {
      firstPaint.current = false;
      root.dataset.theme = theme;
      return;
    }
    root.classList.add("theme-switching");
    root.dataset.theme = theme;
    try { localStorage.setItem("charter.theme", theme); } catch {}
    const id = setTimeout(() => root.classList.remove("theme-switching"), 220);
    return () => clearTimeout(id);
  }, [theme]);

  const busyRef = useRef(false);
  useEffect(() => {
    const tick = async () => {
      if (document.hidden || busyRef.current) return;
      busyRef.current = true;
      try { await reload(); } finally { busyRef.current = false; }
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [reload]);

  const usable = mandates.filter((m) => m.status === "active");
  const focused = mandates.find((m) => m.mandateId === selectedId) ?? usable[0] ?? null;
  const descendantsOf = (rootId) => {
    const result = [];
    const visit = (parentId) => mandates.filter((m) => m.parentMandateId === parentId).forEach((child) => {
      result.push(child);
      visit(child.mandateId);
    });
    visit(rootId);
    return result;
  };
  const wasFocused = useRef({ id: null, status: null });
  useEffect(() => {
    const before = wasFocused.current;
    const next = { id: focused?.mandateId ?? null, status: focused?.status ?? null };
    wasFocused.current = next;
    if (before.id === next.id && before.status === "active" && next.status && next.status !== "active") {
      setSelectedId(null);
    }
  }, [focused?.mandateId, focused?.status]);

  return (
    <>
      <Shell
        locale={locale}
        setLocale={setLocale}
        theme={theme}
        setTheme={setTheme}
        curve={curves[0] ?? null}
        tab={tab}
        setTab={setTab}
        mandate={focused}
        mandates={mandates}
        usable={usable}
        onSelectMandate={setSelectedId}
        counts={{ approvals: approvals.length }}
        onRevoke={() => focused && setRevoking(focused)}
      >
        {err && <div className="mb-5 rounded border border-deny-line bg-deny-bg px-4 py-3 font-mono text-[12.5px] text-deny-ink">{err}</div>}

        {tab === "wallet" && <Wallet locale={locale} methods={methods} reload={reload} />}
        {tab === "issue" && <EnergyPortal.Issuer locale={locale} methods={methods} reload={reload} />}
        {tab === "cycle" && <DailyCycle locale={locale} cycle={cycle} trail={trail} />}
        {tab === "approvals" && <ApprovalQueue locale={locale} approvals={approvals} reload={reload} />}
        {tab === "mandates" && (
          <Mandates
            locale={locale}
            mandates={mandates}
            selectedId={focused?.mandateId}
            onSelect={(id) => { setSelectedId(id); setTab("mandates"); }}
            onRevoke={setRevoking}
          />
        )}
        {tab === "curve" && <EnergyPortal.Curves locale={locale} curves={curves} reload={reload} mandate={focused} />}
        {tab === "audit" && <AuditTrail locale={locale} trail={trail} />}
      </Shell>

      {revoking && (
        <RevokeDialog
          locale={locale}
          mandate={revoking}
          descendants={descendantsOf(revoking.mandateId)}
          onClose={() => setRevoking(null)}
          onConfirm={async () => { await api.revoke(revoking.mandateId, locale); await reload(); }}
        />
      )}
    </>
  );
}
