// src/pages/scenario/components/CapexTable.tsx
import { useMemo, useState } from "react";
import { Card } from "../../../components/ui";
import { fmt } from "../../../utils/format";
import { apiPost, apiPatch, apiDelete, ApiError } from "../../../lib/api";
import type { ScenarioDetail, CapexEntry } from "../../../types/scenario";

/** ------- Backend V2 ile uyumlu tip ------- */
type CapexRow = CapexEntry & {
  asset_name?: string | null;
  category?: string | null;
  service_start_year?: number | null;
  service_start_month?: number | null; // 1..12
  useful_life_months?: number | null;
  depr_method?: string | null; // "straight_line"
  salvage_value?: number | null;
  is_active?: boolean | null;
};

/** ------- Draft Tipi (input'lar string tutulur) ------- */
type RowDraft = {
  id?: number;
  year: string;
  month: string;        // 1..12
  amount: string;       // number
  notes?: string;

  asset_name: string;
  category: string;
  service_start_year: string;
  service_start_month: string;
  useful_life_months: string;
  depr_method: string;  // straight_line (şimdilik)
  salvage_value: string;
  is_active: boolean;
};

function startYM(s: ScenarioDetail | null): { y: string; m: string } {
  if (!s?.start_date) return { y: "", m: "" };
  const d = new Date(s.start_date);
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1);
  return { y, m };
}

function toDraft(it?: CapexRow, s?: ScenarioDetail | null): RowDraft {
  if (it) {
    return {
      id: it.id,
      year: String(it.year ?? ""),
      month: String(it.month ?? ""),
      amount: String(it.amount ?? 0),
      notes: it.notes ?? "",

      asset_name: String(it.asset_name ?? ""),
      category: String(it.category ?? ""),
      service_start_year: String(it.service_start_year ?? ""),
      service_start_month: String(it.service_start_month ?? ""),
      useful_life_months: String(it.useful_life_months ?? ""),
      depr_method: String(it.depr_method ?? "straight_line"),
      salvage_value: String(it.salvage_value ?? "0"),
      is_active: it.is_active ?? true,
    };
  }
  const { y, m } = startYM(s ?? null);
  return {
    year: y,
    month: m,
    amount: "0",
    notes: "",

    asset_name: "",
    category: "",
    service_start_year: y,
    service_start_month: m,
    useful_life_months: "",
    depr_method: "straight_line",
    salvage_value: "0",
    is_active: true,
  };
}

function toPayload(d: RowDraft) {
  return {
    year: Number(d.year),
    month: Number(d.month),
    amount: Number(d.amount || 0),
    notes: d.notes || null,

    asset_name: d.asset_name || null,
    category: d.category || null,
    service_start_year: d.service_start_year ? Number(d.service_start_year) : null,
    service_start_month: d.service_start_month ? Number(d.service_start_month) : null,
    useful_life_months: d.useful_life_months ? Number(d.useful_life_months) : null,
    depr_method: d.depr_method || "straight_line",
    salvage_value: d.salvage_value ? Number(d.salvage_value) : 0,
    is_active: !!d.is_active,
  };
}

function validateDraft(d: RowDraft): string | null {
  if (!d.year) return "Year gerekli.";
  const y = Number(d.year);
  if (!Number.isFinite(y) || y < 1900 || y > 3000) return "Year geçersiz.";
  if (!d.month) return "Month gerekli.";
  const m = Number(d.month);
  if (!Number.isFinite(m) || m < 1 || m > 12) return "Month 1..12 olmalı.";
  if (d.amount === "" || d.amount == null) return "Amount gerekli.";
  const a = Number(d.amount);
  if (!Number.isFinite(a)) return "Amount sayı olmalı.";
  // opsiyonelleri zorlamıyoruz
  return null;
}

export default function CapexTable({
  data,
  refresh,
}: {
  data: ScenarioDetail;
  refresh: () => void;
}) {
  const items: CapexRow[] = (data.capex as CapexRow[]) ?? [];

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<RowDraft | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  const totals = useMemo(() => {
    const t = { amount: 0 };
    for (const it of items) t.amount += (it.amount as number) ?? 0;
    return t;
  }, [items]);

  const beginAdd = () => {
    setDraft(toDraft(undefined, data));
    setAdding(true);
  };

  const beginEdit = (it: CapexRow) => {
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
    const err = validateDraft(draft);
    if (err) {
      alert(err);
      return;
    }
    const payload = toPayload(draft);
    try {
      // POST /business-cases/scenarios/:id/capex
      await apiPost(`/business-cases/scenarios/${data.id}/capex`, payload);
      cancelEdit();
      await refresh();
    } catch (e: any) {
      alert(
        (e instanceof ApiError && e.message) ||
          e?.response?.data?.detail ||
          e?.message ||
          "Create failed",
      );
    }
  };

  const saveEdit = async () => {
    if (!draft || !editingId) return;
    const err = validateDraft(draft);
    if (err) {
      alert(err);
      return;
    }
    const payload = toPayload(draft);
    try {
      // PATCH /business-cases/scenarios/capex/:id
      await apiPatch(`/business-cases/scenarios/capex/${editingId}`, payload);
      cancelEdit();
      await refresh();
    } catch (e: any) {
      alert(
        (e instanceof ApiError && e.message) ||
          e?.response?.data?.detail ||
          e?.message ||
          "Update failed",
      );
    }
  };

  const onDelete = async (it: CapexRow) => {
    if (!confirm(`Delete CAPEX entry ${it.year}/${String(it.month).padStart(2, "0")} ?`)) return;
    try {
      // DELETE /business-cases/scenarios/capex/:id
      await apiDelete(`/business-cases/scenarios/capex/${it.id}`);
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

  const renderMethod = (val: string, onChange: (v: string) => void) => (
    <select
      value={val || "straight_line"}
      onChange={(e) => onChange(e.target.value)}
      className="w-36 px-2 py-1 rounded border"
    >
      <option value="straight_line">straight_line</option>
    </select>
  );

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium">CAPEX (Capital Expenditures)</div>
        <button onClick={beginAdd} className="px-2 py-1 rounded border text-sm hover:bg-gray-50">
          + Add CAPEX
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b">
              <th className="py-1 px-2">Year</th>
              <th className="py-1 px-2">Month</th>
              <th className="py-1 px-2 text-right">Amount</th>
              <th className="py-1 px-2">Notes</th>
              <th className="py-1 px-2">Asset</th>
              <th className="py-1 px-2">Category</th>
              <th className="py-1 px-2 text-right">Svc Start (Y/M)</th>
              <th className="py-1 px-2 text-right">Life (mo)</th>
              <th className="py-1 px-2">Method</th>
              <th className="py-1 px-2 text-right">Salvage</th>
              <th className="py-1 px-2 text-center">Active</th>
              <th className="py-1 px-2 text-right w-40">Actions</th>
            </tr>
          </thead>

          <tbody>
            {adding && draft && (
              <tr className="border-b bg-yellow-50/40">
                <td className="py-1 px-2">
                  <input
                    placeholder="YYYY"
                    type="number"
                    value={draft.year}
                    onChange={(e) => setDraft({ ...draft, year: e.target.value })}
                    className="w-24 px-2 py-1 rounded border text-right"
                  />
                </td>
                <td className="py-1 px-2">
                  <input
                    placeholder="MM"
                    type="number"
                    value={draft.month}
                    onChange={(e) => setDraft({ ...draft, month: e.target.value })}
                    className="w-16 px-2 py-1 rounded border text-right"
                    min={1}
                    max={12}
                  />
                </td>
                <td className="py-1 px-2 text-right">
                  <input
                    type="number"
                    value={draft.amount}
                    onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                    className="w-28 px-2 py-1 rounded border text-right"
                  />
                </td>
                <td className="py-1 px-2">
                  <input
                    value={draft.notes ?? ""}
                    onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    className="w-48 px-2 py-1 rounded border"
                    placeholder="Optional"
                  />
                </td>

                <td className="py-1 px-2">
                  <input
                    value={draft.asset_name}
                    onChange={(e) => setDraft({ ...draft, asset_name: e.target.value })}
                    className="w-40 px-2 py-1 rounded border"
                    placeholder="e.g. Crusher"
                  />
                </td>
                <td className="py-1 px-2">
                  <input
                    value={draft.category}
                    onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                    className="w-32 px-2 py-1 rounded border"
                    placeholder="e.g. Plant"
                  />
                </td>
                <td className="py-1 px-2 text-right">
                  <div className="flex gap-1">
                    <input
                      placeholder="YYYY"
                      type="number"
                      value={draft.service_start_year}
                      onChange={(e) => setDraft({ ...draft, service_start_year: e.target.value })}
                      className="w-20 px-2 py-1 rounded border text-right"
                    />
                    <input
                      placeholder="MM"
                      type="number"
                      value={draft.service_start_month}
                      onChange={(e) => setDraft({ ...draft, service_start_month: e.target.value })}
                      className="w-14 px-2 py-1 rounded border text-right"
                    />
                  </div>
                </td>
                <td className="py-1 px-2 text-right">
                  <input
                    type="number"
                    value={draft.useful_life_months}
                    onChange={(e) => setDraft({ ...draft, useful_life_months: e.target.value })}
                    className="w-20 px-2 py-1 rounded border text-right"
                    placeholder="eg. 60"
                  />
                </td>
                <td className="py-1 px-2">
                  {renderMethod(draft.depr_method, (v) => setDraft({ ...draft, depr_method: v }))}
                </td>
                <td className="py-1 px-2 text-right">
                  <input
                    type="number"
                    value={draft.salvage_value}
                    onChange={(e) => setDraft({ ...draft, salvage_value: e.target.value })}
                    className="w-24 px-2 py-1 rounded border text-right"
                  />
                </td>
                <td className="py-1 px-2 text-center">
                  <input
                    type="checkbox"
                    checked={draft.is_active}
                    onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
                  />
                </td>
                <td className="py-1 px-2 text-right">
                  <button onClick={saveAdd} className="px-2 py-1 rounded border mr-2 hover:bg-gray-50">
                    Save
                  </button>
                  <button onClick={cancelEdit} className="px-2 py-1 rounded border hover:bg-gray-50">
                    Cancel
                  </button>
                </td>
              </tr>
            )}

            {items.length === 0 && !adding && (
              <tr>
                <td colSpan={12} className="py-2 text-gray-500">
                  No CAPEX entries.
                </td>
              </tr>
            )}

            {items.map((it) => {
              const editing = Boolean(editingId === it.id && draft);

              if (editing) {
                const d = draft as RowDraft;
                return (
                  <tr key={it.id} className="border-b bg-yellow-50/40">
                    <td className="py-1 px-2">
                      <input
                        type="number"
                        value={d.year}
                        onChange={(e) => setDraft({ ...d, year: e.target.value })}
                        className="w-24 px-2 py-1 rounded border text-right"
                      />
                    </td>
                    <td className="py-1 px-2">
                      <input
                        type="number"
                        value={d.month}
                        onChange={(e) => setDraft({ ...d, month: e.target.value })}
                        className="w-16 px-2 py-1 rounded border text-right"
                        min={1}
                        max={12}
                      />
                    </td>
                    <td className="py-1 px-2 text-right">
                      <input
                        type="number"
                        value={d.amount}
                        onChange={(e) => setDraft({ ...d, amount: e.target.value })}
                        className="w-28 px-2 py-1 rounded border text-right"
                      />
                    </td>
                    <td className="py-1 px-2">
                      <input
                        value={d.notes ?? ""}
                        onChange={(e) => setDraft({ ...d, notes: e.target.value })}
                        className="w-48 px-2 py-1 rounded border"
                      />
                    </td>
                    <td className="py-1 px-2">
                      <input
                        value={d.asset_name}
                        onChange={(e) => setDraft({ ...d, asset_name: e.target.value })}
                        className="w-40 px-2 py-1 rounded border"
                      />
                    </td>
                    <td className="py-1 px-2">
                      <input
                        value={d.category}
                        onChange={(e) => setDraft({ ...d, category: e.target.value })}
                        className="w-32 px-2 py-1 rounded border"
                      />
                    </td>
                    <td className="py-1 px-2 text-right">
                      <div className="flex gap-1">
                        <input
                          placeholder="YYYY"
                          type="number"
                          value={d.service_start_year}
                          onChange={(e) => setDraft({ ...d, service_start_year: e.target.value })}
                          className="w-20 px-2 py-1 rounded border text-right"
                        />
                        <input
                          placeholder="MM"
                          type="number"
                          value={d.service_start_month}
                          onChange={(e) => setDraft({ ...d, service_start_month: e.target.value })}
                          className="w-14 px-2 py-1 rounded border text-right"
                        />
                      </div>
                    </td>
                    <td className="py-1 px-2 text-right">
                      <input
                        type="number"
                        value={d.useful_life_months}
                        onChange={(e) => setDraft({ ...d, useful_life_months: e.target.value })}
                        className="w-20 px-2 py-1 rounded border text-right"
                      />
                    </td>
                    <td className="py-1 px-2">
                      {renderMethod(d.depr_method, (v) => setDraft({ ...d, depr_method: v }))}
                    </td>
                    <td className="py-1 px-2 text-right">
                      <input
                        type="number"
                        value={d.salvage_value}
                        onChange={(e) => setDraft({ ...d, salvage_value: e.target.value })}
                        className="w-24 px-2 py-1 rounded border text-right"
                      />
                    </td>
                    <td className="py-1 px-2 text-center">
                      <input
                        type="checkbox"
                        checked={d.is_active}
                        onChange={(e) => setDraft({ ...d, is_active: e.target.checked })}
                      />
                    </td>
                    <td className="py-1 px-2 text-right">
                      <button onClick={saveEdit} className="px-2 py-1 rounded border mr-2 hover:bg-gray-50">
                        Save
                      </button>
                      <button onClick={cancelEdit} className="px-2 py-1 rounded border hover:bg-gray-50">
                        Cancel
                      </button>
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={it.id} className="border-b">
                  <td className="py-1 px-2">{it.year}</td>
                  <td className="py-1 px-2">{String(it.month).padStart(2, "0")}</td>
                  <td className="py-1 px-2 text-right">{fmt(it.amount as number)}</td>
                  <td className="py-1 px-2">{it.notes ?? "—"}</td>
                  <td className="py-1 px-2">{it.asset_name || "—"}</td>
                  <td className="py-1 px-2">{it.category || "—"}</td>
                  <td className="py-1 px-2 text-right">
                    {it.service_start_year
                      ? `${it.service_start_year}/${String(it.service_start_month ?? "").padStart(2, "0")}`
                      : "—"}
                  </td>
                  <td className="py-1 px-2 text-right">{it.useful_life_months ?? "—"}</td>
                  <td className="py-1 px-2">{it.depr_method || "—"}</td>
                  <td className="py-1 px-2 text-right">
                    {it.salvage_value != null ? fmt(it.salvage_value as number) : "—"}
                  </td>
                  <td className="py-1 px-2 text-center">{it.is_active ? "✓" : "—"}</td>
                  <td className="py-1 px-2 text-right">
                    <button onClick={() => beginEdit(it)} className="px-2 py-1 rounded border mr-2 hover:bg-gray-50">
                      Edit
                    </button>
                    <button onClick={() => onDelete(it)} className="px-2 py-1 rounded border hover:bg-gray-50">
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr className="border-t font-medium">
              <td className="py-1 px-2 text-right" colSpan={2}>
                Total:
              </td>
              <td className="py-1 px-2 text-right">{fmt(totals.amount)}</td>
              <td colSpan={9} />
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}
