// frontend/src/pages/scenario/components/IndexPointsTable.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  listPoints,
  upsertPoint,
  bulkUpsertPoints,
  deletePointByYM,
  fromYM,
  type IndexPoint,
  type IndexPointBulkItem,
  type Paginated,
} from "../api/indexSeries";

type Props = {
  seriesId: number;       // Required: which series to manage
  onChanged?: () => void; // Optional callback after data changes
};

const YM_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export default function IndexPointsTable({ seriesId, onChanged }: Props) {
  // Listing & pagination
  const [rows, setRows] = useState<IndexPoint[]>([]);
  const [count, setCount] = useState(0);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);

  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Single upsert form
  const [ym, setYM] = useState("");
  const [value, setValue] = useState<string>("");

  // Bulk upsert area
  const [bulkText, setBulkText] = useState("");

  const page = useMemo(() => Math.floor(offset / limit) + 1, [offset, limit]);
  const pages = useMemo(
    () => Math.max(1, Math.ceil(count / (limit || 1))),
    [count, limit]
  );

  async function load() {
    if (!seriesId) return;
    setLoading(true);
    setError(null);
    try {
      const res: Paginated<IndexPoint> = await listPoints(seriesId, { limit, offset });
      setRows(res.items || []);
      setCount(res.count ?? res.items?.length ?? 0);
    } catch (e: any) {
      setError(e?.message || "Failed to load points.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setOffset(0); // reset paging when series changes
  }, [seriesId]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesId, limit, offset]);

  const canSingleSubmit = YM_REGEX.test(ym) && value.trim() !== "" && !loading;

  async function handleSingleUpsert() {
    if (!canSingleSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const num = Number(value);
      if (Number.isNaN(num)) {
        setError("Value must be numeric.");
        setLoading(false);
        return;
      }
      await upsertPoint(seriesId, { ym, value: num });
      setYM("");
      setValue("");
      await load();
      onChanged?.();
    } catch (e: any) {
      const status = e?.status ?? e?.response?.status;
      if (status === 400) setError("Invalid request. Check 'YYYY-MM' format and value.");
      else setError(e?.message || "Save error.");
    } finally {
      setLoading(false);
    }
  }

  const parsedBulk: IndexPointBulkItem[] = useMemo(() => {
    const out: IndexPointBulkItem[] = [];
    for (const raw of bulkText.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const parts = line.split(/[;, \t]+/).map((s) => s.trim());
      // Format A: "YYYY-MM;value"
      if (parts.length === 2 && YM_REGEX.test(parts[0])) {
        const { year, month } = fromYM(parts[0]);
        const v = Number(parts[1]);
        if (!Number.isNaN(v)) out.push({ year, month, value: v });
      }
      // Format B: "year;month;value"
      else if (parts.length >= 3) {
        const y = Number(parts[0]);
        const m = Number(parts[1]);
        const v = Number(parts[2]);
        if (
          Number.isInteger(y) &&
          Number.isInteger(m) &&
          m >= 1 &&
          m <= 12 &&
          !Number.isNaN(v)
        ) {
          out.push({ year: y, month: m, value: v });
        }
      }
    }
    return out;
  }, [bulkText]);

  async function handleBulkUpsert() {
    if (!parsedBulk.length) return;
    setLoading(true);
    setError(null);
    try {
      await bulkUpsertPoints(seriesId, parsedBulk);
      setBulkText("");
      await load();
      onChanged?.();
    } catch (e: any) {
      setError(e?.message || "Bulk upload failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(ym: string) {
    if (!ym) return;
    setLoading(true);
    setError(null);
    try {
      await deletePointByYM(seriesId, ym);
      await load();
      onChanged?.();
    } catch (e: any) {
      setError(e?.message || "Delete failed.");
    } finally {
      setLoading(false);
    }
  }

  const disablePrev = offset <= 0 || loading;
  const disableNext = offset + limit >= count || loading;

  return (
    <div className="border rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Time Series Points</div>
        <button
          className="px-3 py-1 rounded border"
          onClick={load}
          disabled={loading}
          title="Refresh"
        >
          {loading ? "…" : "↻"}
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
          {error}
        </div>
      )}

      {/* Single upsert */}
      <div className="flex flex-wrap gap-2 items-end">
        <label className="text-sm">
          Month (YYYY-MM)
          <input
            className="mt-1 border rounded px-2 py-1 w-40"
            placeholder="2025-01"
            value={ym}
            onChange={(e) => setYM(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Value
          <input
            className="mt-1 border rounded px-2 py-1 w-40"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <button
          className="px-3 py-2 rounded bg-indigo-600 text-white disabled:opacity-50"
          onClick={handleSingleUpsert}
          disabled={!canSingleSubmit}
        >
          Add / Update
        </button>
      </div>

      {/* Table */}
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-1 px-1 w-40">Month (YM)</th>
              <th className="py-1 px-1">Value</th>
              <th className="py-1 px-1 w-24 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ym} className="border-b">
                <td className="py-1 px-1">{r.ym}</td>
                <td className="py-1 px-1">{r.value}</td>
                <td className="py-1 px-1 text-right">
                  <button
                    className="text-red-600"
                    onClick={() => handleDelete(r.ym)}
                    disabled={loading}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!loading && !rows.length && (
              <tr>
                <td className="py-2 px-1 text-sm text-gray-500" colSpan={3}>
                  No records.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm">
        <div>
          Total {count} • Page {page}/{pages}
        </div>
        <div className="flex items-center gap-2">
          <select
            className="border rounded px-2 py-1"
            value={limit}
            onChange={(e) => {
              setOffset(0);
              setLimit(Number(e.target.value));
            }}
          >
            {[20, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n}/page
              </option>
            ))}
          </select>
          <button
            className="px-2 py-1 rounded border"
            disabled={disablePrev}
            onClick={() => setOffset((o) => Math.max(0, o - limit))}
          >
            ‹ Prev
          </button>
          <button
            className="px-2 py-1 rounded border"
            disabled={disableNext}
            onClick={() => setOffset((o) => o + limit)}
          >
            Next ›
          </button>
        </div>
      </div>

      {/* Bulk upsert */}
      <div className="border rounded-xl p-3">
        <div className="font-medium mb-2">Bulk Upload</div>
        <textarea
          className="w-full h-32 border rounded px-2 py-1"
          placeholder={`YYYY-MM;value\nor\nyear;month;value`}
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
        />
        <div className="flex items-center justify-between mt-2">
          <div className="text-xs text-gray-500">Rows: {parsedBulk.length}</div>
          <button
            className="px-3 py-2 rounded bg-gray-900 text-white disabled:opacity-50"
            onClick={handleBulkUpsert}
            disabled={!parsedBulk.length || loading}
          >
            Upload
          </button>
        </div>
      </div>
    </div>
  );
}
