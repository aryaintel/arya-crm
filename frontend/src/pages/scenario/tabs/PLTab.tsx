import type {
  ScenarioDetail,
  PLResponse,
  ScenarioOverhead,
  ScenarioProduct,
} from "../../../types/scenario";

import ProductsTable from "../components/ProductsTable";
import OverheadsTable from "../components/OverheadsTable";
import { Card, KV } from "../../../components/ui";
import { fmt, fmtMonthYY, getNumberClass } from "../../../utils/format";
import { apiPatch, apiPost, apiDelete, ApiError } from "../../../lib/api";
import { useState } from "react";

type Props = {
  data: ScenarioDetail;
  pl: PLResponse | null;
  onCompute: () => void | Promise<void>;
  refresh: () => void | Promise<void>;
  /** Üst bileşenden göndermen şart değil; gönderilmezse no-op kullanılır */
  openMonthsEditor?: (p: ScenarioProduct) => void;
};

export default function PLTab({
  data,
  pl,
  onCompute,
  refresh,
  openMonthsEditor,
}: Props) {
  // ---------- Product modal ----------
  const [openProd, setOpenProd] = useState(false);
  const [editingProd, setEditingProd] = useState<ScenarioProduct | null>(null);
  const [prodForm, setProdForm] = useState({
    name: "",
    price: "0",
    unit_cogs: "0",
    is_active: true as boolean,
  });
  const isProdValid = prodForm.name.trim().length > 0;

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
    if (!isProdValid) return;
    const base = {
      name: prodForm.name.trim(),
      price: Number(prodForm.price || 0),
      unit_cogs: Number(prodForm.unit_cogs || 0),
      is_active: !!prodForm.is_active,
    };
    try {
      if (editingProd)
        await apiPatch(`/business-cases/scenarios/products/${editingProd.id}`, base);
      else
        await apiPost(`/business-cases/scenarios/${data.id}/products`, base);

      setOpenProd(false);
      await refresh();
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
      await refresh();
    } catch (e: any) {
      alert(
        (e instanceof ApiError && e.message) ||
          e?.response?.data?.detail ||
          e?.message ||
          "Delete failed",
      );
    }
  };

  // ---------- Overhead modal ----------
  const [openOvh, setOpenOvh] = useState(false);
  const [editingOvh, setEditingOvh] = useState<ScenarioOverhead | null>(null);
  const [ovhForm, setOvhForm] = useState<{
    name: string;
    type: "fixed" | "%_revenue";
    amount: string;
  }>({ name: "", type: "fixed", amount: "0" });

  const isOvhValid = (() => {
    const nameOk = ovhForm.name.trim().length > 0;
    const val = Number(ovhForm.amount);
    if (!Number.isFinite(val)) return false;
    if (ovhForm.type === "%_revenue") return nameOk && val >= 0 && val <= 100;
    return nameOk && val >= 0;
  })();

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
    if (!isOvhValid) return;
    const raw = Number(ovhForm.amount || 0);
    const amountToSend = ovhForm.type === "%_revenue" ? raw / 100 : raw;
    const base = { name: ovhForm.name.trim(), type: ovhForm.type, amount: amountToSend };
    try {
      if (editingOvh)
        await apiPatch(`/business-cases/scenarios/overheads/${editingOvh.id}`, base);
      else
        await apiPost(`/business-cases/scenarios/${data.id}/overheads`, base);

      setOpenOvh(false);
      await refresh();
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
      await refresh();
    } catch (e: any) {
      alert(
        (e instanceof ApiError && e.message) ||
          e?.response?.data?.detail ||
          e?.message ||
          "Delete failed",
      );
    }
  };

  return (
    <>
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
        onNewProd={onNewProd}
        openMonthsEditor={openMonthsEditor ?? (() => {})}
        onEditProd={onEditProd}
        onDeleteProd={onDeleteProd}
      />

      <OverheadsTable
        data={data}
        onNewOvh={onNewOvh}
        onEditOvh={onEditOvh}
        onDeleteOvh={onDeleteOvh}
      />

      {!pl ? (
        <Card>
          <div className="text-sm text-gray-500">
            Önce <b>Compute P&L</b> ile hesapla.
          </div>
        </Card>
      ) : (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
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
                      <td className="sticky left-0 bg-white py-1 px-2 font-medium">
                        {row.label}
                      </td>
                      {pl.months.map((m, i) => (
                        <td
                          key={i}
                          className={`py-1 px-2 text-right ${getNumberClass(
                            (m as any)[row.key],
                          )}`}
                        >
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
      )}

      {/* Product Modal */}
      {openProd && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="relative bg-white w-[820px] max-w-[95vw] rounded-xl shadow p-5">
            <div className="text-lg font-semibold mb-4">
              {editingProd ? "Edit Product" : "Add Product"}
            </div>
            <div className="space-y-3">
              <label className="block">
                <div className="text-xs text-gray-500 mb-1">Name</div>
                <input
                  value={prodForm.name}
                  onChange={(e) =>
                    setProdForm((f) => ({ ...f, name: e.target.value }))
                  }
                  className="w-full px-3 py-2 rounded-md border text-sm"
                />
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block">
                  <div className="text-xs text-gray-500 mb-1">Price</div>
                  <input
                    type="number"
                    value={prodForm.price}
                    onChange={(e) =>
                      setProdForm((f) => ({ ...f, price: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-md border text-sm"
                  />
                </label>
                <label className="block">
                  <div className="text-xs text-gray-500 mb-1">Unit COGS</div>
                  <input
                    type="number"
                    value={prodForm.unit_cogs}
                    onChange={(e) =>
                      setProdForm((f) => ({ ...f, unit_cogs: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-md border text-sm"
                  />
                </label>
              </div>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={prodForm.is_active}
                  onChange={(e) =>
                    setProdForm((f) => ({ ...f, is_active: e.target.checked }))
                  }
                />
                Active
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setOpenProd(false)}
                className="px-3 py-1.5 rounded-md border hover:bg-gray-50"
              >
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
          </div>
        </div>
      )}

      {/* Overhead Modal */}
      {openOvh && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="relative bg-white w-[820px] max-w-[95vw] rounded-xl shadow p-5">
            <div className="text-lg font-semibold mb-4">
              {editingOvh ? "Edit Overhead" : "Add Overhead"}
            </div>
            <div className="space-y-3">
              <label className="block">
                <div className="text-xs text-gray-500 mb-1">Name</div>
                <input
                  value={ovhForm.name}
                  onChange={(e) =>
                    setOvhForm((f) => ({ ...f, name: e.target.value }))
                  }
                  className="w-full px-3 py-2 rounded-md border text-sm"
                />
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block">
                  <div className="text-xs text-gray-500 mb-1">Type</div>
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
                </label>
                <label className="block">
                  <div className="text-xs text-gray-500 mb-1">
                    {ovhForm.type === "%_revenue" ? "Amount (%)" : "Amount"}
                  </div>
                  <input
                    type="number"
                    value={ovhForm.amount}
                    onChange={(e) =>
                      setOvhForm((f) => ({ ...f, amount: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-md border text-sm"
                  />
                </label>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setOpenOvh(false)}
                className="px-3 py-1.5 rounded-md border hover:bg-gray-50"
              >
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
          </div>
        </div>
      )}
    </>
  );
}
