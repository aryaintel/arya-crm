// frontend/src/pages/scenario/tabs/TaxTab.tsx
import React, { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut, apiDelete, isApiError } from "../../../lib/api";

type Props = { scenarioId: number };

/* =========================
   Types (aligned with backend)
   ========================= */
type TaxType = "vat" | "withholding" | "corp" | "custom";
type AppliesTo = "revenue" | "services" | "capex" | "profit" | "all";

type TaxRule = {
  id?: number;
  scenario_id?: number;

  name: string;
  tax_type: TaxType;
  applies_to: AppliesTo;

  rate_pct: number;
  start_year: number;
  start_month: number;
  end_year?: number | null;
  end_month?: number | null;

  is_inclusive: boolean;
  notes?: string | null;
  is_active: boolean;
};

type ResolveResp = {
  scenario_id: number;
  // legacy/new dual support
  tax_code?: string | null;          // legacy schema
  scope?: string | null;             // legacy: SALES|SERVICES|CAPEX|ALL
  applies_to?: AppliesTo | null;     // new: revenue|services|capex|all
  year: number;
  month: number;
  found: boolean;
  rate_pct: number | null;
  inclusive?: boolean | null;
  source_id?: number | null;
  jurisdiction?: string | null;
};

// Resolve UI scope (kept simple, profit rare for resolve)
type ResolveScopeUi = "all" | "sales" | "services" | "capex";
const RESOLVE_SCOPES: ResolveScopeUi[] = ["all", "sales", "services", "capex"];

// UI -> legacy backend mapping
const toLegacyScope = (s: ResolveScopeUi) =>
  s === "sales" ? "SALES" : s === "services" ? "SERVICES" : s === "capex" ? "CAPEX" : "ALL";

// UI -> new backend mapping
const toAppliesTo = (s: ResolveScopeUi): AppliesTo =>
  s === "sales" ? "revenue" : s === "services" ? "services" : s === "capex" ? "capex" : "all";

const TAX_TYPES: TaxType[] = ["vat", "withholding", "corp", "custom"];
const APPLIES: AppliesTo[] = ["revenue", "services", "capex", "profit", "all"];

/* =========================
   Format helpers (en-US, 2 decimals)
   ========================= */
const fmt2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const fmtPct = (x: any) => {
  const n = Number(x);
  return Number.isFinite(n) ? `${fmt2.format(n)} %` : "0.00 %";
};
const f2 = (x: any) => {
  const n = Number(x);
  return Number.isFinite(n) ? fmt2.format(n) : "0.00";
};

const emptyRow = (y: number, m: number): TaxRule => ({
  name: "",
  tax_type: "custom",
  applies_to: "all",
  rate_pct: 0,
  start_year: y,
  start_month: m,
  end_year: null,
  end_month: null,
  is_inclusive: false,
  notes: "",
  is_active: true,
});

export default function TaxTab({ scenarioId }: Props) {
  const [rows, setRows] = useState<TaxRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // form
  const [editing, setEditing] = useState<TaxRule | null>(null);
  const [show, setShow] = useState(false);

  // resolve panel
  const now = useMemo(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  }, []);
  const [resTaxCode, setResTaxCode] = useState<string>("VAT"); // legacy fallback
  const [resScope, setResScope] = useState<ResolveScopeUi>("all");
  const [resYear, setResYear] = useState<number>(now.y);
  const [resMonth, setResMonth] = useState<number>(now.m);
  const [resolved, setResolved] = useState<ResolveResp | null>(null);

  const baseUrl = `/scenarios/${scenarioId}/tax`;

  /* =========================
     Data loading
     ========================= */
  async function reload() {
    setLoading(true);
    setErr(null);
    setResolved(null);
    try {
      const data = await apiGet<TaxRule[]>(`${baseUrl}`);
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setRows([]);
      setErr(e?.message || "Failed to load tax rules.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioId]);

  /* =========================
     Form open/close
     ========================= */
  function openCreate() {
    setEditing(emptyRow(now.y, now.m));
    setShow(true);
  }
  function openEdit(row: TaxRule) {
    setEditing({ ...row });
    setShow(true);
  }
  function closeForm() {
    setShow(false);
    setEditing(null);
  }

  /* =========================
     Save / Delete / Toggle
     ========================= */
  async function saveForm() {
    if (!editing) return;
    const payload: TaxRule = {
      ...editing,
      rate_pct: Number(editing.rate_pct || 0),
      start_year: Number(editing.start_year),
      start_month: Number(editing.start_month),
      end_year:
        editing.end_year === undefined || editing.end_year === null || (editing.end_year as any) === ""
          ? null
          : Number(editing.end_year),
      end_month:
        editing.end_month === undefined || editing.end_month === null || (editing.end_month as any) === ""
          ? null
          : Number(editing.end_month),
      is_inclusive: !!editing.is_inclusive,
      is_active: !!editing.is_active,
    };

    try {
      if (editing.id) {
        await apiPut<TaxRule>(`${baseUrl}/${editing.id}`, payload);
      } else {
        await apiPost<TaxRule>(`${baseUrl}`, payload);
      }
      closeForm();
      await reload();
    } catch (e: any) {
      setErr(e?.message || "Failed to save tax rule.");
    }
  }

  async function removeRow(id?: number) {
    if (!id) return;
    if (!confirm("Delete this tax rule?")) return;
    try {
      await apiDelete(`${baseUrl}/${id}`);
      await reload();
    } catch (e: any) {
      setErr(e?.message || "Failed to delete.");
    }
  }

  async function toggleActive(row: TaxRule) {
    if (!row.id) return;
    try {
      await apiPut(`${baseUrl}/${row.id}`, { ...row, is_active: !row.is_active });
      await reload();
    } catch (e: any) {
      setErr(e?.message || "Failed to update.");
    }
  }

  /* =========================
     Resolve (dual schema compatible)
     ========================= */
  async function resolveTax() {
    setResolved(null);
    setErr(null);

    // Try new schema first
    try {
      const q1 = new URLSearchParams({
        applies_to: toAppliesTo(resScope), // revenue|services|capex|all
        year: String(resYear),
        month: String(resMonth),
      }).toString();

      const data = await apiGet<ResolveResp>(`${baseUrl}/resolve?${q1}`);
      setResolved(data);
      setErr(null);
      return;
    } catch (e: any) {
      // If 400/404/422, fall back to legacy; otherwise show error
      if (!isApiError(e) || (e.status !== 400 && e.status !== 404 && e.status !== 422)) {
        setErr(e?.message || "Resolve failed.");
        return;
      }
    }

    // Legacy fallback: tax_code + scope
    try {
      const code = (resTaxCode || "").trim();
      if (code.length < 2) {
        throw new Error("Please enter a Tax Code (e.g. VAT) for legacy resolve.");
      }

      const q2 = new URLSearchParams({
        tax_code: code,
        scope: toLegacyScope(resScope),
        year: String(resYear),
        month: String(resMonth),
      }).toString();

      const data = await apiGet<ResolveResp>(`${baseUrl}/resolve?${q2}`);
      setResolved(data);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || "Resolve failed.");
    }
  }

  function resolvedScopeLabel(r: ResolveResp) {
    if (r.applies_to) return r.applies_to;
    if (r.scope) return r.scope;
    return toLegacyScope(resScope);
  }

  /* =========================
     Render
     ========================= */
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold">Tax Rules</h3>
        <div className="flex items-center gap-2">
          <button onClick={openCreate} className="px-3 py-2 rounded-lg border hover:bg-gray-50">
            + New Rule
          </button>
          <button onClick={reload} className="px-3 py-2 rounded-lg border hover:bg-gray-50" disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      {err && <div className="p-3 rounded-md border border-red-300 bg-red-50 text-red-700">{err}</div>}

      {/* Table */}
      <div className="overflow-auto border rounded-xl">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              <th className="p-2 text-left">Name</th>
              <th className="p-2 text-left">Type</th>
              <th className="p-2 text-left">Scope</th>
              <th className="p-2 text-right">Rate %</th>
              <th className="p-2 text-left">Start</th>
              <th className="p-2 text-left">End</th>
              <th className="p-2 text-center">Inclusive</th>
              <th className="p-2 text-center">Active</th>
              <th className="p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="p-3" colSpan={9}>
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="p-4 text-gray-500" colSpan={9}>
                  No tax rules yet. Use <b>+ New Rule</b>.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{r.name}</td>
                  <td className="p-2">{r.tax_type}</td>
                  <td className="p-2">{r.applies_to}</td>
                  <td className="p-2 text-right">{fmtPct(r.rate_pct)}</td>
                  <td className="p-2">
                    {fmt0.format(r.start_year)}/{String(r.start_month).padStart(2, "0")}
                  </td>
                  <td className="p-2">
                    {r.end_year != null && r.end_month != null
                      ? `${fmt0.format(r.end_year)}/${String(r.end_month).padStart(2, "0")}`
                      : "—"}
                  </td>
                  <td className="p-2 text-center">
                    <input type="checkbox" checked={!!r.is_inclusive} readOnly />
                  </td>
                  <td className="p-2 text-center">
                    <input type="checkbox" checked={!!r.is_active} onChange={() => toggleActive(r)} />
                  </td>
                  <td className="p-2 text-right">
                    <button className="px-2 py-1 rounded-md border mr-2 hover:bg-gray-50" onClick={() => openEdit(r)}>
                      Edit
                    </button>
                    <button
                      className="px-2 py-1 rounded-md border hover:bg-red-50 text-red-600"
                      onClick={() => removeRow(r.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Resolve panel */}
      <div className="border rounded-xl p-3 sm:p-4 bg-white">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div>
            <div className="text-xs text-gray-600">Tax Code (legacy fallback)</div>
            <input
              className="border rounded-md px-2 py-1 w-full"
              placeholder="VAT / WHT / CORP…"
              value={resTaxCode}
              onChange={(e) => setResTaxCode(e.target.value)}
            />
          </div>
          <div>
            <div className="text-xs text-gray-600">Scope</div>
            <select
              className="border rounded-md px-2 py-1 w-full"
              value={resScope}
              onChange={(e) => setResScope(e.target.value as ResolveScopeUi)}
            >
              {RESOLVE_SCOPES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs text-gray-600">Year</div>
            <input
              type="number"
              lang="en-US"
              className="border rounded-md px-2 py-1 w-full"
              value={resYear}
              onChange={(e) => setResYear(Number(e.target.value))}
            />
          </div>
          <div>
            <div className="text-xs text-gray-600">Month</div>
            <input
              type="number"
              min={1}
              max={12}
              lang="en-US"
              className="border rounded-md px-2 py-1 w-full"
              value={resMonth}
              onChange={(e) => setResMonth(Number(e.target.value))}
            />
          </div>
          <div className="flex">
            <button className="ml-auto px-3 py-2 rounded-md border hover:bg-gray-50" onClick={resolveTax}>
              Resolve Tax
            </button>
          </div>
        </div>

        {resolved && (
          <div className="mt-3 text-sm">
            <div>
              <span className="text-gray-600 mr-1">Result:</span>
              <b>
                {resolvedScopeLabel(resolved)} @ {fmt0.format(resolved.year)}/
                {String(resolved.month).padStart(2, "0")} →{" "}
                {resolved.found && resolved.rate_pct != null ? fmtPct(resolved.rate_pct) : "—"}
              </b>
            </div>
            <div className="text-gray-500">
              {resolved.tax_code ? `code: ${resolved.tax_code}` : ""}
              {resolved.source_id ? ` (#${resolved.source_id})` : ""}
              {typeof resolved.inclusive === "boolean" ? ` • inclusive: ${resolved.inclusive ? "yes" : "no"}` : ""}
            </div>
          </div>
        )}
      </div>

      {/* Drawer / Form */}
      {show && editing && (
        <div className="fixed inset-0 bg-black/30 z-40 flex items-end sm:items-center justify-center">
          <div className="bg-white w-full sm:max-w-3xl rounded-t-2xl sm:rounded-2xl shadow-xl p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-semibold">{editing.id ? "Edit Tax Rule" : "New Tax Rule"}</h4>
              <button className="px-3 py-1 rounded-md border" onClick={closeForm}>
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-600">Name *</label>
                <input
                  className="w-full border rounded-md px-2 py-1"
                  value={editing.name}
                  onChange={(e) => setEditing((s) => s && { ...s, name: e.target.value })}
                />
              </div>

              <div>
                <label className="text-xs text-gray-600">Type</label>
                <select
                  className="w-full border rounded-md px-2 py-1"
                  value={editing.tax_type}
                  onChange={(e) => setEditing((s) => s && { ...s, tax_type: e.target.value as TaxType })}
                >
                  {TAX_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-600">Scope (applies_to)</label>
                <select
                  className="w-full border rounded-md px-2 py-1"
                  value={editing.applies_to}
                  onChange={(e) => setEditing((s) => s && { ...s, applies_to: e.target.value as AppliesTo })}
                >
                  {APPLIES.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-600">Rate %</label>
                <input
                  type="number"
                  step="0.01"
                  lang="en-US"
                  className="w-full border rounded-md px-2 py-1 text-right"
                  value={editing.rate_pct}
                  onChange={(e) => setEditing((s) => s && { ...s, rate_pct: Number(e.target.value) })}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-600">Start Year</label>
                  <input
                    type="number"
                    lang="en-US"
                    className="w-full border rounded-md px-2 py-1"
                    value={editing.start_year}
                    onChange={(e) => setEditing((s) => s && { ...s, start_year: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600">Start Month</label>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    lang="en-US"
                    className="w-full border rounded-md px-2 py-1"
                    value={editing.start_month}
                    onChange={(e) => setEditing((s) => s && { ...s, start_month: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-600">End Year (optional)</label>
                  <input
                    type="number"
                    lang="en-US"
                    className="w-full border rounded-md px-2 py-1"
                    value={editing.end_year ?? ""}
                    onChange={(e) =>
                      setEditing((s) => s && { ...s, end_year: e.target.value === "" ? null : Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600">End Month (optional)</label>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    lang="en-US"
                    className="w-full border rounded-md px-2 py-1"
                    value={editing.end_month ?? ""}
                    onChange={(e) =>
                      setEditing((s) => s && { ...s, end_month: e.target.value === "" ? null : Number(e.target.value) })
                    }
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="inclTax"
                  type="checkbox"
                  checked={!!editing.is_inclusive}
                  onChange={(e) => setEditing((s) => s && { ...s, is_inclusive: e.target.checked })}
                />
                <label htmlFor="inclTax" className="text-sm">
                  Inclusive (price includes tax)
                </label>
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs text-gray-600">Notes</label>
                <textarea
                  className="w-full border rounded-md px-2 py-1"
                  rows={3}
                  value={editing.notes ?? ""}
                  onChange={(e) => setEditing((s) => s && { ...s, notes: e.target.value })}
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="activeTax"
                  type="checkbox"
                  checked={!!editing.is_active}
                  onChange={(e) => setEditing((s) => s && { ...s, is_active: e.target.checked })}
                />
                <label htmlFor="activeTax" className="text-sm">
                  Active
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button className="px-3 py-2 rounded-md border" onClick={closeForm}>
                Cancel
              </button>
              <button className="px-3 py-2 rounded-md bg-black text-white" onClick={saveForm}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
