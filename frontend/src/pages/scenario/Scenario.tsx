import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiGet, apiPost } from "../../lib/api";

// Tabs (mevcutlar)
import BOQTable from "../scenario/components/BOQTable";
import TWCTab from "../scenario/tabs/TWCTab";
import CapexTable from "../scenario/components/CapexTable";
import ServicesTable from "../scenario/components/ServicesTable";
// YENİ: FX & TAX
import FXTab from "../scenario/tabs/FXTab";
import TaxTab from "../scenario/tabs/TaxTab";

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
  workflow_state?: "draft" | "twc" | "capex" | "services" | "ready" | string;
  is_boq_ready?: boolean;
  is_twc_ready?: boolean;
  is_capex_ready?: boolean;
  is_services_ready?: boolean;
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
    | "capex"
    | "services"
    | "fx"
    | "tax";

  function setTabRaw(next: typeof tab) {
    setSp(
      (p) => {
        p.set("tab", next);
        return p;
      },
      { replace: true }
    );
  }

  function setTabSafe(next: typeof tab) {
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
    if (next === "services" && !flow.is_capex_ready) {
      alert("Önce 3. CAPEX sekmesinde 'Mark Ready' yapmalısınız.");
      return;
    }
    if (next === "pl" && !flow.is_services_ready) {
      alert("Önce 4. SERVICES sekmesinde 'Mark Ready' yapmalısınız.");
      return;
    }
    // Not: fx ve tax sekmeleri guard'lı değil
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
      setErr(e?.message || "Failed to load scenario.");
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
  const canGoSERVICES = !!flow?.is_capex_ready;
  const canGoPL = !!flow?.is_services_ready;

  async function markServicesReady() {
    try {
      await apiPost(`/scenarios/${id}/workflow/mark-services-ready`, {});
      await loadAll();
      setTabRaw("pl");
    } catch (e: any) {
      alert(e?.message || "Mark Services Ready başarısız.");
    }
  }

  const stateSafe = (flow?.workflow_state ?? "draft").toUpperCase();

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
                (flow.workflow_state ?? "draft") === "draft" && "bg-gray-100 text-gray-700",
                flow.workflow_state === "twc" && "bg-amber-100 text-amber-700",
                flow.workflow_state === "capex" && "bg-sky-100 text-sky-700",
                flow.workflow_state === "services" && "bg-purple-100 text-purple-700",
                flow.workflow_state === "ready" && "bg-emerald-100 text-emerald-700"
              )}
              title={`BOQ:${flow.is_boq_ready ? "✓" : "•"}  TWC:${
                flow.is_twc_ready ? "✓" : "•"
              }  CAPEX:${flow.is_capex_ready ? "✓" : "•"}  SERVICES:${
                flow.is_services_ready ? "✓" : "•"
              }`}
            >
              State: {stateSafe}
            </span>
          )}
          <button
            onClick={loadAll}
            className="ml-3 px-3 py-1 rounded border hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setTabSafe("boq")}
          className={cls("px-3 py-1 rounded border",
            tab === "boq" ? "bg-amber-50 border-amber-300" : "bg-white")}
        >
          1. BOQ
        </button>

        <button
          onClick={() => setTabSafe("twc")}
          disabled={!canGoTWC}
          className={cls("px-3 py-1 rounded border",
            tab === "twc" ? "bg-amber-50 border-amber-300" : "bg-white",
            !canGoTWC && "opacity-50 cursor-not-allowed")}
          title={!canGoTWC ? "Önce 1. BOQ 'Ready' olmalı" : "TWC (Input)"}
        >
          2. TWC
        </button>

        <button
          onClick={() => setTabSafe("capex")}
          disabled={!canGoCAPEX}
          className={cls("px-3 py-1 rounded border",
            tab === "capex" ? "bg-amber-50 border-amber-300" : "bg-white",
            !canGoCAPEX && "opacity-50 cursor-not-allowed")}
          title={!canGoCAPEX ? "Önce 2. TWC 'Ready' olmalı" : "CAPEX (Input)"}
        >
          3. CAPEX
        </button>

        {/* YENİ: FX & TAX sekmeleri – serbest erişim */}
        <button
          onClick={() => setTabSafe("fx")}
          className={cls("px-3 py-1 rounded border",
            tab === "fx" ? "bg-gray-100 border-gray-300" : "bg-white")}
          title="FX (kur varsayımları)"
        >
          FX
        </button>

        <button
          onClick={() => setTabSafe("tax")}
          className={cls("px-3 py-1 rounded border",
            tab === "tax" ? "bg-gray-100 border-gray-300" : "bg-white")}
          title="Tax (vergi kuralları)"
        >
          TAX
        </button>

        <button
          onClick={() => setTabSafe("services")}
          disabled={!canGoSERVICES}
          className={cls("px-3 py-1 rounded border",
            tab === "services" ? "bg-amber-50 border-amber-300" : "bg-white",
            !canGoSERVICES && "opacity-50 cursor-not-allowed")}
          title={!canGoSERVICES ? "Önce 3. CAPEX 'Ready' olmalı" : "Services (Input)"}
        >
          4. SERVICES
        </button>

        <button
          onClick={() => setTabSafe("pl")}
          disabled={!canGoPL}
          className={cls("px-3 py-1 rounded border",
            tab === "pl" ? "bg-emerald-50 border-emerald-300" : "bg-white",
            !canGoPL && "opacity-50 cursor-not-allowed")}
          title={!canGoPL ? "Önce 4. SERVICES 'Ready' olmalı" : "P&L (Output)"}
        >
          5. P&L
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
                  setTabRaw("services");
                }}
              />
            </div>
          )}

          {tab === "fx" && (
            <div className="rounded border p-4 bg-white">
              <FXTab scenarioId={id} />
            </div>
          )}

          {tab === "tax" && (
            <div className="rounded border p-4 bg-white">
              <TaxTab scenarioId={id} />
            </div>
          )}

          {tab === "services" && (
            <div className="rounded border p-4 bg-white space-y-4">
              <ServicesTable scenarioId={id} />
              <div className="flex items-center justify-end">
                <button
                  onClick={markServicesReady}
                  className={cls(
                    "px-3 py-2 rounded bg-black text-white hover:opacity-90",
                    flow.is_services_ready && "opacity-60 cursor-not-allowed"
                  )}
                  disabled={!!flow.is_services_ready}
                >
                  Mark Services Ready
                </button>
              </div>
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
