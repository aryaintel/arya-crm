// src/App.tsx
import { useState } from "react";
import { Routes, Route, NavLink, useLocation } from "react-router-dom";

/* --- Basit sayfalar --- */
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

function Accounts() {
  return (
    <div className="bg-white rounded-xl shadow p-6">
      <h2 className="text-lg font-medium mb-4">Accounts</h2>
      <p className="text-sm text-gray-600">Accounts list and filters go here.</p>
    </div>
  );
}

function Contacts() {
  return (
    <div className="bg-white rounded-xl shadow p-6">
      <h2 className="text-lg font-medium mb-4">Contacts</h2>
      <p className="text-sm text-gray-600">Contacts list will be displayed.</p>
    </div>
  );
}

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

/* --- Başlık için route bazlı isim --- */
function usePageTitle() {
  const { pathname } = useLocation();
  if (pathname.startsWith("/accounts")) return "Accounts";
  if (pathname.startsWith("/contacts")) return "Contacts";
  if (pathname.startsWith("/deals")) return "Opportunities";
  if (pathname.startsWith("/reports")) return "Reports";
  return "Dashboard";
}

export default function App() {
  const title = usePageTitle();

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
          <div className="flex items-center space-x-4">
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
