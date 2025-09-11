// src/pages/Accounts.tsx
import { useEffect, useMemo, useState } from "react";
import api from "../lib/api";

type Account = {
  id: number | string;
  name: string;
  industry?: string | null;
  website?: string | null;
  owner_name?: string | null;   // read-only (liste için)
  owner_id?: number | null;     // BE'ye gönderilecek alan
};

type AccountsPayload = {
  items: Account[];
  meta?: {
    page?: number;
    page_size?: number;
    total?: number;
    has_next?: boolean;
    has_prev?: boolean;
  };
};

export default function AccountsPage() {
  const [items, setItems] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

  const [total, setTotal] = useState<number | undefined>();
  const [hasNext, setHasNext] = useState<boolean | undefined>();
  const [hasPrev, setHasPrev] = useState<boolean | undefined>();

  // modal state
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form, setForm] = useState<Partial<Account>>({
    name: "",
    industry: "",
    website: "",
    owner_id: null,
  });
  const isValid = useMemo(() => (form.name || "").trim().length > 1, [form]);

  const byIdUrl = (id: number | string) => `/accounts/${id}/`;
  const byIdUrlNoSlash = (id: number | string) => `/accounts/${id}`;

  const fetchAccounts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/accounts/", { params: { page, page_size: pageSize, q } });
      const payload: AccountsPayload = Array.isArray(res.data)
        ? { items: res.data, meta: { page, page_size: pageSize } }
        : (res.data as AccountsPayload);

      setItems(payload.items ?? []);
      setTotal(payload.meta?.total);
      setHasNext(payload.meta?.has_next);
      setHasPrev(payload.meta?.has_prev);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchAccounts();
  };

  const onNew = () => {
    setEditing(null);
    setForm({ name: "", industry: "", website: "", owner_id: null });
    setOpen(true);
  };

  const onEdit = (row: Account) => {
    setEditing(row);
    setForm({
      name: row.name || "",
      industry: row.industry || "",
      website: row.website || "",
      owner_id: row.owner_id ?? null,
      owner_name: row.owner_name ?? "",
    });
    setOpen(true);
  };

  const onDelete = async (row: Account) => {
    if (!confirm(`Delete account "${row.name}"?`)) return;
    try {
      try {
        await api.delete(byIdUrl(row.id));           // /accounts/:id/
      } catch {
        await api.delete(byIdUrlNoSlash(row.id));    // /accounts/:id
      }
      await fetchAccounts();
      alert("Deleted.");
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || "Delete failed");
    }
  };

  const onSave = async () => {
    if (!isValid) return;

    // owner_name BE'ye gönderilmez; BE owner_id bekler.
    const payload = {
      name: form.name?.trim(),
      industry: form.industry || null,
      website: form.website || null,
      owner_id:
        form.owner_id === undefined || form.owner_id === null || Number.isNaN(form.owner_id)
          ? null
          : Number(form.owner_id),
    };

    try {
      if (editing) {
        try {
          await api.patch(byIdUrl(editing.id), payload);
        } catch {
          try {
            await api.put(byIdUrl(editing.id), payload);
          } catch {
            await api.put(byIdUrlNoSlash(editing.id), payload);
          }
        }
      } else {
        await api.post("/accounts/", payload);
      }
      setOpen(false);
      await fetchAccounts();
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || "Save failed");
    }
  };

  return (
    <div className="bg-white rounded-xl shadow p-6">
      {/* header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h2 className="text-lg font-medium">Accounts</h2>
        <form onSubmit={onSearch} className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, industry…"
            className="px-3 py-1.5 rounded-md border text-sm w-64"
          />
          <button type="submit" className="px-3 py-1.5 rounded-md border text-sm hover:bg-gray-50">Search</button>
          <button type="button" onClick={fetchAccounts} className="px-3 py-1.5 rounded-md border text-sm hover:bg-gray-50">Refresh</button>
          <button type="button" onClick={onNew} className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-500">+ New</button>
        </form>
      </div>

      {/* states */}
      {loading && <div className="text-sm text-gray-500">Loading accounts…</div>}
      {error && <div className="text-sm text-red-600">Error: {error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="text-sm text-gray-500">No accounts yet. Add one and click <b>Refresh</b>.</div>
      )}

      {/* list */}
      {!loading && !error && items.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Industry</th>
                  <th className="py-2 pr-4">Website</th>
                  <th className="py-2 pr-4">Owner</th>
                  <th className="py-2 pr-4 w-40 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{a.name}</td>
                    <td className="py-2 pr-4">{a.industry ?? "—"}</td>
                    <td className="py-2 pr-4">
                      {a.website ? (
                        <a className="text-indigo-600 hover:underline" href={a.website} target="_blank" rel="noreferrer">
                          {a.website}
                        </a>
                      ) : "—"}
                    </td>
                    <td className="py-2 pr-4">{a.owner_name ?? (a.owner_id ?? "—")}</td>
                    <td className="py-2 pr-4 text-right">
                      <button onClick={() => onEdit(a)} className="px-2 py-1 rounded border mr-2 hover:bg-gray-50">Edit</button>
                      <button onClick={() => onDelete(a)} className="px-2 py-1 rounded border hover:bg-gray-50">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* pager */}
          <div className="flex items-center justify-between mt-4 text-sm">
            <div className="text-gray-500">
              Page {page}
              {typeof total === "number" ? <> • Total: {total}</> : null}
            </div>
            <div className="flex gap-2">
              <button
                disabled={hasPrev === false || page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 rounded-md border hover:bg-gray-50 disabled:opacity-50"
              >
                ‹ Prev
              </button>
              <button
                disabled={hasNext === false}
                onClick={() => setPage((p) => p + 1)}
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
          <div className="bg-white w-[520px] max-w-[92vw] rounded-xl shadow p-5">
            <div className="text-lg font-semibold mb-4">
              {editing ? "Edit Account" : "New Account"}
            </div>

            <div className="space-y-3">
              <Field label="Name">
                <input
                  value={form.name ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md border text-sm"
                  placeholder="Acme Corp"
                />
              </Field>

              <Field label="Industry">
                <input
                  value={form.industry ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md border text-sm"
                  placeholder="Manufacturing"
                />
              </Field>

              <Field label="Website">
                <input
                  value={form.website ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md border text-sm"
                  placeholder="https://acme.example"
                />
              </Field>

              <Field label="Owner ID">
                <input
                  type="number"
                  value={form.owner_id ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      owner_id: e.target.value === "" ? null : Number(e.target.value),
                    }))
                  }
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

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-md border hover:bg-gray-50">Cancel</button>
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
