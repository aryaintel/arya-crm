// src/pages/Contacts.tsx
import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "../lib/api";

type Contact = {
  id: number | string;
  name: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  notes?: string | null;
  account_id?: number | string | null;
  account_name?: string | null;
  owner_id?: number | string | null;
  owner_name?: string | null;
  created_at?: string;
};

type ContactsPayload = {
  items: Contact[];
  page?: number;
  size?: number;
  total?: number;
  has_next?: boolean;
  has_prev?: boolean;
  meta?: {
    page?: number;
    size?: number;
    total?: number;
    has_next?: boolean;
    has_prev?: boolean;
  };
};

export default function ContactsPage() {
  const [items, setItems] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [size] = useState(20);
  const [total, setTotal] = useState<number | undefined>();
  const [hasNext, setHasNext] = useState<boolean | undefined>();
  const [hasPrev, setHasPrev] = useState<boolean | undefined>();

  // Modal / form
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    title: "",
    notes: "",
    account_id: "" as string | number | "",
    owner_id: "" as string | number | "",
    account_name: "",
    owner_name: "",
  });

  const isValid = useMemo(() => (form.name || "").trim().length > 1, [form]);

  const byIdUrl = (id: number | string) => `/contacts/${id}/`;
  const byIdUrlNoSlash = (id: number | string) => `/contacts/${id}`;

  const fetchContacts = async (p = page) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        page: String(p),
        size: String(size),
      });
      if (search.trim()) qs.set("search", search.trim());

      const data = await apiGet<ContactsPayload>(`/contacts/?${qs.toString()}`);

      // items: (obj.items) ya da doğrudan dizi gelebilir
      const list: Contact[] = Array.isArray((data as any).items)
        ? ((data as any).items as Contact[])
        : (Array.isArray(data as any) ? ((data as any) as Contact[]) : []);

      setItems(list);

      // meta top-level ya da data.meta olabilir
      const meta = data.meta ?? data;
      setTotal(meta?.total);
      setHasNext(meta?.has_next);
      setHasPrev(meta?.has_prev);

      if (typeof meta?.page === "number") setPage(meta.page);
      else setPage(p);
    } catch (e: any) {
      const msg =
        (e instanceof ApiError && e.message) ||
        e?.message ||
        "Contacts fetch failed";
      setError(String(msg));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContacts(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    await fetchContacts(1);
  };

  const onNew = () => {
    setEditing(null);
    setForm({
      name: "",
      email: "",
      phone: "",
      title: "",
      notes: "",
      account_id: "",
      owner_id: "",
      account_name: "",
      owner_name: "",
    });
    setOpen(true);
  };

  const onEdit = (c: Contact) => {
    setEditing(c);
    setForm({
      name: c.name ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      title: c.title ?? "",
      notes: c.notes ?? "",
      account_id: (c.account_id ?? "").toString(),
      owner_id: (c.owner_id ?? "").toString(),
      account_name: c.account_name ?? "",
      owner_name: c.owner_name ?? "",
    });
    setOpen(true);
  };

  const onDelete = async (row: Contact) => {
    if (!confirm(`Delete contact "${row.name ?? row.id}"?`)) return;
    try {
      try {
        await apiDelete(byIdUrl(row.id));
      } catch {
        await apiDelete(byIdUrlNoSlash(row.id));
      }
      await fetchContacts(page);
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
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      title: form.title.trim() || null,
      notes: form.notes.trim() || null,
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
          await apiPost("/contacts/", payload);
        } catch {
          await apiPost("/contacts", payload);
        }
      }

      setOpen(false);
      await fetchContacts(page);
      alert("Saved.");
    } catch (e: any) {
      const msg =
        (e instanceof ApiError && e.message) ||
        e?.message ||
        "Save failed";
      alert(msg);
    }
  };

  const pagerText = useMemo(() => {
    const head = `Page ${page}`;
    return typeof total === "number" ? `${head} • Total: ${total}` : head;
  }, [page, total]);

  return (
    <div className="bg-white rounded-xl shadow p-6">
      {/* header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h2 className="text-lg font-medium">Contacts</h2>
        <form onSubmit={onSearch} className="flex gap-2 items-center">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name/email/phone"
            className="px-3 py-1.5 rounded-md border text-sm w-64"
          />
          <button type="submit" className="px-3 py-1.5 rounded-md border text-sm hover:bg-gray-50">
            Search
          </button>
          <button
            type="button"
            onClick={() => fetchContacts(page)}
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
      {loading && <div className="text-sm text-gray-500">Loading contacts…</div>}
      {error && <div className="text-sm text-red-600">Error: {error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="text-sm text-gray-500">
          No contacts yet. Add one and click <b>Refresh</b>.
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
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">Phone</th>
                  <th className="py-2 pr-4">Title</th>
                  <th className="py-2 pr-4">Notes</th>
                  <th className="py-2 pr-4">Account</th>
                  <th className="py-2 pr-4">Owner</th>
                  <th className="py-2 pr-4 w-40 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{c.name || "—"}</td>
                    <td className="py-2 pr-4">{c.email || "—"}</td>
                    <td className="py-2 pr-4">{c.phone || "—"}</td>
                    <td className="py-2 pr-4">{c.title || "—"}</td>
                    <td className="py-2 pr-4">{c.notes || "—"}</td>
                    <td className="py-2 pr-4">{c.account_name ?? c.account_id ?? "—"}</td>
                    <td className="py-2 pr-4">{c.owner_name ?? c.owner_id ?? "—"}</td>
                    <td className="py-2 pr-4 text-right">
                      <button
                        onClick={() => onEdit(c)}
                        className="px-2 py-1 rounded border mr-2 hover:bg-gray-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => onDelete(c)}
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
                disabled={hasPrev === false || page === 1}
                onClick={() => {
                  const next = Math.max(1, page - 1);
                  setPage(next);
                  fetchContacts(next);
                }}
                className="px-3 py-1.5 rounded-md border hover:bg-gray-50 disabled:opacity-50"
              >
                ‹ Prev
              </button>
              <button
                disabled={hasNext === false}
                onClick={() => {
                  const next = page + 1;
                  setPage(next);
                  fetchContacts(next);
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
          <div className="bg-white w-[640px] max-w-[95vw] rounded-xl shadow p-5">
            <div className="text-lg font-semibold mb-4">
              {editing ? "Edit Contact" : "New Contact"}
            </div>

            <div className="space-y-3">
              <Field label="Name">
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md border text-sm"
                  placeholder="Jane Doe"
                />
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Email">
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    className="w-full px-3 py-2 rounded-md border text-sm"
                    placeholder="jane@company.com"
                  />
                </Field>
                <Field label="Phone">
                  <input
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2 rounded-md border text-sm"
                    placeholder="+90 5xx xxx xx xx"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Title">
                  <input
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    className="w-full px-3 py-2 rounded-md border text-sm"
                    placeholder="Manager"
                  />
                </Field>
                <Field label="Notes">
                  <input
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    className="w-full px-3 py-2 rounded-md border text-sm"
                    placeholder="new customer"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Account ID">
                  <input
                    value={form.account_id}
                    onChange={(e) => setForm((f) => ({ ...f, account_id: e.target.value }))}
                    className="w-full px-3 py-2 rounded-md border text-sm"
                    placeholder="12"
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
                    placeholder="3"
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
