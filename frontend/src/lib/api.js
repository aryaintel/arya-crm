// frontend/src/lib/api.js
import axios from "axios";

export const API_URL = import.meta.env.VITE_API_URL;

const api = axios.create({
  baseURL: API_URL,
  timeout: 15000,
});

// 🔐 Her isteğe JWT + Tenant ekle (varsa)
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  const tenant = localStorage.getItem("tenant"); // örn: "demo" veya "default"

  config.headers = config.headers ?? {};

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (tenant) {
    // Backend genelde bu isimleri kullanır; biz X-Tenant-ID kullanıyoruz.
    config.headers["X-Tenant-ID"] = tenant;
  }

  return config;
});

export default api;
