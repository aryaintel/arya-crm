// src/pages/Scenario.tsx
import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { apiGet, apiPost, apiPatch, apiDelete, apiPut, ApiError } from "../lib/api";

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

/** ------------ Page ------------ */
export default function ScenarioPage() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const sid = Number(scenarioId);

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
    amount: string;
  }>({
    name: "",
    type: "fixed",
    amount: "0",
  });

  const isProdValid = useMemo(() => prodForm.name.trim().length > 0, [prodForm]);
  const isOvhValid = useMemo(() => ovhForm.name.trim().length > 0, [ovhForm]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid]);

  /** ------------ Helpers for scenario window ------------ */
  function getScenarioWindow() {
    if (!data) return null;
    const start = new Date(data.start_date);
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
    // mevcut satırlar varsa sırala
    const rows = [...(p.months ?? [])].sort((a, b) => a.year - b.year || a.month - b.month);
    if (rows.length > 0) {
      setMonthsRows(rows);
    } else {
      // boşsa senaryo başlangıcıyla 1 satır aç
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

    // sanitize + senaryo penceresi içinde filtrele
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
    setOvhForm({ name: o.name, type: o.type, amount: String(o.amount ?? 0) });
    setOpenOvh(true);
  };

  const onSaveOvh = async () => {
    if (!data || !isOvhValid) return;
    const base = {
      name: ovhForm.name.trim(),
      type: ovhForm.type,
      amount: Number(ovhForm.amount || 0),
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

  /** ------------ Compute P&L ------------ */
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

  /** ------------ Render ------------ */
  return (
    <div className="bg-white rounded-xl shadow p-6">
      {/* header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-medium">Scenario</h2>
        </div>

        <div className="flex gap-2">
          <button onClick={fetchScenario} className="px-3 py-1.5 rounded-md border text-sm hover:bg-gray-50">
            Refresh
          </button>
          <button onClick={onCompute} className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-500">
            Compute P&L
          </button>
        </div>
      </div>

      {/* states */}
      {loading && <div className="text-sm text-gray-500">Loading scenario…</div>}
      {error && <div className="text-sm text-red-600">Error: {error}</div>}

      {!loading && !error && data && (
        <>
          {/* Products */}
          <HeaderMeta data={data} />

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

          {/* Overheads */}
          <OverheadsTable data={data} onNewOvh={onNewOvh} onEditOvh={onEditOvh} onDeleteOvh={onDeleteOvh} />

          {/* P&L */}
          {pl && (
            <div className="mt-6">
              <SectionHeader title="P&L (Computed)" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

                {/* >>> Classic P&L matrix (rows = lines, columns = months) */}
                <Card>
                  <div className="text-sm font-medium mb-2">P&amp;L by Month</div>
                  <div className="overflow-x-auto relative">
                    <table className="min-w-max text-xs">
                      <thead>
                        <tr className="border-b">
                          <th className="sticky left-0 bg-white py-1 px-2 text-left">Line</th>
                          {pl.months.map((m, i) => (
                            <th
                              key={i}
                              className="py-1 px-2 text-right whitespace-nowrap"
                              title={`${m.year}-${String(m.month).padStart(2, "0")}`}
                            >
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
              </div>
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
                        <button
                          onClick={() => setMonthsRows((rows) => rows.filter((_, i) => i !== idx))}
                          className="px-2 py-1 rounded border hover:bg-gray-50"
                        >
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
              <Field label="Amount">
                <input
                  type="number"
                  value={ovhForm.amount}
                  onChange={(e) => setOvhForm((f) => ({ ...f, amount: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md border text-sm"
                  placeholder="500"
                />
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
function HeaderMeta({ data }: { data: ScenarioDetail }) {
  return (
    <div className="text-sm text-gray-500 -mt-2 mb-3">
      ID: <b>{data.id}</b> • Name: <b>{data.name}</b> • Months: <b>{data.months}</b> •
      Start: <b>{formatDate(data.start_date)}</b> • BC:{" "}
      <Link className="text-indigo-600 hover:underline" to={`/business-cases/${data.business_case_id}`}>
        #{data.business_case_id}
      </Link>
    </div>
  );
}

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
                  <td className="py-2 pr-4">{fmt(o.amount)}</td>
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

/** ------------ Small UI helpers (same vibe as Accounts) ------------ */
function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mt-6 mb-2">
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
