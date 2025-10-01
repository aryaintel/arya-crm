import React, { useEffect, useMemo, useState } from "react";

/**
 * RebatesTab
 * -----------------------------------------------------------------------------
 * Scenario-level rebates management (list, create, edit, delete)
 * Backend API: /api/scenarios/:id/rebates[...]
 * - Runtime API base resolver (ENV → window.__API_URL__ → <meta> → heuristic)
 * - Robust JWT Bearer injection (storage + cookie + global + meta)
 * - Pure React (no external UI deps)
 */

type RebateKind = "percent" | "tier_percent" | "lump_sum";
type RebateScope = "all" | "boq" | "services" | "product";
type RebateBasis = "revenue" | "gross_margin" | "volume";

type RebateRow = {
  id: number;
  scenario_id: number;
  name: string;
  scope: RebateScope;
  kind: RebateKind;
  basis: RebateBasis;
  product_id?: number | null;
  valid_from_year?: number | null;
  valid_from_month?: number | null;
  valid_to_year?: number | null;
  valid_to_month?: number | null;
  accrual_method: "monthly" | "quarterly" | "annual" | "on_invoice";
  pay_month_lag?: number | null;
  is_active: boolean;
  notes?: string | null;
  percent?: number | null; // bazı backendler düz percent döndürebilir
  tiers?: TierRow[];
  lumps?: LumpRow[];
};

type TierRow = {
  id: number;
  rebate_id: number;
  min_value: number;
  max_value?: number | null;
  percent?: number | null;
  amount?: number | null;
  description?: string | null;
  sort_order: number;
};

type LumpRow = {
  id: number;
  rebate_id: number;
  year: number;
  month: number;
  amount: number;
  description?: string | null;
};

type RebateIn = {
  name: string;
  scope: RebateScope;
  kind: RebateKind;
  basis: RebateBasis;
  product_id?: number | null;

  valid_from_year?: number | null;
  valid_from_month?: number | null;
  valid_to_year?: number | null;
  valid_to_month?: number | null;

  accrual_method: "monthly" | "quarterly" | "annual" | "on_invoice";
  pay_month_lag?: number | null;

  is_active: boolean;
  notes?: string | null;

  // UI-only — body'ye gönderilmez; 'percent' olarak normalize edilir
  percent_value?: number | null;

  tiers?: Array<{
    min_value: number;
    max_value?: number | null;
    percent?: number | null;
    amount?: number | null;
    description?: string | null;
    sort_order?: number;
  }>;
  lumps?: Array<{
    year: number;
    month: number;
    amount: number;
    description?: string | null;
  }>;
};

type RebateSubmit =
  | (Omit<RebateIn, "percent_value" | "tiers" | "lumps"> & { percent: number })
  | (Omit<RebateIn, "percent_value" | "lumps"> & { tiers: NonNullable<RebateIn["tiers"]> })
  | (Omit<RebateIn, "percent_value" | "tiers"> & { lumps: NonNullable<RebateIn["lumps"]> });

// -------------------------- Utils --------------------------
function parseScenarioIdFromLocation(): number | undefined {
  try {
    const m = window.location.pathname.match(/\/scenarios\/(\d+)/i);
    if (m && m[1]) return Number(m[1]);
  } catch {}
  return undefined;
}

function resolveApiBase(): string {
  // 1) Vite env
  // @ts-ignore
  const envBase = typeof import.meta !== "undefined" ? import.meta?.env?.VITE_API_URL : "";
  if (envBase) return String(envBase).replace(/\/+$/, "");

  // 2) window global override
  // @ts-ignore
  if (typeof window !== "undefined" && (window as any).__API_URL__) {
    // @ts-ignore
    return String((window as any).__API_URL__).replace(/\/+$/, "");
  }

  // 3) <meta name="api-base" content="http://127.0.0.1:8000">
  if (typeof document !== "undefined") {
    const meta = document.querySelector('meta[name="api-base"]') as HTMLMetaElement | null;
    if (meta?.content) return meta.content.replace(/\/+$/, "");
  }

  // 4) Heuristic for local dev: FE 5173/3000/5174/8080 → BE 8000
  if (typeof window !== "undefined") {
    const { protocol, hostname, port } = window.location;
    const p = Number(port || (protocol === "https:" ? 443 : 80));
    const backendPort = [5173, 3000, 5174, 8080].includes(p) ? 8000 : p;
    return `${protocol}//${hostname}:${backendPort}`;
  }

  // 5) Fallback
  return "";
}
const API_BASE = resolveApiBase();

// swagger’da gördüğümüz yapı için default prefix /api
function getApiPrefix(): string {
  try {
    // @ts-ignore
    const envPref = typeof import.meta !== "undefined" ? import.meta?.env?.VITE_API_PREFIX : "";
    if (envPref) return String(envPref);
  } catch {}
  // @ts-ignore
  if (typeof window !== "undefined" && (window as any).__API_PREFIX__) {
    // @ts-ignore
    return String((window as any).__API_PREFIX__);
  }
  const meta = document.querySelector('meta[name="api-prefix"]') as HTMLMetaElement | null;
  if (meta?.content) return meta.content;
  return "/api";
}
const API_PREFIX = getApiPrefix();

function readCsrfToken(): string | undefined {
  try {
    const meta = document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement | null;
    return meta?.content || undefined;
  } catch {
    return undefined;
  }
}

function looksLikeJwt(s: string): boolean {
  return /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(s);
}

function deepFindJwt(obj: any): string | undefined {
  const seen = new Set<any>();
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (cur && typeof cur === "object" && !seen.has(cur)) {
      seen.add(cur);
      for (const k of Object.keys(cur)) {
        const v = cur[k];
        if (typeof v === "string") {
          if (v.startsWith("Bearer ") && looksLikeJwt(v.slice(7))) return v;
          if (looksLikeJwt(v)) return `Bearer ${v}`;
        } else if (v && typeof v === "object") {
          stack.push(v);
        }
      }
    }
  }
  return undefined;
}

/** App genelinde kullanılan JWT token'ı (varsa) yakala (storage + cookie + global + meta) */
function getBearerToken(): string | undefined {
  try {
    // 0) Meta tag
    const meta = document.querySelector('meta[name="auth-token"]') as HTMLMetaElement | null;
    if (meta?.content) {
      const t = meta.content.trim();
      if (t.startsWith("Bearer ")) return t;
      if (looksLikeJwt(t)) return `Bearer ${t}`;
    }

    // 1) Global köprüler
    // @ts-ignore
    const w: any = window;
    if (w?.__AUTH_TOKEN__) {
      const t = String(w.__AUTH_TOKEN__);
      if (t.startsWith("Bearer ")) return t;
      if (looksLikeJwt(t)) return `Bearer ${t}`;
    }
    if (w?.__AUTH__?.token) {
      const t = String(w.__AUTH__.token);
      if (t.startsWith("Bearer ")) return t;
      if (looksLikeJwt(t)) return `Bearer ${t}`;
    }

    // 2) Storage — hedef anahtarlar (hızlı yol)
    const stores = [localStorage, sessionStorage] as const;
    const fastKeys = [
      "Authorization",
      "access_token",
      "token",
      "jwt",
      "bearer",
      "id_token",
      "AUTH_TOKEN",
      "aryaintel.auth",
      "aryaintel_token",
      "auth",
    ];
    for (const st of stores) {
      for (const key of fastKeys) {
        const raw = st.getItem(key);
        if (!raw) continue;
        if (raw.startsWith("Bearer ") && looksLikeJwt(raw.slice(7))) return raw;
        if (looksLikeJwt(raw)) return `Bearer ${raw}`;
        try {
          const obj = JSON.parse(raw);
          const found = deepFindJwt(obj);
          if (found) return found;
        } catch {}
      }
    }
    // 3) Storage — tüm anahtarlar (derin tarama)
    for (const st of stores) {
      for (let i = 0; i < st.length; i++) {
        const key = st.key(i)!;
        const raw = st.getItem(key) || "";
        if (raw.startsWith("Bearer ") && looksLikeJwt(raw.slice(7))) return raw;
        if (looksLikeJwt(raw)) return `Bearer ${raw}`;
        try {
          const obj = JSON.parse(raw);
          const found = deepFindJwt(obj);
          if (found) return found;
        } catch {}
      }
    }

    // 4) Cookie — HTTPOnly değilse (örn. 'access_token=...') yakala
    const cookies = document.cookie?.split(";").map((s) => s.trim()) || [];
    const cookieCandidates = ["Authorization", "access_token", "token", "jwt", "bearer", "id_token"];
    for (const c of cookies) {
      const [k, v] = c.split("=") as [string, string];
      if (!k || !v) continue;
      if (!cookieCandidates.includes(k)) continue;
      const val = decodeURIComponent(v);
      if (val.startsWith("Bearer ") && looksLikeJwt(val.slice(7))) return val;
      if (looksLikeJwt(val)) return `Bearer ${val}`;
      try {
        const obj = JSON.parse(val);
        const found = deepFindJwt(obj);
        if (found) return found;
      } catch {}
    }
  } catch {}
  return undefined;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

const cellClass = "px-2 py-1 border-b border-gray-200 text-sm";
const thClass =
  "px-2 py-2 border-b-2 border-gray-300 text-left text-xs font-semibold uppercase tracking-wide";
const badge = (txt: string) =>
  ({
    percent: "bg-blue-100 text-blue-800",
    tier_percent: "bg-purple-100 text-purple-800",
    lump_sum: "bg-amber-100 text-amber-800",
    all: "bg-gray-100 text-gray-800",
    boq: "bg-emerald-100 text-emerald-800",
    services: "bg-cyan-100 text-cyan-800",
    product: "bg-pink-100 text-pink-800",
    active: "bg-green-100 text-green-800",
    inactive: "bg-red-100 text-red-800",
  } as Record<string, string>)[txt] || "bg-gray-100 text-gray-800";

/** backend düz 'percent' döndürüyorsa onu; yoksa tiers[0].percent'i oku */
function flatPercentFromRow(r: RebateRow): number | undefined {
  const p = r.percent;
  if (p !== undefined && p !== null) return Number(p);
  const pt = r.tiers?.[0]?.percent;
  return pt !== undefined && pt !== null ? Number(pt) : undefined;
}

/** RebateRow → RebateIn (UI draft) dönüşümü tek noktadan */
function rowToDraft(row: RebateRow): RebateIn {
  return {
    name: row.name,
    scope: row.scope,
    kind: row.kind,
    basis: row.basis,
    product_id: row.product_id ?? null,
    valid_from_year: row.valid_from_year ?? null,
    valid_from_month: row.valid_from_month ?? null,
    valid_to_year: row.valid_to_year ?? null,
    valid_to_month: row.valid_to_month ?? null,
    accrual_method: row.accrual_method,
    pay_month_lag: row.pay_month_lag ?? 0,
    is_active: row.is_active,
    notes: row.notes ?? "",
    percent_value: row.kind === "percent" ? flatPercentFromRow(row) ?? 0 : undefined,
    tiers:
      row.kind === "tier_percent"
        ? (row.tiers ?? []).map((t, i) => ({
            min_value: Number(t.min_value ?? 0),
            max_value: t.max_value == null ? null : Number(t.max_value),
            percent: t.percent == null ? null : Number(t.percent),
            amount: t.amount == null ? null : Number(t.amount),
            description: t.description ?? "",
            sort_order: t.sort_order ?? i,
          }))
        : undefined,
    lumps:
      row.kind === "lump_sum"
        ? (row.lumps ?? []).map((l) => ({
            year: Number(l.year),
            month: Number(l.month),
            amount: Number(l.amount),
            description: l.description ?? "",
          }))
        : undefined,
  };
}

/** UI draft → API body (percent_value alanını düşürür ve normalize eder) */
function buildSubmitBody(d: RebateIn): RebateSubmit {
  const base = {
    name: d.name.trim(),
    scope: d.scope,
    kind: d.kind,
    basis: d.basis,
    product_id: toIntOrNull(d.product_id) ?? null,
    valid_from_year: toIntOrNull(d.valid_from_year) ?? null,
    valid_from_month: toIntOrNull(d.valid_from_month) ?? null,
    valid_to_year: toIntOrNull(d.valid_to_year) ?? null,
    valid_to_month: toIntOrNull(d.valid_to_month) ?? null,
    accrual_method: d.accrual_method,
    pay_month_lag: toIntOrNull(d.pay_month_lag) ?? 0,
    is_active: !!d.is_active,
    notes: d.notes || "",
  };

  if (d.kind === "percent") {
    const percent = toNumOrNull(d.percent_value) ?? 0;
    return { ...base, percent };
  }

  if (d.kind === "tier_percent") {
    const tiers = (d.tiers || []).map((t, idx) => ({
      min_value: Number(t.min_value ?? 0),
      max_value: t.max_value == null ? null : Number(t.max_value),
      percent: t.percent == null ? null : Number(t.percent),
      amount: t.amount == null ? null : Number(t.amount),
      description: t.description || "",
      sort_order: (t as any).sort_order !== undefined ? Number((t as any).sort_order) : idx,
    }));
    return { ...base, tiers };
  }

  // lump_sum
  const lumps = (d.lumps || []).map((l) => ({
    year: Number(l.year),
    month: Number(l.month),
    amount: Number(l.amount),
    description: l.description || "",
  }));
  return { ...base, lumps };
}

function toIntOrNull(v: any): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toNumOrNull(v: any): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** fetch helper (API_PREFIX + path) — Authorization header’ı otomatik ekler */
async function api<T>(
  path: string,
  init?: RequestInit & { query?: Record<string, any> }
): Promise<T> {
  const base = API_BASE || window.location.origin;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const withPrefix = `${API_PREFIX.replace(/\/+$/, "")}${cleanPath}`;
  const url = new URL(withPrefix, base);

  if (init?.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init?.headers as Record<string, string>),
  };

  // CSRF + Ajax
  headers["X-Requested-With"] = headers["X-Requested-With"] || "XMLHttpRequest";
  const csrf = readCsrfToken();
  if (csrf && !headers["X-CSRF-Token"]) headers["X-CSRF-Token"] = csrf;

  // Authorization
  if (!headers["Authorization"]) {
    const bearer = getBearerToken();
    if (bearer) headers["Authorization"] = bearer;
  }

  const res = await fetch(url.toString(), {
    credentials: "include",
    headers,
    ...init,
  });

  if (!res.ok) {
    let detail = "";
    try {
      const raw = await res.text();
      if (raw) {
        try {
          const j = JSON.parse(raw);
          detail = (j as any)?.detail || (j as any)?.message || raw;
        } catch {
          detail = raw;
        }
      }
    } catch {}
    throw new Error(`${res.status} ${res.statusText}: ${detail}`.trim());
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return (await res.json()) as T;
  }
  // @ts-ignore
  return undefined as T;
}

function formatValidity(
  fromY?: number | null,
  fromM?: number | null,
  toY?: number | null,
  toM?: number | null
) {
  const p1 = fromY && fromM ? `${String(fromM).padStart(2, "0")}/${fromY}` : "—";
  const p2 = toY && toM ? `${String(toM).padStart(2, "0")}/${toY}` : "—";
  return `${p1} → ${p2}`;
}

// -------------------------- UI --------------------------
const L = {
  Label: (p: { children: React.ReactNode; htmlFor?: string }) => (
    <label
      htmlFor={p.htmlFor}
      className="block text-xs font-semibold text-gray-600 mb-1"
    >
      {p.children}
    </label>
  ),
  Input: (
    p: React.InputHTMLAttributes<HTMLInputElement> & { widthClass?: string }
  ) => (
    <input
      {...p}
      className={
        "border border-gray-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-indigo-400 " +
        (p.className || "") +
        " " +
        (p.widthClass || "")
      }
    />
  ),
  Select: (
    p: React.SelectHTMLAttributes<HTMLSelectElement> & { widthClass?: string }
  ) => (
    <select
      {...p}
      className={
        "border border-gray-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-indigo-400 " +
        (p.className || "") +
        " " +
        (p.widthClass || "")
      }
    />
  ),
  TextArea: (
    p: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
      widthClass?: string;
    }
  ) => (
    <textarea
      {...p}
      className={
        "border border-gray-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-indigo-400 " +
        (p.className || "") +
        " " +
        (p.widthClass || "")
      }
      rows={p.rows ?? 3}
    />
  ),
  Button: (
    p: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      variant?: "primary" | "secondary" | "danger" | "ghost";
      small?: boolean;
    }
  ) => {
    const base =
      "inline-flex items-center justify-center rounded transition-colors";
    const size = p.small ? " px-2 py-1 text-xs" : " px-3 py-1.5 text-sm";
    const palette =
      p.variant === "danger"
        ? " bg-red-600 text-white hover:bg-red-700"
        : p.variant === "secondary"
        ? " bg-gray-200 text-gray-800 hover:bg-gray-300"
        : p.variant === "ghost"
        ? " bg-transparent text-gray-700 hover:bg-gray-100"
        : " bg-indigo-600 text-white hover:bg-indigo-700";
    return (
      <button {...p} className={`${base}${size}${palette} ${p.className || ""}`}>
        {p.children}
      </button>
    );
  },
};

// -------------------------- Component --------------------------
export default function RebatesTab(props: { scenarioId?: number }) {
  const scenarioId =
    props.scenarioId ?? parseScenarioIdFromLocation() ?? undefined;

  const [items, setItems] = useState<RebateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState>({ mode: "none" });

  const [refreshTick, setRefreshTick] = useState(0);
  const doRefresh = () => setRefreshTick((x) => x + 1);

  useEffect(() => {
    if (!scenarioId) return;
    let ignore = false;
    setLoading(true);
    setErr(null);
    api<RebateRow[]>(`/scenarios/${scenarioId}/rebates`, {
      query: { include_details: true },
    })
      .then((rows) => {
        if (ignore) return;
        setItems(rows);
      })
      .catch((e) => !ignore && setErr(e.message || String(e)))
      .finally(() => !ignore && setLoading(false));
    return () => {
      ignore = true;
    };
  }, [scenarioId, refreshTick]);

  const startCreate = () => setEdit({ mode: "create", draft: emptyDraft() });

  const startEdit = (row: RebateRow) => {
    setEdit({ mode: "edit", id: row.id, draft: rowToDraft(row) });
  };

  const cancelEdit = () => setEdit({ mode: "none" });

  const remove = async (row: RebateRow) => {
    if (!scenarioId) return;
    if (!confirm(`Delete rebate "${row.name}"?`)) return;
    try {
      await api(`/scenarios/${scenarioId}/rebates/${row.id}`, {
        method: "DELETE",
      });
      doRefresh();
    } catch (e: any) {
      alert(e.message || String(e));
    }
  };

  const toggleActive = async (row: RebateRow) => {
    if (!scenarioId) return;
    try {
      const draft = rowToDraft(row);
      draft.is_active = !row.is_active;
      const body = buildSubmitBody(draft);
      await api(`/scenarios/${scenarioId}/rebates/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      doRefresh();
    } catch (e: any) {
      alert(e.message || String(e));
    }
  };

  const save = async () => {
    if (!scenarioId) return;
    if (edit.mode === "none") return;

    const d = edit.draft;

    // validations
    if (!d.name || d.name.trim().length === 0) {
      alert("Name is required.");
      return;
    }
    if (d.scope === "product" && !toIntOrNull(d.product_id)) {
      alert("When scope='product', product_id is required.");
      return;
    }
    if (d.kind === "percent" && (d.percent_value === undefined || d.percent_value === null)) {
      alert("percent_value is required for kind='percent'.");
      return;
    }

    const body = buildSubmitBody(d);

    try {
      if (edit.mode === "create") {
        await api(`/scenarios/${scenarioId}/rebates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        await api(`/scenarios/${scenarioId}/rebates/${edit.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      setEdit({ mode: "none" });
      doRefresh();
    } catch (e: any) {
      alert(e.message || String(e));
    }
  };

  const editingTitle =
    edit.mode === "create"
      ? "Create Rebate"
      : edit.mode === "edit"
      ? `Edit Rebate #${edit.id}`
      : "";

  const ListTable = useMemo(
    () => (
      <div className="overflow-auto border rounded-md">
        <table className="min-w-[960px] w-full">
          <thead>
            <tr className="bg-gray-50">
              <th className={thClass}>Name</th>
              <th className={thClass}>Kind</th>
              <th className={thClass}>Scope</th>
              <th className={thClass}>Basis</th>
              <th className={thClass}>Validity</th>
              <th className={thClass}>Accrual</th>
              <th className={thClass}>Lag</th>
              <th className={thClass}>Status</th>
              <th className={thClass}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className={cellClass}>
                  <div className="font-medium text-gray-900">{r.name}</div>
                  {r.notes ? (
                    <div className="text-gray-500 text-xs">{r.notes}</div>
                  ) : null}
                </td>
                <td className={cellClass}>
                  <span className={`px-2 py-0.5 rounded text-xs ${badge(r.kind)}`}>
                    {r.kind}
                  </span>
                </td>
                <td className={cellClass}>
                  <span className={`px-2 py-0.5 rounded text-xs ${badge(r.scope)}`}>
                    {r.scope}
                  </span>
                  {r.scope === "product" && r.product_id ? (
                    <span className="ml-2 text-xs text-gray-500">
                      product_id: {r.product_id}
                    </span>
                  ) : null}
                </td>
                <td className={cellClass}>{r.basis}</td>
                <td className={cellClass}>
                  <span className="text-xs text-gray-700">
                    {formatValidity(
                      r.valid_from_year,
                      r.valid_from_month,
                      r.valid_to_year,
                      r.valid_to_month
                    )}
                  </span>
                </td>
                <td className={cellClass}>{r.accrual_method}</td>
                <td className={cellClass}>{r.pay_month_lag ?? 0}</td>
                <td className={cellClass}>
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${
                      r.is_active ? badge("active") : badge("inactive")
                    }`}
                  >
                    {r.is_active ? "active" : "inactive"}
                  </span>
                </td>
                <td className={cellClass}>
                  <div className="flex gap-2">
                    <L.Button small variant="secondary" onClick={() => startEdit(r)}>
                      Edit
                    </L.Button>
                    <L.Button small variant="ghost" onClick={() => toggleActive(r)}>
                      {r.is_active ? "Deactivate" : "Activate"}
                    </L.Button>
                    <L.Button small variant="danger" onClick={() => remove(r)}>
                      Delete
                    </L.Button>
                  </div>
                  {r.kind === "percent" && flatPercentFromRow(r) != null ? (
                    <div className="mt-1 text-xs text-gray-500">
                      %: {Number(flatPercentFromRow(r)).toFixed(4)}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
            {items.length === 0 && !loading ? (
              <tr>
                <td className={cellClass} colSpan={9}>
                  <div className="text-center text-gray-500 text-sm py-6">
                    No rebates yet. Click “New Rebate”.
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    ),
    [items, loading]
  );

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Scenario Rebates</h2>
        <div className="flex items-center gap-2">
          <L.Button variant="secondary" onClick={doRefresh}>
            Refresh
          </L.Button>
          <L.Button onClick={startCreate}>New Rebate</L.Button>
        </div>
      </div>

      {!scenarioId ? (
        <div className="text-red-600 text-sm">
          Scenario ID not found. Pass as prop or ensure route contains /scenarios/:id.
        </div>
      ) : null}

      {err ? (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2 mb-3">
          {err}
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-gray-600 mb-3">Loading…</div>
      ) : null}

      {ListTable}

      {edit.mode !== "none" ? (
        <div className="mt-6 border rounded-md p-4 bg-white shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-base font-semibold">{editingTitle}</div>
            <div className="flex gap-2">
              <L.Button variant="secondary" onClick={cancelEdit}>
                Cancel
              </L.Button>
              <L.Button onClick={save}>Save</L.Button>
            </div>
          </div>

          <FormFields
            draft={edit.draft}
            setDraft={(d) =>
              setEdit((s) => (s.mode === "none" ? s : { ...s, draft: d }))
            }
          />

          {/* Kind-specific editors */}
          {edit.draft.kind === "percent" ? (
            <PercentEditor
              draft={edit.draft}
              setDraft={(d) =>
                setEdit((s) => (s.mode === "none" ? s : { ...s, draft: d }))
              }
            />
          ) : edit.draft.kind === "tier_percent" ? (
            <TierEditor
              draft={edit.draft}
              setDraft={(d) =>
                setEdit((s) => (s.mode === "none" ? s : { ...s, draft: d }))
              }
            />
          ) : (
            <LumpEditor
              draft={edit.draft}
              setDraft={(d) =>
                setEdit((s) => (s.mode === "none" ? s : { ...s, draft: d }))
              }
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

type EditState =
  | { mode: "none" }
  | { mode: "create"; draft: RebateIn }
  | { mode: "edit"; id: number; draft: RebateIn };

const emptyDraft = (scenarioDefaultKind: RebateKind = "percent"): RebateIn => ({
  name: "",
  scope: "all",
  kind: scenarioDefaultKind,
  basis: "revenue",
  product_id: null,
  valid_from_year: null,
  valid_from_month: null,
  valid_to_year: null,
  valid_to_month: null,
  accrual_method: "monthly",
  pay_month_lag: 0,
  is_active: true,
  notes: "",
  percent_value: scenarioDefaultKind === "percent" ? 0 : undefined,
  tiers: scenarioDefaultKind === "tier_percent" ? [] : undefined,
  lumps: scenarioDefaultKind === "lump_sum" ? [] : undefined,
});

// -------------------------- Form Sections --------------------------
function FormFields(props: { draft: RebateIn; setDraft: (d: RebateIn) => void }) {
  const { draft, setDraft } = props;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div>
        <L.Label>Name</L.Label>
        <L.Input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Year-1 rebate"
        />
      </div>

      <div>
        <L.Label>Scope</L.Label>
        <L.Select
          value={draft.scope}
          onChange={(e) => setDraft({ ...draft, scope: e.target.value as RebateScope })}
        >
          <option value="all">all</option>
          <option value="boq">boq</option>
          <option value="services">services</option>
          <option value="product">product</option>
        </L.Select>
      </div>

      <div>
        <L.Label>Kind</L.Label>
        <L.Select
          value={draft.kind}
          onChange={(e) => {
            const k = e.target.value as RebateKind;
            if (k === "percent") {
              setDraft({
                ...draft,
                kind: k,
                percent_value: draft.percent_value ?? 0,
                tiers: undefined,
                lumps: undefined,
              });
            } else if (k === "tier_percent") {
              setDraft({
                ...draft,
                kind: k,
                tiers: draft.tiers ?? [],
                percent_value: undefined,
                lumps: undefined,
              });
            } else {
              setDraft({
                ...draft,
                kind: k,
                lumps: draft.lumps ?? [],
                percent_value: undefined,
                tiers: undefined,
              });
            }
          }}
        >
          <option value="percent">percent</option>
          <option value="tier_percent">tier_percent</option>
          <option value="lump_sum">lump_sum</option>
        </L.Select>
      </div>

      <div>
        <L.Label>Basis</L.Label>
        <L.Select
          value={draft.basis}
          onChange={(e) => setDraft({ ...draft, basis: e.target.value as RebateBasis })}
        >
          <option value="revenue">revenue</option>
          <option value="gross_margin">gross_margin</option>
          <option value="volume">volume</option>
        </L.Select>
      </div>

      <div>
        <L.Label>Product ID (when scope=product)</L.Label>
        <L.Input
          type="number"
          value={draft.product_id ?? ""}
          onChange={(e) =>
            setDraft({ ...draft, product_id: toIntOrNull(e.target.value) ?? null })
          }
          placeholder="e.g. 101"
        />
      </div>

      <div>
        <L.Label>Accrual Method</L.Label>
        <L.Select
          value={draft.accrual_method}
          onChange={(e) =>
            setDraft({
              ...draft,
              accrual_method: e.target.value as RebateIn["accrual_method"],
            })
          }
        >
          <option value="monthly">monthly</option>
          <option value="quarterly">quarterly</option>
          <option value="annual">annual</option>
          <option value="on_invoice">on_invoice</option>
        </L.Select>
      </div>

      <div>
        <L.Label>Pay Month Lag</L.Label>
        <L.Input
          type="number"
          value={draft.pay_month_lag ?? 0}
          onChange={(e) =>
            setDraft({ ...draft, pay_month_lag: toIntOrNull(e.target.value) ?? 0 })
          }
        />
      </div>

      <div className="grid grid-cols-4 gap-2">
        <div className="col-span-2">
          <L.Label>Valid From (Year)</L.Label>
          <L.Input
            type="number"
            value={draft.valid_from_year ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, valid_from_year: toIntOrNull(e.target.value) ?? null })
            }
            placeholder="YYYY"
          />
        </div>
        <div className="col-span-2">
          <L.Label>Valid From (Month)</L.Label>
          <L.Select
            value={draft.valid_from_month ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                valid_from_month: e.target.value ? Number(e.target.value) : null,
              })
            }
          >
            <option value="">—</option>
            {MONTHS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </L.Select>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <div className="col-span-2">
          <L.Label>Valid To (Year)</L.Label>
          <L.Input
            type="number"
            value={draft.valid_to_year ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, valid_to_year: toIntOrNull(e.target.value) ?? null })
            }
            placeholder="YYYY"
          />
        </div>
        <div className="col-span-2">
          <L.Label>Valid To (Month)</L.Label>
          <L.Select
            value={draft.valid_to_month ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                valid_to_month: e.target.value ? Number(e.target.value) : null,
              })
            }
          >
            <option value="">—</option>
            {MONTHS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </L.Select>
        </div>
      </div>

      <div className="md:col-span-3">
        <L.Label>Notes</L.Label>
        <L.TextArea
          value={draft.notes || ""}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="rebate_active"
          type="checkbox"
          checked={!!draft.is_active}
          onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
        />
        <label htmlFor="rebate_active" className="text-sm">
          Active
        </label>
      </div>
    </div>
  );
}

/** kind='percent' — flat percent */
function PercentEditor(props: { draft: RebateIn; setDraft: (d: RebateIn) => void }) {
  const { draft, setDraft } = props;
  return (
    <div className="mt-4">
      <div className="text-sm font-semibold mb-2">Flat percent</div>
      <div className="max-w-xs">
        <L.Label>Percent (%)</L.Label>
        <L.Input
          type="number"
          step="0.0001"
          value={draft.percent_value ?? 0}
          onChange={(e) =>
            setDraft({ ...draft, percent_value: toNumOrNull(e.target.value) ?? 0 })
          }
        />
      </div>
    </div>
  );
}

/** kind='tier_percent' — tier grid */
function TierEditor(props: { draft: RebateIn; setDraft: (d: RebateIn) => void }) {
  const { draft, setDraft } = props;
  const tiers = draft.tiers ?? [];

  const addTier = () => {
    const next = [
      ...tiers,
      { min_value: 0, max_value: null, percent: 0, amount: null, description: "", sort_order: tiers.length },
    ];
    setDraft({ ...draft, tiers: next });
  };

  const upd = (idx: number, patch: Partial<NonNullable<RebateIn["tiers"]>[number]>) => {
    const next = tiers.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    setDraft({ ...draft, tiers: next });
  };

  const rm = (idx: number) => {
    const next = tiers.filter((_, i) => i !== idx).map((t, i) => ({ ...t, sort_order: i }));
    setDraft({ ...draft, tiers: next });
  };

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Tiers</div>
        <L.Button small onClick={addTier}>Add Tier</L.Button>
      </div>
      <div className="overflow-auto border rounded-md">
        <table className="min-w-[800px] w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className={thClass}>#</th>
              <th className={thClass}>Min</th>
              <th className={thClass}>Max</th>
              <th className={thClass}>Percent</th>
              <th className={thClass}>Amount</th>
              <th className={thClass}>Description</th>
              <th className={thClass}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((t, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className={cellClass}>{i + 1}</td>
                <td className={cellClass}>
                  <L.Input
                    type="number"
                    value={t.min_value}
                    onChange={(e) => upd(i, { min_value: Number(e.target.value) })}
                    widthClass="w-32"
                  />
                </td>
                <td className={cellClass}>
                  <L.Input
                    type="number"
                    value={t.max_value ?? ""}
                    onChange={(e) =>
                      upd(i, { max_value: e.target.value === "" ? null : Number(e.target.value) })
                    }
                    widthClass="w-32"
                  />
                </td>
                <td className={cellClass}>
                  <L.Input
                    type="number"
                    step="0.0001"
                    value={t.percent ?? ""}
                    onChange={(e) =>
                      upd(i, {
                        percent: e.target.value === "" ? null : Number(e.target.value),
                        amount: e.target.value !== "" ? null : t.amount ?? null,
                      })
                    }
                    widthClass="w-28"
                  />
                </td>
                <td className={cellClass}>
                  <L.Input
                    type="number"
                    step="0.0001"
                    value={t.amount ?? ""}
                    onChange={(e) =>
                      upd(i, {
                        amount: e.target.value === "" ? null : Number(e.target.value),
                        percent: e.target.value !== "" ? null : t.percent ?? null,
                      })
                    }
                    widthClass="w-28"
                  />
                </td>
                <td className={cellClass}>
                  <L.Input
                    value={t.description || ""}
                    onChange={(e) => upd(i, { description: e.target.value })}
                  />
                </td>
                <td className={cellClass}>
                  <L.Button small variant="danger" onClick={() => rm(i)}>
                    Remove
                  </L.Button>
                </td>
              </tr>
            ))}
            {tiers.length === 0 ? (
              <tr>
                <td className={cellClass} colSpan={7}>
                  <div className="text-center text-gray-500 text-sm py-4">
                    No tiers. Click “Add Tier”.
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-gray-500 mt-2">
        * On each row enter <b>percent</b> or <b>amount</b> (only one).
      </div>
    </div>
  );
}

/** kind='lump_sum' — multiple payments */
function LumpEditor(props: { draft: RebateIn; setDraft: (d: RebateIn) => void }) {
  const { draft, setDraft } = props;
  const lumps = draft.lumps ?? [];

  const addLump = () => {
    const next = [
      ...lumps,
      { year: new Date().getFullYear(), month: 1, amount: 0, description: "" },
    ];
    setDraft({ ...draft, lumps: next });
  };

  const upd = (idx: number, patch: Partial<NonNullable<RebateIn["lumps"]>[number]>) => {
    const next = lumps.map((l, i) => (i === idx ? { ...l, ...patch } : l));
    setDraft({ ...draft, lumps: next });
  };

  const rm = (idx: number) => {
    const next = lumps.filter((_, i) => i !== idx);
    setDraft({ ...draft, lumps: next });
  };

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Lump Sum Entries</div>
        <L.Button small onClick={addLump}>Add Entry</L.Button>
      </div>
      <div className="overflow-auto border rounded-md">
        <table className="min-w-[620px] w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className={thClass}>Year</th>
              <th className={thClass}>Month</th>
              <th className={thClass}>Amount</th>
              <th className={thClass}>Description</th>
              <th className={thClass}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {lumps.map((l, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className={cellClass}>
                  <L.Input
                    type="number"
                    value={l.year}
                    onChange={(e) => upd(i, { year: Number(e.target.value) })}
                    widthClass="w-24"
                  />
                </td>
                <td className={cellClass}>
                  <L.Select
                    value={l.month}
                    onChange={(e) => upd(i, { month: Number(e.target.value) })}
                  >
                    {MONTHS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </L.Select>
                </td>
                <td className={cellClass}>
                  <L.Input
                    type="number"
                    step="0.01"
                    value={l.amount}
                    onChange={(e) => upd(i, { amount: Number(e.target.value) })}
                    widthClass="w-28"
                  />
                </td>
                <td className={cellClass}>
                  <L.Input
                    value={l.description || ""}
                    onChange={(e) => upd(i, { description: e.target.value })}
                  />
                </td>
                <td className={cellClass}>
                  <L.Button small variant="danger" onClick={() => rm(i)}>
                    Remove
                  </L.Button>
                </td>
              </tr>
            ))}
            {lumps.length === 0 ? (
              <tr>
                <td className={cellClass} colSpan={5}>
                  <div className="text-center text-gray-500 text-sm py-4">
                    No entries. Click “Add Entry”.
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
