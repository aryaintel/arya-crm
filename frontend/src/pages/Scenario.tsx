import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { apiGet, apiPost, apiPatch, apiDelete, apiPut, ApiError } from "../lib/api";

/** ---- Sabit kolon genişlikleri (px) ---- */
const FIRST_COL_W = 160; // Product / Line sütunu
const MONTH_COL_W = 92;  // Tüm ay sütunları

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
  amount: number; // BE: fixed = amount, %_revenue = fraction (0.2 => 20%)
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

type PLMonth = {
  year: number;
  month: number;
  revenue: number;
  cogs: number;
  gross_margin: number;
  overhead_fixed: number;
  overhead_var_pct: number;
  overhead_var_amount: number;
  overhead_total: number;
  ebit: number;
  net_income: number;
};

type PLResponse = {
  scenario: {
    id: number;
    name: string;
    months: number;
    start_date: string;
    overheads: { fixed_sum: number; pct_sum: number };
  };
  months: PLMonth[];
  totals: {
    revenue: number;
    cogs: number;
    gross_margin: number;
    overhead_fixed_total: number;
    overhead_var_total: number;
    overhead_total: number;
    ebit: number;
    net_income: number;
  };
};

/** ------------ Finance (client-side) types ------------ */
type CapexRow = { year: number; month: number; amount: number };
type FinanceMode = "proxy" | "fcf";

/** ------------ Page ------------ */
export default function ScenarioPage() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const sid = Number(scenarioId);

  // 3 tab: P&L, TWC, Volumes
  const [tab, setTab] = useState<"pl" | "twc" | "volumes">("pl");

  const [data, setData] = useState<ScenarioDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // compute result (optional)
  const [pl, setPl] = useState<PLResponse | null>(null);

  // product modal
  const [openProd, setOpenProd] = useState(false);
  const [editingProd, setEditingProd] = useState<ScenarioProduct | null>(null);
  const [prodForm, setProdForm] = useState({
    name: "",
    price: "0",
    unit_cogs: "0",
    is_active: true,
  });

  // months modal
  const [openMonths, setOpenMonths] = useState(false);
  const [monthsProduct, setMonthsProduct] = useState<ScenarioProduct | null>(null);
  const [monthsRows, setMonthsRows] = useState<ProductMonth[]>([]);

  // overhead modal
  const [openOvh, setOpenOvh] = useState(false);
  const [editingOvh, setEditingOvh] = useState<ScenarioOverhead | null>(null);
  const [ovhForm, setOvhForm] = useState<{
    name: string;
    type: "fixed" | "%_revenue";
    amount: string; // UI: %_revenue -> 0–100; fixed -> amount
  }>({
    name: "",
    type: "fixed",
    amount: "0",
  });

  const isProdValid = useMemo(() => prodForm.name.trim().length > 0, [prodForm]);

  // ---- Overhead validation (0–100 when % selected) ----
  const isOvhValid = useMemo(() => {
    const nameOk = ovhForm.name.trim().length > 0;
    const val = Number(ovhForm.amount);
    if (!Number.isFinite(val)) return false;
    if (ovhForm.type === "%_revenue") return nameOk && val >= 0 && val <= 100;
    return nameOk && val >= 0;
  }, [ovhForm]);

  const fetchScenario = async () => {
    setLoading(true);
    setError(null);
    setPl(null);
    try {
      const payload = await apiGet<ScenarioDetail>(`/business-cases/scenarios/${sid}`);
      setData(payload);
    } catch (e: any) {
      const msg =
        (e instanceof ApiError && e.message) ||
        e?.response?.data?.detail ||
        e?.message ||
        "Load failed";
      setError(String(msg));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!sid) {
      setError("Invalid scenario id");
      setLoading(false);
      return;
    }
    fetchScenario();
  }, [sid]);

  /** ------------ Helpers for scenario window ------------ */
  function getScenarioWindow() {
    if (!data) return null;
    const start = new Date(data.start_date);
    if (Number.isNaN(start.getTime())) return null;
    const startY = start.getUTCFullYear();
    const startM = start.getUTCMonth() + 1; // 1..12
    const end = new Date(Date.UTC(startY, startM - 1 + (data.months - 1), 1));
    const endY = end.getUTCFullYear();
    const endM = end.getUTCMonth() + 1;
    return { startY, startM, endY, endM, start, end };
  }
  function isInWindow(y: number, m: number) {
    const w = getScenarioWindow();
    if (!w) return true;
    const a = y * 100 + m;
    const s = w.startY * 100 + w.startM;
    const e = w.endY * 100 + w.endM;
    return a >= s && a <= e;
  }
  function monthIndex(year: number, month: number) {
    const w = getScenarioWindow();
    if (!w) return 0;
    return (year - w.startY) * 12 + (month - w.startM);
  }
  function buildMonthsList() {
    const w = getScenarioWindow();
    if (!w || !data) return [];
    const out: { y: number; m: number }[] = [];
    let y = w.startY, m = w.startM;
    for (let i = 0; i < data.months; i++) {
      out.push({ y, m });
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }

  /** ------------ Products ------------ */
  const onNewProd = () => {
    setEditingProd(null);
    setProdForm({ name: "", price: "0", unit_cogs: "0", is_active: true });
    setOpenProd(true);
  };

  const onEditProd = (p: ScenarioProduct) => {
    setEditingProd(p);
    setProdForm({
      name: p.name,
      price: String(p.price ?? 0),
      unit_cogs: String(p.unit_cogs ?? 0),
      is_active: !!p.is_active,
    });
    setOpenProd(true);
  };

  const onSaveProd = async () => {
    if (!isProdValid || !data) return;
    const base = {
      name: prodForm.name.trim(),
      price: Number(prodForm.price || 0),
      unit_cogs: Number(prodForm.unit_cogs || 0),
      is_active: !!prodForm.is_active,
    };
    try {
      if (editingProd) {
        await apiPatch(`/business-cases/scenarios/products/${editingProd.id}`, base);
      } else {
        await apiPost(`/business-cases/scenarios/${data.id}/products`, base);
      }
      setOpenProd(false);
      await fetchScenario();
    } catch (e: any) {
      alert(
        (e instanceof ApiError && e.message) ||
          e?.response?.data?.detail ||
          e?.message ||
          "Save failed",
      );
    }
  };

  const onDeleteProd = async (p: ScenarioProduct) => {
    if (!confirm(`Delete product "${p.name}"?`)) return;
    try {
      await apiDelete(`/business-cases/scenarios/products/${p.id}`);
      await fetchScenario();
    } catch (e: any) {
      alert(
        (e instanceof ApiError && e.message) ||
          e?.response?.data?.detail ||
          e?.message ||
          "Delete failed",
      );
    }
  };

  /** ------------ Months (bulk upsert) ------------ */
  const openMonthsEditor = (p: ScenarioProduct) => {
    setMonthsProduct(p);
    const rows = [...(p.months ?? [])].sort((a, b) => a.year - b.year || a.month - b.month);
    if (rows.length > 0) {
      setMonthsRows(rows);
    } else {
      const w = getScenarioWindow();
      const startY = w?.startY ?? new Date().getUTCFullYear();
      const startM = w?.startM ?? 1;
      setMonthsRows([{ year: startY, month: startM, quantity: 0 }]);
    }
    setOpenMonths(true);
  };

  const addMonthsRow = () => {
    if (monthsRows.length === 0) {
      const w = getScenarioWindow();
      const startY = w?.startY ?? new Date().getUTCFullYear();
      const startM = w?.startM ?? 1;
      setMonthsRows([{ year: startY, month: startM, quantity: 0 }]);
      return;
    }
    const last = monthsRows[monthsRows.length - 1];
    const next: ProductMonth = {
      year: last.month === 12 ? last.year + 1 : last.year,
      month: last.month === 12 ? 1 : last.month + 1,
      quantity: 0,
    };
    setMonthsRows((r) => [...r, next]);
  };

  const onSaveMonths = async () => {
    if (!monthsProduct || !data) return;

    const payload = monthsRows
      .map((r) => ({
        year: Number(r.year),
        month: Number(r.month),
        quantity: Number(r.quantity),
      }))
      .filter((r) => r.year >= 1900 && r.month >= 1 && r.month <= 12)
      .filter((r) => isInWindow(r.year, r.month));

    try {
      await apiPut(`/business-cases/scenarios/products/${monthsProduct.id}/months`, payload);
      setOpenMonths(false);
      await fetchScenario();
    } catch (e: any) {
      alert(
        (e instanceof ApiError && e.message) ||
          e?.response?.data?.detail ||
          e?.message ||
          "Save failed",
      );
    }
  };

  /** ------------ Overheads ------------ */
  const onNewOvh = () => {
    setEditingOvh(null);
    setOvhForm({ name: "", type: "fixed", amount: "0" });
    setOpenOvh(true);
  };

  const onEditOvh = (o: ScenarioOverhead) => {
    setEditingOvh(o);
    setOvhForm({
      name: o.name,
      type: o.type,
      amount: String(o.type === "%_revenue" ? (o.amount ?? 0) * 100 : (o.amount ?? 0)),
    });
    setOpenOvh(true);
  };

  const onSaveOvh = async () => {
    if (!data || !isOvhValid) return;

    const raw = Number(ovhForm.amount || 0);
    const amountToSend = ovhForm.type === "%_revenue" ? raw / 100 : raw;

    const base = {
      name: ovhForm.name.trim(),
      type: ovhForm.type,
      amount: amountToSend,
    };
    try {
      if (editingOvh) {
        await apiPatch(`/business-cases/scenarios/overheads/${editingOvh.id}`, base);
      } else {
        await apiPost(`/business-cases/scenarios/${data.id}/overheads`, base);
      }
      setOpenOvh(false);
      await fetchScenario();
    } catch (e: any) {
      alert(
        (e instanceof ApiError && e.message) ||
          e?.response?.data?.detail ||
          e?.message ||
          "Save failed",
      );
    }
  };

  const onDeleteOvh = async (o: ScenarioOverhead) => {
    if (!confirm(`Delete overhead "${o.name}"?`)) return;
    try {
      await apiDelete(`/business-cases/scenarios/overheads/${o.id}`);
      await fetchScenario();
    } catch (e: any) {
      alert(
        (e instanceof ApiError && e.message) ||
          e?.response?.data?.detail ||
          e?.message ||
          "Delete failed",
      );
    }
  };

  /** ------------ Compute P&L (backend) ------------ */
  const onCompute = async () => {
    try {
      const res = await apiPost<PLResponse>(`/business-cases/scenarios/${sid}/compute`, {});
      setPl(res);
    } catch (e: any) {
      alert(
        (e instanceof ApiError && e.message) ||
          e?.response?.data?.detail ||
          e?.message ||
          "Compute failed",
      );
    }
  };

  /** ------------ Finance (client-side) state ------------ */
  const [mode, setMode] = useState<FinanceMode>("fcf"); // default FCF
  const [wacc, setWacc] = useState("12"); // annual %
  const [fxInfo, setFxInfo] = useState("1"); // info only
  const [cpiInfo, setCpiInfo] = useState("2"); // info only

  const [taxRate, setTaxRate] = useState("25"); // annual %
  const [capexRows, setCapexRows] = useState<CapexRow[]>([]);
  const [deprLifeYears, setDeprLifeYears] = useState("5"); // straight-line
  const [deprStart, setDeprStart] = useState<"next" | "same">("next"); // amortisman başlangıcı
  const [treatFirstAsT0, setTreatFirstAsT0] = useState(true); // ilk ay capex'i t0 say
  const [dso, setDso] = useState("45");
  const [dpo, setDpo] = useState("30");
  const [dio, setDio] = useState("60");

  const addCapexRow = () => {
    const w = getScenarioWindow();
    const y = w?.startY ?? new Date().getUTCFullYear();
    const m = w?.startM ?? 1;
    setCapexRows((r) => [...r, { year: y, month: m, amount: 0 }]);
  };
  const changeCapexRow = (i: number, next: CapexRow) => {
    setCapexRows((rows) => rows.map((r, idx) => (idx === i ? next : r)));
  };
  const removeCapexRow = (i: number) => {
    setCapexRows((rows) => rows.filter((_, idx) => idx !== i));
  };

  /** ------------ Finance (client-side) calculations ------------ */
  const finance = useMemo(() => {
    if (!data) return null;

    const months = data.months;
    const annual = Number(wacc) / 100;
    const r = Math.pow(1 + annual, 1 / 12) - 1; // monthly discount from annual WACC

    // Need pl for EBIT/Revenue/COGS series
    const plMonths = pl?.months ?? [];
    const havePL = plMonths.length === months;

    // Build arrays
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

    // Capex timeline
    const capex: number[] = new Array(months).fill(0);
    for (const row of capexRows) {
      if (!isInWindow(row.year, row.month)) continue;
      const idx = monthIndex(row.year, row.month);
      if (idx >= 0 && idx < months) capex[idx] += Number(row.amount || 0);
    }

    // Treat first-month Capex as t0 (and remove from month-1 to avoid double count)
    let t0 = 0;
    const w = getScenarioWindow();
    if (w && treatFirstAsT0) {
      let firstMonthCapex = 0;
      for (const row of capexRows) {
        if (row.year === w.startY && row.month === w.startM) firstMonthCapex += Number(row.amount || 0);
      }
      if (firstMonthCapex !== 0) {
        t0 -= firstMonthCapex;
        capex[0] = Math.max(0, (capex[0] || 0) - firstMonthCapex);
      }
    }

    // Depreciation – straight-line per capex item over life
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

    // Taxes (simple): tax = max(0, EBIT) * (annual tax / 12)
    const taxMonthlyRate = Number(taxRate || "0") / 100 / 12;
    const taxes: number[] = ebit.map((e) => (e > 0 ? e * taxMonthlyRate : 0));

    // Working capital: AR = Revenue*DSO/30, INV = COGS*DIO/30, AP = COGS*DPO/30
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

    // Free Cash Flow = EBIT – Taxes + Depreciation – Capex – ΔWC
    const fcf: number[] = new Array(months).fill(0);
    for (let i = 0; i < months; i++) {
      fcf[i] = (ebit[i] ?? 0) - taxes[i] + depreciation[i] - capex[i] - deltaWC[i];
    }

    // Discounting helpers
    const npv = (cf: number[], rate: number) =>
      cf.reduce((acc, v, i) => acc + v / Math.pow(1 + rate, i + 1), 0);

    const irr = (cf0: number, cf: number[]) => {
      let lo = -0.99, hi = 10;
      const f = (rr: number) => cf0 + cf.reduce((acc, v, i) => acc + v / Math.pow(1 + rr, i + 1), 0);
      for (let it = 0; it < 120; it++) {
        const mid = (lo + hi) / 2;
        const val = f(mid);
        if (Math.abs(val) < 1e-9) return mid;
        if (val > 0) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    };

    const selectedCF = mode === "proxy" && havePL ? (plMonths.map(m => m.net_income ?? 0)) : fcf;
    const projectNPV = t0 + npv(selectedCF, r);
    const irrMonthly = selectedCF.length > 0 ? irr(t0, selectedCF) : 0;
    const irrAnnual = (1 + irrMonthly) ** 12 - 1;

    // labels for debug table
    const labels = havePL ? plMonths.map((m) => ({ y: m.year, m: m.month })) : [];

    // preview string
    const previewParts: string[] = [];
    previewParts.push(`t0:${fmt(t0)}`);
    for (let i = 0; i < Math.min(8, selectedCF.length); i++) previewParts.push(`t${i + 1}:${fmt(selectedCF[i])}`);

    return {
      rMonthly: r,
      havePL,
      npv: projectNPV,
      irrMonthly,
      irrAnnual,
      preview: previewParts.join(" | "),
      cfBasis: mode === "proxy" ? "Net Income (proxy)" : "Free Cash Flow",
      labels, ebit, taxes, depreciation, capex, deltaWC, fcf, t0,
    };
  }, [data, pl, mode, wacc, taxRate, capexRows, deprLifeYears, deprStart, treatFirstAsT0, dso, dpo, dio]);

  /** ------------ Volumes TAB state ------------ */
  type VolumesMap = Record<number, number[]>; // productId -> quantities by month index
  const monthsList = buildMonthsList();
  const [volumes, setVolumes] = useState<VolumesMap>({});
  const [exMode, setExMode] = useState<"constant" | "growth">("constant");
  const [growthPct, setGrowthPct] = useState<string>("5"); // monthly %

  // init volumes from backend once data arrives
  useEffect(() => {
    if (!data) return;
    const m = data.months;
    const next: VolumesMap = {};
    for (const p of data.products) {
      const arr = new Array(m).fill(0);
      for (const r of p.months ?? []) {
        if (!isInWindow(r.year, r.month)) continue;
        const idx = monthIndex(r.year, r.month);
        if (idx >= 0 && idx < m) arr[idx] = r.quantity ?? 0;
      }
      next[p.id] = arr;
    }
    setVolumes(next);
  }, [data]);

  const setCell = (pid: number, midx: number, val: number) => {
    setVolumes((v) => ({ ...v, [pid]: (v[pid] ?? []).map((x, i) => (i === midx ? val : x)) }));
  };

  const extrapolateAll = () => {
    if (!data) return;
    const months = data.months;
    const rate = Number(growthPct || "0") / 100;
    setVolumes((v) => {
      const copy: VolumesMap = { ...v };
      for (const p of data.products) {
        const row = [...(copy[p.id] ?? new Array(months).fill(0))];
        const first = row[0] ?? 0;
        if (first <= 0) { copy[p.id] = row; continue; }
        for (let i = 1; i < months; i++) {
          row[i] = exMode === "constant" ? first : Math.round(first * Math.pow(1 + rate, i));
        }
        copy[p.id] = row;
      }
      return copy;
    });
  };

  const saveAllVolumes = async () => {
    if (!data) return;
    try {
      for (const p of data.products) {
        const arr = volumes[p.id] ?? [];
        const payload: ProductMonth[] = arr.map((q, i) => ({
          year: monthsList[i].y,
          month: monthsList[i].m,
          quantity: Number(q || 0),
        }));
        await apiPut(`/business-cases/scenarios/products/${p.id}/months`, payload);
      }
      await fetchScenario();
      alert("Volumes saved.");
    } catch (e: any) {
      alert((e instanceof ApiError && e.message) || e?.message || "Save failed");
    }
  };

  // Simulation from volumes grid
  const sim = useMemo(() => {
    if (!data || monthsList.length === 0) return null;
    const m = data.months;
    const revenue = new Array(m).fill(0);
    const cogs = new Array(m).fill(0);
    for (const p of data.products) {
      const vols = volumes[p.id] ?? new Array(m).fill(0);
      for (let i = 0; i < m; i++) {
        revenue[i] += (vols[i] ?? 0) * (p.price ?? 0);
        cogs[i] += (vols[i] ?? 0) * (p.unit_cogs ?? 0);
      }
    }
    const gm = revenue.map((x, i) => x - cogs[i]);
    const totals = {
      revenue: revenue.reduce((a, b) => a + b, 0),
      cogs: cogs.reduce((a, b) => a + b, 0),
      gm: gm.reduce((a, b) => a + b, 0),
    };
    return { revenue, cogs, gm, totals };
  }, [data, volumes, monthsList.length]);

  /** ------------ Render ------------ */
  return (
    <div className="bg-white rounded-xl shadow p-6">
      {/* header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-2">
        <div>
          <h2 className="text-lg font-medium">Scenario</h2>
          {data && (
            <div className="text-sm text-gray-500">
              ID: <b>{data.id}</b> • Name: <b>{data.name}</b> • Months: <b>{data.months}</b> •
              Start: <b>{formatDate(data.start_date)}</b> • BC:{" "}
              <Link className="text-indigo-600 hover:underline" to={`/business-cases/${data.business_case_id}`}>
                #{data.business_case_id}
              </Link>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button onClick={fetchScenario} className="px-3 py-1.5 rounded-md border text-sm hover:bg-gray-50">
            Refresh
          </button>
          {tab === "pl" && (
            <button onClick={onCompute} className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-500">
              Compute P&L
            </button>
          )}
          {tab === "volumes" && (
            <button onClick={saveAllVolumes} className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-500">
              Save All
            </button>
          )}
        </div>
      </div>

      {/* tabs */}
      <div className="flex items-center gap-3 border-b mb-4">
        {(["pl","twc","volumes"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 -mb-px border-b-2 text-sm ${
              tab === t ? "border-indigo-600 text-indigo-700" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "pl" ? "P&L" : t === "twc" ? "TWC" : "Volumes"}
          </button>
        ))}
      </div>

      {/* states */}
      {loading && <div className="text-sm text-gray-500">Loading scenario…</div>}
      {error && <div className="text-sm text-red-600">Error: {error}</div>}

      {!loading && !error && data && (
        <>
          {/* --------- P&L TAB (Inputs + Outputs) --------- */}
          {tab === "pl" && (
            <>
              {/* ÜST: Inputs + Compute */}
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium">Inputs</h3>
                <button
                  onClick={onCompute}
                  className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-500"
                >
                  Compute P&L
                </button>
              </div>

              <ProductsTable
                data={data}
                onNewProd={() => {
                  setEditingProd(null);
                  setProdForm({ name: "", price: "0", unit_cogs: "0", is_active: true });
                  setOpenProd(true);
                }}
                openMonthsEditor={openMonthsEditor}
                onEditProd={onEditProd}
                onDeleteProd={onDeleteProd}
              />
              <OverheadsTable data={data} onNewOvh={onNewOvh} onEditOvh={onEditOvh} onDeleteOvh={onDeleteOvh} />

              {/* ALT: Çıktılar */}
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                {!pl ? (
                  <Card>
                    <div className="text-sm text-gray-500">Önce yukarıdaki <b>Compute P&L</b> ile hesapla.</div>
                  </Card>
                ) : (
                  <>
                    <Card>
                      <div className="text-sm font-medium mb-2">Totals</div>
                      <KV label="Revenue" value={fmt(pl.totals.revenue)} />
                      <KV label="COGS" value={fmt(pl.totals.cogs)} />
                      <KV label="Gross Margin" value={fmt(pl.totals.gross_margin)} />
                      <KV label="Overhead Fixed Total" value={fmt(pl.totals.overhead_fixed_total)} />
                      <KV label="Overhead Variable Total" value={fmt(pl.totals.overhead_var_total)} />
                      <KV label="Overhead Total" value={fmt(pl.totals.overhead_total)} />
                      <KV label="EBIT" value={fmt(pl.totals.ebit)} />
                    </Card>

                    <Card>
                      <div className="text-sm font-medium mb-2">P&amp;L by Month</div>
                      <div className="overflow-x-auto relative">
                        <table className="min-w-max text-xs">
                          <thead>
                            <tr className="border-b">
                              <th className="sticky left-0 bg-white py-1 px-2 text-left">Line</th>
                              {pl.months.map((m, i) => (
                                <th key={i} className="py-1 px-2 text-right whitespace-nowrap" title={`${m.year}-${String(m.month).padStart(2, "0")}`}>
                                  {fmtMonthYY(m.year, m.month)}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {[
                              { key: "revenue", label: "Revenue" },
                              { key: "cogs", label: "COGS" },
                              { key: "gross_margin", label: "Gross Margin" },
                              { key: "overhead_total", label: "Overhead (Total)" },
                              { key: "ebit", label: "EBIT" },
                            ].map((row) => (
                              <tr key={row.key} className="border-b last:border-0">
                                <td className="sticky left-0 bg-white py-1 px-2 font-medium">{row.label}</td>
                                {pl.months.map((m, i) => (
                                  <td key={i} className={`py-1 px-2 text-right ${getNumberClass((m as any)[row.key])}`}>
                                    {fmt((m as any)[row.key])}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  </>
                )}
              </div>
            </>
          )}

          {/* --------- TWC TAB (Cash Flow / NPV-IRR) --------- */}
          {tab === "twc" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Left: parameters */}
              <Card>
                <div className="text-sm font-medium mb-3">TWC / Cash Flow Inputs</div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="Discount Rate (WACC, % annual)">
                    <input type="number" value={wacc} onChange={(e) => setWacc(e.target.value)} className="w-full px-3 py-2 rounded-md border text-sm" />
                  </Field>

                  <Field label="CPI (annual %, info)">
                    <input type="number" value={cpiInfo} onChange={(e) => setCpiInfo(e.target.value)} className="w-full px-3 py-2 rounded-md border text-sm" />
                  </Field>

                  <Field label="FX Rate (info)">
                    <input type="number" value={fxInfo} onChange={(e) => setFxInfo(e.target.value)} className="w-full px-3 py-2 rounded-md border text-sm" />
                  </Field>

                  <Field label="Tax Rate (% annual)">
                    <input type="number" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className="w-full px-3 py-2 rounded-md border text-sm" />
                  </Field>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                  <Field label="DSO (days)">
                    <input type="number" value={dso} onChange={(e) => setDso(e.target.value)} className="w-full px-3 py-2 rounded-md border text-sm" />
                  </Field>
                  <Field label="DPO (days)">
                    <input type="number" value={dpo} onChange={(e) => setDpo(e.target.value)} className="w-full px-3 py-2 rounded-md border text-sm" />
                  </Field>
                  <Field label="DIO (days)">
                    <input type="number" value={dio} onChange={(e) => setDio(e.target.value)} className="w-full px-3 py-2 rounded-md border text-sm" />
                  </Field>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                  <Field label="Depreciation Life (years, straight-line)">
                    <input type="number" value={deprLifeYears} onChange={(e) => setDeprLifeYears(e.target.value)} className="w-full px-3 py-2 rounded-md border text-sm" min={1} step="1" />
                  </Field>

                  <Field label="Depreciation Starts">
                    <select value={deprStart} onChange={(e) => setDeprStart(e.target.value as "next" | "same")} className="w-full px-3 py-2 rounded-md border text-sm">
                      <option value="next">Next month (recommended)</option>
                      <option value="same">Same month</option>
                    </select>
                  </Field>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                  <Field label="Cash Flow Basis">
                    <select value={mode} onChange={(e) => setMode(e.target.value as FinanceMode)} className="w-full px-3 py-2 rounded-md border text-sm">
                      <option value="fcf">Free Cash Flow (recommended)</option>
                      <option value="proxy">Net Income (proxy)</option>
                    </select>
                  </Field>

                  <label className="flex items-center gap-2 text-sm mt-6 md:mt-0">
                    <input type="checkbox" checked={treatFirstAsT0} onChange={(e) => setTreatFirstAsT0(e.target.checked)} />
                    Treat first-month Capex as <b>t0</b> (NPV/IRR)
                  </label>
                </div>

                <div className="text-xs text-gray-500 mt-3">
                  Note: MVP aşamasında FCF aylık hesaplanır. Depreciation lineer, vergi EBIT üzerinden (pozitifse),
                  ΔWC = AR + INV − AP; AR=Revenue×DSO/30, INV=COGS×DIO/30, AP=COGS×DPO/30.
                </div>
              </Card>

              {/* Middle: Capex table */}
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-medium">Capex Plan (monthly)</div>
                  <button onClick={addCapexRow} className="px-2 py-1 rounded border text-sm hover:bg-gray-50">+ Add Row</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left border-b">
                        <th className="py-1 pr-3">Year</th>
                        <th className="py-1 pr-3">Month</th>
                        <th className="py-1 pr-3">Amount</th>
                        <th className="py-1 pr-3 w-16"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {capexRows.length === 0 ? (
                        <tr><td colSpan={4} className="py-2 text-gray-500">No capex yet.</td></tr>
                      ) : (
                        capexRows.map((r, idx) => {
                          const out = !isInWindow(r.year, r.month);
                          const danger = out ? "border-red-400 focus:ring-red-500" : "";
                          return (
                            <tr key={idx} className="border-b last:border-0">
                              <td className="py-1 pr-3">
                                <input type="number" value={r.year} onChange={(e) => changeCapexRow(idx, { ...r, year: Number(e.target.value) })} className={`w-24 px-2 py-1 rounded border text-sm ${danger}`} />
                              </td>
                              <td className="py-1 pr-3">
                                <input type="number" value={r.month} min={1} max={12} onChange={(e) => changeCapexRow(idx, { ...r, month: Number(e.target.value) })} className={`w-20 px-2 py-1 rounded border text-sm ${danger}`} />
                              </td>
                              <td className="py-1 pr-3">
                                <input type="number" value={r.amount} onChange={(e) => changeCapexRow(idx, { ...r, amount: Number(e.target.value) })} className="w-32 px-2 py-1 rounded border text-sm" />
                              </td>
                              <td className="py-1 pr-3 text-right">
                                <button onClick={() => removeCapexRow(idx)} className="px-2 py-1 rounded border hover:bg-gray-50">Remove</button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Right: Results */}
              <Card>
                <div className="text-sm font-medium mb-3">NPV / IRR (Client-side)</div>
                {!finance?.havePL ? (
                  <div className="text-sm text-gray-500">
                    FCF için P&amp;L verisine ihtiyaç var. Önce P&L sekmesinde <b>Compute P&amp;L</b> yap.
                  </div>
                ) : (
                  <>
                    <KV label="Monthly discount r" value={`${(finance.rMonthly * 100).toFixed(4)} %`} />
                    <KV label={`NPV (based on ${finance.cfBasis})`} value={fmt(finance.npv)} />
                    <KV label="IRR (monthly)" value={`${(finance.irrMonthly * 100).toFixed(4)} %`} />
                    <KV label="IRR (annualized)" value={`${(finance.irrAnnual * 100).toFixed(4)} %`} />
                    <div className="text-xs text-gray-500 mt-3">
                      Cash Flow Preview (first 8):<br />
                      <code className="text-[11px]">{finance.preview}</code>
                    </div>
                  </>
                )}
              </Card>

              {/* FCF Debug Table */}
              <div className="lg:col-span-3">
                <Card>
                  <div className="text-sm font-medium mb-2">FCF Debug Table (Excel-Style)</div>
                  {!finance?.havePL ? (
                    <div className="text-sm text-gray-500">Tabloyu görmek için önce P&L’i hesapla.</div>
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
                                title={`${lm.y}-${String(lm.m).padStart(2,"0")}`}
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
                            { label: "FCF = EBIT − Tax + Dep − Capex − ΔWC", arr: finance.fcf },
                          ].map((row) => (
                            <tr key={row.label} className="border-b last:border-0">
                              <td
                                className="sticky left-0 bg-white py-1 px-2 font-medium"
                                style={{ width: FIRST_COL_W, minWidth: FIRST_COL_W }}
                              >
                                {row.label}
                              </td>
                              {row.arr.map((v: number, idx: number) => (
                                <td
                                  key={idx}
                                  className={`py-1 px-2 text-right ${getNumberClass(v)}`}
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
                  <div className="text-xs text-gray-500 mt-2">
                    Formül: <code>EBIT − Tax + Depreciation − Capex − ΔWC</code>.
                  </div>
                </Card>
              </div>
            </div>
          )}

          {/* --------- VOLUMES TAB --------- */}
          {tab === "volumes" && (
            <div className="space-y-4">
              <Card>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                  <Field label="Extrapolation mode">
                    <select value={exMode} onChange={(e) => setExMode(e.target.value as any)} className="w-full px-3 py-2 rounded-md border text-sm">
                      <option value="constant">Constant (copy 1st month)</option>
                      <option value="growth">Growth rate (from 1st month)</option>
                    </select>
                  </Field>
                  {exMode === "growth" && (
                    <Field label="Monthly growth (%)">
                      <input type="number" value={growthPct} onChange={(e) => setGrowthPct(e.target.value)} className="w-full px-3 py-2 rounded-md border text-sm" />
                    </Field>
                  )}
                  <div />
                  <div className="flex md:justify-end">
                    <button onClick={extrapolateAll} className="px-3 py-2 rounded-md border text-sm hover:bg-gray-50">
                      Extrapolate All
                    </button>
                  </div>
                </div>
              </Card>

              <Card>
                <div className="text-sm font-medium mb-2">Volumes (by product × month)</div>
                <div className="overflow-x-auto">
                  <table className="min-w-max text-xs table-fixed">
                    <thead>
                      <tr className="border-b">
                        <th
                          className="sticky left-0 z-10 bg-white py-1 px-2 text-left"
                          style={{ width: FIRST_COL_W, minWidth: FIRST_COL_W }}
                        >
                          Product
                        </th>
                        {monthsList.map((mm, i) => (
                          <th
                            key={i}
                            className="py-1 px-2 text-right whitespace-nowrap"
                            style={{ width: MONTH_COL_W, minWidth: MONTH_COL_W }}
                          >
                            {fmtMonthYY(mm.y, mm.m)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.products.map((p) => (
                        <tr key={p.id} className="border-b last:border-0">
                          <td
                            className="sticky left-0 z-10 bg-white py-1 px-2 font-medium"
                            style={{ width: FIRST_COL_W, minWidth: FIRST_COL_W }}
                          >
                            {p.name}
                          </td>
                          {(volumes[p.id] ?? new Array(data.months).fill(0)).map((q, i) => (
                            <td
                              key={i}
                              className="py-1 px-2 text-right align-middle"
                              style={{ width: MONTH_COL_W, minWidth: MONTH_COL_W }}
                            >
                              <input
                                type="number"
                                value={q ?? 0}
                                onChange={(e) => setCell(p.id, i, Number(e.target.value))}
                                className="w-full px-1.5 py-1 rounded border text-xs text-right tabular-nums"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex justify-end">
                  <button onClick={saveAllVolumes} className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-500">
                    Save All
                  </button>
                </div>
              </Card>

              <Card>
                <div className="text-sm font-medium mb-2">Simulation (Revenue / COGS / GM)</div>
                {!sim ? (
                  <div className="text-sm text-gray-500">No data.</div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                      <KV label="Revenue (total)" value={fmt(sim.totals.revenue)} />
                      <KV label="COGS (total)" value={fmt(sim.totals.cogs)} />
                      <KV label="Gross Margin (total)" value={fmt(sim.totals.gm)} />
                    </div>
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
                            {monthsList.map((mm, i) => (
                              <th
                                key={i}
                                className="py-1 px-2 text-right whitespace-nowrap"
                                style={{ width: MONTH_COL_W, minWidth: MONTH_COL_W }}
                              >
                                {fmtMonthYY(mm.y, mm.m)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            { label: "Revenue", arr: sim.revenue },
                            { label: "COGS", arr: sim.cogs },
                            { label: "Gross Margin", arr: sim.gm },
                          ].map((row) => (
                            <tr key={row.label} className="border-b last:border-0">
                              <td
                                className="sticky left-0 bg-white py-1 px-2 font-medium"
                                style={{ width: FIRST_COL_W, minWidth: FIRST_COL_W }}
                              >
                                {row.label}
                              </td>
                              {row.arr.map((v, idx) => (
                                <td
                                  key={idx}
                                  className={`py-1 px-2 text-right ${getNumberClass(v)}`}
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
                  </>
                )}
              </Card>
            </div>
          )}
        </>
      )}

      {/* Product Modal */}
      {openProd && (
        <Modal onClose={() => setOpenProd(false)} title={editingProd ? "Edit Product" : "Add Product"}>
          <div className="space-y-3">
            <Field label="Name">
              <input
                value={prodForm.name}
                onChange={(e) => setProdForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 rounded-md border text-sm"
                placeholder="Product A"
              />
            </Field>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Price">
                <input
                  type="number"
                  value={prodForm.price}
                  onChange={(e) => setProdForm((f) => ({ ...f, price: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md border text-sm"
                  placeholder="100"
                />
              </Field>
              <Field label="Unit COGS">
                <input
                  type="number"
                  value={prodForm.unit_cogs}
                  onChange={(e) => setProdForm((f) => ({ ...f, unit_cogs: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md border text-sm"
                  placeholder="60"
                />
              </Field>
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={prodForm.is_active}
                onChange={(e) => setProdForm((f) => ({ ...f, is_active: e.target.checked }))}
              />
              Active
            </label>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setOpenProd(false)} className="px-3 py-1.5 rounded-md border hover:bg-gray-50">
              Cancel
            </button>
            <button
              disabled={!isProdValid}
              onClick={onSaveProd}
              className="px-3 py-1.5 rounded-md bg-indigo-600 text-white disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </Modal>
      )}

      {/* Months Modal */}
      {openMonths && monthsProduct && (
        <Modal onClose={() => setOpenMonths(false)} title={`Edit Months • ${monthsProduct.name}`}>
          <div className="text-xs text-gray-500 mb-2">
            Add rows and set (year, month, quantity). Existing rows are upserted.
            {(() => {
              const w = getScenarioWindow();
              if (!w) return null;
              return (
                <span className="ml-2">
                  <b>Valid range:</b> {w.startY}-{String(w.startM).padStart(2, "0")} → {w.endY}-{String(w.endM).padStart(2, "0")}
                </span>
              );
            })()}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-1 pr-3">Year</th>
                  <th className="py-1 pr-3">Month</th>
                  <th className="py-1 pr-3">Quantity</th>
                  <th className="py-1 pr-3 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {monthsRows.map((r, idx) => {
                  const out = !isInWindow(r.year, r.month);
                  const danger = out ? "border-red-400 focus:ring-red-500" : "";
                  return (
                    <tr key={idx} className="border-b last:border-0">
                      <td className="py-1 pr-3">
                        <input
                          type="number"
                          value={r.year}
                          onChange={(e) => changeMonthRow(idx, { ...r, year: Number(e.target.value) })}
                          className={`w-24 px-2 py-1 rounded border text-sm ${danger}`}
                        />
                      </td>
                      <td className="py-1 pr-3">
                        <input
                          type="number"
                          value={r.month}
                          min={1}
                          max={12}
                          onChange={(e) => changeMonthRow(idx, { ...r, month: Number(e.target.value) })}
                          className={`w-20 px-2 py-1 rounded border text-sm ${danger}`}
                        />
                      </td>
                      <td className="py-1 pr-3">
                        <input
                          type="number"
                          value={r.quantity}
                          onChange={(e) => changeMonthRow(idx, { ...r, quantity: Number(e.target.value) })}
                          className="w-28 px-2 py-1 rounded border text-sm"
                        />
                      </td>
                      <td className="py-1 pr-3 text-right">
                        <button onClick={() => setMonthsRows((rows) => rows.filter((_, i) => i !== idx))} className="px-2 py-1 rounded border hover:bg-gray-50">
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex justify-between">
            <button onClick={addMonthsRow} className="px-3 py-1.5 rounded-md border text-sm hover:bg-gray-50">
              + Add Row
            </button>
            <div className="flex gap-2">
              <button onClick={() => setOpenMonths(false)} className="px-3 py-1.5 rounded-md border hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={onSaveMonths} className="px-3 py-1.5 rounded-md bg-indigo-600 text-white">
                Save
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Overhead Modal */}
      {openOvh && (
        <Modal onClose={() => setOpenOvh(false)} title={editingOvh ? "Edit Overhead" : "Add Overhead"}>
          <div className="space-y-3">
            <Field label="Name">
              <input
                value={ovhForm.name}
                onChange={(e) => setOvhForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 rounded-md border text-sm"
                placeholder="Marketing"
              />
            </Field>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Type">
                <select
                  value={ovhForm.type}
                  onChange={(e) =>
                    setOvhForm((f) => ({
                      ...f,
                      type: e.target.value as "fixed" | "%_revenue",
                    }))
                  }
                  className="w-full px-3 py-2 rounded-md border text-sm"
                >
                  <option value="fixed">Fixed</option>
                  <option value="%_revenue">% of Revenue</option>
                </select>
              </Field>

              <Field label={ovhForm.type === "%_revenue" ? "Amount (%)" : "Amount"}>
                <input
                  type="number"
                  value={ovhForm.amount}
                  onChange={(e) => setOvhForm((f) => ({ ...f, amount: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md border text-sm"
                  placeholder={ovhForm.type === "%_revenue" ? "e.g. 15" : "500"}
                  min={ovhForm.type === "%_revenue" ? 0 : undefined}
                  max={ovhForm.type === "%_revenue" ? 100 : undefined}
                  step="0.01"
                />
                {ovhForm.type === "%_revenue" && (
                  <div className="text-xs text-gray-500 mt-1">
                    Enter a percentage between 0 and 100. It will be saved to the backend as a fraction (e.g., 15 → 0.15).
                  </div>
                )}
              </Field>
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setOpenOvh(false)} className="px-3 py-1.5 rounded-md border hover:bg-gray-50">
              Cancel
            </button>
            <button
              disabled={!isOvhValid}
              onClick={onSaveOvh}
              className="px-3 py-1.5 rounded-md bg-indigo-600 text-white disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </Modal>
      )}
    </div>
  );

  /** ---- helpers (inside component for access) ---- */
  function changeMonthRow(idx: number, next: ProductMonth) {
    setMonthsRows((rows) => rows.map((r, i) => (i === idx ? next : r)));
  }
}

/** ------------ Subcomponents ------------ */
function ProductsTable({
  data,
  onNewProd,
  openMonthsEditor,
  onEditProd,
  onDeleteProd,
}: {
  data: ScenarioDetail;
  onNewProd: () => void;
  openMonthsEditor: (p: ScenarioProduct) => void;
  onEditProd: (p: ScenarioProduct) => void;
  onDeleteProd: (p: ScenarioProduct) => void;
}) {
  return (
    <>
      <SectionHeader
        title="Products"
        right={
          <button
            onClick={onNewProd}
            className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-500"
          >
            + Add Product
          </button>
        }
      />
      {data.products.length === 0 ? (
        <div className="text-sm text-gray-500 mb-4">No products yet.</div>
      ) : (
        <div className="overflow-x-auto mb-6">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Price</th>
                <th className="py-2 pr-4">Unit COGS</th>
                <th className="py-2 pr-4">Active</th>
                <th className="py-2 pr-4 w-64 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.products.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium">{p.name}</td>
                  <td className="py-2 pr-4">{fmt(p.price)}</td>
                  <td className="py-2 pr-4">{fmt(p.unit_cogs)}</td>
                  <td className="py-2 pr-4">{p.is_active ? "Yes" : "No"}</td>
                  <td className="py-2 pr-4 text-right">
                    <button onClick={() => openMonthsEditor(p)} className="px-2 py-1 rounded border mr-2 hover:bg-gray-50">
                      Volumes
                    </button>
                    <button onClick={() => onEditProd(p)} className="px-2 py-1 rounded border mr-2 hover:bg-gray-50">
                      Edit
                    </button>
                    <button onClick={() => onDeleteProd(p)} className="px-2 py-1 rounded border hover:bg-gray-50">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function OverheadsTable({
  data,
  onNewOvh,
  onEditOvh,
  onDeleteOvh,
}: {
  data: ScenarioDetail;
  onNewOvh: () => void;
  onEditOvh: (o: ScenarioOverhead) => void;
  onDeleteOvh: (o: ScenarioOverhead) => void;
}) {
  return (
    <>
      <SectionHeader
        title="Overheads"
        right={
          <button
            onClick={onNewOvh}
            className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-500"
          >
            + Add Overhead
          </button>
        }
      />
      {data.overheads.length === 0 ? (
        <div className="text-sm text-gray-500 mb-4">No overheads yet.</div>
      ) : (
        <div className="overflow-x-auto mb-6">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4 w-56 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.overheads.map((o) => (
                <tr key={o.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium">{o.name}</td>
                  <td className="py-2 pr-4">{o.type === "fixed" ? "Fixed" : "% of Revenue"}</td>
                  <td className="py-2 pr-4">
                    {o.type === "%_revenue" ? `${fmtPct(o.amount)}%` : fmt(o.amount)}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    <button onClick={() => onEditOvh(o)} className="px-2 py-1 rounded border mr-2 hover:bg-gray-50">
                      Edit
                    </button>
                    <button onClick={() => onDeleteOvh(o)} className="px-2 py-1 rounded border hover:bg-gray-50">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** ------------ Small UI helpers ------------ */
function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mt-4 mb-2">
      <h3 className="font-medium">{title}</h3>
      {right}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      {children}
    </label>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="relative bg-white w-[820px] max-w-[95vw] rounded-xl shadow p-5">
        <div className="text-lg font-semibold mb-4">{title}</div>
        {children}
        <button
          onClick={onClose}
          className="absolute top-2 right-2 rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border p-4">{children}</div>;
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm py-0.5">
      <div className="text-gray-500">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

/** ------------ Utils ------------ */
function fmt(n: number | null | undefined) {
  const x = typeof n === "number" ? n : 0;
  return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function fmtPct(fraction: number | null | undefined) {
  const x = typeof fraction === "number" ? fraction * 100 : 0;
  return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}
function getNumberClass(v: number) {
  if (typeof v !== "number") return "";
  return v < 0 ? "text-red-600" : "";
}
function fmtMonthYY(year: number, month: number) {
  const ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const mm = Math.max(1, Math.min(12, month)) - 1;
  const yy = String(year).slice(-2);
  return `${ABBR[mm]}-${yy}`;
}
