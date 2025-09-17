import { useMemo, useState } from "react";
import { apiPost, apiPatch, apiDelete, ApiError } from "../../../lib/api";
import { fmt } from "../../../utils/format";
import type { ScenarioDetail, ScenarioBOQItem, BOQFrequency } from "../../../types/scenario";

/** ---- Draft tipi ---- */
type RowDraft = {
  id?: number;
  section?: string | null;
  item_name: string;
  unit: string;
  quantity: string;
  unit_price: string;
  unit_cogs: string;
  frequency: BOQFrequency;
  months?: string;
  start_year?: string;
  start_month?: string;
  is_active: boolean;
  notes?: string;
};

function toDraft(it?: ScenarioBOQItem): RowDraft {
  return {
    id: it?.id,
    section: it?.section ?? "",
    item_name: it?.item_name ?? "",
    unit: it?.unit ?? "",
    quantity: String(it?.quantity ?? 0),
    unit_price: String(it?.unit_price ?? 0),
    unit_cogs: String(it?.unit_cogs ?? 0),
    frequency: (it?.frequency ?? "once") as BOQFrequency,
    months: it?.months ? String(it.months) : "",
    start_year: it?.start_year ? String(it.start_year) : "",
    start_month: it?.start_month ? String(it.start_month) : "",
    is_active: it?.is_active ?? true,
    notes: it?.notes ?? "",
  };
}

function toPayload(d: RowDraft): Omit<ScenarioBOQItem, "id"> {
  return {
    section: d.section || null,
    item_name: d.item_name.trim(),
    unit: d.unit.trim(),
    quantity: Number(d.quantity || 0),
    unit_price: Number(d.unit_price || 0),
    unit_cogs: Number(d.unit_cogs || 0),
    frequency: d.frequency,
    months: d.months ? Number(d.months) : undefined,
    start_year: d.start_year ? Number(d.start_year) : undefined,
    start_month: d.start_month ? Number(d.start_month) : undefined,
    is_active: !!d.is_active,
    notes: d.notes || null,
  };
}

function lineTotals(it: ScenarioBOQItem) {
  const mult = it.frequency === "monthly" && it.months ? it.months : 1;
  const revenue = (it.quantity ?? 0) * (it.unit_price ?? 0) * mult;
  const cogs = (it.quantity ?? 0) * (it.unit_cogs ?? 0) * mult;
  return { revenue, cogs, gm: revenue - cogs };
}

export default function BOQTable({
  data,
  refresh,
}: {
  data: ScenarioDetail;
  refresh: () => void;
}) {
  const items = data.boq_items ?? [];

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<RowDraft | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  const totals = useMemo(() => {
    const t = { revenue: 0, cogs: 0, gm: 0 };
    for (const it of items) {
      const x = lineTotals(it);
      t.revenue += x.revenue;
      t.cogs += x.cogs;
      t.gm += x.gm;
    }
    return t;
  }, [items]);

  const beginAdd = () => {
    setDraft(
      toDraft({
        item_name: "",
        unit: "",
        quantity: 0,
        unit_price: 0,
        unit_cogs: 0,
        frequency: "once",
        is_active: true,
      } as any)
    );
    setAdding(true);
  };

  const beginEdit = (it: ScenarioBOQItem) => {
    setEditingId(it.id);
    setDraft(toDraft(it));
  };

  const cancelEdit = () => {
    setAdding(false);
    setEditingId(null);
    setDraft(null);
  };

  const saveAdd = async () => {
    if (!draft) return;
    const payload = toPayload(draft);
    if (!payload.item_name) { alert("Item name gerekli."); return; }
    try {
      await apiPost(`/business-cases/scenarios/${data.id}/boq-items`, payload);
      cancelEdit();
      await refresh();
    } catch (e: any) {
      alert((e instanceof ApiError && e.message) || e?.response?.data?.detail || e?.message || "Create failed");
    }
  };

  const saveEdit = async () => {
    if (!draft || !editingId) return;
    const payload = toPayload(draft);
    if (!payload.item_name) { alert("Item name gerekli."); return; }
    try {
      await apiPatch(`/business-cases/scenarios/boq-items/${editingId}`, payload);
      cancelEdit();
      await refresh();
    } catch (e: any) {
      alert((e instanceof ApiError && e.message) || e?.response?.data?.detail || e?.message || "Update failed");
    }
  };

  const onDelete = async (it: ScenarioBOQItem) => {
    if (!confirm(`Delete BOQ item "${it.item_name}"?`)) return;
    try {
      await apiDelete(`/business-cases/scenarios/boq-items/${it.id}`);
      await refresh();
    } catch (e: any) {
      alert((e instanceof ApiError && e.message) || e?.response?.data?.detail || e?.message || "Delete failed");
    }
  };

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium">BOQ (Bill of Quantities)</div>
        <button onClick={beginAdd} className="px-2 py-1 rounded border text-sm hover:bg-gray-50">
          + Add BOQ Item
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b">
              <th className="py-1 px-2 text-left">Section</th>
              <th className="py-1 px-2 text-left">Item</th>
              <th className="py-1 px-2 text-left">Unit</th>
              <th className="py-1 px-2 text-right">Qty</th>
              <th className="py-1 px-2 text-right">Unit Price</th>
              <th className="py-1 px-2 text-right">Unit COGS</th>
              <th className="py-1 px-2 text-left">Freq</th>
              <th className="py-1 px-2 text-right">Months</th>
              <th className="py-1 px-2 text-right">Start (Y/M)</th>
              <th className="py-1 px-2 text-center">Active</th>
              <th className="py-1 px-2 text-right">Line Rev</th>
              <th className="py-1 px-2 text-right">Line COGS</th>
              <th className="py-1 px-2 text-right">Line GM</th>
              <th className="py-1 px-2 text-right w-40">Actions</th>
            </tr>
          </thead>
          <tbody>
            {adding && draft && (
              <tr className="border-b bg-yellow-50/40">
                <td className="py-1 px-2">
                  <input value={draft.section ?? ""} onChange={(e) => setDraft({ ...draft, section: e.target.value })} className="w-28 px-2 py-1 rounded border" />
                </td>
                <td className="py-1 px-2">
                  <input value={draft.item_name} onChange={(e) => setDraft({ ...draft, item_name: e.target.value })} className="w-48 px-2 py-1 rounded border" />
                </td>
                <td className="py-1 px-2">
                  <input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} className="w-20 px-2 py-1 rounded border" />
                </td>
                <td className="py-1 px-2 text-right">
                  <input type="number" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} className="w-24 px-2 py-1 rounded border text-right" />
                </td>
                <td className="py-1 px-2 text-right">
                  <input type="number" value={draft.unit_price} onChange={(e) => setDraft({ ...draft, unit_price: e.target.value })} className="w-24 px-2 py-1 rounded border text-right" />
                </td>
                <td className="py-1 px-2 text-right">
                  <input type="number" value={draft.unit_cogs} onChange={(e) => setDraft({ ...draft, unit_cogs: e.target.value })} className="w-24 px-2 py-1 rounded border text-right" />
                </td>
                <td className="py-1 px-2">
                  <select value={draft.frequency} onChange={(e) => setDraft({ ...draft, frequency: e.target.value as BOQFrequency })} className="px-2 py-1 rounded border">
                    <option value="once">once</option>
                    <option value="monthly">monthly</option>
                    <option value="per_shipment">per_shipment</option>
                    <option value="per_tonne">per_tonne</option>
                  </select>
                </td>
                <td className="py-1 px-2 text-right">
                  <input type="number" value={draft.months ?? ""} onChange={(e) => setDraft({ ...draft, months: e.target.value })} className="w-20 px-2 py-1 rounded border text-right" />
                </td>
                <td className="py-1 px-2 text-right">
                  <div className="flex gap-1">
                    <input placeholder="YYYY" type="number" value={draft.start_year ?? ""} onChange={(e) => setDraft({ ...draft, start_year: e.target.value })} className="w-20 px-2 py-1 rounded border text-right" />
                    <input placeholder="MM" type="number" value={draft.start_month ?? ""} onChange={(e) => setDraft({ ...draft, start_month: e.target.value })} className="w-14 px-2 py-1 rounded border text-right" />
                  </div>
                </td>
                <td className="py-1 px-2 text-center">
                  <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} />
                </td>
                <td className="py-1 px-2 text-right">{fmt(Number(draft.quantity || 0) * Number(draft.unit_price || 0) * (draft.frequency === "monthly" && Number(draft.months || 0) > 0 ? Number(draft.months) : 1))}</td>
                <td className="py-1 px-2 text-right">{fmt(Number(draft.quantity || 0) * Number(draft.unit_cogs || 0) * (draft.frequency === "monthly" && Number(draft.months || 0) > 0 ? Number(draft.months) : 1))}</td>
                <td className="py-1 px-2 text-right">{fmt(Number(draft.quantity || 0) * (Number(draft.unit_price || 0) - Number(draft.unit_cogs || 0)) * (draft.frequency === "monthly" && Number(draft.months || 0) > 0 ? Number(draft.months) : 1))}</td>
                <td className="py-1 px-2 text-right">
                  <button onClick={saveAdd} className="px-2 py-1 rounded border mr-2 hover:bg-gray-50">Save</button>
                  <button onClick={cancelEdit} className="px-2 py-1 rounded border hover:bg-gray-50">Cancel</button>
                </td>
              </tr>
            )}

            {items.length === 0 && !adding && (
              <tr><td colSpan={14} className="py-2 text-gray-500">No BOQ items.</td></tr>
            )}

            {items.map((it) => {
              const editing = editingId === it.id && draft;
              const lt = lineTotals(it);

              if (editing) {
                return (
                  <tr key={it.id} className="border-b bg-yellow-50/40">
                    <td className="py-1 px-2"><input value={draft!.section ?? ""} onChange={(e) => setDraft({ ...draft!, section: e.target.value })} className="w-28 px-2 py-1 rounded border" /></td>
                    <td className="py-1 px-2"><input value={draft!.item_name} onChange={(e) => setDraft({ ...draft!, item_name: e.target.value })} className="w-48 px-2 py-1 rounded border" /></td>
                    <td className="py-1 px-2"><input value={draft!.unit} onChange={(e) => setDraft({ ...draft!, unit: e.target.value })} className="w-20 px-2 py-1 rounded border" /></td>
                    <td className="py-1 px-2 text-right"><input type="number" value={draft!.quantity} onChange={(e) => setDraft({ ...draft!, quantity: e.target.value })} className="w-24 px-2 py-1 rounded border text-right" /></td>
                    <td className="py-1 px-2 text-right"><input type="number" value={draft!.unit_price} onChange={(e) => setDraft({ ...draft!, unit_price: e.target.value })} className="w-24 px-2 py-1 rounded border text-right" /></td>
                    <td className="py-1 px-2 text-right"><input type="number" value={draft!.unit_cogs} onChange={(e) => setDraft({ ...draft!, unit_cogs: e.target.value })} className="w-24 px-2 py-1 rounded border text-right" /></td>
                    <td className="py-1 px-2">
                      <select value={draft!.frequency} onChange={(e) => setDraft({ ...draft!, frequency: e.target.value as BOQFrequency })} className="px-2 py-1 rounded border">
                        <option value="once">once</option>
                        <option value="monthly">monthly</option>
                        <option value="per_shipment">per_shipment</option>
                        <option value="per_tonne">per_tonne</option>
                      </select>
                    </td>
                    <td className="py-1 px-2 text-right"><input type="number" value={draft!.months ?? ""} onChange={(e) => setDraft({ ...draft!, months: e.target.value })} className="w-20 px-2 py-1 rounded border text-right" /></td>
                    <td className="py-1 px-2 text-right">
                      <div className="flex gap-1">
                        <input placeholder="YYYY" type="number" value={draft!.start_year ?? ""} onChange={(e) => setDraft({ ...draft!, start_year: e.target.value })} className="w-20 px-2 py-1 rounded border text-right" />
                        <input placeholder="MM" type="number" value={draft!.start_month ?? ""} onChange={(e) => setDraft({ ...draft!, start_month: e.target.value })} className="w-14 px-2 py-1 rounded border text-right" />
                      </div>
                    </td>
                    <td className="py-1 px-2 text-center"><input type="checkbox" checked={draft!.is_active} onChange={(e) => setDraft({ ...draft!, is_active: e.target.checked })} /></td>
                    <td className="py-1 px-2 text-right">{fmt(Number(draft!.quantity || 0) * Number(draft!.unit_price || 0) * (draft!.frequency === "monthly" && Number(draft!.months || 0) > 0 ? Number(draft!.months) : 1))}</td>
                    <td className="py-1 px-2 text-right">{fmt(Number(draft!.quantity || 0) * Number(draft!.unit_cogs || 0) * (draft!.frequency === "monthly" && Number(draft!.months || 0) > 0 ? Number(draft!.months) : 1))}</td>
                    <td className="py-1 px-2 text-right">{fmt(Number(draft!.quantity || 0) * (Number(draft!.unit_price || 0) - Number(draft!.unit_cogs || 0)) * (draft!.frequency === "monthly" && Number(draft!.months || 0) > 0 ? Number(draft!.months) : 1))}</td>
                    <td className="py-1 px-2 text-right">
                      <button onClick={saveEdit} className="px-2 py-1 rounded border mr-2 hover:bg-gray-50">Save</button>
                      <button onClick={cancelEdit} className="px-2 py-1 rounded border hover:bg-gray-50">Cancel</button>
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={it.id} className="border-b">
                  <td className="py-1 px-2">{it.section}</td>
                  <td className="py-1 px-2">{it.item_name}</td>
                  <td className="py-1 px-2">{it.unit}</td>
                  <td className="py-1 px-2 text-right">{fmt(it.quantity)}</td>
                  <td className="py-1 px-2 text-right">{fmt(it.unit_price)}</td>
                  <td className="py-1 px-2 text-right">{fmt(it.unit_cogs ?? 0)}</td>
                  <td className="py-1 px-2">{it.frequency}</td>
                  <td className="py-1 px-2 text-right">{it.months ?? "-"}</td>
                  <td className="py-1 px-2 text-right">
                    {it.start_year ? `${it.start_year}/${String(it.start_month ?? "").padStart(2, "0")}` : "-"}
                  </td>
                  <td className="py-1 px-2 text-center">{it.is_active ? "✓" : "—"}</td>
                  <td className="py-1 px-2 text-right">{fmt(lt.revenue)}</td>
                  <td className="py-1 px-2 text-right">{fmt(lt.cogs)}</td>
                  <td className="py-1 px-2 text-right">{fmt(lt.gm)}</td>
                  <td className="py-1 px-2 text-right">
                    <button onClick={() => beginEdit(it)} className="px-2 py-1 rounded border mr-2 hover:bg-gray-50">Edit</button>
                    <button onClick={() => onDelete(it)} className="px-2 py-1 rounded border hover:bg-gray-50">Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr className="border-t font-medium">
              <td colSpan={10} className="py-1 px-2 text-right">Totals:</td>
              <td className="py-1 px-2 text-right">{fmt(totals.revenue)}</td>
              <td className="py-1 px-2 text-right">{fmt(totals.cogs)}</td>
              <td className="py-1 px-2 text-right">{fmt(totals.gm)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
