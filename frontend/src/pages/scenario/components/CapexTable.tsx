// frontend/src/pages/scenario/components/CapexTable.tsx
import React, { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "../../../lib/api";

type OpenKey = number | "draft";

/* ---------- Types ---------- */
type Props = {
  scenarioId: number;
  onChanged?: () => void;
  onMarkedReady?: () => void;
};

type CapexRow = {
  id?: number;
  scenario_id?: number;
  year: number;
  month: number; // 1..12 – CAPEX spend month (cash out)
  amount: number;
  notes?: string | null;

  // Basic
  asset_name?: string | null;
  category?: string | null;
  service_start_year?: number | null;
  service_start_month?: number | null;
  useful_life_months?: number | null;
  depr_method?: string | null;
  is_active?: boolean | null;

  // Advanced
  salvage_value?: number | null;
  disposal_year?: number | null;
  disposal_month?: number | null;
  disposal_proceeds?: number | null;
  replace_at_end?: boolean | null;
  per_unit_cost?: number | null;
  quantity?: number | null;
  contingency_pct?: number | null;
  partial_month_policy?: string | null;
};

/* ---------- Utils ---------- */
function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function cls(...a: (string | false | undefined)[]) {
  return a.filter(Boolean).join(" ");
}
function ymToInput(year?: number | null, month?: number | null): string {
  if (!year || !month) return "";
  return `${year}-${String(month).padStart(2, "0")}`;
}
function inputToYM(value: string): { year: number; month: number } {
  const [y, m] = value.split("-").map((x) => Number(x));
  return { year: y || new Date().getFullYear(), month: m || 1 };
}

/* ---------- Category presets (19 adet) ---------- */
const TENDER_CATEGORY_PRESETS = [
  "Emulsion Storage",
  "Ammonium Nitrate Handling",
  "Tiltframe",
  "Wallaby Bins 34T per Bin",
  "Conveyors",
  "Electrical & Controls",
  "Civil Works",
  "Foundations",
  "Buildings & Shelters",
  "Site Works & Roads",
  "Utilities & Services",
  "Water System",
  "Air/Compressor System",
  "Power Distribution",
  "Lighting",
  "Safety & Fire",
  "Commissioning & Training",
  "Spares & Consumables",
  "Miscellaneous / Contingency",
];

/* ---------- Component ---------- */
export default function CapexTable({ scenarioId, onChanged, onMarkedReady }: Props) {
  const [rows, setRows] = useState<CapexRow[]>([]);
  const [draft, setDraft] = useState<CapexRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openAdv, setOpenAdv] = useState<Partial<Record<OpenKey, boolean>>>({});

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
    const y = today.getFullYear();
    const m = today.getMonth() + 1;
    setDraft({
      year: y,
      month: m,
      amount: 0,
      asset_name: "",
      category: "",
      service_start_year: y,
      service_start_month: m,
      useful_life_months: 60,
      depr_method: "straight_line",
      is_active: true,
      salvage_value: 0,
      disposal_year: null,
      disposal_month: null,
      disposal_proceeds: 0,
      replace_at_end: false,
      per_unit_cost: null,
      quantity: null,
      contingency_pct: 0,
      partial_month_policy: "full_month",
      notes: "",
    });
    setOpenAdv((p) => ({ ...p, draft: false }));
  }

  function cancelAdd() {
    setDraft(null);
    setOpenAdv((p) => {
      const cp = { ...p };
      delete cp["draft"];
      return cp;
    });
  }

  async function saveNew() {
    if (!draft) return;
    setSaving(true);
    try {
      const body: CapexRow = {
        ...draft,
        year: num(draft.year),
        month: num(draft.month),
        amount: num(draft.amount),
        useful_life_months:
          draft.useful_life_months == null ? null : num(draft.useful_life_months),
        salvage_value: draft.salvage_value == null ? null : num(draft.salvage_value),
        disposal_year: draft.disposal_year == null ? null : num(draft.disposal_year),
        disposal_month: draft.disposal_month == null ? null : num(draft.disposal_month),
        disposal_proceeds:
          draft.disposal_proceeds == null ? null : num(draft.disposal_proceeds),
        per_unit_cost: draft.per_unit_cost == null ? null : num(draft.per_unit_cost),
        quantity: draft.quantity == null ? null : num(draft.quantity),
        contingency_pct:
          draft.contingency_pct == null ? null : num(draft.contingency_pct),
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
      const body: CapexRow = {
        ...r,
        year: num(r.year),
        month: num(r.month),
        amount: num(r.amount),
        useful_life_months:
          r.useful_life_months == null ? null : num(r.useful_life_months),
        salvage_value: r.salvage_value == null ? null : num(r.salvage_value),
        disposal_year: r.disposal_year == null ? null : num(r.disposal_year),
        disposal_month: r.disposal_month == null ? null : num(r.disposal_month),
        disposal_proceeds:
          r.disposal_proceeds == null ? null : num(r.disposal_proceeds),
        per_unit_cost: r.per_unit_cost == null ? null : num(r.per_unit_cost),
        quantity: r.quantity == null ? null : num(r.quantity),
        contingency_pct: r.contingency_pct == null ? null : num(r.contingency_pct),
      };
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

  /* ---------- UI bits ---------- */
  const labelCls = "text-xs text-gray-600 mb-1";
  const inputCls =
    "w-full px-2 py-1 rounded border border-gray-300 focus:outline-none focus:ring";
  const inputRight = cls(inputCls, "text-right");

  // Category öneri listesi: preset + satırlardan gelen benzersizler
  const categoryOptions = useMemo(() => {
    const set = new Set<string>(TENDER_CATEGORY_PRESETS);
    for (const r of rows) {
      if (r.category && r.category.trim()) set.add(r.category.trim());
    }
    if (draft?.category && draft.category.trim()) set.add(draft.category.trim());
    return Array.from(set.values());
  }, [rows, draft]);

  /* ====== Row component (memo'lu) ====== */
  const BasicRow = React.memo(function BasicRow({
    value,
    onChange,
    isDraft,
  }: {
    value: CapexRow;
    onChange: (next: CapexRow) => void;
    isDraft?: boolean;
  }) {
    const key: OpenKey = isDraft ? "draft" : (value.id as number);
    const advOpen = !!openAdv[key];

    // ---- LOCAL state (caret kaymasını engeller) ----
    const [localAsset, setLocalAsset] = useState<string>(value.asset_name ?? "");
    const [localCategory, setLocalCategory] = useState<string>(value.category ?? "");
    const [localNotes, setLocalNotes] = useState<string>(value.notes ?? "");

    // Satır başka kayıtla değişince (id değişimi vs) lokali senkle
    useEffect(() => {
      setLocalAsset(value.asset_name ?? "");
      setLocalCategory(value.category ?? "");
      setLocalNotes(value.notes ?? "");
      // only when row identity changes:
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value.id]);

    // Commit helper
    const commitField = (field: "asset_name" | "category" | "notes", v: string) => {
      if (field === "asset_name" && v !== (value.asset_name ?? "")) {
        onChange({ ...value, asset_name: v });
      } else if (field === "category" && v !== (value.category ?? "")) {
        onChange({ ...value, category: v });
      } else if (field === "notes" && v !== (value.notes ?? "")) {
        onChange({ ...value, notes: v });
      }
    };

    const commitOnEnter =
      (field: "asset_name" | "category" | "notes", current: string) =>
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
          commitField(field, current);
          (e.target as HTMLInputElement).blur();
        }
      };

    return (
      <>
        <tr className="odd:bg-white even:bg-gray-50 align-top">
          {/* Asset Name – ilk sütun (local state) */}
          <td className="px-3 py-2">
            <label className={labelCls}>Asset Name</label>
            <input
              value={localAsset}
              onChange={(e) => setLocalAsset(e.target.value)}
              onBlur={() => commitField("asset_name", localAsset)}
              onKeyDown={commitOnEnter("asset_name", localAsset)}
              className={inputCls}
              autoComplete="off"
              spellCheck={false}
            />
          </td>

          {/* Category (datalist + local state) */}
          <td className="px-3 py-2">
            <label className={labelCls}>Category</label>
            <input
              list="capex-category-options"
              value={localCategory}
              onChange={(e) => setLocalCategory(e.target.value)}
              onBlur={() => commitField("category", localCategory)}
              onKeyDown={commitOnEnter("category", localCategory)}
              className={inputCls}
              placeholder="Select or type…"
              autoComplete="off"
              spellCheck={false}
            />
          </td>

          {/* Spend (Y/M) */}
          <td className="px-3 py-2">
            <label className={labelCls}>Spend (Y/M)</label>
            <input
              type="month"
              lang="en"
              value={ymToInput(value.year, value.month)}
              onChange={(e) => {
                const { year, month } = inputToYM(e.target.value);
                onChange({ ...value, year, month });
              }}
              className={inputCls}
            />
          </td>

          {/* Amount */}
          <td className="px-3 py-2">
            <label className={labelCls}>Amount</label>
            <input
              type="number"
              value={value.amount}
              onChange={(e) => onChange({ ...value, amount: num(e.target.value) })}
              className={inputRight}
              autoComplete="off"
            />
          </td>

          {/* Active */}
          <td className="px-3 py-2">
            <label className={labelCls}>Active</label>
            <div className="flex items-center h-[34px]">
              <input
                type="checkbox"
                checked={!!value.is_active}
                onChange={(e) => onChange({ ...value, is_active: e.target.checked })}
              />
            </div>
          </td>

          {/* Service Start */}
            <td className="px-3 py-2">
              <label className={labelCls}>Service Start (Y/M)</label>
              <input
                type="month"
                lang="en"
                value={ymToInput(
                  value.service_start_year ?? null,
                  value.service_start_month ?? null
                )}
                onChange={(e) => {
                  const { year, month } = inputToYM(e.target.value);
                  onChange({
                    ...value,
                    service_start_year: year,
                    service_start_month: month,
                  });
                }}
                className={inputCls}
              />
            </td>

          {/* Useful Life */}
          <td className="px-3 py-2">
            <label className={labelCls}>Useful Life (months)</label>
            <input
              type="number"
              value={value.useful_life_months ?? 0}
              onChange={(e) =>
                onChange({ ...value, useful_life_months: num(e.target.value) })
              }
              className={inputRight}
              autoComplete="off"
            />
          </td>

          {/* Depreciation Method */}
          <td className="px-3 py-2">
            <label className={labelCls}>Depreciation</label>
            <select
              value={value.depr_method || "straight_line"}
              onChange={(e) => onChange({ ...value, depr_method: e.target.value })}
              className={inputCls}
            >
              <option value="straight_line">Straight-line</option>
              <option value="declining_balance">Declining balance</option>
            </select>
          </td>

          {/* Actions */}
          <td className="px-3 py-2 w-52">
            <div className={labelCls}>&nbsp;</div>
            <div className="flex items-center gap-2">
              {isDraft ? (
                <>
                  <button
                    onClick={saveNew}
                    disabled={saving}
                    className={cls(
                      "px-3 py-1 rounded text-white",
                      saving ? "bg-indigo-400" : "bg-indigo-600 hover:bg-indigo-700"
                    )}
                  >
                    Save
                  </button>
                  <button
                    onClick={cancelAdd}
                    className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => saveRow(value)}
                    disabled={saving}
                    className={cls(
                      "px-3 py-1 rounded text-white",
                      saving ? "bg-indigo-400" : "bg-indigo-600 hover:bg-indigo-700"
                    )}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => delRow(value)}
                    className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300"
                  >
                    Delete
                  </button>
                </>
              )}
              <button
                onClick={() => setOpenAdv((p) => ({ ...p, [key]: !advOpen }))}
                className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200"
              >
                {advOpen ? "Hide" : "Details"}
              </button>
            </div>
          </td>
        </tr>

        {/* Advanced row */}
        {advOpen && (
          <tr className="bg-white border-t">
            <td colSpan={9} className="px-3 pb-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
                <div>
                  <div className={labelCls}>Disposal (Y/M)</div>
                  <input
                    type="month"
                    lang="en"
                    value={ymToInput(value.disposal_year ?? null, value.disposal_month ?? null)}
                    onChange={(e) => {
                      const { year, month } = inputToYM(e.target.value);
                      onChange({ ...value, disposal_year: year, disposal_month: month });
                    }}
                    className={inputCls}
                  />
                </div>

                <div>
                  <div className={labelCls}>Disposal Proceeds</div>
                  <input
                    type="number"
                    value={value.disposal_proceeds ?? 0}
                    onChange={(e) =>
                      onChange({ ...value, disposal_proceeds: num(e.target.value) })
                    }
                    className={inputRight}
                    autoComplete="off"
                  />
                </div>

                <div className="flex items-end gap-2">
                  <input
                    type="checkbox"
                    checked={!!value.replace_at_end}
                    onChange={(e) => onChange({ ...value, replace_at_end: e.target.checked })}
                  />
                  <span className="text-sm text-gray-700">Replace at end</span>
                </div>

                <div>
                  <div className={labelCls}>Per Unit Cost</div>
                  <input
                    type="number"
                    value={value.per_unit_cost ?? ""}
                    onChange={(e) =>
                      onChange({ ...value, per_unit_cost: num(e.target.value) })
                    }
                    className={inputRight}
                    autoComplete="off"
                  />
                </div>

                <div>
                  <div className={labelCls}>Quantity</div>
                  <input
                    type="number"
                    value={value.quantity ?? ""}
                    onChange={(e) =>
                      onChange({ ...value, quantity: num(e.target.value) })
                    }
                    className={inputRight}
                    autoComplete="off"
                  />
                </div>

                <div>
                  <div className={labelCls}>Salvage Value</div>
                  <input
                    type="number"
                    value={value.salvage_value ?? 0}
                    onChange={(e) =>
                      onChange({ ...value, salvage_value: num(e.target.value) })
                    }
                    className={inputRight}
                    autoComplete="off"
                  />
                </div>

                <div>
                  <div className={labelCls}>Contingency (%)</div>
                  <input
                    type="number"
                    value={value.contingency_pct ?? 0}
                    onChange={(e) =>
                      onChange({ ...value, contingency_pct: num(e.target.value) })
                    }
                    className={inputRight}
                    autoComplete="off"
                  />
                </div>

                <div>
                  <div className={labelCls}>Partial Month Policy</div>
                  <select
                    value={value.partial_month_policy || "full_month"}
                    onChange={(e) =>
                      onChange({ ...value, partial_month_policy: e.target.value })
                    }
                    className={inputCls}
                  >
                    <option value="full_month">Full month</option>
                    <option value="half_month">Half month</option>
                    <option value="prorate">Prorate</option>
                  </select>
                </div>

                <div className="md:col-span-3">
                  <div className={labelCls}>Notes</div>
                  <input
                    value={localNotes}
                    onChange={(e) => setLocalNotes(e.target.value)}
                    onBlur={() => commitField("notes", localNotes)}
                    onKeyDown={commitOnEnter("notes", localNotes)}
                    className={inputCls}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              </div>
            </td>
          </tr>
        )}
      </>
    );
  });

  /* ---------- Render ---------- */
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">CAPEX</h3>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200"
          >
            Refresh
          </button>
          <button
            onClick={startAdd}
            className="px-3 py-1 rounded text-white bg-indigo-600 hover:bg-indigo-700"
          >
            + Add
          </button>
          <button
            onClick={markReady}
            className="px-3 py-1 rounded text-white bg-indigo-600 hover:bg-indigo-700"
          >
            Mark CAPEX Ready → READY
          </button>
        </div>
      </div>

      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-2 rounded">
          {err}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : (
        <div className="overflow-x-auto border rounded bg-white">
          {/* Category öneri listesi */}
          <datalist id="capex-category-options">
            {categoryOptions.map((opt) => (
              <option key={opt} value={opt} />
            ))}
          </datalist>

          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2">Asset Name</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2 w-36">Spend (Y/M)</th>
                <th className="px-3 py-2 w-28 text-right">Amount</th>
                <th className="px-3 py-2 w-20">Active</th>
                <th className="px-3 py-2 w-36">Service Start</th>
                <th className="px-3 py-2 w-36 text-right">Useful Life</th>
                <th className="px-3 py-2 w-40">Depreciation</th>
                <th className="px-3 py-2 w-52">Actions</th>
              </tr>
            </thead>
            <tbody>
              {draft && (
                <BasicRow
                  key="draft"
                  value={draft}
                  onChange={(next) => setDraft(next)}
                  isDraft
                />
              )}

              {rows.map((r) => (
                <BasicRow
                  key={r.id}
                  value={r}
                  onChange={(next) =>
                    setRows((p) => p.map((x) => (x.id === r.id ? next : x)))
                  }
                />
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 font-semibold">
                <td className="px-3 py-2">Totals</td>
                <td className="px-3 py-2" colSpan={2} />
                <td className="px-3 py-2 text-right">{total.toLocaleString()}</td>
                <td className="px-3 py-2" colSpan={5} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
