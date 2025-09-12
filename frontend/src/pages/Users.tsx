// src/pages/Users.tsx
import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "../lib/api";

type User = {
  id: number | string;
  email: string;
  role_name?: string | null;
  is_active?: boolean | null;
  created_at?: string | null;
};

type UsersPayload = {
  items: User[];
  meta?: {
    page?: number;
    size?: number;
    total?: number;
    pages?: number;
    has_next?: boolean;
    has_prev?: boolean;
  };
};

export default function UsersPage() {
  const [items, setItems] = useState<User[]>([]);
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
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<{
    email: string;
    role_name: string;
    is_active: boolean;
    password: string; // create'de zorunlu, edit'te opsiyonel
  }>({
    email: "",
    role_name: "",
    is_active: true,
    password: "",
  });

  const isValid = useMemo(() => {
    const okEmail = /\S+@\S+\.\S+/.test(form.email);
    if (editing) return okEmail;                   // edit: şifre opsiyonel
    return okEmail && form.password.trim().length >= 6; // create: min 6
  }, [form, editing]);

  // Yardımcı URL’ler (hem /users/:id hem /users/:id/ denenir)
  const byIdUrl = (id: number | string) => `/users/${id}/`;
  const byIdUrlNoSlash = (id: number | string) => `/users/${id}`;

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("size", String(pageSize));
      if (q.trim()) params.set("search", q.trim());

      const payload = await apiGet<UsersPayload>(`/users/?${params.toString()}`);

      setItems(payload.items ?? []);
      setTotal(payload.meta?.total);
      setPages(payload.meta?.pages);

      // has_next / has_prev çıkarımı
      if (typeof payload.meta?.has_next === "boolean") {
        setHasNext(payload.meta.has_next);
      } else if (payload.meta?.pages) {
        setHasNext(page < (payload.meta.pages ?? 1));
      } else if (payload.meta?.total != null) {
        setHasNext(page * pageSize < (payload.meta.total ?? 0));
      } else {
        setHasNext(undefined);
      }

      if (typeof payload.meta?.has_prev === "boolean") {
        setHasPrev(payload.meta.has_prev);
      } else {
        setHasPrev(page > 1);
      }
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
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchUsers();
  };

  const onNew = () => {
    setEditing(null);
    setForm({ email: "", role_name: "", is_active: true, password: "" });
    setOpen(true);
  };

  const onEdit = (row: User) => {
    setEditing(row);
    setForm({
      email: row.email || "",
      role_name: row.role_name || "",
      is_active: row.is_active ?? true,
      password: "",
    });
    setOpen(true);
  };

  const onDelete = async (row: User) => {
    if (!confirm(`Delete user "${row.email}"?`)) return;
    try {
      try {
        await apiDelete(byIdUrl(row.id));       // /users/:id/
      } catch {
        await apiDelete(byIdUrlNoSlash(row.id)); // /users/:id
      }
      await fetchUsers();
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

    // Tek BİR payload: (önceden iki kere tanımlama hatası vardı)
    const basePayload: any = {
      email: form.email.trim().toLowerCase(),
      role_name: form.role_name.trim() || "member",
      is_active: form.is_active,
    };
    if (!editing) {
      basePayload.password = form.password; // create: zorunlu
    } else if (form.password.trim().length >= 6) {
      basePayload.password = form.password.trim(); // edit: opsiyonel
    }

    try {
      if (editing) {
        try {
          await apiPatch(byIdUrl(editing.id), basePayload);
        } catch {
          await apiPatch(byIdUrlNoSlash(editing.id), basePayload);
        }
      } else {
        await apiPost("/users/", basePayload);
      }
      setOpen(false);
      await fetchUsers();
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
        <h2 className="text-lg font-medium">Users</h2>
        <form onSubmit={onSearch} className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search in email/role…"
            className="px-3 py-1.5 rounded-md border text-sm w-64"
          />
          <button type="submit" className="px-3 py-1.5 rounded-md border text-sm hover:bg-gray-50">
            Search
          </button>
          <button
            type="button"
            onClick={fetchUsers}
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
      {loading && <div className="text-sm text-gray-500">Loading users…</div>}
      {error && <div className="text-sm text-red-600">Error: {error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="text-sm text-gray-500">
          No users found. Add one and click <b>Refresh</b>.
        </div>
      )}

      {/* list */}
      {!loading && !error && items.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">Role</th>
                  <th className="py-2 pr-4">Active</th>
                  <th className="py-2 pr-4">Created</th>
                  <th className="py-2 pr-4 w-40 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{u.email}</td>
                    <td className="py-2 pr-4">{u.role_name || "—"}</td>
                    <td className="py-2 pr-4">{u.is_active === false ? "No" : "Yes"}</td>
                    <td className="py-2 pr-4">
                      {u.created_at ? new Date(u.created_at).toLocaleString() : "—"}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <button
                        onClick={() => onEdit(u)}
                        className="px-2 py-1 rounded border mr-2 hover:bg-gray-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => onDelete(u)}
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
          <div className="bg-white w-[520px] max-w-[92vw] rounded-xl shadow p-5">
            <div className="text-lg font-semibold mb-4">
              {editing ? "Edit User" : "New User"}
            </div>

            <div className="space-y-3">
              <Field label="Email">
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md border text-sm"
                  placeholder="user@example.com"
                />
              </Field>

              <Field label="Role">
                <input
                  value={form.role_name}
                  onChange={(e) => setForm((f) => ({ ...f, role_name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md border text-sm"
                  placeholder="admin / member"
                />
              </Field>

              <Field label={editing ? "Password (leave empty to keep)" : "Password"}>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md border text-sm"
                  placeholder={editing ? "•••••• (optional)" : "min 6 chars"}
                />
              </Field>

              <Field label="Active">
                <div className="flex items-center gap-2">
                  <input
                    id="is_active"
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                  />
                  <label htmlFor="is_active" className="text-sm text-gray-700">
                    User is active
                  </label>
                </div>
              </Field>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-md border hover:bg-gray-50">
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
