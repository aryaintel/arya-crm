// frontend/src/pages/Scenario.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiGet } from "../../lib/api";

// Tabs
import BOQTable from "../scenario/components/BOQTable";
import TWCTab from "../scenario/tabs/TWCTab";
import CapexTable from "../scenario/components/CapexTable";

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
  workflow_state: "draft" | "twc" | "capex" | "ready" | string;
  is_boq_ready: boolean;
  is_twc_ready: boolean;
  is_capex_ready: boolean;
};

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
  const tab = (sp.get("tab") || "boq").toLowerCase() as
    | "pl"
    | "boq"
    | "twc"
    | "capex";

  function setTabSafe(next: "pl" | "boq" | "twc" | "capex") {
    if (!flow) return;

    if (next === "twc" && !flow.is_boq_ready) {
      alert("Önce 1. BOQ sekmesinde 'Mark Ready' yapmalısınız.");
      return;
    }
    if (next === "capex" && !flow.is_twc_ready) {
      alert("Önce 2. TWC sekmesinde 'Mark Ready' yapmalısınız.");
      return;
    }
    if (next === "pl" && !flow.is_capex_ready) {
      alert("Önce 3. CAPEX sekmesinde 'Mark Ready' yapmalısınız.");
      return;
    }

    setSp((p) => {
      p.set("tab", next);
      return p;
    }, { replace: true });
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
      setErr(e?.message || "Failed to load scenario.");
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
  const canGoPL = !!flow?.is_capex_ready;

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
                flow.workflow_state === "draft" && "bg-gray-100 text-gray-700",
                flow.workflow_state === "twc" && "bg-amber-100 text-amber-700",
                flow.workflow_state === "capex" && "bg-sky-100 text-sky-700",
                flow.workflow_state === "ready" && "bg-emerald-100 text-emerald-700"
              )}
              title={`BOQ:${flow.is_boq_ready ? "✓" : "•"}  TWC:${
                flow.is_twc_ready ? "✓" : "•"
              }  CAPEX:${flow.is_capex_ready ? "✓" : "•"}`}
            >
              State: {flow.workflow_state.toUpperCase()}
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

      {/* Tabs — numaralı ve akış sırası: 1→4 */}
      <div className="flex gap-2">
        <button
          onClick={() => setTabSafe("boq")}
          className={cls(
            "px-3 py-1 rounded border",
            tab === "boq" ? "bg-amber-50 border-amber-300" : "bg-white"
          )}
          title="BOQ (Input)"
        >
          1. BOQ
        </button>

        <button
          onClick={() => setTabSafe("twc")}
          disabled={!canGoTWC}
          className={cls(
            "px-3 py-1 rounded border",
            tab === "twc" ? "bg-amber-50 border-amber-300" : "bg-white",
            !canGoTWC && "opacity-50 cursor-not-allowed"
          )}
          title={!canGoTWC ? "Önce 1. BOQ 'Ready' olmalı" : "TWC (Input)"}
        >
          2. TWC
        </button>

        <button
          onClick={() => setTabSafe("capex")}
          disabled={!canGoCAPEX}
          className={cls(
            "px-3 py-1 rounded border",
            tab === "capex" ? "bg-amber-50 border-amber-300" : "bg-white",
            !canGoCAPEX && "opacity-50 cursor-not-allowed"
          )}
          title={!canGoCAPEX ? "Önce 2. TWC 'Ready' olmalı" : "CAPEX (Input)"}
        >
          3. CAPEX
        </button>

        <button
          onClick={() => setTabSafe("pl")}
          disabled={!canGoPL}
          className={cls(
            "px-3 py-1 rounded border",
            tab === "pl" ? "bg-emerald-50 border-emerald-300" : "bg-white",
            !canGoPL && "opacity-50 cursor-not-allowed"
          )}
          title={!canGoPL ? "Önce 3. CAPEX 'Ready' olmalı" : "P&L (Output)"}
        >
          4. P&L
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
                  setTabSafe("twc");
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
                  setTabSafe("capex");
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
                  setTabSafe("pl");
                }}
              />
            </div>
          )}

          {tab === "pl" && (
            <div className="rounded border p-6 bg-emerald-50/40">
              <h3 className="font-semibold text-lg mb-2">P&L (coming next)</h3>
              <p className="text-sm text-gray-700">
                Workflow “READY” aşamasında bu ekranda P&L özetini ve aylık kırılımı
                göstereceğiz.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
