// [BEGIN FILE] frontend/src/pages/scenario/tabs/SummaryTab.tsx
import React, { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../../lib/api";

/** Props */
type Props = { scenarioId: number };

/** BOQ Item */
type BOQItem = {
  id?: number;
  is_active: boolean | null | undefined;
  item_name: string;
  unit: string;
  quantity: number | null | undefined;
  unit_price: number | null | undefined;
  unit_cogs?: number | null | undefined;
  frequency: "once" | "monthly" | "per_shipment" | "per_tonne";
  months?: number | null | undefined;
  start_year?: number | null | undefined;
  start_month?: number | null | undefined;
};

/** Month aggregates */
type MonthAgg = {
  revenue: number;
  cogs: number;
  gm: number;
  services_rev: number;
  services_cogs: number;
  rebates_contra: number;
  overheads: number;
  capex_depr: number;
  fx_impact: number;
  tax: number;
  key: string;
  y: number;
  m: number;
};

/** Rebates preview response (minimal) */
type RebatePreviewItem = { ym: string; accrual: number; cash?: number };
type RebatesPreviewResp = { items: RebatePreviewItem[] };

/* ---------- Helpers ---------- */
function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function pad2(n: number) { return String(n).padStart(2, "0"); }
function ymKey(y: number, m: number) { return `${y}-${pad2(m)}`; }
function addMonths(y: number, m: number, k: number) {
  const d0 = new Date(y, m - 1, 1);
  const d1 = new Date(d0.getFullYear(), d0.getMonth() + k, 1);
  return { year: d1.getFullYear(), month: d1.getMonth() + 1 };
}

/** Formatting */
const moneyFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
function fmtMoney(n: number, dashForZero = true) { return dashForZero && Math.abs(n) < 1e-9 ? "–" : moneyFmt.format(n); }
function fmtPct(n: number) { return Number.isFinite(n) ? `${n.toFixed(1)}%` : "–"; }

/** KPI cell */
function KPI({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border bg-white p-3 shadow-sm">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="text-[11px] text-gray-500 mt-1">{hint}</div> : null}
    </div>
  );
}

/** SummaryTab */
export default function SummaryTab({ scenarioId }: Props) {
  const [boq, setBoq] = useState<BOQItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Rebates map: ym → accrual (negative)
  const [rebatesMap, setRebatesMap] = useState<Record<string, number>>({});
  const [rebatesErr, setRebatesErr] = useState<string | null>(null);
  const [rebatesLoading, setRebatesLoading] = useState(false);

  /** Load BOQ — canonical path (NO /api prefix anywhere) */
  async function loadBOQ() {
    setLoading(true);
    setErr(null);
    try {
      const url = `/scenarios/${scenarioId}/boq`;
      const data = await apiGet<BOQItem[]>(url);
      setBoq(data);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || "Failed to load BOQ.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (scenarioId) loadBOQ();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioId]);

  /** Base BOQ monthly schedule (36 months) */
  const baseRows: MonthAgg[] = useMemo(() => {
    const agg = new Map<string, MonthAgg>();
    const HORIZON = 36;

    const active = boq.filter(
      (r): r is BOQItem & { is_active: true; start_year: number; start_month: number } =>
        !!r.is_active && typeof r.start_year === "number" && typeof r.start_month === "number"
    );

    for (const r of active) {
      const qty = num(r.quantity);
      const price = num(r.unit_price);
      const uc = num(r.unit_cogs ?? 0);
      const lineRev = qty * price;
      const lineCogs = qty * uc;

      const startY = r.start_year!;
      const startM = r.start_month!;

      if (r.frequency === "monthly") {
        const len = Math.max(1, num(r.months ?? 1));
        for (let k = 0; k < Math.min(len, HORIZON); k++) {
          const { year, month } = addMonths(startY, startM, k);
          const key = ymKey(year, month);
          const cur =
            agg.get(key) || {
              key, y: year, m: month,
              revenue: 0, cogs: 0, gm: 0,
              services_rev: 0, services_cogs: 0, rebates_contra: 0,
              overheads: 0, capex_depr: 0, fx_impact: 0, tax: 0,
            };
          cur.revenue += lineRev;
          cur.cogs += lineCogs;
          cur.gm += lineRev - lineCogs;
          agg.set(key, cur);
        }
      } else {
        const key = ymKey(startY, startM);
        const cur =
          agg.get(key) || {
            key, y: startY, m: startM,
            revenue: 0, cogs: 0, gm: 0,
            services_rev: 0, services_cogs: 0, rebates_contra: 0,
            overheads: 0, capex_depr: 0, fx_impact: 0, tax: 0,
          };
        cur.revenue += lineRev;
        cur.cogs += lineCogs;
        cur.gm += lineRev - lineCogs;
        agg.set(key, cur);
      }
    }
    return [...agg.values()].sort((a, b) => a.y - b.y || a.m - b.m);
  }, [boq]);

  /** Rebates preview — same root (/scenarios) */
  useEffect(() => {
    async function loadRebates(fromYM: string, toYM: string) {
      setRebatesLoading(true);
      setRebatesErr(null);
      const url = `/scenarios/${scenarioId}/rebates/preview?from=${encodeURIComponent(fromYM)}&to=${encodeURIComponent(toYM)}&mode=monthly`;
      try {
        const resp = await apiGet<RebatesPreviewResp>(url);
        const map: Record<string, number> = {};
        for (const it of resp.items ?? []) map[it.ym] = Number(it.accrual) || 0;
        setRebatesMap(map);
      } catch (e: any) {
        const status = e?.response?.status ?? "ERR";
        // axios bazı 'Network Error' vakalarında config.url vermez; o yüzden kendi url’imizi yazıyoruz.
        setRebatesErr(`[${status}] GET ${url} — Failed to fetch (possible CORS issue or server is unreachable)`);
        setRebatesMap({});
      } finally {
        setRebatesLoading(false);
      }
    }

    if (baseRows.length) {
      const fromYM = `${baseRows[0].y}-${pad2(baseRows[0].m)}`;
      const last = baseRows[baseRows.length - 1];
      const toYM = `${last.y}-${pad2(last.m)}`;
      loadRebates(fromYM, toYM);
    } else {
      setRebatesMap({});
    }
  }, [scenarioId, baseRows]);

  /** Final rows with rebates overlay */
  const rows = useMemo<MonthAgg[]>(() => {
    if (!baseRows.length) return [];
    return baseRows.map((r) => ({ ...r, rebates_contra: rebatesMap[r.key] ?? 0 }));
  }, [baseRows, rebatesMap]);

  /** Totals & KPIs */
  const totals = useMemo(() => {
    return rows.reduce(
      (s, r) => {
        const totalRev = r.revenue + r.services_rev + r.rebates_contra;
        const totalCogs = r.cogs + r.services_cogs;
        const gm = totalRev - totalCogs;

        s.revenue += totalRev;
        s.cogs += totalCogs;
        s.gm += gm;
        s.ebitda += gm - r.overheads;
        s.ebit += gm - r.overheads - r.capex_depr;
        s.net += (gm - r.overheads - r.capex_depr) + r.fx_impact - r.tax;

        s.fx += r.fx_impact; s.tax += r.tax;
        return s;
      },
      { revenue: 0, cogs: 0, gm: 0, ebitda: 0, ebit: 0, net: 0, fx: 0, tax: 0 }
    );
  }, [rows]);

  const kpi = useMemo(() => {
    const rev = totals.revenue, cogs = totals.cogs, gm = totals.gm;
    const gmPct = rev !== 0 ? (gm / rev) * 100 : 0;
    return { revenue: rev, cogs, gm, gmPct, ebitda: totals.ebitda, ebit: totals.ebit, net: totals.net };
  }, [totals]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">Summary</h3>
        <div className="flex items-center gap-2">
          {(loading || rebatesLoading) && <span className="text-xs text-gray-500">Loading…</span>}
          <button onClick={loadBOQ} className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200" disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Revenue" value={fmtMoney(kpi.revenue)} />
        <KPI label="COGS" value={fmtMoney(kpi.cogs)} />
        <KPI label="Gross Margin" value={fmtMoney(kpi.gm)} hint={fmtPct(kpi.gmPct)} />
        <KPI label="EBITDA (approx.)" value={fmtMoney(kpi.ebitda)} />
        <KPI label="EBIT (approx.)" value={fmtMoney(kpi.ebit)} />
        <KPI label="FX Impact" value={fmtMoney(totals.fx)} />
        <KPI label="Tax" value={fmtMoney(totals.tax)} />
        <KPI label="Net Income (approx.)" value={fmtMoney(kpi.net)} />
      </div>

      {/* Errors */}
      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-2 rounded">{err}</div>}
      {rebatesErr && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 p-2 rounded">
          Rebates preview: {rebatesErr}
        </div>
      )}

      {/* Monthly table */}
      <div className="overflow-auto border rounded bg-white">
        <table className="min-w-full text-[13px] tabular-nums">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-100 text-gray-800">
              <th rowSpan={2} className="min-w-[90px] sticky left-0 z-20 bg-gray-100 border border-gray-300 px-3 py-2 text-left">Y/M</th>
              <th colSpan={4} className="border border-gray-300 px-3 py-2 text-center">Revenue</th>
              <th colSpan={4} className="border border-gray-300 px-3 py-2 text-center">Costs</th>
              <th rowSpan={2} className="border border-gray-300 px-3 py-2 text-center">Gross Margin</th>
              <th colSpan={2} className="border border-gray-300 px-3 py-2 text-center">Below the Line</th>
              <th rowSpan={2} className="border border-gray-300 px-3 py-2 text-center">Net (approx.)</th>
            </tr>
            <tr className="bg-gray-100 text-gray-800">
              <th className="border border-gray-300 px-3 py-2 text-right">BOQ</th>
              <th className="border border-gray-300 px-3 py-2 text-right">Services</th>
              <th className="border border-gray-300 px-3 py-2 text-right">Rebates (–)</th>
              <th className="border border-gray-300 px-3 py-2 text-right">Total</th>
              <th className="border border-gray-300 px-3 py-2 text-right">BOQ COGS</th>
              <th className="border border-gray-300 px-3 py-2 text-right">Services COGS</th>
              <th className="border border-gray-300 px-3 py-2 text-right">Overheads</th>
              <th className="border border-gray-300 px-3 py-2 text-right">Deprec.</th>
              <th className="border border-gray-300 px-3 py-2 text-right">FX</th>
              <th className="border border-gray-300 px-3 py-2 text-right">Tax</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r, idx) => {
              const totalRev = r.revenue + r.services_rev + r.rebates_contra;
              const totalCogs = r.cogs + r.services_cogs + r.overheads + r.capex_depr;
              const gm = totalRev - (r.cogs + r.services_cogs);
              const net = gm - r.overheads - r.capex_depr + r.fx_impact - r.tax;
              return (
                <tr key={r.key} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                  <td className="sticky left-0 z-10 bg-inherit border border-gray-300 px-3 py-2 text-left">{r.y}/{pad2(r.m)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">{fmtMoney(r.revenue)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">{fmtMoney(r.services_rev)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">{fmtMoney(r.rebates_contra)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right font-medium">{fmtMoney(totalRev)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">{fmtMoney(r.cogs)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">{fmtMoney(r.services_cogs)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">{fmtMoney(r.overheads)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">{fmtMoney(r.capex_depr)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right font-medium">{fmtMoney(gm)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">{fmtMoney(r.fx_impact)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">{fmtMoney(r.tax)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right font-semibold">{fmtMoney(net)}</td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr className="bg-emerald-50 font-semibold">
              <td className="sticky left-0 z-10 bg-emerald-50 border border-gray-300 px-3 py-2">Totals</td>
              <td className="border border-gray-300 px-3 py-2 text-right">{fmtMoney(rows.reduce((s, r) => s + r.revenue, 0))}</td>
              <td className="border border-gray-300 px-3 py-2 text-right">{fmtMoney(rows.reduce((s, r) => s + r.services_rev, 0))}</td>
              <td className="border border-gray-300 px-3 py-2 text-right">{fmtMoney(rows.reduce((s, r) => s + r.rebates_contra, 0))}</td>
              <td className="border border-gray-300 px-3 py-2 text-right">{fmtMoney(rows.reduce((s, r) => s + (r.revenue + r.services_rev + r.rebates_contra), 0))}</td>
              <td className="border border-gray-300 px-3 py-2 text-right">{fmtMoney(rows.reduce((s, r) => s + r.cogs, 0))}</td>
              <td className="border border-gray-300 px-3 py-2 text-right">{fmtMoney(rows.reduce((s, r) => s + r.services_cogs, 0))}</td>
              <td className="border border-gray-300 px-3 py-2 text-right">{fmtMoney(rows.reduce((s, r) => s + r.overheads, 0))}</td>
              <td className="border border-gray-300 px-3 py-2 text-right">{fmtMoney(rows.reduce((s, r) => s + r.capex_depr, 0))}</td>
              <td className="border border-gray-300 px-3 py-2 text-right">{fmtMoney(rows.reduce((s, r) => s + ((r.revenue + r.services_rev + r.rebates_contra) - (r.cogs + r.services_cogs)), 0))}</td>
              <td className="border border-gray-300 px-3 py-2 text-right">{fmtMoney(rows.reduce((s, r) => s + r.fx_impact, 0))}</td>
              <td className="border border-gray-300 px-3 py-2 text-right">{fmtMoney(rows.reduce((s, r) => s + r.tax, 0))}</td>
              <td className="border border-gray-300 px-3 py-2 text-right">
                {fmtMoney(rows.reduce((s, r) => {
                  const gm = (r.revenue + r.services_rev + r.rebates_contra) - (r.cogs + r.services_cogs);
                  return s + (gm - r.overheads - r.capex_depr + r.fx_impact - r.tax);
                }, 0))}
              </td>
            </tr>
          </tfoot>
        </table>

        <div className="px-3 py-2 text-xs text-gray-500">
          Excel-style layout with live <strong>Rebates (contra)</strong> overlay via
          <code> /scenarios/:id/rebates/preview</code>. Core data (BOQ) via <code>/scenarios/:id/boq</code>.
        </div>
      </div>

      {/* Contribution blocks */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-md border bg-white p-3">
          <div className="font-medium mb-2">Revenue Contributors</div>
          <ul className="text-sm space-y-1 text-gray-700">
            <li>• BOQ Revenue (active) ✅</li>
            <li>• Services Revenue (placeholder) ⏳</li>
            <li>• Rebates (contra-revenue) ✅ (preview)</li>
          </ul>
        </div>
        <div className="rounded-md border bg-white p-3">
          <div className="font-medium mb-2">Cost & Overheads</div>
          <ul className="text-sm space-y-1 text-gray-700">
            <li>• BOQ COGS (active) ✅</li>
            <li>• Services COGS (placeholder) ⏳</li>
            <li>• Overheads (placeholder) ⏳</li>
            <li>• CAPEX Depreciation (placeholder) ⏳</li>
          </ul>
        </div>
        <div className="rounded-md border bg-white p-3">
          <div className="font-medium mb-2">Below the Line</div>
          <ul className="text-sm space-y-1 text-gray-700">
            <li>• FX Impact (placeholder) ⏳</li>
            <li>• Tax (placeholder) ⏳</li>
            <li>• Net Income (approx.) derived on the table</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
// [END FILE] frontend/src/pages/scenario/tabs/SummaryTab.tsx
