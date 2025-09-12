// src/pages/Deals.tsx
import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "../lib/api";

type Deal = {
  id: number | string;
  name: string;
  stage?: string | null;
  current_stage?: string | null;
  source?: string | null;
  expected_close_date?: string | null; // ISO (YYYY-MM-DD)
  account_id?: number | string | null;
  account_name?: string | null;
  owner_id?: number | string | null;
  owner_name?: string | null;
  created_at?: string;
  updated_at?: string;
  owner?: { id?: number | string; name?: string; email?: string } | null;
  account?: { id?: number | string; name?: string; industry?: string } | null;
};

type DealsPayload = {
  items: Deal[];
  total?: number;
  page?: number;
  page_size?: number;
  meta?: {
    total?: number;
    page?: number;
    page_size?: number;
  };
};

export default function DealsPage() {
  const [items, setItems] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState<number | undefined>();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Deal | null>(null);
  const [form, setForm] = useState({
    name: "",
    stage: "",
    current_stage: "",
    source: "",
    expected_close_date: "",
    account_id: "" as string | number | "",
    owner_id: "" as string | number | "",
    account_name: "",
    owner_name: "",
  });

  const isValid = useMemo(() => (form.name || "").trim().length > 1, [form]);

  const byIdUrl = (id: number | string) => `/deals/${id}/`;
  const byIdUrlNoSlash = (id: number | string) => `/deals/${id}`;

  const fetchDeals = async (p = page) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        page: String(p),
        page_size: String(pageSize),
      });
      const data = await apiGet<DealsPayload>(`/deals/?${qs.toString()}`);

      const list: Deal[] = Array.isArray((data as any).items)
        ? ((data as any).items as Deal[])
        : (Array.isArray(data as any) ? ((data as any) as Deal[]) : []);
      setItems(list);

      const meta = data.meta ?? data;
      if (typeof meta?.total === "number") setTotal(meta.total);
      else setTotal(list.length);

      if (typeof meta?.page === "number") setPage(meta.page);
      else setPage(p);
    } catch (e: any) {
      const msg =
        (e instanceof ApiError && e.message) ||
        e?.message ||
        "Deals fetch failed";
      setError(String(msg));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeals(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pagerText = useMemo(() => {
    const head = `Page ${page}`;
    return typeof total === "number" ? `${head} • Total: ${total}` : head;
  }, [page, total]);

  const hasPrev = page > 1;
  const hasNext =
    typeof total === "number" ? page * pageSize < total : items.length === pageSize;

  const onRefresh = () => fetchDeals(page);

  const onNew = () => {
    setEditing(null);
    setForm({
      name: "",
      stage: "",
      current_stage: "",
      source: "",
      expected_close_date: "",
      account_id: "",
      owner_id: "",
      account_name: "",
      owner_name: "",
    });
    setOpen(true);
  };

  const onEdit = (d: Deal) => {
    setEditing(d);
    setForm({
      name: d.name ?? "",
      stage: d.stage ?? "",
      current_stage: d.current_stage ?? "",
      source: d.source ?? "",
      expected_close_date: (d.expected_close_date ?? "").slice(0, 10),
      account_id: (d.account_id ?? d.account?.id ?? "").toString(),
      owner_id: (d.owner_id ?? d.owner?.id ?? "").toString(),
      account_name: d.account_name ?? d.account?.name ?? "",
      owner_name: d.owner_name ?? d.owner?.name ?? "",
    });
    setOpen(true);
  };

  const onDelete = async (row: Deal) => {
    if (!confirm(`Delete deal "${row.name ?? row.id}"?`)) return;
    try {
      try {
        await apiDelete(byIdUrl(row.id));
      } catch {
        await apiDelete(byIdUrlNoSlash(row.id));
      }
      await fetchDeals(page);
      alert("Deleted.");
    } catch (e: any) {
      const msg =
        (e instanceof ApiError && e.message) ||
        e?.message ||
        "Delete failed";
      alert(String(msg));
    }
  };

  const onSave = async () => {
    if (!isValid) return;

    const payload = {
      name: form.name.trim(),
      stage: form.stage.trim() || null,
      current_stage: form.current_stage.trim() || null,
      source: form.source.trim() || null,
      expected_close_date: form.expected_close_date || null,
      account_id:
        form.account_id === "" || form.account_id === null
          ? null
          : Number(form.account_id),
      owner_id:
        form.owner_id === "" || form.owner_id === null
          ? null
          : Number(form.owner_id),
    };

    try {
      if (editing) {
        try {
          await apiPatch(byIdUrl(editing.id), payload);
        } catch {
          await apiPatch(byIdUrlNoSlash(editing.id), payload);
        }
      } else {
        try {
          await apiPost("/deals/", payload);
        } catch {
          await apiPost("/deals", payload);
        }
      }
      setOpen(false);
      await fetchDeals(page);
      alert("Saved.");
    } catch (e: any) {
      const msg =
        (e instanceof ApiError && e.message) ||
        e?.message ||
        "Save failed";
      alert(String(msg));
    }
  };

  return (
    <div className="bg-white rounded-xl shadow p-6">
      {/* header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h2 className="text-lg font-medium">Deals</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="px-3 py-1.5 rounded-md border text-sm hover:bg-gray-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={onNew}
            className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-500"
          >
            + New
          </button>
        </div>
      </div>

      {/* states */}
      {loading && <div className="text-sm text-gray-500">Loading deals…</div>}
      {error && <div className="text-sm text-red-600">Error: {error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="text-sm text-gray-500">
          No deals yet. Add one and click <b>Refresh</b>.
        </div>
      )}

      {/* list */}
      {!loading && !error && items.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Stage</th>
                  <th className="py-2 pr-4">Current Stage</th>
                  <th className="py-2 pr-4">Source</th>
                  <th className="py-2 pr-4">Expected Close</th>
                  <th className="py-2 pr-4">Account</th>
                  <th className="py-2 pr-4">Owner</th>
                  <th className="py-2 pr-4 w-40 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{d.name || "—"}</td>
                    <td className="py-2 pr-4">{d.stage || "—"}</td>
                    <td className="py-2 pr-4">{d.current_stage || "—"}</td>
                    <td className="py-2 pr-4">{d.source || "—"}</td>
                    <td className="py-2 pr-4">
                      {d.expected_close_date
                        ? new Date(d.expected_close_date).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="py-2 pr-4">
                      {d.account_name ?? d.account?.name ?? d.account_id ?? "—"}
                    </td>
                    <td className="py-2 pr-4">
                      {d.owner_name ?? d.owner?.name ?? d.owner_id ?? "—"}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <button
                        onClick={() => onEdit(d)}
                        className="px-2 py-1 rounded border mr-2 hover:bg-gray-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => onDelete(d)}
                        className="px-2 py-1 rounded border hover:bg-gray-50"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* pager */}
          <div className="flex items-center justify-between mt-4 text-sm">
            <div className="text-gray-500">{pagerText}</div>
            <div className="flex gap-2">
              <button
                disabled={!hasPrev}
                onClick={() => {
                  const next = Math.max(1, page - 1);
                  setPage(next);
                  fetchDeals(next);
                }}
                className="px-3 py-1.5 rounded-md border hover:bg-gray-50 disabled:opacity-50"
              >
                ‹ Prev
              </button>
              <button
                disabled={!hasNext}
                onClick={() => {
                  const next = page + 1;
                  setPage(next);
                  fetchDeals(next);
                }}
                className="px-3 py-1.5 rounded-md border hover:bg-gray-50 disabled:opacity-50"
              >
                Next ›
              </button>
            </div>
          </div>
        </>
      )}

      {/* modal */}
      {open && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white w-[720px] max-w-[95vw] rounded-xl shadow p-5">
            <div className="text-lg font-semibold mb-4">
              {editing ? "Edit Deal" : "New Deal"}
            </div>

            <div className="space-y-3">
              <Field label="Name">
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md border text-sm"
                  placeholder="New project"
                />
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Stage">
                  <input
                    value={form.stage}
                    onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value }))}
                    className="w-full px-3 py-2 rounded-md border text-sm"
                    placeholder="Qualification"
                  />
                </Field>
                <Field label="Current Stage">
                  <input
                    value={form.current_stage}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, current_stage: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-md border text-sm"
                    placeholder="Discovery"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Source">
                  <input
                    value={form.source}
                    onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                    className="w-full px-3 py-2 rounded-md border text-sm"
                    placeholder="Referral"
                  />
                </Field>
                <Field label="Expected Close">
                  <input
                    type="date"
                    value={form.expected_close_date}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, expected_close_date: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-md border text-sm"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Account ID">
                  <input
                    value={form.account_id}
                    onChange={(e) => setForm((f) => ({ ...f, account_id: e.target.value }))}
                    className="w-full px-3 py-2 rounded-md border text-sm"
                    placeholder="2"
                  />
                  {form.account_name ? (
                    <div className="text-xs text-gray-500 mt-1">
                      Current account: <b>{form.account_name}</b>
                    </div>
                  ) : null}
                </Field>

                <Field label="Owner ID">
                  <input
                    value={form.owner_id}
                    onChange={(e) => setForm((f) => ({ ...f, owner_id: e.target.value }))}
                    className="w-full px-3 py-2 rounded-md border text-sm"
                    placeholder="1"
                  />
                  {form.owner_name ? (
                    <div className="text-xs text-gray-500 mt-1">
                      Current owner: <b>{form.owner_name}</b>
                    </div>
                  ) : null}
                </Field>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 rounded-md border hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                disabled={!isValid}
                onClick={onSave}
                className="px-3 py-1.5 rounded-md bg-indigo-600 text-white disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
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
