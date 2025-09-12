import {
  NavLink,
  Routes,
  Route,
  useLocation,
  Navigate,
  useNavigate,
} from "react-router-dom";
import { Suspense, lazy, useEffect, useState } from "react";

import DashboardPage from "./pages/Dashboard";
import AccountsPage from "./pages/Accounts";
import ContactsPage from "./pages/Contacts";
import DealsPage from "./pages/Deals";
import LoginPage from "./pages/Login";

import { apiGet, ApiError } from "./lib/api";
import { clearToken, getToken } from "./lib/auth";

const UsersPage = lazy(() => import("./pages/Users"));

type Me = { id: number; email: string; role: "admin" | "member" };

function usePageTitle() {
  const { pathname } = useLocation();
  if (pathname.startsWith("/accounts")) return "Accounts";
  if (pathname.startsWith("/contacts")) return "Contacts";
  if (pathname.startsWith("/deals")) return "Opportunities";
  if (pathname.startsWith("/users")) return "Users";
  if (pathname.startsWith("/login")) return "Login";
  return "Dashboard";
}

function RequireAuth({ children }: { children: JSX.Element }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return children;
}

function RequireAdmin({
  children,
  me,
}: {
  children: JSX.Element;
  me: Me | null;
}) {
  if (!getToken()) return <Navigate to="/login" replace />;
  if (me?.role !== "admin") return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const title = usePageTitle();
  const nav = useNavigate();
  const location = useLocation();
  const [me, setMe] = useState<Me | null>(null);

  // /auth/me -> 404 olursa /me fallback
  async function fetchMeWithFallback(): Promise<Me> {
    try {
      return await apiGet<Me>("/auth/me");
    } catch (e: any) {
      // Sadece 404'te /me'ye düş
      if (e instanceof ApiError && e.status === 404) {
        return await apiGet<Me>("/me");
      }
      throw e;
    }
  }

  // me'yi yükle (token varsa)
  async function loadMe() {
    if (!getToken()) {
      setMe(null);
      return;
    }
    try {
      const m = await fetchMeWithFallback();
      setMe(m);
    } catch (e: any) {
      // Token'ı sadece gerçek yetkisizlikte sil
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        clearToken();
        setMe(null);
        // Kullanıcı korumalı bir sayfadaysa login’e yönlenir (RequireAuth)
      } else {
        // Ağ hatası / 5xx / 404 vb. durumlarda token'ı KORU
        // Me bilgisi yoksa header'da "guest" görünür ama redirect olmaz
        console.warn("loadMe failed (token preserved):", e);
      }
    }
  }

  useEffect(() => {
    loadMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Başka tab’da login/logout olursa eşitle
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "aryaintel_token") loadMe();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onLogout = () => {
    clearToken();
    setMe(null);
    nav("/login", { replace: true });
  };

  const isAdmin = me?.role === "admin";

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
          {isAdmin && (
            <NavLink
              to="/users"
              className={({ isActive }) =>
                `block px-3 py-2 rounded-lg hover:bg-indigo-50 ${
                  isActive ? "bg-indigo-100 text-indigo-700" : ""
                }`
              }
            >
              Users (Admin)
            </NavLink>
          )}
        </nav>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="h-16 bg-white border-b shadow-sm flex items-center justify-between px-6">
          <h1 className="text-xl font-semibold">{title}</h1>
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <span>{me ? `${me.email} · ${me.role}` : "guest"}</span>
            {getToken() ? (
              <button
                onClick={onLogout}
                className="px-2 py-1 rounded border hover:bg-gray-50"
              >
                Logout
              </button>
            ) : (
              <NavLink
                to="/login"
                className="px-2 py-1 rounded border hover:bg-gray-50"
              >
                Login
              </NavLink>
            )}
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-6">
          <Routes>
            {/* Login korumasız olmalı */}
            <Route path="/login" element={<LoginPage />} />

            <Route
              path="/"
              element={
                <RequireAuth>
                  <DashboardPage />
                </RequireAuth>
              }
            />
            <Route
              path="/accounts"
              element={
                <RequireAuth>
                  <AccountsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/contacts"
              element={
                <RequireAuth>
                  <ContactsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/deals"
              element={
                <RequireAuth>
                  <DealsPage />
                </RequireAuth>
              }
            />

            {/* Admin sayfası – lazy; admin olmayanı engelle */}
            <Route
              path="/users"
              element={
                <RequireAdmin me={me}>
                  <Suspense fallback={<div>Loading…</div>}>
                    <UsersPage />
                  </Suspense>
                </RequireAdmin>
              }
            />
          </Routes>
        </main>
      </div>
    </div>
  );
}
