import React, { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "../../../lib/api";

type Props = {
  scenarioId: number;
  onChanged?: () => void;
  onMarkedReady?: () => void;
};

type CapexRow = {
  id?: number;
  scenario_id?: number;
  year: number;
  month: number; // 1..12
  amount: number;
  notes?: string | null;

  // ileri sürümler için alanlar (opsiyonel)
  asset_name?: string | null;
  category?: string | null;
  service_start_year?: number | null;
  service_start_month?: number | null;
  useful_life_months?: number | null;
  depr_method?: string | null;
  salvage_value?: number | null;
  is_active?: boolean | null;
  disposal_year?: number | null;
  disposal_month?: number | null;
  disposal_proceeds?: number | null;
  replace_at_end?: boolean | null;
  per_unit_cost?: number | null;
  quantity?: number | null;
  contingency_pct?: number | null;
  partial_month_policy?: string | null;
};

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// "YYYY-MM" <-> (year, month)
function ymToInput(year?: number, month?: number): string {
  if (!year || !month) return "";
  const m = String(month).padStart(2, "0");
  return `${year}-${m}`;
}
function inputToYM(value: string): { year: number; month: number } {
  const [y, m] = value.split("-").map((x) => Number(x));
  return { year: y || new Date().getFullYear(), month: m || 1 };
}

function cls(...a: (string | false | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

export default function CapexTable({ scenarioId, onChanged, onMarkedReady }: Props) {
  const [rows, setRows] = useState<CapexRow[]>([]);
  const [draft, setDraft] = useState<CapexRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const data = await apiGet<CapexRow[]>(`/scenarios/${scenarioId}/capex`);
      setRows(data || []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load CAPEX.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (scenarioId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioId]);

  function startAdd() {
    const today = new Date();
    setDraft({
      year: today.getFullYear(),
      month: today.getMonth() + 1,
      amount: 0,
      notes: "",
    });
  }
  function cancelAdd() {
    setDraft(null);
  }

  async function saveNew() {
    if (!draft) return;
    setSaving(true);
    try {
      const body = {
        ...draft,
        year: num(draft.year),
        month: num(draft.month),
        amount: num(draft.amount),
      };
      const created = await apiPost<CapexRow>(`/scenarios/${scenarioId}/capex`, body);
      setRows((p) => [...p, created]);
      setDraft(null);
      onChanged?.();
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || "CAPEX save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function saveRow(r: CapexRow) {
    if (!r.id) return;
    setSaving(true);
    try {
      const body = { ...r, year: num(r.year), month: num(r.month), amount: num(r.amount) };
      const upd = await apiPut<CapexRow>(`/scenarios/${scenarioId}/capex/${r.id}`, body);
      setRows((p) => p.map((x) => (x.id === r.id ? upd : x)));
      onChanged?.();
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || "CAPEX update failed.");
    } finally {
      setSaving(false);
    }
  }

  async function delRow(r: CapexRow) {
    if (!r.id) return;
    if (!confirm("Delete CAPEX item?")) return;
    try {
      await apiDelete(`/scenarios/${scenarioId}/capex/${r.id}`);
      setRows((p) => p.filter((x) => x.id !== r.id));
      onChanged?.();
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || "CAPEX delete failed.");
    }
  }

  async function markReady() {
    if (!confirm("Mark CAPEX as ready and move to READY (P&L)?")) return;
    try {
      await apiPost(`/scenarios/${scenarioId}/workflow/mark-capex-ready`, {});
      onMarkedReady?.();
      alert("Workflow moved to READY.");
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || "Cannot mark CAPEX as ready.");
    }
  }

  const total = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [rows]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">CAPEX</h3>
        <div className="flex gap-2">
          <button onClick={load} className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200">
            Refresh
          </button>
          <button onClick={startAdd} className="px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700">
            + Add
          </button>
          <button
            onClick={markReady}
            className="px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Mark CAPEX Ready → READY
          </button>
        </div>
      </div>

      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-2 rounded">{err}</div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : (
        <div className="overflow-x-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 w-44">Month</th>
                <th className="px-3 py-2 w-32 text-right">Amount</th>
                <th className="px-3 py-2">Notes</th>
                <th className="px-3 py-2 w-40">Actions</th>
              </tr>
            </thead>
            <tbody>
              {/* inline add row */}
              {draft && (
                <tr className="bg-amber-50/40">
                  <td className="px-3 py-2">
                    <input
                      type="month"
                      value={ymToInput(draft.year, draft.month)}
                      onChange={(e) => {
                        const { year, month } = inputToYM(e.target.value);
                        setDraft({ ...(draft as CapexRow), year, month });
                      }}
                      className="w-full px-2 py-1 rounded border border-gray-300 focus:outline-none focus:ring"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={draft.amount}
                      onChange={(e) => setDraft({ ...(draft as CapexRow), amount: num(e.target.value) })}
                      className="w-full px-2 py-1 rounded border border-gray-300 focus:outline-none focus:ring text-right"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={draft.notes || ""}
                      onChange={(e) => setDraft({ ...(draft as CapexRow), notes: e.target.value })}
                      className="w-full px-2 py-1 rounded border border-gray-300 focus:outline-none focus:ring"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button
                        onClick={saveNew}
                        disabled={saving}
                        className={cls(
                          "px-3 py-1 rounded text-white",
                          saving ? "bg-emerald-400" : "bg-emerald-600 hover:bg-emerald-700"
                        )}
                      >
                        Save
                      </button>
                      <button onClick={cancelAdd} className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300">
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              )}

              {/* existing rows */}
              {rows.map((r) => (
                <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                  <td className="px-3 py-2">
                    <input
                      type="month"
                      value={ymToInput(r.year, r.month)}
                      onChange={(e) => {
                        const { year, month } = inputToYM(e.target.value);
                        setRows((p) => p.map((x) => (x.id === r.id ? { ...x, year, month } : x)));
                      }}
                      className="w-full px-2 py-1 rounded border border-gray-300 focus:outline-none focus:ring"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={r.amount}
                      onChange={(e) =>
                        setRows((p) => p.map((x) => (x.id === r.id ? { ...x, amount: num(e.target.value) } : x)))
                      }
                      className="w-full px-2 py-1 rounded border border-gray-300 focus:outline-none focus:ring text-right"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={r.notes || ""}
                      onChange={(e) =>
                        setRows((p) => p.map((x) => (x.id === r.id ? { ...x, notes: e.target.value } : x)))
                      }
                      className="w-full px-2 py-1 rounded border border-gray-300 focus:outline-none focus:ring"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveRow(r)}
                        disabled={saving}
                        className={cls(
                          "px-3 py-1 rounded text-white",
                          saving ? "bg-emerald-400" : "bg-emerald-600 hover:bg-emerald-700"
                        )}
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
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 font-semibold">
                <td className="px-3 py-2">Totals</td>
                <td className="px-3 py-2 text-right">{total.toLocaleString()}</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
