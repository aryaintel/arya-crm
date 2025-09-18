// frontend/src/pages/scenario/Scenario.tsx
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiGet, apiPost, apiPut, apiDelete } from "../../lib/api";
import BOQTable from "./components/BOQTable";

/** ------------ Types (mirrors backend) ------------ */
type ProductMonth = { year: number; month: number; quantity: number };

type ScenarioProduct = {
  id: number;
  name: string;
  price: number;
  unit_cogs: number;
  is_active: boolean;
  months: ProductMonth[];
};

type ScenarioOverhead = {
  id: number;
  name: string;
  type: "fixed" | "%_revenue";
  amount: number;
};

type ScenarioDetail = {
  id: number;
  business_case_id: number;
  name: string;
  months: number;
  start_date: string; // ISO
  products: ScenarioProduct[];
  overheads: ScenarioOverhead[];
};

type Workflow = {
  scenario_id: number;
  workflow_state: "draft" | "twc" | "capex" | "ready" | string;
  is_boq_ready: boolean;
  is_twc_ready: boolean;
  is_capex_ready: boolean;
};

/** ------------ TWC ------------ */
type TWCIn = {
  twc_dso_days?: number | string;
  twc_dpo_days?: number | string;
  twc_dio_days?: number | string;
  twc_freight_pct_of_sales?: number | string;
  twc_safety_stock_pct_cogs?: number | string;
  twc_other_wc_fixed?: number | string;
};
type TWCOut = TWCIn & { scenario_id: number };

type TWCBucket = {
  year: number;
  month: number;
  revenue: number;
  cogs: number;
  freight: number;
  ar: number;
  ap: number;
  inv: number;
  nwc: number;
};
type TWCPreview = {
  scenario_id: number;
  assumptions: TWCOut;
  monthly: TWCBucket[];
  totals: Record<string, number>;
};

/** ------------ CAPEX ------------ */
type CapexRow = {
  id?: number;
  scenario_id?: number;
  year: number;
  month: number;
  amount: number;
  notes?: string | null;
  asset_name?: string | null;
  category?: string | null;
  service_start_year?: number | null;
  service_start_month?: number | null;
  useful_life_months?: number | null;
  depr_method?: string | null;
  salvage_value?: number | null;
  is_active?: boolean | null;
  disposal_year?: number | null;
  disposal_month?: number | null;
  disposal_proceeds?: number | null;
  replace_at_end?: boolean | null;
  per_unit_cost?: number | null;
  quantity?: number | null;
  contingency_pct?: number | null;
  partial_month_policy?: string | null;
};

/** ------------ Helpers ------------ */
function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function cls(...a: (string | false | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

// null güvenli TWC merge
function mergeTWC(
  current: TWCOut | null,
  patch: Partial<TWCOut>,
  scenarioId: number
): TWCOut {
  const base: TWCOut = {
    scenario_id: scenarioId,
    twc_dso_days: 45,
    twc_dpo_days: 30,
    twc_dio_days: 20,
    twc_freight_pct_of_sales: 0,
    twc_safety_stock_pct_cogs: 0,
    twc_other_wc_fixed: 0,
  };
  return { ...(current ?? base), ...patch };
}

/** ------------ Page ------------ */
export default function ScenarioPage() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const id = Number(scenarioId);
  const [sp, setSp] = useSearchParams();

  const [data,  setData]  = useState<ScenarioDetail | null>(null);
  const [flow,  setFlow]  = useState<Workflow | null>(null);
  const [twc,   setTwc]   = useState<TWCOut | null>(null);
  const [twcPv, setTPrev] = useState<TWCPreview | null>(null);
  const [capexRows, setCapexRows] = useState<CapexRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const tab = (sp.get("tab") || "boq").toLowerCase();
  function setTab(t: string) {
    setSp((p) => { p.set("tab", t); return p; }, { replace: true });
  }

  // Load Scenario + Workflow + TWC + CAPEX in parallel
  async function loadAll() {
    setLoading(true);
    setErr(null);
    try {
      const [sc, wf, twcRes, cap] = await Promise.all([
        apiGet<ScenarioDetail>(`/business-cases/scenarios/${id}`),
        apiGet<Workflow>(`/scenarios/${id}/workflow`),
        apiGet<TWCOut>(`/scenarios/${id}/twc`).catch(() => null as any),
        apiGet<CapexRow[]>(`/scenarios/${id}/capex`).catch(() => []),
      ]);
      setData(sc);
      setFlow(wf);
      if (twcRes) setTwc(twcRes);
      setCapexRows(cap || []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load scenario.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (id) loadAll(); /* eslint-disable-next-line */ }, [id]);

  const bcLink = useMemo(() => data ? `/business-cases/${data.business_case_id}` : "#", [data]);

  /* ---------- TWC actions ---------- */
  async function saveTWC() {
    if (!twc) return;
    setErr(null);
    try {
      const payload: TWCIn = {
        twc_dso_days: num(twc.twc_dso_days),
        twc_dpo_days: num(twc.twc_dpo_days),
        twc_dio_days: num(twc.twc_dio_days),
        twc_freight_pct_of_sales: num(twc.twc_freight_pct_of_sales),
        twc_safety_stock_pct_cogs: num(twc.twc_safety_stock_pct_cogs),
        twc_other_wc_fixed: num(twc.twc_other_wc_fixed),
      };
      const res = await apiPut<TWCOut>(`/scenarios/${id}/twc`, payload);
      setTwc(res);
      alert("TWC saved.");
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || "TWC save failed.");
    }
  }
  async function previewTWC() {
    setErr(null);
    try {
      const pv = await apiPost<TWCPreview>(`/scenarios/${id}/twc/preview`, {});
      setTPrev(pv);
    } catch (e: any) {
      setTPrev(null);
      alert(e?.response?.data?.detail || e?.message || "Preview failed.");
    }
  }
  async function markTWCReady() {
    try {
      await apiPost(`/scenarios/${id}/workflow/mark-twc-ready`, {});
      const wf = await apiGet<Workflow>(`/scenarios/${id}/workflow`);
      setFlow(wf);
      alert("Workflow moved to CAPEX.");
      setTab("capex");
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || "Cannot mark TWC as ready.");
    }
  }

  /* ---------- CAPEX actions ---------- */
  const [cxDraft, setCxDraft] = useState<CapexRow | null>(null);
  function startCapexAdd() {
    setCxDraft({
      year: new Date().getFullYear(),
      month: 1,
      amount: 0,
      notes: "",
    });
  }
  function cancelCapexAdd() { setCxDraft(null); }

  async function saveCapexNew() {
    if (!cxDraft) return;
    try {
      const created = await apiPost<CapexRow>(`/scenarios/${id}/capex`, {
        ...cxDraft,
        year: num(cxDraft.year),
        month: num(cxDraft.month),
        amount: num(cxDraft.amount),
      });
      setCapexRows((p) => [...p, created]);
      setCxDraft(null);
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || "CAPEX save failed.");
    }
  }
  async function saveCapexEdit(r: CapexRow) {
    if (!r.id) return;
    try {
      const upd = await apiPut<CapexRow>(`/scenarios/${id}/capex/${r.id}`, {
        ...r,
        year: num(r.year),
        month: num(r.month),
        amount: num(r.amount),
      });
      setCapexRows((p) => p.map((x) => (x.id === r.id ? upd : x)));
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || "CAPEX update failed.");
    }
  }
  async function delCapex(r: CapexRow) {
    if (!r.id) return;
    if (!confirm("Delete CAPEX item?")) return;
    try {
      await apiDelete(`/scenarios/${id}/capex/${r.id}`);
      setCapexRows((p) => p.filter((x) => x.id !== r.id));
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || "CAPEX delete failed.");
    }
  }
  async function markCapexReady() {
    try {
      await apiPost(`/scenarios/${id}/workflow/mark-capex-ready`, {});
      const wf = await apiGet<Workflow>(`/scenarios/${id}/workflow`);
      setFlow(wf);
      alert("Workflow moved to READY (P&L).");
      setTab("pl");
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || "Cannot mark CAPEX as ready.");
    }
  }

  /* ---------- Render ---------- */
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Scenario</h2>
          {data && (
            <div className="text-sm text-gray-600">
              ID: {data.id} • Name: <span className="font-medium">{data.name}</span> • Months: {data.months} • Start: {new Date(data.start_date).toISOString().slice(0,10)} • BC:{" "}
              <Link to={bcLink} className="text-indigo-600 underline">#{data.business_case_id}</Link>
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
              title={`BOQ:${flow.is_boq_ready ? "✓" : "•"}  TWC:${flow.is_twc_ready ? "✓" : "•"}  CAPEX:${flow.is_capex_ready ? "✓" : "•"}`}
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

      {/* Tabs: input vs calc/output renkleri */}
      <div className="flex gap-2">
        <button onClick={() => setTab("pl")}    className={cls("px-3 py-1 rounded border", tab==="pl"    ? "bg-emerald-50 border-emerald-300":"bg-white")}  title="Output">P&L</button>
        <button onClick={() => setTab("twc")}   className={cls("px-3 py-1 rounded border", tab==="twc"   ? "bg-amber-50 border-amber-300":"bg-white")}   title="Input">TWC</button>
        <button onClick={() => setTab("boq")}   className={cls("px-3 py-1 rounded border", tab==="boq"   ? "bg-amber-50 border-amber-300":"bg-white")}   title="Input">BOQ</button>
        <button onClick={() => setTab("capex")} className={cls("px-3 py-1 rounded border", tab==="capex" ? "bg-amber-50 border-amber-300":"bg-white")}   title="Input">CAPEX</button>
      </div>

      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-2 rounded">{err}</div>}

      {!loading && data && (
        <div className="space-y-4">
          {tab === "boq" && (
            <div className="rounded border p-4 bg-white">
              <BOQTable
                scenarioId={id}
                onChanged={loadAll}
                onMarkedReady={async () => { await loadAll(); setTab("twc"); }}
              />
            </div>
          )}

          {tab === "twc" && (
            <div className="rounded border p-4 bg-white space-y-3">
              <h3 className="font-semibold text-lg">TWC Assumptions</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Field label="DSO (days)">
                  <Input
                    type="number"
                    value={twc?.twc_dso_days ?? 45}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setTwc((p) => mergeTWC(p, { twc_dso_days: e.target.value }, id))}
                  />
                </Field>
                <Field label="DPO (days)">
                  <Input
                    type="number"
                    value={twc?.twc_dpo_days ?? 30}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setTwc((p) => mergeTWC(p, { twc_dpo_days: e.target.value }, id))}
                  />
                </Field>
                <Field label="DIO (days)">
                  <Input
                    type="number"
                    value={twc?.twc_dio_days ?? 20}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setTwc((p) => mergeTWC(p, { twc_dio_days: e.target.value }, id))}
                  />
                </Field>

                <Field label="Freight (% of sales)">
                  <Input
                    type="number"
                    value={twc?.twc_freight_pct_of_sales ?? 0}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setTwc((p) => mergeTWC(p, { twc_freight_pct_of_sales: e.target.value }, id))}
                  />
                </Field>
                <Field label="Safety Stock (% of COGS)">
                  <Input
                    type="number"
                    value={twc?.twc_safety_stock_pct_cogs ?? 0}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setTwc((p) => mergeTWC(p, { twc_safety_stock_pct_cogs: e.target.value }, id))}
                  />
                </Field>
                <Field label="Other WC (fixed)">
                  <Input
                    type="number"
                    value={twc?.twc_other_wc_fixed ?? 0}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setTwc((p) => mergeTWC(p, { twc_other_wc_fixed: e.target.value }, id))}
                  />
                </Field>
              </div>

              <div className="flex gap-2">
                <button onClick={saveTWC} className="px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700">Save TWC</button>
                <button onClick={previewTWC} className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200">Preview NWC</button>
                <button onClick={markTWCReady} className="px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700">Mark TWC Ready → CAPEX</button>
              </div>

              {twcPv && (
                <div className="mt-3">
                  <h4 className="font-medium mb-2">Preview (Monthly)</h4>
                  <div className="overflow-x-auto border rounded">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2">Y/M</th>
                          <th className="px-3 py-2 text-right">Revenue</th>
                          <th className="px-3 py-2 text-right">COGS</th>
                          <th className="px-3 py-2 text-right">Freight</th>
                          <th className="px-3 py-2 text-right">AR</th>
                          <th className="px-3 py-2 text-right">AP</th>
                          <th className="px-3 py-2 text-right">INV</th>
                          <th className="px-3 py-2 text-right">NWC</th>
                        </tr>
                      </thead>
                      <tbody>
                        {twcPv.monthly.map((b, i) => (
                          <tr key={i} className="odd:bg-white even:bg-gray-50">
                            <td className="px-3 py-2">{b.year}/{String(b.month).padStart(2,"0")}</td>
                            <td className="px-3 py-2 text-right">{b.revenue.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right">{b.cogs.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right">{b.freight.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right">{b.ar.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right">{b.ap.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right">{b.inv.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right">{b.nwc.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "capex" && (
            <div className="rounded border p-4 bg-white space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-lg">CAPEX</h3>
                <div className="flex gap-2">
                  <button onClick={loadAll} className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200">Refresh</button>
                  <button onClick={startCapexAdd} className="px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700">+ Add</button>
                  <button onClick={markCapexReady} className="px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700">Mark CAPEX Ready → READY</button>
                </div>
              </div>

              <div className="overflow-x-auto border rounded">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 w-20">Year</th>
                      <th className="px-3 py-2 w-16">Month</th>
                      <th className="px-3 py-2 w-28 text-right">Amount</th>
                      <th className="px-3 py-2">Notes</th>
                      <th className="px-3 py-2 w-36">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cxDraft && (
                      <tr className="bg-amber-50/40">
                        <td className="px-3 py-2"><Input type="number" value={cxDraft.year} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setCxDraft({...cxDraft, year:Number(e.target.value)})}/></td>
                        <td className="px-3 py-2"><Input type="number" value={cxDraft.month} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setCxDraft({...cxDraft, month:Number(e.target.value)})}/></td>
                        <td className="px-3 py-2"><Input type="number" value={cxDraft.amount} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setCxDraft({...cxDraft, amount:Number(e.target.value)})}/></td>
                        <td className="px-3 py-2"><Input value={cxDraft.notes||""} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setCxDraft({...cxDraft, notes:e.target.value})}/></td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            <button onClick={saveCapexNew} className="px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700">Save</button>
                            <button onClick={cancelCapexAdd} className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300">Cancel</button>
                          </div>
                        </td>
                      </tr>
                    )}
                    {capexRows.map((r) => (
                      <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                        <td className="px-3 py-2"><Input type="number" value={r.year} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setCapexRows(p=>p.map(x=>x.id===r.id?{...x, year:Number(e.target.value)}:x))}/></td>
                        <td className="px-3 py-2"><Input type="number" value={r.month} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setCapexRows(p=>p.map(x=>x.id===r.id?{...x, month:Number(e.target.value)}:x))}/></td>
                        <td className="px-3 py-2"><Input type="number" value={r.amount} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setCapexRows(p=>p.map(x=>x.id===r.id?{...x, amount:Number(e.target.value)}:x))}/></td>
                        <td className="px-3 py-2"><Input value={r.notes||""} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setCapexRows(p=>p.map(x=>x.id===r.id?{...x, notes:e.target.value}:x))}/></td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            <button onClick={()=>saveCapexEdit(r)} className="px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700">Save</button>
                            <button onClick={()=>delCapex(r)} className="px-3 py-1 rounded bg-rose-600 text-white hover:bg-rose-700">Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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

/* ---------- Small UI bits ---------- */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-sm">
      <div className="text-gray-600 mb-1">{label}</div>
      {children}
    </label>
  );
}
function Input(props: any) {
  return (
    <input
      {...props}
      className={cls(
        "w-full px-2 py-1 rounded border border-gray-300 focus:outline-none focus:ring",
        props.className
      )}
    />
  );
}
