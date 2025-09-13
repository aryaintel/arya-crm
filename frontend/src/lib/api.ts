import { getToken } from "./auth";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

export class ApiError extends Error {
  status: number;
  payload?: unknown;
  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

function authHeader(token?: string | null): Record<string, string> {
  const t = token === undefined ? getToken() : token;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function readPayload(res: Response): Promise<{ message: string; payload: unknown }> {
  let payload: unknown = null;
  let message = res.statusText || "Request failed";
  try {
    payload = await res.clone().json();
    const p = payload as any;
    if (p?.detail) {
      if (typeof p.detail === "string") message = p.detail;
      else if (Array.isArray(p.detail) && p.detail[0]?.msg) message = p.detail[0].msg;
    }
  } catch {
    try {
      const txt = await res.text();
      payload = txt;
      if (txt) message = txt;
    } catch {
      /* no-op */
    }
  }
  return { message, payload };
}

async function request<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  token?: string | null
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...authHeader(token) };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr: any) {
    // Ağ hatası → kontrollü hata
    throw new ApiError(0, networkErr?.message || "Network error", networkErr);
  }

  if (!res.ok) {
    const { message, payload } = await readPayload(res);
    throw new ApiError(res.status, message, payload);
  }

  if (res.status === 204) return undefined as unknown as T;

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return (await res.json()) as T;

  return undefined as unknown as T;
}

export function apiGet<T>(path: string, token?: string | null) {
  return request<T>("GET", path, undefined, token);
}
export function apiPost<T>(path: string, body: unknown, token?: string | null) {
  return request<T>("POST", path, body, token);
}
export function apiPatch<T>(path: string, body: unknown, token?: string | null) {
  return request<T>("PATCH", path, body, token);
}
export function apiDelete(path: string, token?: string | null) {
  return request<void>("DELETE", path, undefined, token);
}
