// frontend/src/pages/scenario/components/BOQTable.tsx
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "../../../lib/api";

type Props = {
  scenarioId: number;
  onChanged?: () => void;
  onMarkedReady?: () => void;
};

type BOQItem = {
  id?: number;
  scenario_id?: number;
  section?: string | null;
  category?: "bulk_with_freight" | "bulk_ex_freight" | "freight" | null;
  item_name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  unit_cogs?: number | null;

  frequency: "once" | "monthly" | "per_shipment" | "per_tonne";
  months?: number | null;

  start_year?: number | null;
  start_month?: number | null;

  is_active: boolean;
  notes?: string | null;
};

function cls(...a: (string | false | undefined)[]) {
  return a.filter(Boolean).join(" ");
}
function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** --- Yerleşik ay/yıl seçici (type="month") --- */
function MonthInput({
  value,
  onChange,
  className,
}: {
  value: { year: number | null | undefined; month: number | null | undefined };
  onChange: (next: { year: number | null; month: number | null }) => void;
  className?: string;
}) {
  // HTML month value string -> "YYYY-MM" | ""
  const str =
    value.year && value.month ? `${value.year}-${pad2(value.month)}` : "";

  return (
    <input
      type="month"
      value={str}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value; // "2026-03" | ""
        if (!v) {
          onChange({ year: null, month: null });
          return;
        }
        const [y, m] = v.split("-").map((t) => Number(t));
        onChange({
          year: Number.isFinite(y) ? y : null,
          month: Number.isFinite(m) ? m : null,
        });
      }}
      className={cls(
        "w-full px-2 py-1 rounded border border-gray-300 focus:outline-none focus:ring",
        className
      )}
    />
  );
}

const CATEGORY_OPTIONS: Array<BOQItem["category"]> = [
  "bulk_with_freight",
  "bulk_ex_freight",
  "freight",
];

export default function BOQTable({ scenarioId, onChanged, onMarkedReady }: Props) {
  const [rows, setRows] = useState<BOQItem[]>([]);
  const [draft, setDraft] = useState<BOQItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const data = await apiGet<BOQItem[]>(`/scenarios/${scenarioId}/boq`);
      setRows(data);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || "Failed to load BOQ.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (scenarioId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioId]);

  // toplamları basitçe hesapla (Excel’deki satır GM = qty*(price-cogs))
  const totals = useMemo(() => {
    let rev = 0,
      cogs = 0,
      gm = 0;
    for (const r of rows) {
      const lineRev = num(r.quantity) * num(r.unit_price);
      const lineCogs = num(r.quantity) * num(r.unit_cogs || 0);
      rev += lineRev;
      cogs += lineCogs;
      gm += lineRev - lineCogs;
    }
    return { rev, cogs, gm };
  }, [rows]);

  function startAdd() {
    setDraft({
      section: "",
      category: "bulk_with_freight",
      item_name: "",
      unit: "",
      quantity: 0,
      unit_price: 0,
      unit_cogs: 0,
      frequency: "once",
      months: null,
      start_year: null,
      start_month: null,
      is_active: true,
      notes: "",
    });
  }
  function cancelAdd() {
    setDraft(null);
  }

  async function saveNew() {
    if (!draft) return;
    try {
      const created = await apiPost<BOQItem>(`/scenarios/${scenarioId}/boq`, {
        ...draft,
        quantity: num(draft.quantity),
        unit_price: num(draft.unit_price),
        unit_cogs: draft.unit_cogs == null ? null : num(draft.unit_cogs),
        months: draft.months == null ? null : num(draft.months),
      });
      setRows((p) => [...p, created]);
      setDraft(null);
      onChanged?.();
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || "Save failed.");
    }
  }

  async function saveEdit(r: BOQItem) {
    if (!r.id) return;
    try {
      const upd = await apiPut<BOQItem>(`/scenarios/${scenarioId}/boq/${r.id}`, {
        ...r,
        quantity: num(r.quantity),
        unit_price: num(r.unit_price),
        unit_cogs: r.unit_cogs == null ? null : num(r.unit_cogs),
        months: r.months == null ? null : num(r.months),
      });
      setRows((p) => p.map((x) => (x.id === r.id ? upd : x)));
      onChanged?.();
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || "Update failed.");
    }
  }

  async function delRow(r: BOQItem) {
    if (!r.id) return;
    if (!confirm("Delete BOQ item?")) return;
    try {
      await apiDelete(`/scenarios/${scenarioId}/boq/${r.id}`);
      setRows((p) => p.filter((x) => x.id !== r.id));
      onChanged?.();
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || "Delete failed.");
    }
  }

  async function markReady() {
    if (!confirm("Mark BOQ as ready and move to TWC?")) return;
    try {
      await apiPost(`/scenarios/${scenarioId}/boq/mark-ready`, {});
      onChanged?.();
      onMarkedReady?.();
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || "Cannot mark as ready.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">BOQ (Bill of Quantities)</h3>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200"
            disabled={loading}
          >
            Refresh
          </button>
          <button
            onClick={startAdd}
            className="px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700"
          >
            + Add BOQ Item
          </button>
          <button
            onClick={markReady}
            className="px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Mark BOQ Ready → TWC
          </button>
        </div>
      </div>

      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-2 rounded">
          {err}
        </div>
      )}

      <div className="overflow-x-auto border rounded bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2">Section</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2">Unit</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Unit Price</th>
              <th className="px-3 py-2 text-right">Unit COGS</th>
              <th className="px-3 py-2">Freq</th>
              <th className="px-3 py-2 text-right">Months</th>
              <th className="px-3 py-2">Start (Y/M)</th>
              <th className="px-3 py-2">Active</th>
              <th className="px-3 py-2 text-right">Line Rev</th>
              <th className="px-3 py-2 text-right">Line COGS</th>
              <th className="px-3 py-2 text-right">Line GM</th>
              <th className="px-3 py-2 w-36">Actions</th>
            </tr>
          </thead>

          <tbody>
            {draft && (
              <tr className="bg-amber-50/40">
                <td className="px-3 py-2">
                  <input
                    className="w-full px-2 py-1 rounded border border-gray-300"
                    value={draft.section ?? ""}
                    onChange={(e) => setDraft({ ...draft, section: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    className="w-full px-2 py-1 rounded border border-gray-300"
                    value={draft.category ?? "bulk_with_freight"}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        category: e.target.value as BOQItem["category"],
                      })
                    }
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c || "none"} value={c || "bulk_with_freight"}>
                        {c === "bulk_with_freight"
                          ? "Bulk (w/ Freight)"
                          : c === "bulk_ex_freight"
                          ? "Bulk (ex Freight)"
                          : "Freight"}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    className="w-full px-2 py-1 rounded border border-gray-300"
                    value={draft.item_name}
                    onChange={(e) => setDraft({ ...draft, item_name: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    className="w-full px-2 py-1 rounded border border-gray-300"
                    value={draft.unit}
                    onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    className="w-full px-2 py-1 rounded border border-gray-300 text-right"
                    value={draft.quantity}
                    onChange={(e) =>
                      setDraft({ ...draft, quantity: Number(e.target.value) })
                    }
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    className="w-full px-2 py-1 rounded border border-gray-300 text-right"
                    value={draft.unit_price}
                    onChange={(e) =>
                      setDraft({ ...draft, unit_price: Number(e.target.value) })
                    }
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    className="w-full px-2 py-1 rounded border border-gray-300 text-right"
                    value={draft.unit_cogs ?? 0}
                    onChange={(e) =>
                      setDraft({ ...draft, unit_cogs: Number(e.target.value) })
                    }
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    className="w-full px-2 py-1 rounded border border-gray-300"
                    value={draft.frequency}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        frequency: e.target.value as BOQItem["frequency"],
                      })
                    }
                  >
                    <option value="once">once</option>
                    <option value="monthly">monthly</option>
                    <option value="per_shipment">per_shipment</option>
                    <option value="per_tonne">per_tonne</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    className="w-full px-2 py-1 rounded border border-gray-300 text-right"
                    value={draft.months ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        months: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </td>
                <td className="px-3 py-2">
                  {/* Yıl/Ay yerine tek month-picker */}
                  <MonthInput
                    value={{
                      year: draft.start_year ?? null,
                      month: draft.start_month ?? null,
                    }}
                    onChange={({ year, month }) =>
                      setDraft({ ...draft, start_year: year, start_month: month })
                    }
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={!!draft.is_active}
                    onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  {num(draft.quantity * draft.unit_price)}
                </td>
                <td className="px-3 py-2 text-right">
                  {num(draft.quantity * (draft.unit_cogs ?? 0))}
                </td>
                <td className="px-3 py-2 text-right">
                  {num(
                    draft.quantity * draft.unit_price -
                      draft.quantity * (draft.unit_cogs ?? 0)
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    <button
                      onClick={saveNew}
                      className="px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700"
                    >
                      Save
                    </button>
                    <button
                      onClick={cancelAdd}
                      className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                </td>
              </tr>
            )}

            {rows.map((r) => {
              const lineRev = num(r.quantity) * num(r.unit_price);
              const lineCogs = num(r.quantity) * num(r.unit_cogs || 0);
              const lineGM = lineRev - lineCogs;

              return (
                <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                  <td className="px-3 py-2">
                    <input
                      className="w-full px-2 py-1 rounded border border-gray-300"
                      value={r.section ?? ""}
                      onChange={(e) =>
                        setRows((p) =>
                          p.map((x) =>
                            x.id === r.id ? { ...x, section: e.target.value } : x
                          )
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="w-full px-2 py-1 rounded border border-gray-300"
                      value={r.category ?? "bulk_with_freight"}
                      onChange={(e) =>
                        setRows((p) =>
                          p.map((x) =>
                            x.id === r.id
                              ? {
                                  ...x,
                                  category: e.target.value as BOQItem["category"],
                                }
                              : x
                          )
                        )
                      }
                    >
                      {CATEGORY_OPTIONS.map((c) => (
                        <option key={c || "none"} value={c || "bulk_with_freight"}>
                          {c === "bulk_with_freight"
                            ? "Bulk (w/ Freight)"
                            : c === "bulk_ex_freight"
                            ? "Bulk (ex Freight)"
                            : "Freight"}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="w-full px-2 py-1 rounded border border-gray-300"
                      value={r.item_name}
                      onChange={(e) =>
                        setRows((p) =>
                          p.map((x) =>
                            x.id === r.id ? { ...x, item_name: e.target.value } : x
                          )
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="w-full px-2 py-1 rounded border border-gray-300"
                      value={r.unit}
                      onChange={(e) =>
                        setRows((p) =>
                          p.map((x) =>
                            x.id === r.id ? { ...x, unit: e.target.value } : x
                          )
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      className="w-full px-2 py-1 rounded border border-gray-300 text-right"
                      value={r.quantity}
                      onChange={(e) =>
                        setRows((p) =>
                          p.map((x) =>
                            x.id === r.id ? { ...x, quantity: Number(e.target.value) } : x
                          )
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      className="w-full px-2 py-1 rounded border border-gray-300 text-right"
                      value={r.unit_price}
                      onChange={(e) =>
                        setRows((p) =>
                          p.map((x) =>
                            x.id === r.id
                              ? { ...x, unit_price: Number(e.target.value) }
                              : x
                          )
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      className="w-full px-2 py-1 rounded border border-gray-300 text-right"
                      value={r.unit_cogs ?? 0}
                      onChange={(e) =>
                        setRows((p) =>
                          p.map((x) =>
                            x.id === r.id
                              ? { ...x, unit_cogs: Number(e.target.value) }
                              : x
                          )
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="w-full px-2 py-1 rounded border border-gray-300"
                      value={r.frequency}
                      onChange={(e) =>
                        setRows((p) =>
                          p.map((x) =>
                            x.id === r.id
                              ? {
                                  ...x,
                                  frequency: e.target.value as BOQItem["frequency"],
                                }
                              : x
                          )
                        )
                      }
                    >
                      <option value="once">once</option>
                      <option value="monthly">monthly</option>
                      <option value="per_shipment">per_shipment</option>
                      <option value="per_tonne">per_tonne</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      className="w-full px-2 py-1 rounded border border-gray-300 text-right"
                      value={r.months ?? ""}
                      onChange={(e) =>
                        setRows((p) =>
                          p.map((x) =>
                            x.id === r.id
                              ? {
                                  ...x,
                                  months:
                                    e.target.value === ""
                                      ? null
                                      : Number(e.target.value),
                                }
                              : x
                          )
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <MonthInput
                      value={{ year: r.start_year ?? null, month: r.start_month ?? null }}
                      onChange={({ year, month }) =>
                        setRows((p) =>
                          p.map((x) =>
                            x.id === r.id
                              ? { ...x, start_year: year, start_month: month }
                              : x
                          )
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={!!r.is_active}
                      onChange={(e) =>
                        setRows((p) =>
                          p.map((x) =>
                            x.id === r.id ? { ...x, is_active: e.target.checked } : x
                          )
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-2 text-right">{lineRev}</td>
                  <td className="px-3 py-2 text-right">{lineCogs}</td>
                  <td className="px-3 py-2 text-right">{lineGM}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveEdit(r)}
                        className="px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => delRow(r)}
                        className="px-3 py-1 rounded bg-rose-600 text-white hover:bg-rose-700"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr className="bg-gray-100 font-semibold">
              <td className="px-3 py-2" colSpan={12}>
                Totals
              </td>
              <td className="px-3 py-2 text-right">{totals.rev}</td>
              <td className="px-3 py-2 text-right">{totals.cogs}</td>
              <td className="px-3 py-2 text-right">{totals.gm}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
