import React, { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../../lib/api";

type Props = { scenarioId: number };

/* ==========
   Types (backend uyumlu olacak şekilde esnek tutuldu)
   ========== */
type AppliesTo = "revenue" | "services" | "capex" | "boq" | "all";
type Frequency = "none" | "monthly" | "annual";
type Method = "fixed_pct" | "index";

type EscalationPolicy = {
  id: number;
  scenario_id?: number;

  name: string;
  applies_to: AppliesTo;        // hangi alana uygulanır
  method: Method;               // fixed_pct | index

  // fixed
  fixed_pct?: number | null;    // % cinsinden

  // index tabanlı (örn: CPI-TR, PPI, FX gibi seri kodları)
  index_code?: string | null;   // serinin kısa kodu
  base_year?: number | null;
  base_month?: number | null;   // 1..12
  step_years?: number | null;   // kaç yılda bir “step”
  step_months?: number | null;  // kaç ayda bir “step”

  frequency?: Frequency;        // none | monthly | annual
  is_active: boolean;

  notes?: string | null;
};

type ResolveResp = {
  // seçili tarih için politika başına katsayı ve/veya efektif % döndüğünü varsayıyoruz
  items: Array<{
    policy_id: number;
    name: string;
    applies_to: AppliesTo;
    method: Method;
    // ekranda göstereceğimiz iki temel çıktı:
    factor?: number | null;     // katsayı (1.08 gibi)
    effective_pct?: number | null; // % (8.0 gibi)
    details?: string | null;       // backend açıklaması (opsiyonel)
  }>;
};

function cls(...a: (string | false | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

const fmt2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function EscalationTab({ scenarioId }: Props) {
  const [policies, setPolicies] = useState<EscalationPolicy[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // resolve panel state
  const now = useMemo(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  }, []);
  const [year, setYear] = useState<number>(now.y);
  const [month, setMonth] = useState<number>(now.m);
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<ResolveResp | null>(null);

  const baseUrl = `/scenarios/${scenarioId}/escalation-policies`;
  const resolveUrl = `/scenarios/${scenarioId}/escalation/resolve`;

  async function reload() {
    setLoading(true);
    setErr(null);
    setResolved(null);
    try {
      // sadece okuma
      const data = await apiGet<EscalationPolicy[]>(baseUrl);
      setPolicies(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setPolicies([]);
      setErr(e?.response?.data?.detail || e?.message || "Failed to load escalation policies.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioId]);

  async function resolvePolicies() {
    setResolving(true);
    setErr(null);
    setResolved(null);
    try {
      const q = new URLSearchParams({
        year: String(year),
        month: String(month),
      }).toString();
      const data = await apiGet<ResolveResp>(`${resolveUrl}?${q}`);
      setResolved(data);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || "Resolve failed.");
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold">Escalation (Preview)</h3>
        <div className="flex gap-2">
          <button
            onClick={reload}
            className={cls(
              "px-3 py-1.5 rounded-md border text-sm hover:bg-gray-50 disabled:opacity-60",
              loading && "cursor-progress"
            )}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </div>

      {err && (
        <div className="p-3 rounded-md border border-red-300 bg-red-50 text-red-700">{err}</div>
      )}

      {/* Policies table */}
      <div className="overflow-auto border rounded-xl bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              <th className="p-2 text-left">Name</th>
              <th className="p-2 text-left">Scope</th>
              <th className="p-2 text-left">Method</th>
              <th className="p-2 text-right">Fixed %</th>
              <th className="p-2 text-left">Index Code</th>
              <th className="p-2 text-left">Base (Y/M)</th>
              <th className="p-2 text-left">Step (y/m)</th>
              <th className="p-2 text-left">Freq</th>
              <th className="p-2 text-center">Active</th>
              <th className="p-2 text-left">Notes</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="p-3" colSpan={10}>Loading…</td>
              </tr>
            ) : policies.length === 0 ? (
              <tr>
                <td className="p-4 text-gray-500" colSpan={10}>
                  No escalation policies yet.
                </td>
              </tr>
            ) : (
              policies.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-2">{p.name}</td>
                  <td className="p-2">{p.applies_to}</td>
                  <td className="p-2">{p.method}</td>
                  <td className="p-2 text-right">
                    {p.method === "fixed_pct" ? fmt2.format(Number(p.fixed_pct ?? 0)) : "—"}
                  </td>
                  <td className="p-2">{p.method === "index" ? (p.index_code || "—") : "—"}</td>
                  <td className="p-2">
                    {p.base_year && p.base_month ? `${p.base_year}/${String(p.base_month).padStart(2, "0")}` : "—"}
                  </td>
                  <td className="p-2">
                    {(p.step_years ?? 0) || (p.step_months ?? 0)
                      ? `${p.step_years ?? 0}/${p.step_months ?? 0}`
                      : "—"}
                  </td>
                  <td className="p-2">{p.frequency || "none"}</td>
                  <td className="p-2 text-center">
                    <input type="checkbox" checked={!!p.is_active} readOnly />
                  </td>
                  <td className="p-2">{p.notes || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Resolve panel */}
      <div className="border rounded-xl p-3 sm:p-4 bg-white">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <div className="text-xs text-gray-600">Year</div>
            <input
              type="number"
              className="border rounded-md px-2 py-1 w-full"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end mt-3">
          <div>
            <div className="text-xs text-gray-600">Month</div>
            <input
              type="number"
              min={1}
              max={12}
              className="border rounded-md px-2 py-1 w-full"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            />
          </div>
          <div className="flex">
            <button
              className={cls(
                "ml-auto px-3 py-2 rounded-md border hover:bg-gray-50",
                resolving && "opacity-60 cursor-progress"
              )}
              onClick={resolvePolicies}
              disabled={resolving}
            >
              Resolve Escalation
            </button>
          </div>
        </div>

        {resolved && (
          <div className="mt-4 overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-700">
                <tr>
                  <th className="p-2 text-left">Policy</th>
                  <th className="p-2 text-left">Scope</th>
                  <th className="p-2 text-left">Method</th>
                  <th className="p-2 text-right">Factor</th>
                  <th className="p-2 text-right">Effective %</th>
                  <th className="p-2 text-left">Details</th>
                </tr>
              </thead>
              <tbody>
                {resolved.items?.length ? (
                  resolved.items.map((it) => (
                    <tr key={it.policy_id} className="border-t">
                      <td className="p-2">{it.name}</td>
                      <td className="p-2">{it.applies_to}</td>
                      <td className="p-2">{it.method}</td>
                      <td className="p-2 text-right">
                        {it.factor == null ? "—" : fmt2.format(it.factor)}
                      </td>
                      <td className="p-2 text-right">
                        {it.effective_pct == null ? "—" : `${fmt2.format(it.effective_pct)} %`}
                      </td>
                      <td className="p-2">{it.details || "—"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="p-3 text-gray-500" colSpan={6}>
                      No matching policy for selected date.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="mt-2 text-xs text-gray-500">
              Preview amaçlıdır; sonuçlar politika tanımlarına göre hesaplanır (fixed % veya index bazlı step/frequency).
            </div>
          </div>
        )}
      </div>

      {/* Bilgi notu */}
      <div className="text-xs text-gray-500">
        Bu sekme yalnızca önizleme/çözümleme amaçlıdır. Servisler/CAPEX üzerinde otomatik değişiklik yapmaz.
      </div>
    </div>
  );
}
