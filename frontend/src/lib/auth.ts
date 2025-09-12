// src/lib/auth.ts
// Basit token & rol & tenant yönetimi + yardımcılar

const TOKEN_KEY = "aryaintel_token";
const ROLE_KEY = "aryaintel_role";
const TENANT_KEY = "aryaintel_tenant";

export type RoleName = "admin" | "member" | "guest";

/* ---------- Token ---------- */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(tok: string) {
  localStorage.setItem(TOKEN_KEY, tok);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/* ---------- Role ---------- */
export function getRole(): RoleName {
  return (localStorage.getItem(ROLE_KEY) as RoleName) || "guest";
}
export function setRole(role: RoleName) {
  localStorage.setItem(ROLE_KEY, role);
}
export function clearRole() {
  localStorage.removeItem(ROLE_KEY);
}

/* ---------- Tenant ---------- */
export function getTenantSlug(): string | null {
  return localStorage.getItem(TENANT_KEY);
}
export function setTenantSlug(slug: string) {
  localStorage.setItem(TENANT_KEY, slug);
}
export function clearTenantSlug() {
  localStorage.removeItem(TENANT_KEY);
}

/* ---------- Headers / helpers ---------- */
export function getAuthHeader(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

/** Tek seferde oturum verilerini kurar */
export function loginSuccess(opts: { token: string; role: RoleName; tenant?: string }) {
  setToken(opts.token);
  setRole(opts.role);
  if (opts.tenant) setTenantSlug(opts.tenant);
}

/** Logout: tüm oturum verilerini temizle */
export function logout() {
  clearToken();
  clearRole();
  clearTenantSlug();
}
