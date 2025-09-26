// Rise & Fall tab — Arya CRM v1.0.7 compatible
// Single-file: selector (Service/BOQ) + formulation editor + preview + optional index overlay

import React, { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut } from "../../../lib/api";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";

/* ===================== Types ===================== */

type Props = { scenarioId: number };

type ServiceRow = {
  id: number;
  service_name?: string | null;
  unit_cost?: number | null; // base price
  currency?: string | null;
  start_year?: number | null;
  start_month?: number | null; // 1..12
  product_id?: number | null;
};

type BOQItem = {
  id: number;
  section?: string | null;
  unit_cogs?: number | null; // base price
  start_year?: number | null;
  start_month?: number | null; // 1..12
  product_id?: number | null;
};

type IndexSeries = {
  id: number;
  code: string;
  name: string;
  currency?: string | null;
};

type IndexPoint = { year: number; month: number; value: number };

type Frequency = "monthly" | "quarterly" | "annual";
type Compounding = "simple" | "compound";
type Scope = "service" | "boq";

interface FormulationComponent {
  index_series_id: number;
  weight_pct: number; // 0..100
  base_ref_ym?: string | null; // YYYY-MM
  lag_months?: number; // could be negative
  factor?: number; // multiplier
  cap_pct?: number | null;
  floor_pct?: number | null;
}

interface RiseFallForm {
  frequency: Frequency;
  compounding: Compounding;
  months: number; // preview horizon
  components: FormulationComponent[];
  base_price: number; // unit_cost/unit_cogs
  start_ym?: string | null; // optional override
}

type PreviewRow = { ym: string; price: number; idx: number };

/* ===================== Helpers ===================== */

function cls(...a: Array<string | false | undefined>) { return a.filter(Boolean).join(" "); }
function pad2(n: number) { return String(n).padStart(2, "0"); }
function ymStr(y: number, m: number) { return `${y}-${pad2(m)}`; }
function fromYM(s: string): { y: number; m: number } { const [yy, mm] = s.split("-").map(Number); return { y: yy, m: mm }; }
function addMonths(y: number, m: number, k: number): { y: number; m: number } {
  const dt = new Date(y, m - 1, 1);
  dt.setMonth(dt.getMonth() + k);
  return { y: dt.getFullYear(), m: dt.getMonth() + 1 };
}
function stepsForFrequency(freq: Frequency): number {
  return freq === "monthly" ? 1 : freq === "quarterly" ? 3 : 12;
}
const nullableNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* -------- Payload sanitization (TS-safe, BE-friendly) -------- */
function sanitizeComponent(c: FormulationComponent) {
  const out: any = {
    index_series_id: Number(c.index_series_id),
    weight_pct: Number(c.weight_pct),
  };
  if (c.base_ref_ym && /^\d{4}-\d{2}$/.test(c.base_ref_ym)) out.base_ref_ym = c.base_ref_ym;
  const lag = nullableNumber(c.lag_months as any);
  if (lag !== null) out.lag_months = lag;
  const fac = nullableNumber(c.factor as any);
  if (fac !== null) out.factor = fac;
  out.cap_pct = nullableNumber(c.cap_pct as any);
  out.floor_pct = nullableNumber(c.floor_pct as any);
  return out;
}

function sanitizeFormulationPayload(raw: {
  product_id?: number | null;
  name?: string | null;
  code?: string | null;
  base_price?: number | null;
  frequency?: Frequency | null;
  compounding?: Compounding | null;
  start_ym?: string | null;
  components: FormulationComponent[];
}) {
  const payload: any = {
    name: raw.name ?? null,
    base_price: nullableNumber(raw.base_price as any),
    frequency: raw.frequency ?? "annual",
    compounding: raw.compounding ?? "simple",
    start_ym: raw.start_ym && /^\d{4}-\d{2}$/.test(raw.start_ym) ? raw.start_ym : null,
    components: (raw.components || []).map(sanitizeComponent),
  };
  if (raw.product_id) payload.product_id = Number(raw.product_id);
  if (raw.code) payload.code = String(raw.code);
  return payload;
}

/* -------- Preview engine -------- */
function buildPreview(
  form: RiseFallForm,
  seriesPointsMap: Map<number, Map<string, number>>,
  startY: number,
  startM: number
): PreviewRow[] {
  const horizon = Math.max(1, form.months || 24);
  const step = stepsForFrequency(form.frequency);
  const out: PreviewRow[] = [];
  const basePrice = Number(form.base_price || 0);
  if (!basePrice || form.components.length === 0) return out;

  function compositeAt(ym: string) {
    let total = 0;
    for (const c of form.components) {
      const mp = seriesPointsMap.get(c.index_series_id);
      if (!mp) continue;
      const val = mp.get(ym);
      if (val == null) continue;
      const w = (c.weight_pct ?? 0) / 100.0;
      const f = c.factor ?? 1;
      total += val * w * f;
    }
    return total;
  }

  const baseRefs = form.components.map((c) => c.base_ref_ym).filter(Boolean) as string[];
  const fallbackBase = ymStr(startY, startM);
  const baseYM = baseRefs[0] || fallbackBase;
  const baseIndex = compositeAt(baseYM) || 100;

  let currentPrice = basePrice;
  for (let k = 0; k < horizon; k += step) {
    const { y, m } = addMonths(startY, startM, k);
    const ym = ymStr(y, m);

    // composite with lags
    let compVal = 0;
    for (const c of form.components) {
      const mp = seriesPointsMap.get(c.index_series_id);
      if (!mp) continue;
      const lag = c.lag_months ?? 0;
      const target = addMonths(y, m, lag);
      const tYM = ymStr(target.y, target.m);
      const val = mp.get(tYM);
      if (val == null) continue;
      const w = (c.weight_pct ?? 0) / 100.0;
      const f = c.factor ?? 1;
      compVal += val * w * f;
    }

    const baseDeltaPct = baseIndex ? (compVal - baseIndex) / baseIndex : 0;

    const netCap = Math.min(...form.components.map((c) => (c.cap_pct ?? Infinity)), Infinity);
    const netFloor = Math.max(...form.components.map((c) => (c.floor_pct ?? -Infinity)), -Infinity);
    const boundedDeltaPct = Math.min(Math.max(baseDeltaPct * 100, netFloor), netCap);
    const deltaRatio = 1 + (boundedDeltaPct / 100);

    const priceForPoint =
      form.compounding === "simple" ? basePrice * deltaRatio : currentPrice * deltaRatio;

    out.push({ ym, price: Number(priceForPoint.toFixed(4)), idx: Number(compVal.toFixed(4)) });
    currentPrice = priceForPoint;
  }
  return out;
}

/* ===================== Small API helpers (v1.0.7) ===================== */

async function createFormulation(payload: any) {
  return apiPost("/api/formulations", payload);
}
async function updateFormulation(fid: number, payload: any) {
  return apiPut(`/api/formulations/${fid}`, payload);
}
async function attachFormulationToService(serviceId: number, formulationId: number) {
  try { return await apiPost(`/api/services/${serviceId}/attach-formulation`, { formulation_id: formulationId }); } catch {}
  try { return await apiPost(`/services/${serviceId}/attach-formulation`, { formulation_id: formulationId }); } catch {}
  try { return await apiPost(`/api/formulation-links/service/${serviceId}`, { formulation_id: formulationId }); } catch {}
  return apiPost(`/api/formulation-links`, { scope: "service", item_id: serviceId, formulation_id: formulationId });
}
async function attachFormulationToBoq(itemId: number, formulationId: number) {
  try { return await apiPost(`/api/boq-items/${itemId}/attach-formulation`, { formulation_id: formulationId }); } catch {}
  try { return await apiPost(`/boq-items/${itemId}/attach-formulation`, { formulation_id: formulationId }); } catch {}
  try { return await apiPost(`/api/formulation-links/boq/${itemId}`, { formulation_id: formulationId }); } catch {}
  return apiPost(`/api/formulation-links`, { scope: "boq", item_id: itemId, formulation_id: formulationId });
}

/* ===================== Component ===================== */
export default function RiseAndFallTab({ scenarioId }: Props) {
  // Data state
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [boqs, setBOQs] = useState<BOQItem[]>([]);
  const [series, setSeries] = useState<IndexSeries[]>([]);
  const [pointsBySeries, setPointsBySeries] = useState<Map<number, Map<string, number>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Selection
  const [scope, setScope] = useState<Scope>("service");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Form state
  const [form, setForm] = useState<RiseFallForm>({
    frequency: "annual",
    compounding: "simple",
    months: 36,
    components: [],
    base_price: 0,
    start_ym: null,
  });

  const [showSeries, setShowSeries] = useState(false);

  // Preview start YM
  const startYM = useMemo(() => {
    const src = (scope === "service"
      ? services.find((s) => s.id === selectedId)
      : boqs.find((b) => b.id === selectedId)) || null;
    const y = src?.start_year || new Date().getFullYear();
    const m = src?.start_month || new Date().getMonth() + 1;
    const ym = form.start_ym || ymStr(y, m);
    return ym;
  }, [scope, selectedId, services, boqs, form.start_ym]);

  // Derive base price from selection
  useEffect(() => {
    if (scope === "service") {
      const s = services.find((v) => v.id === selectedId);
      const bp = Number(s?.unit_cost ?? 0);
      setForm((f) => ({ ...f, base_price: bp }));
    } else {
      const b = boqs.find((v) => v.id === selectedId);
      const bp = Number(b?.unit_cogs ?? 0);
      setForm((f) => ({ ...f, base_price: bp }));
    }
  }, [scope, selectedId, services, boqs]);

  // Helper: GET first-success
  async function fetchAny<T = any>(paths: string[]): Promise<T> {
    let lastErr: any = null;
    for (const p of paths) {
      try {
        return await apiGet<T>(p);
      } catch (e: any) { lastErr = e; }
    }
    throw lastErr || new Error("No endpoint matched");
  }

  // Load core data
  useEffect(() => {
    const sid = Number(scenarioId);
    if (!sid || Number.isNaN(sid)) { setLoading(false); setErr("Invalid scenario id."); return; }
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const [svc, bq, ser] = await Promise.all([
          fetchAny<any>([
            `/scenarios/${sid}/services`,
            `/business-cases/scenarios/${sid}/services`,
            `/business-cases/scenarios/${sid}/service-items`,
          ]),
          fetchAny<any>([
            `/scenarios/${sid}/boq-items`,
            `/scenarios/${sid}/boq`,
            `/business-cases/scenarios/${sid}/boq-items`,
            `/business-cases/scenarios/${sid}/boq`,
          ]),
          apiGet<any>(`/api/index-series`),
        ]);
        const toArray = (x: any) => (Array.isArray(x) ? x : x?.items ?? []);
        setServices(toArray(svc));
        setBOQs(toArray(bq));
        setSeries(toArray(ser));
      } catch (e: any) {
        setErr(e?.message || "Failed to load data.");
      } finally {
        setLoading(false);
      }
    })();
  }, [scenarioId]);

  // Load points for needed series
  useEffect(() => {
    (async () => {
      const needed = new Set(form.components.map((c) => c.index_series_id).filter(Boolean));
      const missing = Array.from(needed).filter((sid) => !pointsBySeries.has(sid));
      if (missing.length === 0) return;
      try {
        const next = new Map(pointsBySeries);
        for (const sid of missing) {
          const res = await apiGet<any>(`/api/index-series/${sid}/points?limit=10000&offset=0`);
          const items: IndexPoint[] = Array.isArray(res) ? res : res.items ?? [];
          const mp = new Map<string, number>();
          for (const p of items) mp.set(`${p.year}-${pad2(p.month)}`, Number(p.value));
          next.set(sid, mp);
        }
        setPointsBySeries(next);
      } catch {/* ignore */}
    })();
  }, [form.components, pointsBySeries]);

  // Preview data
  const chartData: PreviewRow[] = useMemo(() => {
    const { y, m } = fromYM(startYM);
    return buildPreview(form, pointsBySeries, y, m);
  }, [form, pointsBySeries, startYM]);

  // Index overlay
  const indexOverlay = useMemo(() => {
    if (!showSeries || form.components.length === 0) return [] as Array<{ ym: string; [k: string]: number | string | null }>;
    const { y, m } = fromYM(startYM);
    const horizon = Math.max(1, form.months || 24);
    const out: Array<{ ym: string; [k: string]: number | string | null }> = [];
    for (let k = 0; k < horizon; k++) {
      const { y: yy, m: mm } = addMonths(y, m, k);
      const ym = ymStr(yy, mm);
      const row: { ym: string; [k: string]: number | string | null } = { ym };
      for (const c of form.components) {
        const mp = pointsBySeries.get(c.index_series_id);
        const lag = c.lag_months ?? 0;
        const t = addMonths(yy, mm, lag);
        const val = mp?.get(ymStr(t.y, t.m));
        row[`S#${c.index_series_id}`] = val ?? null;
      }
      out.push(row);
    }
    return out;
  }, [showSeries, form.components, pointsBySeries, startYM, form.months]);

  // POST/PUT first-success
  async function postAny<T = any>(paths: string[], body: any): Promise<T> {
    let lastErr: any = null;
    for (const p of paths) {
      try { return await apiPost<T>(p, body); } catch (e: any) { lastErr = e; }
    }
    throw lastErr || new Error("No POST endpoint matched");
  }
  async function putAny<T = any>(paths: string[], body: any): Promise<T> {
    let lastErr: any = null;
    for (const p of paths) {
      try { return await apiPut<T>(p, body); } catch (e: any) { lastErr = e; }
    }
    throw lastErr || new Error("No PUT endpoint matched");
  }

  // Save flow (create+attach -> direct attach -> scenario fallback)
  async function save() {
    if (!selectedId) return alert("Select a row first.");

    const wSum = form.components.reduce((s, c) => s + (Number(c.weight_pct) || 0), 0);
    if (Math.abs(wSum - 100) > 0.001) {
      if (!confirm(`Weights sum to ${wSum.toFixed(2)}%, not 100%. Continue?`)) return;
    }

    let product_id: number | undefined;
    if (scope === "service") {
      const s = services.find((x) => x.id === selectedId);
      if (s?.product_id) product_id = s.product_id || undefined;
    } else {
      const b = boqs.find((x) => x.id === selectedId);
      if (b?.product_id) product_id = b.product_id || undefined;
    }

    const normalizedStartYM = (form.start_ym && /^\d{4}-\d{2}$/.test(form.start_ym)) ? form.start_ym : startYM;

    const attachPayload = sanitizeFormulationPayload({
      name: `RF-${scope}-${selectedId}`,
      base_price: form.base_price,
      frequency: form.frequency,
      compounding: form.compounding,
      start_ym: normalizedStartYM,
      components: form.components,
    });

    // 1) create + attach
    try {
      const formulationPayload = sanitizeFormulationPayload({
        product_id,
        name: `RF-${scope}-${selectedId}`,
        code: `RF-${scope}-${selectedId}`,
        base_price: form.base_price,
        frequency: form.frequency,
        compounding: form.compounding,
        start_ym: normalizedStartYM,
        components: form.components,
      });

      const created: any = await createFormulation(formulationPayload);
      const formulation_id = created?.id || created?.data?.id || created?.formulation_id;
      if (!formulation_id) throw new Error("Formulation ID not returned");

      if (scope === "service") await attachFormulationToService(selectedId, formulation_id);
      else await attachFormulationToBoq(selectedId, formulation_id);

      alert("Saved successfully.");
      return;
    } catch (e1: any) {
      console.warn("create+attach failed, trying direct attach…", e1?.message || e1);
    }

    // 2) Direct attach
    try {
      if (scope === "service") {
        await postAny(
          [
            `/api/services/${selectedId}/formulation`,
            `/services/${selectedId}/formulation`,
            `/api/services/${selectedId}/rise-fall`,
            `/services/${selectedId}/rise-fall`,
          ],
          attachPayload
        );
      } else {
        await postAny(
          [
            `/api/boq-items/${selectedId}/formulation`,
            `/boq-items/${selectedId}/formulation`,
            `/api/boq-items/${selectedId}/rise-fall`,
            `/boq-items/${selectedId}/rise-fall`,
          ],
          attachPayload
        );
      }
      alert("Saved successfully.");
      return;
    } catch (e2: any) {
      console.warn("direct attach failed, trying scenario fallback…", e2?.message || e2);
    }

    // 3) Scenario-scoped fallback
    try {
      await putAny(
        [
          `/api/scenarios/${scenarioId}/rise-fall/${scope}/${selectedId}`,
          `/scenarios/${scenarioId}/rise-fall/${scope}/${selectedId}`,
          `/api/scenarios/${scenarioId}/${scope}/${selectedId}/rise-fall`,
          `/scenarios/${scenarioId}/${scope}/${selectedId}/rise-fall`,
          `/api/business-cases/scenarios/${scenarioId}/rise-fall/${scope}/${selectedId}`,
          `/business-cases/scenarios/${scenarioId}/rise-fall/${scope}/${selectedId}`,
        ],
        attachPayload
      );
      alert("Saved successfully (fallback endpoint).");
      return;
    } catch (e3: any) {
      console.warn("scenario fallback failed", e3?.message || e3);
      alert((e3 && (e3.response?.data?.detail || e3.message)) || "Save failed. Please check backend endpoints/logs.");
    }
  }

  /* ===================== UI ===================== */
  if (loading) return <div>Loading…</div>;
  if (err) return <div className="text-red-600">{err}</div>;

  const selectionList: Array<ServiceRow | BOQItem> = scope === "service" ? services : boqs;

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Left: selector */}
      <aside className="col-span-4 border rounded-xl p-3 bg-white">
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold">Rows</div>
          <div className="flex gap-2">
            <button
              className={cls(
                "px-2 py-1 rounded text-sm border",
                scope === "service" ? "bg-indigo-600 text-white border-indigo-600" : "bg-gray-100"
              )}
              onClick={() => setScope("service")}
            >
              Services
            </button>
            <button
              className={cls(
                "px-2 py-1 rounded text-sm border",
                scope === "boq" ? "bg-indigo-600 text-white border-indigo-600" : "bg-gray-100"
              )}
              onClick={() => setScope("boq")}
            >
              BOQ
            </button>
          </div>
        </div>
        <div className="h-[420px] overflow-auto divide-y">
          {selectionList.map((r) => (
            <div
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={cls(
                "p-2 cursor-pointer text-sm",
                selectedId === r.id ? "bg-indigo-50" : "hover:bg-gray-50"
              )}
            >
              <div className="font-medium truncate">
                {scope === "service" ? (r as ServiceRow).service_name || `#${r.id}` : (r as BOQItem).section || `#${r.id}`}
              </div>
              <div className="text-gray-600">
                Base: {scope === "service" ? (r as ServiceRow).unit_cost ?? "—" : (r as BOQItem).unit_cogs ?? "—"}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Right: editor + preview */}
      <main className="col-span-8 space-y-4">
        {!selectedId ? (
          <div className="text-sm text-gray-600 border rounded-xl p-6 bg-white">Select a row on the left.</div>
        ) : (
          <div className="space-y-4">
            {/* Editor Card */}
            <div className="border rounded-xl p-4 bg-white">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Formulation</h3>
                <div className="flex items-center gap-2">
                  <label className="text-sm flex items-center gap-1">
                    <input type="checkbox" checked={showSeries} onChange={(e) => setShowSeries(e.target.checked)} />
                    Visualize Series
                  </label>
                  <button onClick={save} className="px-3 py-1.5 rounded-md border text-sm hover:bg-gray-50">Save</button>
                </div>
              </div>

              {/* Top row: base/meta */}
              <div className="mt-3 grid grid-cols-4 gap-3 text-sm">
                <label className="flex flex-col">
                  <span className="text-gray-600">Frequency</span>
                  <select
                    value={form.frequency}
                    onChange={(e) => setForm({ ...form, frequency: e.target.value as Frequency })}
                    className="border rounded px-2 py-1"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annual">Annual</option>
                  </select>
                </label>
                <label className="flex flex-col">
                  <span className="text-gray-600">Compounding</span>
                  <select
                    value={form.compounding}
                    onChange={(e) => setForm({ ...form, compounding: e.target.value as Compounding })}
                    className="border rounded px-2 py-1"
                  >
                    <option value="simple">Simple</option>
                    <option value="compound">Compound</option>
                  </select>
                </label>
                <label className="flex flex-col">
                  <span className="text-gray-600">Preview Months</span>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={form.months}
                    onChange={(e) => setForm({ ...form, months: Math.max(1, Math.min(120, Number(e.target.value || 0))) })}
                    className="border rounded px-2 py-1"
                  />
                </label>
                <label className="flex flex-col">
                  <span className="text-gray-600">Start (YYYY-MM)</span>
                  <input type="month" value={startYM} onChange={(e) => setForm({ ...form, start_ym: e.target.value })} className="border rounded px-2 py-1" />
                </label>
              </div>

              <div className="mt-3 grid grid-cols-4 gap-3 text-sm">
                <label className="flex flex-col">
                  <span className="text-gray-600">Base Price</span>
                  <input
                    type="number"
                    value={form.base_price}
                    onChange={(e) => setForm({ ...form, base_price: Number(e.target.value || 0) })}
                    className="border rounded px-2 py-1"
                  />
                </label>
                <div className="flex items-end">
                  <button onClick={addComponent} className="px-3 py-1.5 rounded-md border text-sm hover:bg-gray-50">+ Add Component</button>
                </div>
              </div>

              {/* Components table */}
              <div className="mt-4 border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-2 w-48">Index Series</th>
                      <th className="text-left p-2 w-24">Weight %</th>
                      <th className="text-left p-2 w-32">Base Ref</th>
                      <th className="text-left p-2 w-24">Lag (m)</th>
                      <th className="text-left p-2 w-24">Factor</th>
                      <th className="text-left p-2 w-24">Cap %</th>
                      <th className="text-left p-2 w-24">Floor %</th>
                      <th className="p-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.components.length === 0 && (
                      <tr><td colSpan={8} className="p-3 text-center text-gray-500">No components. Add one.</td></tr>
                    )}
                    {form.components.map((c, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2">
                          <select
                            value={c.index_series_id}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              setForm((f) => ({ ...f, components: f.components.map((cc, j) => (j === i ? { ...cc, index_series_id: v } : cc)) }));
                            }}
                            className="border rounded px-2 py-1 w-full"
                          >
                            {series.length === 0 ? (
                              <option value={0}>No series</option>
                            ) : (
                              series.map((s) => (
                                <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                              ))
                            )}
                          </select>
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={c.weight_pct}
                            onChange={(e) => {
                              const v = Math.max(0, Math.min(100, Number(e.target.value || 0)));
                              setForm((f) => ({ ...f, components: f.components.map((cc, j) => (j === i ? { ...cc, weight_pct: v } : cc)) }));
                            }}
                            className="border rounded px-2 py-1 w-full"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="month"
                            value={c.base_ref_ym || startYM}
                            onChange={(e) => {
                              const v = e.target.value || null;
                              setForm((f) => ({ ...f, components: f.components.map((cc, j) => (j === i ? { ...cc, base_ref_ym: v } : cc)) }));
                            }}
                            className="border rounded px-2 py-1 w-full"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            value={c.lag_months ?? 0}
                            onChange={(e) => {
                              const v = Number(e.target.value || 0);
                              setForm((f) => ({ ...f, components: f.components.map((cc, j) => (j === i ? { ...cc, lag_months: v } : cc)) }));
                            }}
                            className="border rounded px-2 py-1 w-full"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            step="0.01"
                            value={c.factor ?? 1}
                            onChange={(e) => {
                              const v = Number(e.target.value || 1);
                              setForm((f) => ({ ...f, components: f.components.map((cc, j) => (j === i ? { ...cc, factor: v } : cc)) }));
                            }}
                            className="border rounded px-2 py-1 w-full"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            step="0.01"
                            value={c.cap_pct ?? ""}
                            onChange={(e) => {
                              const v = e.target.value === "" ? null : Number(e.target.value);
                              setForm((f) => ({ ...f, components: f.components.map((cc, j) => (j === i ? { ...cc, cap_pct: v } : cc)) }));
                            }}
                            placeholder="—"
                            className="border rounded px-2 py-1 w-full"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            step="0.01"
                            value={c.floor_pct ?? ""}
                            onChange={(e) => {
                              const v = e.target.value === "" ? null : Number(e.target.value);
                              setForm((f) => ({ ...f, components: f.components.map((cc, j) => (j === i ? { ...cc, floor_pct: v } : cc)) }));
                            }}
                            placeholder="—"
                            className="border rounded px-2 py-1 w-full"
                          />
                        </td>
                        <td className="p-2 text-right">
                          <button onClick={() => removeComponent(i)} className="px-2 py-1 rounded border text-xs hover:bg-gray-50">Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Preview Card */}
            <div className="border rounded-xl p-4 bg-white">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Preview</h3>
                <div className="text-sm text-gray-600">Start: {startYM} • Horizon: {form.months}m</div>
              </div>

              {chartData.length === 0 ? (
                <div className="text-sm text-gray-500">Add at least one component and set a base price.</div>
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="ym" tick={{ fontSize: 11 }} interval={Math.max(0, Math.floor(form.months / 12) - 1)} />
                      <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Line yAxisId="left" type="monotone" dataKey="price" name="Price" dot={false} />
                      <Line yAxisId="right" type="monotone" dataKey="idx" name="Composite Index" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {showSeries && indexOverlay.length > 0 && (
                <div className="h-64 mt-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={indexOverlay} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="ym" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      {form.components.map((c) => (
                        <Line key={c.index_series_id} type="monotone" dataKey={`S#${c.index_series_id}`} name={`Series ${c.index_series_id}`} dot={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );

  function addComponent() {
    const firstSeries = series[0]?.id ?? 0;
    setForm((f) => ({
      ...f,
      components: [
        ...f.components,
        { index_series_id: firstSeries, weight_pct: 100, base_ref_ym: startYM, lag_months: 0, factor: 1, cap_pct: null, floor_pct: null },
      ],
    }));
  }
  function removeComponent(idx: number) {
    setForm((f) => ({ ...f, components: f.components.filter((_, i) => i !== idx) }));
  }
}
