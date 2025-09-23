// frontend/src/pages/Scenario/Scenario.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiGet, apiPost } from "../../lib/api";

// Tabs
import BOQTable from "../scenario/components/BOQTable";
import TWCTab from "../scenario/tabs/TWCTab";
import CapexTable from "../scenario/components/CapexTable";
import ServicesTable from "../scenario/components/ServicesTable";
// NEW: FX & TAX
import FxTab from "../scenario/tabs/FXTab";
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

type Tab = "pl" | "boq" | "twc" | "capex" | "fx" | "tax" | "services";

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
// backend ile uyum: twc/twc_ready, capex/capex_ready, ...
function isState(ws: string, key: string) {
  return ws === key || ws === `${key}_ready`;
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

  // Guard'sız ham sekme değiştirici — Mark Ready akışlarında kullanılır
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

  // Guard'lı normal sekme geçişi
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
      alert("Önce 4. FX sekmesinde 'Mark Ready' yapmalısınız.");
      return;
    }
    if (next === "services" && !flow.is_tax_ready) {
      alert("Önce 5. TAX sekmesinde 'Mark Ready' yapmalısınız.");
      return;
    }
    if (next === "pl" && !flow.is_services_ready) {
      alert("Önce 6. SERVICES sekmesinde 'Mark Ready' yapmalısınız.");
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
  const canGoFX = !!flow?.is_capex_ready;
  const canGoTAX = !!flow?.is_fx_ready;
  const canGoSERVICES = !!flow?.is_tax_ready;
  const canGoPL = !!flow?.is_services_ready;

  // --- Actions (Ready işaretleme) ---
  async function markServicesReady() {
    try {
      await apiPost(`/scenarios/${id}/workflow/mark-services-ready`, {});
      await loadAll();
      setTabRaw("pl");
    } catch (e: any) {
      alert(e?.message || "Mark Services Ready başarısız.");
    }
  }

  const ws = (flow?.workflow_state ?? "draft").toString();
  const stateSafe =
    ws === "ready"
      ? "READY"
      : ws.replace("_ready", "").toUpperCase(); // TWC_READY → TWC gibi okunur

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
                // services aşamasında backend çoğunlukla ready yapıyor;
                // ara renklendirme için flags'a göre göster:
                flow.is_tax_ready && !flow.is_services_ready && "bg-purple-100 text-purple-700",
                ws === "ready" && "bg-emerald-100 text-emerald-700"
              )}
              title={`BOQ:${flow.is_boq_ready ? "✓" : "•"}  TWC:${
                flow.is_twc_ready ? "✓" : "•"
              }  CAPEX:${flow.is_capex_ready ? "✓" : "•"}  FX:${
                flow.is_fx_ready ? "✓" : "•"
              }  TAX:${flow.is_tax_ready ? "✓" : "•"}  SERVICES:${
                flow.is_services_ready ? "✓" : "•"
              }`}
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

      {/* Tabs — sıra: 1→7 */}
      <div className="flex gap-2 flex-wrap">
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
          onClick={() => setTabSafe("fx")}
          disabled={!canGoFX}
          className={cls(
            "px-3 py-1 rounded border",
            tab === "fx" ? "bg-amber-50 border-amber-300" : "bg-white",
            !canGoFX && "opacity-50 cursor-not-allowed"
          )}
          title={!canGoFX ? "Önce 3. CAPEX 'Ready' olmalı" : "FX (Input)"}
        >
          4. FX
        </button>

        <button
          onClick={() => setTabSafe("tax")}
          disabled={!canGoTAX}
          className={cls(
            "px-3 py-1 rounded border",
            tab === "tax" ? "bg-amber-50 border-amber-300" : "bg-white",
            !canGoTAX && "opacity-50 cursor-not-allowed"
          )}
          title={!canGoTAX ? "Önce 4. FX 'Ready' olmalı" : "TAX (Input)"}
        >
          5. TAX
        </button>

        <button
          onClick={() => setTabSafe("services")}
          disabled={!canGoSERVICES}
          className={cls(
            "px-3 py-1 rounded border",
            tab === "services" ? "bg-amber-50 border-amber-300" : "bg-white",
            !canGoSERVICES && "opacity-50 cursor-not-allowed"
          )}
          title={!canGoSERVICES ? "Önce 5. TAX 'Ready' olmalı" : "Services (Input)"}
        >
          6. SERVICES
        </button>

        <button
          onClick={() => setTabSafe("pl")}
          disabled={!canGoPL}
          className={cls(
            "px-3 py-1 rounded border",
            tab === "pl" ? "bg-emerald-50 border-emerald-300" : "bg-white",
            !canGoPL && "opacity-50 cursor-not-allowed"
          )}
          title={!canGoPL ? "Önce 6. SERVICES 'Ready' olmalı" : "P&L (Output)"}
        >
          7. P&L
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
            <div className="rounded border p-4 bg-white space-y-4">
              <ServicesTable scenarioId={id} />
              <div className="flex items-center justify-end">
                <button
                  onClick={markServicesReady}
                  className={cls(
                    "px-3 py-2 rounded bg-purple-600 text-white hover:bg-purple-700",
                    flow.is_services_ready && "opacity-60 cursor-not-allowed"
                  )}
                  disabled={!!flow.is_services_ready}
                  title={
                    flow.is_services_ready
                      ? "Zaten hazır işaretlenmiş"
                      : "Services'i Ready olarak işaretle"
                  }
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
