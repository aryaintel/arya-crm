// src/pages/Accounts.tsx
import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "../lib/api";

type Account = {
  id: number | string;
  name: string;
  industry?: string | null;
  type?: string | null;
  website?: string | null;
  phone?: string | null;
  billing_address?: string | null;
  shipping_address?: string | null;
  owner_email?: string | null; // backend'den geliyor, sadece görüntüleme
};

type AccountsPayload = {
  items: Account[];
  meta?: {
    page?: number;
    size?: number;
    total?: number;
    pages?: number;
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
  const [pages, setPages] = useState<number | undefined>();

  // modal state
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form, setForm] = useState<{
    name: string;
    industry: string;
    type: string;
    website: string;
    phone: string;
    billing_address: string;
    shipping_address: string;
  }>({
    name: "",
    industry: "",
    type: "",
    website: "",
    phone: "",
    billing_address: "",
    shipping_address: "",
  });

  const isValid = useMemo(() => (form.name || "").trim().length > 1, [form]);

  const byIdUrl = (id: number | string) => `/accounts/${id}/`;
  const byIdUrlNoSlash = (id: number | string) => `/accounts/${id}`;

  const fetchAccounts = async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        size: String(pageSize),
      });
      if (q.trim()) qs.set("q", q.trim());

      const payload = await apiGet<AccountsPayload>(`/accounts/?${qs.toString()}`);

      setItems(payload.items ?? []);
      setTotal(payload.meta?.total);
      setPages(payload.meta?.pages);
      // has_next / has_prev gelmezse hesapla
      if (typeof payload.meta?.has_next === "boolean") {
        setHasNext(payload.meta.has_next);
      } else if (payload.meta?.pages) {
        setHasNext(page < (payload.meta.pages ?? 1));
      } else if (payload.meta?.total != null) {
        setHasNext(page * pageSize < (payload.meta.total ?? 0));
      } else {
        setHasNext(undefined);
      }
      setHasPrev(typeof payload.meta?.has_prev === "boolean" ? payload.meta.has_prev : page > 1);
    } catch (e: any) {
      const msg =
        (e instanceof ApiError && e.message) ||
        e?.response?.data?.detail ||
        e?.message ||
        "Unknown error";
      setError(String(msg));
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
    setForm({
      name: "",
      industry: "",
      type: "",
      website: "",
      phone: "",
      billing_address: "",
      shipping_address: "",
    });
    setOpen(true);
  };

  const onEdit = (row: Account) => {
    setEditing(row);
    setForm({
      name: row.name || "",
      industry: row.industry || "",
      type: row.type || "",
      website: row.website || "",
      phone: row.phone || "",
      billing_address: row.billing_address || "",
      shipping_address: row.shipping_address || "",
    });
    setOpen(true);
  };

  const onDelete = async (row: Account) => {
    if (!confirm(`Delete account "${row.name}"?`)) return;
    try {
      try {
        await apiDelete(byIdUrl(row.id)); // /accounts/:id/
      } catch {
        await apiDelete(byIdUrlNoSlash(row.id)); // /accounts/:id
      }
      await fetchAccounts();
      alert("Deleted.");
    } catch (e: any) {
      const msg =
        (e instanceof ApiError && e.message) ||
        e?.response?.data?.detail ||
        e?.message ||
        "Delete failed";
      alert(String(msg));
    }
  };

  const onSave = async () => {
    if (!isValid) return;

    // owner backend tarafından current user olarak atanır — gönderme!
    const payload = {
      name: form.name.trim(),
      industry: form.industry.trim() || null,
      type: form.type.trim() || null,
      website: form.website.trim() || null,
      phone: form.phone.trim() || null,
      billing_address: form.billing_address.trim() || null,
      shipping_address: form.shipping_address.trim() || null,
    };

    try {
      if (editing) {
        try {
          await apiPatch(byIdUrl(editing.id), payload);
        } catch {
          await apiPatch(byIdUrlNoSlash(editing.id), payload);
        }
      } else {
        await apiPost("/accounts/", payload);
      }
      setOpen(false);
      await fetchAccounts();
    } catch (e: any) {
      const msg =
        (e instanceof ApiError && e.message) ||
        e?.response?.data?.detail ||
        e?.message ||
        "Save failed";
      alert(String(msg));
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
          <button type="submit" className="px-3 py-1.5 rounded-md border text-sm hover:bg-gray-50">
            Search
          </button>
          <button
            type="button"
            onClick={fetchAccounts}
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
        </form>
      </div>

      {/* states */}
      {loading && <div className="text-sm text-gray-500">Loading accounts…</div>}
      {error && <div className="text-sm text-red-600">Error: {error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="text-sm text-gray-500">
          No accounts yet. Add one and click <b>Refresh</b>.
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
                        <a
                          className="text-indigo-600 hover:underline"
                          href={a.website}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {a.website}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-4">{a.owner_email ?? "—"}</td>
                    <td className="py-2 pr-4 text-right">
                      <button
                        onClick={() => onEdit(a)}
                        className="px-2 py-1 rounded border mr-2 hover:bg-gray-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => onDelete(a)}
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
            <div className="text-gray-500">
              Page {page}
              {typeof pages === "number" ? <> / {pages}</> : null}
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
          <div className="bg-white w-[560px] max-w-[92vw] rounded-xl shadow p-5">
            <div className="text-lg font-semibold mb-4">
              {editing ? "Edit Account" : "New Account"}
            </div>

            <div className="space-y-3">
              <Field label="Name">
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md border text-sm"
                  placeholder="Acme Corp"
                />
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Industry">
                  <input
                    value={form.industry}
                    onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
                    className="w-full px-3 py-2 rounded-md border text-sm"
                    placeholder="Manufacturing"
                  />
                </Field>
                <Field label="Type">
                  <input
                    value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                    className="w-full px-3 py-2 rounded-md border text-sm"
                    placeholder="Customer / Partner…"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Website">
                  <input
                    value={form.website}
                    onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                    className="w-full px-3 py-2 rounded-md border text-sm"
                    placeholder="https://acme.example"
                  />
                </Field>
                <Field label="Phone">
                  <input
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2 rounded-md border text-sm"
                    placeholder="+90 555 000 00 00"
                  />
                </Field>
              </div>

              <Field label="Billing Address">
                <textarea
                  value={form.billing_address}
                  onChange={(e) => setForm((f) => ({ ...f, billing_address: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md border text-sm"
                  placeholder="Street, City, Zip, Country"
                  rows={2}
                />
              </Field>

              <Field label="Shipping Address">
                <textarea
                  value={form.shipping_address}
                  onChange={(e) => setForm((f) => ({ ...f, shipping_address: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md border text-sm"
                  placeholder="Street, City, Zip, Country"
                  rows={2}
                />
              </Field>

              {/* Owner readonly info */}
              <div className="text-xs text-gray-500">
                {editing ? (
                  <>
                    Owner: <b>{editing.owner_email ?? "—"}</b>
                  </>
                ) : (
                  <>Owner: <b>bu kaydı oluşturan kullanıcı</b> olacaktır.</>
                )}
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
