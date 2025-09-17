// src/pages/scenario/components/CapexTable.tsx
import { useMemo, useState } from "react";
import { Card } from "../../../components/ui";
import { fmt } from "../../../utils/format";
import { apiPost, apiPatch, apiDelete, ApiError } from "../../../lib/api";
import type { ScenarioDetail, CapexEntry } from "../../../types/scenario";

/** ------- Draft Tipi (input'lar string tutulur) ------- */
type RowDraft = {
  id?: number;
  year: string;
  month: string; // 1..12
  amount: string; // number
  notes?: string;
};

function startYM(s: ScenarioDetail | null): { y: string; m: string } {
  if (!s?.start_date) return { y: "", m: "" };
  const d = new Date(s.start_date);
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1);
  return { y, m };
}

function toDraft(it?: CapexEntry, s?: ScenarioDetail | null): RowDraft {
  if (it) {
    return {
      id: it.id,
      year: String(it.year ?? ""),
      month: String(it.month ?? ""),
      amount: String(it.amount ?? 0),
      notes: it.notes ?? "",
    };
  }
  const { y, m } = startYM(s ?? null);
  return {
    year: y,
    month: m,
    amount: "0",
    notes: "",
  };
}

function toPayload(d: RowDraft): Omit<CapexEntry, "id"> {
  return {
    year: Number(d.year),
    month: Number(d.month),
    amount: Number(d.amount || 0),
    notes: d.notes || null,
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
  return null;
}

export default function CapexTable({
  data,
  refresh,
}: {
  data: ScenarioDetail;
  refresh: () => void;
}) {
  const items: CapexEntry[] = data.capex ?? [];

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<RowDraft | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  const totals = useMemo(() => {
    const t = { amount: 0 };
    for (const it of items) t.amount += it.amount ?? 0;
    return t;
  }, [items]);

  const beginAdd = () => {
    setDraft(toDraft(undefined, data));
    setAdding(true);
  };

  const beginEdit = (it: CapexEntry) => {
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

  const onDelete = async (it: CapexEntry) => {
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
              <th className="py-1 px-2 text-left">Year</th>
              <th className="py-1 px-2 text-left">Month</th>
              <th className="py-1 px-2 text-right">Amount</th>
              <th className="py-1 px-2 text-left">Notes</th>
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
                    className="w-64 px-2 py-1 rounded border"
                    placeholder="Optional"
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
                <td colSpan={5} className="py-2 text-gray-500">
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
                        className="w-64 px-2 py-1 rounded border"
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
                  <td className="py-1 px-2 text-right">{fmt(it.amount)}</td>
                  <td className="py-1 px-2">{it.notes ?? "—"}</td>
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
              <td />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}
