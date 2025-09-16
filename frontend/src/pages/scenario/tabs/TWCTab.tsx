import { useMemo, useState } from "react";
import type {
  ScenarioDetail,
  CapexRow,
  FinanceMode,
  PLResponse,
} from "../../../types/scenario";
import { Card, Field, KV } from "../../../components/ui";
import {
  fmt,
  fmtMonthYY,
  getNumberClass,
  FIRST_COL_W,
  MONTH_COL_W,
} from "../../../utils/format";
import { isInWindow, monthIndex } from "../../../utils/scenarioWindow";

export default function TWCTab({
  data,
  pl,
}: {
  data: ScenarioDetail;
  pl: PLResponse | null;
}) {
  // ---- inputs ----
  const [mode, setMode] = useState<FinanceMode>("fcf");
  const [wacc, setWacc] = useState("12");
  const [taxRate, setTaxRate] = useState("25");
  const [capexRows, setCapexRows] = useState<CapexRow[]>([]);
  const [deprLifeYears, setDeprLifeYears] = useState("5");
  const [deprStart, setDeprStart] = useState<"next" | "same">("next");
  const [treatFirstAsT0, setTreatFirstAsT0] = useState(true);
  const [dso, setDso] = useState("45");
  const [dpo, setDpo] = useState("30");
  const [dio, setDio] = useState("60");

  // scenario start YM (UTC)
  const startDate = new Date(data.start_date);
  const startY = startDate.getUTCFullYear();
  const startM = startDate.getUTCMonth() + 1;

  // ---- capex table ops ----
  const addCapexRow = () =>
    setCapexRows((r) => [...r, { year: startY, month: startM, amount: 0 }]);
  const changeCapexRow = (i: number, next: CapexRow) =>
    setCapexRows((rows) => rows.map((r, idx) => (idx === i ? next : r)));
  const removeCapexRow = (i: number) =>
    setCapexRows((rows) => rows.filter((_, idx) => idx !== i));

  // ---- finance calc ----
  const finance = useMemo(() => {
    const months = data.months;
    const annual = Number(wacc || "0") / 100;
    const r = Math.pow(1 + annual, 1 / 12) - 1;

    const plMonths = pl?.months ?? [];
    const havePL = plMonths.length === months;

    // series
    const ebit: number[] = new Array(months).fill(0);
    const revenue: number[] = new Array(months).fill(0);
    const cogs: number[] = new Array(months).fill(0);
    if (havePL) {
      for (let i = 0; i < months; i++) {
        ebit[i] = plMonths[i].ebit ?? 0;
        revenue[i] = plMonths[i].revenue ?? 0;
        cogs[i] = plMonths[i].cogs ?? 0;
      }
    }

    // capex timeline
    const capex: number[] = new Array(months).fill(0);
    for (const row of capexRows) {
      if (!isInWindow(data, row.year, row.month)) continue;
      const idx = monthIndex(data, row.year, row.month);
      if (idx >= 0 && idx < months) capex[idx] += Number(row.amount || 0);
    }

    // t0 treatment
    let t0 = 0;
    if (treatFirstAsT0) {
      let firstMonthCapex = 0;
      for (const row of capexRows) {
        if (row.year === startY && row.month === startM)
          firstMonthCapex += Number(row.amount || 0);
      }
      if (firstMonthCapex !== 0) {
        t0 -= firstMonthCapex;
        capex[0] = Math.max(0, (capex[0] || 0) - firstMonthCapex);
      }
    }

    // depreciation
    const lifeMonths = Math.max(1, Math.round(Number(deprLifeYears || "1") * 12));
    const depreciation: number[] = new Array(months).fill(0);
    const startOffset = deprStart === "next" ? 1 : 0;
    for (let t = 0; t < months; t++) {
      const c = capex[t];
      if (c > 0 && lifeMonths > 0) {
        const perMonth = c / lifeMonths;
        for (let k = 0; k < lifeMonths; k++) {
          const idx = t + startOffset + k;
          if (idx < months) depreciation[idx] += perMonth;
        }
      }
    }

    // taxes (only on positive EBIT)
    const taxMonthlyRate = Number(taxRate || "0") / 100 / 12;
    const taxes: number[] = ebit.map((e) => (e > 0 ? e * taxMonthlyRate : 0));

    // working capital
    const ds = Number(dso || "0");
    const dp = Number(dpo || "0");
    const di = Number(dio || "0");
    const ar: number[] = new Array(months).fill(0);
    const inv: number[] = new Array(months).fill(0);
    const ap: number[] = new Array(months).fill(0);
    const nwc: number[] = new Array(months).fill(0);
    if (havePL) {
      for (let i = 0; i < months; i++) {
        ar[i] = revenue[i] * (ds / 30);
        inv[i] = cogs[i] * (di / 30);
        ap[i] = cogs[i] * (dp / 30);
        nwc[i] = ar[i] + inv[i] - ap[i];
      }
    }
    const deltaWC: number[] = new Array(months).fill(0);
    for (let i = 0; i < months; i++) {
      const prev = i === 0 ? 0 : nwc[i - 1];
      deltaWC[i] = nwc[i] - prev; // increase -> cash out
    }

    // FCF
    const fcf: number[] = new Array(months).fill(0);
    for (let i = 0; i < months; i++) {
      fcf[i] =
        (ebit[i] ?? 0) - taxes[i] + depreciation[i] - capex[i] - deltaWC[i];
    }

    // NPV / IRR
    const npv = (cf: number[], rate: number) =>
      cf.reduce((acc, v, i) => acc + v / Math.pow(1 + rate, i + 1), 0);
    const irr = (cf0: number, cf: number[]) => {
      let lo = -0.99,
        hi = 10;
      const f = (rr: number) =>
        cf0 + cf.reduce((acc, v, i) => acc + v / Math.pow(1 + rr, i + 1), 0);
      for (let it = 0; it < 120; it++) {
        const mid = (lo + hi) / 2;
        const val = f(mid);
        if (Math.abs(val) < 1e-9) return mid;
        if (val > 0) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    };

    const selectedCF =
      mode === "proxy" && havePL
        ? plMonths.map((m) => m.net_income ?? 0)
        : fcf;
    const projectNPV = t0 + npv(selectedCF, r);
    const irrMonthly = selectedCF.length > 0 ? irr(t0, selectedCF) : 0;
    const irrAnnual = (1 + irrMonthly) ** 12 - 1;

    // labels & preview
    const labels = havePL
      ? plMonths.map((m) => ({ y: m.year, m: m.month }))
      : [];
    const preview = [
      "t0:" + fmt(t0),
      ...selectedCF.slice(0, 8).map((v, i) => `t${i + 1}:${fmt(v)}`),
    ].join(" | ");

    return {
      rMonthly: r,
      havePL,
      npv: projectNPV,
      irrMonthly,
      irrAnnual,
      preview,
      cfBasis: mode === "proxy" ? "Net Income (proxy)" : "Free Cash Flow",
      labels,
      ebit,
      taxes,
      depreciation,
      capex,
      deltaWC,
      fcf,
    };
  }, [
    data,
    pl,
    mode,
    wacc,
    taxRate,
    capexRows,
    deprLifeYears,
    deprStart,
    treatFirstAsT0,
    dso,
    dpo,
    dio,
    startY,
    startM,
  ]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Inputs */}
      <Card>
        <div className="text-sm font-medium mb-3">TWC / Cash Flow Inputs</div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="WACC % (annual)">
            <input
              type="number"
              value={wacc}
              onChange={(e) => setWacc(e.target.value)}
              className="w-full px-3 py-2 rounded-md border text-sm"
            />
          </Field>
          <Field label="Tax Rate % (annual)">
            <input
              type="number"
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
              className="w-full px-3 py-2 rounded-md border text-sm"
            />
          </Field>
          <Field label="Cash Flow Basis">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as FinanceMode)}
              className="w-full px-3 py-2 rounded-md border text-sm"
            >
              <option value="fcf">Free Cash Flow</option>
              <option value="proxy">Net Income (proxy)</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
          <Field label="DSO (days)">
            <input
              type="number"
              value={dso}
              onChange={(e) => setDso(e.target.value)}
              className="w-full px-3 py-2 rounded-md border text-sm"
            />
          </Field>
          <Field label="DPO (days)">
            <input
              type="number"
              value={dpo}
              onChange={(e) => setDpo(e.target.value)}
              className="w-full px-3 py-2 rounded-md border text-sm"
            />
          </Field>
          <Field label="DIO (days)">
            <input
              type="number"
              value={dio}
              onChange={(e) => setDio(e.target.value)}
              className="w-full px-3 py-2 rounded-md border text-sm"
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <Field label="Depreciation Life (years)">
            <input
              type="number"
              value={deprLifeYears}
              min={1}
              step={1}
              onChange={(e) => setDeprLifeYears(e.target.value)}
              className="w-full px-3 py-2 rounded-md border text-sm"
            />
          </Field>
          <Field label="Depreciation Starts">
            <select
              value={deprStart}
              onChange={(e) =>
                setDeprStart(e.target.value as "next" | "same")
              }
              className="w-full px-3 py-2 rounded-md border text-sm"
            >
              <option value="next">Next month</option>
              <option value="same">Same month</option>
            </select>
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm mt-3">
          <input
            type="checkbox"
            checked={treatFirstAsT0}
            onChange={(e) => setTreatFirstAsT0(e.target.checked)}
          />
          Treat first-month Capex as <b>t0</b>
        </label>
      </Card>

      {/* Capex */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium">Capex Plan (monthly)</div>
          <button
            onClick={addCapexRow}
            className="px-2 py-1 rounded border text-sm hover:bg-gray-50"
          >
            + Add Row
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-1 pr-3">Year</th>
                <th className="py-1 pr-3">Month</th>
                <th className="py-1 pr-3">Amount</th>
                <th className="py-1 pr-3 w-16" />
              </tr>
            </thead>
            <tbody>
              {capexRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-2 text-gray-500">
                    No capex yet.
                  </td>
                </tr>
              ) : (
                capexRows.map((r, idx) => {
                  const out = !isInWindow(data, r.year, r.month);
                  const danger = out ? "border-red-400 focus:ring-red-500" : "";
                  return (
                    <tr key={idx} className="border-b last:border-0">
                      <td className="py-1 pr-3">
                        <input
                          type="number"
                          value={r.year}
                          onChange={(e) =>
                            changeCapexRow(idx, {
                              ...r,
                              year: Number(e.target.value),
                            })
                          }
                          className={`w-24 px-2 py-1 rounded border text-sm ${danger}`}
                        />
                      </td>
                      <td className="py-1 pr-3">
                        <input
                          type="number"
                          value={r.month}
                          min={1}
                          max={12}
                          onChange={(e) =>
                            changeCapexRow(idx, {
                              ...r,
                              month: Number(e.target.value),
                            })
                          }
                          className={`w-20 px-2 py-1 rounded border text-sm ${danger}`}
                        />
                      </td>
                      <td className="py-1 pr-3">
                        <input
                          type="number"
                          value={r.amount}
                          onChange={(e) =>
                            changeCapexRow(idx, {
                              ...r,
                              amount: Number(e.target.value),
                            })
                          }
                          className="w-32 px-2 py-1 rounded border text-sm"
                        />
                      </td>
                      <td className="py-1 pr-3 text-right">
                        <button
                          onClick={() => removeCapexRow(idx)}
                          className="px-2 py-1 rounded border hover:bg-gray-50"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Results */}
      <Card>
        <div className="text-sm font-medium mb-3">NPV / IRR</div>
        {!finance?.havePL ? (
          <div className="text-sm text-gray-500">Önce P&L hesapla.</div>
        ) : (
          <>
            <KV
              label="Monthly discount r"
              value={`${(finance.rMonthly * 100).toFixed(4)} %`}
            />
            <KV label={`NPV (${finance.cfBasis})`} value={fmt(finance.npv)} />
            <KV
              label="IRR (monthly)"
              value={`${(finance.irrMonthly * 100).toFixed(4)} %`}
            />
            <KV
              label="IRR (annualized)"
              value={`${(finance.irrAnnual * 100).toFixed(4)} %`}
            />
            <div className="text-xs text-gray-500 mt-3">
              Preview (first 8):{" "}
              <code className="text-[11px]">{finance.preview}</code>
            </div>
          </>
        )}
      </Card>

      {/* Debug table */}
      <div className="lg:col-span-3">
        <Card>
          <div className="text-sm font-medium mb-2">FCF Debug Table</div>
          {!finance?.havePL ? (
            <div className="text-sm text-gray-500">
              Tabloyu görmek için önce P&L’i hesapla.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-max text-xs table-fixed">
                <thead>
                  <tr className="border-b">
                    <th
                      className="sticky left-0 bg-white py-1 px-2 text-left"
                      style={{ width: FIRST_COL_W, minWidth: FIRST_COL_W }}
                    >
                      Line
                    </th>
                    {finance.labels.map((lm, i) => (
                      <th
                        key={i}
                        className="py-1 px-2 text-right whitespace-nowrap"
                        style={{ width: MONTH_COL_W, minWidth: MONTH_COL_W }}
                      >
                        {fmtMonthYY(lm.y, lm.m)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "EBIT", arr: finance.ebit },
                    { label: "Tax (paid)", arr: finance.taxes },
                    { label: "Depreciation", arr: finance.depreciation },
                    { label: "Capex", arr: finance.capex },
                    { label: "Δ Working Capital", arr: finance.deltaWC },
                    {
                      label: "FCF = EBIT − Tax + Dep − Capex − ΔWC",
                      arr: finance.fcf,
                    },
                  ].map((row) => (
                    <tr key={row.label} className="border-b last:border-0">
                      <td
                        className="sticky left-0 bg-white py-1 px-2 font-medium"
                        style={{
                          width: FIRST_COL_W,
                          minWidth: FIRST_COL_W,
                        }}
                      >
                        {row.label}
                      </td>
                      {row.arr.map((v: number, idx: number) => (
                        <td
                          key={idx}
                          className={`py-1 px-2 text-right ${getNumberClass(
                            v,
                          )}`}
                          style={{ width: MONTH_COL_W, minWidth: MONTH_COL_W }}
                        >
                          {fmt(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
