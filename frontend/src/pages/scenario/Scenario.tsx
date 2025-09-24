// frontend/src/pages/Scenario/Scenario.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiGet, ApiError } from "../../lib/api";

// Tabs
import BOQTable from "../scenario/components/BOQTable";
import TWCTab from "../scenario/tabs/TWCTab";
import CapexTable from "../scenario/components/CapexTable";
import ServicesTable from "../scenario/components/ServicesTable";
// NEW: FX & TAX
import FxTab from "../scenario/tabs/FXTab";
import TaxTab from "../scenario/tabs/TaxTab";
// NEW: Escalation (preview)
import EscalationTab from "../scenario/tabs/EscalationTab";

// ---------- Types ----------
type ScenarioDetail = {
  id: number;
  business_case_id: number;
  name: string;
  months: number;
  start_date: string; // ISO
};

type Workflow = {
  scenario_id: number;
  workflow_state?:
    | "draft"
    | "boq_ready"
    | "twc_ready"
    | "capex_ready"
    | "fx_ready"
    | "tax_ready"
    | "services_ready"
    | "ready"
    | string;

  is_boq_ready?: boolean;
  is_twc_ready?: boolean;
  is_capex_ready?: boolean;
  // NEW:
  is_fx_ready?: boolean;
  is_tax_ready?: boolean;
  is_services_ready?: boolean;
};

// ✨ escalation eklendi
type Tab = "pl" | "boq" | "twc" | "capex" | "escalation" | "fx" | "tax" | "services";

// ---------- Utils ----------
function cls(...a: (string | false | undefined)[]) {
  return a.filter(Boolean).join(" ");
}
function fmtDateISO(d: string) {
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return d;
  }
}
function isState(ws: string, key: string) {
  return ws === key || ws === `${key}_ready`;
}
function tabBtnClass(active: boolean, disabled?: boolean) {
  return cls(
    "px-3 py-1 rounded border text-sm transition-colors focus:outline-none",
    active
      ? "bg-indigo-600 text-white border-indigo-600 shadow font-semibold"
      : "bg-gray-100 text-gray-800 border-gray-300 hover:bg-gray-200",
    (!active && disabled) && "opacity-50 cursor-not-allowed"
  );
}

// ======================================================
export default function ScenarioPage() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const id = Number(scenarioId);
  const [sp, setSp] = useSearchParams();

  const [data, setData] = useState<ScenarioDetail | null>(null);
  const [flow, setFlow] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // URL param tab (default: boq)
  const tab = ((sp.get("tab") || "boq").toLowerCase() as Tab) ?? "boq";

  function setTabRaw(next: Tab) {
    setSp(
      (prev) => {
        const ns = new URLSearchParams(prev);
        ns.set("tab", next);
        return ns;
      },
      { replace: true }
    );
  }

  // Escalation serbest; diğerleri workflow guard'lı
  function setTabSafe(next: Tab) {
    if (!flow) {
      setTabRaw(next);
      return;
    }
    if (next === "twc" && !flow.is_boq_ready) {
      alert("Önce 1. BOQ sekmesinde 'Mark Ready' yapmalısınız.");
      return;
    }
    if (next === "capex" && !flow.is_twc_ready) {
      alert("Önce 2. TWC sekmesinde 'Mark Ready' yapmalısınız.");
      return;
    }
    if (next === "fx" && !flow.is_capex_ready) {
      alert("Önce 3. CAPEX sekmesinde 'Mark Ready' yapmalısınız.");
      return;
    }
    if (next === "tax" && !flow.is_fx_ready) {
      alert("Önce 5. FX sekmesinde 'Mark Ready' yapmalısınız.");
      return;
    }
    if (next === "services" && !flow.is_tax_ready) {
      alert("Önce 6. TAX sekmesinde 'Mark Ready' yapmalısınız.");
      return;
    }
    if (next === "pl" && !flow.is_services_ready) {
      alert("Önce 7. SERVICES sekmesinde 'Mark Ready' yapmalısınız.");
      return;
    }
    setTabRaw(next);
  }

  async function loadAll() {
    setLoading(true);
    setErr(null);
    try {
      const [sc, wf] = await Promise.all([
        apiGet<ScenarioDetail>(`/business-cases/scenarios/${id}`),
        apiGet<Workflow>(`/scenarios/${id}/workflow`),
      ]);
      setData(sc);
      setFlow(wf);
    } catch (e: any) {
      const msg =
        (e instanceof ApiError && e.message) ||
        e?.response?.data?.detail ||
        e?.message ||
        "Failed to load scenario.";
      setErr(String(msg));
      setFlow(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (id) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const bcLink = useMemo(
    () => (data ? `/business-cases/${data.business_case_id}` : "#"),
    [data]
  );

  const canGoTWC = !!flow?.is_boq_ready;
  const canGoCAPEX = !!flow?.is_twc_ready;
  const canGoFX = !!flow?.is_capex_ready;
  const canGoTAX = !!flow?.is_fx_ready;
  const canGoSERVICES = !!flow?.is_tax_ready;
  const canGoPL = !!flow?.is_services_ready;

  const ws = (flow?.workflow_state ?? "draft").toString();
  const stateSafe =
    ws === "ready" ? "READY" : ws.replace("_ready", "").toUpperCase();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Scenario</h2>
          {data && (
            <div className="text-sm text-gray-600">
              ID: {data.id} • Name: <span className="font-medium">{data.name}</span>{" "}
              • Months: {data.months} • Start: {fmtDateISO(data.start_date)} • BC:{" "}
              <Link to={bcLink} className="text-indigo-600 underline">
                #{data.business_case_id}
              </Link>
            </div>
          )}
        </div>
        <div className="text-sm">
          {flow && (
            <span
              className={cls(
                "px-2 py-1 rounded font-medium",
                ws === "draft" && "bg-gray-100 text-gray-700",
                isState(ws, "twc") && "bg-amber-100 text-amber-700",
                isState(ws, "capex") && "bg-sky-100 text-sky-700",
                isState(ws, "fx") && "bg-indigo-100 text-indigo-700",
                isState(ws, "tax") && "bg-rose-100 text-rose-700",
                flow.is_tax_ready && !flow.is_services_ready && "bg-purple-100 text-purple-700",
                ws === "ready" && "bg-emerald-100 text-emerald-700"
              )}
              title={`BOQ:${flow.is_boq_ready ? "✓" : "•"}  TWC:${flow.is_twc_ready ? "✓" : "•"}  CAPEX:${flow.is_capex_ready ? "✓" : "•"}  FX:${flow.is_fx_ready ? "✓" : "•"}  TAX:${flow.is_tax_ready ? "✓" : "•"}  SERVICES:${flow.is_services_ready ? "✓" : "•"}`}
            >
              State: {stateSafe}
            </span>
          )}
          <button
            onClick={loadAll}
            className="ml-3 px-3 py-1 rounded bg-gray-100 hover:bg-gray-200"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs — sıra: 1→8 */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setTabSafe("boq")}
          className={tabBtnClass(tab === "boq")}
          title="BOQ (Input)"
        >
          1. BOQ
        </button>

        <button
          onClick={() => setTabSafe("twc")}
          disabled={!canGoTWC}
          className={tabBtnClass(tab === "twc", !canGoTWC)}
          title={!canGoTWC ? "Önce 1. BOQ 'Ready' olmalı" : "TWC (Input)"}
        >
          2. TWC
        </button>

        <button
          onClick={() => setTabSafe("capex")}
          disabled={!canGoCAPEX}
          className={tabBtnClass(tab === "capex", !canGoCAPEX)}
          title={!canGoCAPEX ? "Önce 2. TWC 'Ready' olmalı" : "CAPEX (Input)"}
        >
          3. CAPEX
        </button>

        {/* NEW: Escalation (guard yok) */}
        <button
          onClick={() => setTabRaw("escalation")}
          className={tabBtnClass(tab === "escalation")}
          title="Escalation (Policies preview & resolve)"
        >
          4. Escalation
        </button>

        <button
          onClick={() => setTabSafe("fx")}
          disabled={!canGoFX}
          className={tabBtnClass(tab === "fx", !canGoFX)}
          title={!canGoFX ? "Önce 3. CAPEX 'Ready' olmalı" : "FX (Input)"}
        >
          5. FX
        </button>

        <button
          onClick={() => setTabSafe("tax")}
          disabled={!canGoTAX}
          className={tabBtnClass(tab === "tax", !canGoTAX)}
          title={!canGoTAX ? "Önce 5. FX 'Ready' olmalı" : "TAX (Input)"}
        >
          6. TAX
        </button>

        <button
          onClick={() => setTabSafe("services")}
          disabled={!canGoSERVICES}
          className={tabBtnClass(tab === "services", !canGoSERVICES)}
          title={!canGoSERVICES ? "Önce 6. TAX 'Ready' olmalı" : "Services (Input)"}
        >
          7. SERVICES
        </button>

        <button
          onClick={() => setTabSafe("pl")}
          disabled={!canGoPL}
          className={tabBtnClass(tab === "pl", !canGoPL)}
          title={!canGoPL ? "Önce 7. SERVICES 'Ready' olmalı" : "P&L (Output)"}
        >
          8. P&L
        </button>
      </div>

      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-2 rounded">
          {err}
        </div>
      )}

      {!loading && data && flow && (
        <div className="space-y-4">
          {tab === "boq" && (
            <div className="rounded border p-4 bg-white">
              <BOQTable
                scenarioId={id}
                onChanged={loadAll}
                onMarkedReady={async () => {
                  await loadAll();
                  setTabRaw("twc");
                }}
              />
            </div>
          )}

          {tab === "twc" && (
            <div className="rounded border p-4 bg-white">
              <TWCTab
                scenarioId={id}
                onMarkedReady={async () => {
                  await loadAll();
                  setTabRaw("capex");
                }}
              />
            </div>
          )}

          {tab === "capex" && (
            <div className="rounded border p-4 bg-white">
              <CapexTable
                scenarioId={id}
                onChanged={loadAll}
                onMarkedReady={async () => {
                  await loadAll();
                  setTabRaw("fx"); // workflow değişmedi
                }}
              />
            </div>
          )}

          {/* NEW: Escalation */}
          {tab === "escalation" && (
            <div className="rounded border p-4 bg-white">
              <EscalationTab scenarioId={id} />
            </div>
          )}

          {tab === "fx" && (
            <div className="rounded border p-4 bg-white">
              <FxTab
                scenarioId={id}
                isReady={!!flow.is_fx_ready}
                onMarkedReady={async () => {
                  await loadAll();
                  setTabRaw("tax");
                }}
              />
            </div>
          )}

          {tab === "tax" && (
            <div className="rounded border p-4 bg-white">
              <TaxTab
                scenarioId={id}
                isReady={!!flow.is_tax_ready}
                onMarkedReady={async () => {
                  await loadAll();
                  setTabRaw("services");
                }}
              />
            </div>
          )}

          {tab === "services" && (
            <div className="rounded border p-4 bg-white">
              <ServicesTable
                scenarioId={id}
                isReady={!!flow.is_services_ready}
                onMarkedReady={async () => {
                  await loadAll();
                  setTabRaw("pl");
                }}
              />
            </div>
          )}

          {tab === "pl" && (
            <div className="rounded border p-6 bg-emerald-50/40">
              <h3 className="font-semibold text-lg mb-2">P&L (coming next)</h3>
              <p className="text-sm text-gray-700">
                Workflow “READY” aşamasında bu ekranda P&L özetini ve aylık kırılımı göstereceğiz.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
