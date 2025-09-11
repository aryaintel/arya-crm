// src/App.tsx
import { NavLink, Routes, Route, useLocation } from "react-router-dom";
import DashboardPage from "./pages/Dashboard";
import AccountsPage from "./pages/Accounts";
import ContactsPage from "./pages/Contacts";
import DealsPage from "./pages/Deals";
import UsersPage from "./pages/Users"; // ← eklendi

function usePageTitle() {
  const { pathname } = useLocation();
  if (pathname.startsWith("/accounts")) return "Accounts";
  if (pathname.startsWith("/contacts")) return "Contacts";
  if (pathname.startsWith("/users")) return "Users";        // ← eklendi
  if (pathname.startsWith("/deals")) return "Opportunities";
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
          <NavLink to="/" end className={({isActive})=>`block px-3 py-2 rounded-lg hover:bg-indigo-50 ${isActive?"bg-indigo-100 text-indigo-700":""}`}>Dashboard</NavLink>
          <NavLink to="/accounts" className={({isActive})=>`block px-3 py-2 rounded-lg hover:bg-indigo-50 ${isActive?"bg-indigo-100 text-indigo-700":""}`}>Accounts</NavLink>
          <NavLink to="/contacts" className={({isActive})=>`block px-3 py-2 rounded-lg hover:bg-indigo-50 ${isActive?"bg-indigo-100 text-indigo-700":""}`}>Contacts</NavLink>
          <NavLink to="/users" className={({isActive})=>`block px-3 py-2 rounded-lg hover:bg-indigo-50 ${isActive?"bg-indigo-100 text-indigo-700":""}`}>Users</NavLink> {/* ← eklendi */}
          <NavLink to="/deals" className={({isActive})=>`block px-3 py-2 rounded-lg hover:bg-indigo-50 ${isActive?"bg-indigo-100 text-indigo-700":""}`}>Opportunities</NavLink>
        </nav>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="h-16 bg-white border-b shadow-sm flex items-center justify-between px-6">
          <h1 className="text-xl font-semibold">{title}</h1>
          <div className="text-sm text-gray-500">user@example.com</div>
        </header>

        {/* Content */}
        <main className="flex-1 p-6">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/users" element={<UsersPage />} /> {/* ← eklendi */}
            <Route path="/deals" element={<DealsPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
