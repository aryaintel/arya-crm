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
// NEW: Escalation
import EscalationTab from "../scenario/tabs/EscalationTab";
// NEW: Index Series (global data)
import IndexSeriesTab from "../scenario/tabs/IndexSeriesTab";

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
  is_fx_ready?: boolean;
  is_tax_ready?: boolean;
  is_services_ready?: boolean;
};

// Tabs (Escalation & Index are ungated)
type Tab =
  | "pl"
  | "boq"
  | "twc"
  | "index"
  | "escalation"
  | "capex"
  | "fx"
  | "tax"
  | "services";

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

  // Escalation & Index are always accessible; others are workflow-guarded
  function setTabSafe(next: Tab) {
    if (!flow) {
      setTabRaw(next);
      return;
    }
    if (next === "twc" && !flow.is_boq_ready) {
      alert("First mark 'Ready' in 1. BOQ.");
      return;
    }
    if (next === "capex" && !flow.is_twc_ready) {
      alert("First mark 'Ready' in 2. TWC.");
      return;
    }
    if (next === "fx" && !flow.is_capex_ready) {
      // CAPEX is now step 5 visually, but it must still be Ready before FX.
      alert("First mark 'Ready' in 5. CAPEX.");
      return;
    }
    if (next === "tax" && !flow.is_fx_ready) {
      alert("First mark 'Ready' in 6. FX.");
      return;
    }
    if (next === "services" && !flow.is_tax_ready) {
      alert("First mark 'Ready' in 7. TAX.");
      return;
    }
    if (next === "pl" && !flow.is_services_ready) {
      alert("First mark 'Ready' in 8. SERVICES.");
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

      {/* Tabs — new order:
          1. BOQ, 2. TWC, 3. Index, 4. Escalation, 5. CAPEX, 6. FX, 7. TAX, 8. SERVICES, 9. P&L */}
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
          title={!canGoTWC ? "First complete 1. BOQ → Mark Ready." : "TWC (Input)"}
        >
          2. TWC
        </button>

        {/* NEW: Index (ungated) */}
        <button
          onClick={() => setTabRaw("index")}
          className={tabBtnClass(tab === "index")}
          title="Index Series (Manage time series data)"
        >
          3. Index
        </button>

        {/* NEW: Escalation (ungated) */}
        <button
          onClick={() => setTabRaw("escalation")}
          className={tabBtnClass(tab === "escalation")}
          title="Escalation (Policies & resolve)"
        >
          4. Escalation
        </button>

        <button
          onClick={() => setTabSafe("capex")}
          disabled={!canGoCAPEX}
          className={tabBtnClass(tab === "capex", !canGoCAPEX)}
          title={!canGoCAPEX ? "First complete 2. TWC → Mark Ready." : "CAPEX (Input)"}
        >
          5. CAPEX
        </button>

        <button
          onClick={() => setTabSafe("fx")}
          disabled={!canGoFX}
          className={tabBtnClass(tab === "fx", !canGoFX)}
          title={!canGoFX ? "First complete 5. CAPEX → Mark Ready." : "FX (Input)"}
        >
          6. FX
        </button>

        <button
          onClick={() => setTabSafe("tax")}
          disabled={!canGoTAX}
          className={tabBtnClass(tab === "tax", !canGoTAX)}
          title={!canGoTAX ? "First complete 6. FX → Mark Ready." : "TAX (Input)"}
        >
          7. TAX
        </button>

        <button
          onClick={() => setTabSafe("services")}
          disabled={!canGoSERVICES}
          className={tabBtnClass(tab === "services", !canGoSERVICES)}
          title={!canGoSERVICES ? "First complete 7. TAX → Mark Ready." : "Services (Input)"}
        >
          8. SERVICES
        </button>

        <button
          onClick={() => setTabSafe("pl")}
          disabled={!canGoPL}
          className={tabBtnClass(tab === "pl", !canGoPL)}
          title={!canGoPL ? "First complete 8. SERVICES → Mark Ready." : "P&L (Output)"}
        >
          9. P&L
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
                  // After TWC, users might go CAPEX, but Index/Escalation are free anyway.
                  setTabRaw("capex");
                }}
              />
            </div>
          )}

          {tab === "index" && (
            <div className="rounded border p-4 bg-white">
              <IndexSeriesTab />
            </div>
          )}

          {tab === "escalation" && (
            <div className="rounded border p-4 bg-white">
              <EscalationTab scenarioId={id} />
            </div>
          )}

          {tab === "capex" && (
            <div className="rounded border p-4 bg-white">
              <CapexTable
                scenarioId={id}
                onChanged={loadAll}
                onMarkedReady={async () => {
                  await loadAll();
                  setTabRaw("fx");
                }}
              />
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
                When the workflow is READY, we’ll display the P&L summary and monthly breakdown here.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
