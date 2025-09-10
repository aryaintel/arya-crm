// src/App.tsx
import { useEffect, useState } from "react";
import { Routes, Route, NavLink, useLocation } from "react-router-dom";
import api from "./lib/api";

/* ----------------- Tipler ----------------- */
type Account = {
  id: string | number;
  name: string;
  industry?: string | null;
  website?: string | null;
  owner_name?: string | null;
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

type Contact = {
  id: string | number;
  // BE bazı yerlerde "name", bazı yerlerde first/last dönebilir
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;

  email?: string | null;
  phone?: string | null;
  title?: string | null;
  notes?: string | null;

  account_id?: number | null;
  account_name?: string | null;

  created_at?: string | null;
};

type ContactsPayload = {
  items: Contact[];
  meta?: {
    page?: number;
    page_size?: number;
    total?: number;
    has_next?: boolean;
    has_prev?: boolean;
  };
};

/* ----------------- Yardımcılar ----------------- */
const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString() : "—");
const fullName = (c: Contact) =>
  c.name ||
  [c.first_name, c.last_name].filter(Boolean).join(" ").trim() ||
  "—";

/* ----------------- Basit sayfalar ----------------- */
function Dashboard() {
  const [count, setCount] = useState(0);
  return (
    <div className="bg-white rounded-xl shadow p-6">
      <h2 className="text-lg font-medium mb-4">Welcome to Aryaintel CRM</h2>
      <p className="text-sm text-gray-600 mb-4">
        This is a Salesforce-like shell. Use the sidebar to navigate.
      </p>
      <button
        onClick={() => setCount((c) => c + 1)}
        className="px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-500"
      >
        Clicked {count} times
      </button>
    </div>
  );
}

/* ----------------- Accounts (GERÇEK VERİ + arama/sayfa) ----------------- */
function Accounts() {
  const [items, setItems] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // filtreler
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

  // meta (opsiyonel)
  const [total, setTotal] = useState<number | undefined>(undefined);
  const [hasNext, setHasNext] = useState<boolean | undefined>(undefined);
  const [hasPrev, setHasPrev] = useState<boolean | undefined>(undefined);

  const fetchAccounts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/accounts/", {
        params: { page, page_size: pageSize, q },
      });

      // API bazen {items, meta}, bazen [] dönebilir — defansif ol
      let payload: AccountsPayload;
      if (Array.isArray(res.data)) {
        payload = { items: res.data, meta: { page, page_size: pageSize } };
      } else {
        payload = res.data as AccountsPayload;
      }

      setItems(payload.items ?? []);
      setTotal(payload.meta?.total);
      setHasNext(payload.meta?.has_next);
      setHasPrev(payload.meta?.has_prev);

      console.log("GET /accounts response:", res.data);
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail || err?.message || "Unknown error";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]); // arama submit ile tetiklenecek

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchAccounts();
  };

  return (
    <div className="bg-white rounded-xl shadow p-6">
      {/* Üst başlık, arama ve refresh */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h2 className="text-lg font-medium">Accounts</h2>

        <form onSubmit={onSearch} className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, industry…"
            className="px-3 py-1.5 rounded-md border text-sm w-64"
          />
          <button
            type="submit"
            className="px-3 py-1.5 rounded-md border text-sm hover:bg-gray-50"
          >
            Search
          </button>
          <button
            type="button"
            onClick={fetchAccounts}
            className="px-3 py-1.5 rounded-md border text-sm hover:bg-gray-50"
          >
            Refresh
          </button>
        </form>
      </div>

      {/* durumlar */}
      {loading && <div className="text-sm text-gray-500">Loading accounts…</div>}
      {error && <div className="text-sm text-red-600">Error: {error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="text-sm text-gray-500">
          No accounts yet. Add one in Swagger, then click <b>Refresh</b>.
        </div>
      )}

      {/* liste */}
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
                          href={a.website}
                          className="text-indigo-600 hover:underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {a.website}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-4">{a.owner_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* sayfalama */}
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
    </div>
  );
}

/* ----------------- Contacts (GERÇEK VERİ + arama/sayfa) ----------------- */
function Contacts() {
  const [items, setItems] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

  const [total, setTotal] = useState<number | undefined>(undefined);
  const [hasNext, setHasNext] = useState<boolean | undefined>(undefined);
  const [hasPrev, setHasPrev] = useState<boolean | undefined>(undefined);

  const fetchContacts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/contacts/", {
        params: { page, page_size: pageSize, q },
      });

      let payload: ContactsPayload;
      if (Array.isArray(res.data)) {
        payload = { items: res.data, meta: { page, page_size: pageSize } };
      } else {
        payload = res.data as ContactsPayload;
      }

      setItems(payload.items ?? []);
      setTotal(payload.meta?.total);
      setHasNext(payload.meta?.has_next);
      setHasPrev(payload.meta?.has_prev);

      console.log("GET /contacts response:", res.data);
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail || err?.message || "Unknown error";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchContacts();
  };

  return (
    <div className="bg-white rounded-xl shadow p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h2 className="text-lg font-medium">Contacts</h2>

        <form onSubmit={onSearch} className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, phone…"
            className="px-3 py-1.5 rounded-md border text-sm w-64"
          />
          <button
            type="submit"
            className="px-3 py-1.5 rounded-md border text-sm hover:bg-gray-50"
          >
            Search
          </button>
          <button
            type="button"
            onClick={fetchContacts}
            className="px-3 py-1.5 rounded-md border text-sm hover:bg-gray-50"
          >
            Refresh
          </button>
        </form>
      </div>

      {loading && <div className="text-sm text-gray-500">Loading contacts…</div>}
      {error && <div className="text-sm text-red-600">Error: {error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="text-sm text-gray-500">
          No contacts yet. Add some in Swagger, then click <b>Refresh</b>.
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Title</th>
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">Phone</th>
                  <th className="py-2 pr-4">Account</th>
                  <th className="py-2 pr-4">Created</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{fullName(c)}</td>
                    <td className="py-2 pr-4">{c.title ?? "—"}</td>
                    <td className="py-2 pr-4">
                      {c.email ? (
                        <a
                          href={`mailto:${c.email}`}
                          className="text-indigo-600 hover:underline"
                        >
                          {c.email}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-4">{c.phone ?? "—"}</td>
                    <td className="py-2 pr-4">
                      {c.account_name ?? c.account_id ?? "—"}
                    </td>
                    <td className="py-2 pr-4">{fmtDate(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
    </div>
  );
}

/* ----------------- Placeholder sayfalar ----------------- */
function Deals() {
  return (
    <div className="bg-white rounded-xl shadow p-6">
      <h2 className="text-lg font-medium mb-4">Opportunities</h2>
      <p className="text-sm text-gray-600">Kanban pipeline will live here.</p>
    </div>
  );
}

function Reports() {
  return (
    <div className="bg-white rounded-xl shadow p-6">
      <h2 className="text-lg font-medium mb-4">Reports</h2>
      <p className="text-sm text-gray-600">KPIs, charts and summaries.</p>
    </div>
  );
}

/* ----------------- Başlık ----------------- */
function usePageTitle() {
  const { pathname } = useLocation();
  if (pathname.startsWith("/accounts")) return "Accounts";
  if (pathname.startsWith("/contacts")) return "Contacts";
  if (pathname.startsWith("/deals")) return "Opportunities";
  if (pathname.startsWith("/reports")) return "Reports";
  return "Dashboard";
}

/* ----------------- Root ----------------- */
export default function App() {
  const title = usePageTitle();

  const ping = async () => {
    try {
      const res = await api.get("/openapi.json");
      const info = res?.data?.info || {};
      alert(`OK: ${info.title || "-"} v${info.version || "-"}`);
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail || err?.message || "Unknown error";
      alert("ERROR: " + msg);
    }
  };

  const testAccounts = async () => {
    try {
      const res = await api.get("/accounts/", {
        params: { q: "", page: 1, page_size: 5 },
      });
      const data = res.data as AccountsPayload;
      const list = Array.isArray(data) ? (data as any) : data.items ?? [];
      alert(`Accounts OK: ${list.length} item(s) (first page)`);
      console.log("GET /accounts response:", res.data);
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail || err?.message || "Unknown error";
      alert("Accounts ERROR: " + msg);
      console.error(err);
    }
  };

  return (
    <div className="flex h-screen bg-gray-100 text-gray-900">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r shadow-sm flex flex-col">
        <div className="h-16 flex items-center justify-center border-b font-bold text-indigo-600">
          Aryaintel CRM
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `block px-3 py-2 rounded-lg hover:bg-indigo-50 ${
                isActive ? "bg-indigo-100 text-indigo-700" : ""
              }`
            }
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/accounts"
            className={({ isActive }) =>
              `block px-3 py-2 rounded-lg hover:bg-indigo-50 ${
                isActive ? "bg-indigo-100 text-indigo-700" : ""
              }`
            }
          >
            Accounts
          </NavLink>
          <NavLink
            to="/contacts"
            className={({ isActive }) =>
              `block px-3 py-2 rounded-lg hover:bg-indigo-50 ${
                isActive ? "bg-indigo-100 text-indigo-700" : ""
              }`
            }
          >
            Contacts
          </NavLink>
          <NavLink
            to="/deals"
            className={({ isActive }) =>
              `block px-3 py-2 rounded-lg hover:bg-indigo-50 ${
                isActive ? "bg-indigo-100 text-indigo-700" : ""
              }`
            }
          >
            Opportunities
          </NavLink>
          <NavLink
            to="/reports"
            className={({ isActive }) =>
              `block px-3 py-2 rounded-lg hover:bg-indigo-50 ${
                isActive ? "bg-indigo-100 text-indigo-700" : ""
              }`
            }
          >
            Reports
          </NavLink>
        </nav>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="h-16 bg-white border-b shadow-sm flex items-center justify-between px-6">
          <h1 className="text-xl font-semibold">{title}</h1>
          <div className="flex items-center space-x-2">
            <button
              onClick={testAccounts}
              className="px-3 py-1.5 rounded-md border text-sm hover:bg-gray-50"
            >
              Test Accounts
            </button>
            <button
              onClick={ping}
              className="px-3 py-1.5 rounded-md border text-sm hover:bg-gray-50"
            >
              Ping API
            </button>
            <button className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-500">
              + New
            </button>
            <span className="text-sm text-gray-500">user@example.com</span>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/contacts" element={<Contacts />} />
            <Route path="/deals" element={<Deals />} />
            <Route path="/reports" element={<Reports />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
