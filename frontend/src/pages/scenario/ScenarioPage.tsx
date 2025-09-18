// src/pages/scenario/ScenarioPage.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import type {
  ScenarioDetail,
  PLResponse,
  ScenarioBOQItem,
  CapexEntry,        // NEW
} from "../../types/scenario";
import { formatDate } from "../../utils/format";
import PLTab from "./tabs/PLTab";
import TWCTab from "./tabs/TWCTab";
import VolumesTab from "./tabs/VolumesTab";
// BOQ global component
import BOQTable from "../../components/BOQTable";
// NEW: Capex table (local component)
import CapexTable from "./components/CapexTable";

type TabKey = "pl" | "twc" | "volumes" | "boq" | "capex"; // NEW
const VALID_TABS: TabKey[] = ["pl", "twc", "volumes", "boq", "capex"]; // NEW

export default function ScenarioPage() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const sid = Number(scenarioId);

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = (searchParams.get("tab") as TabKey) || "pl";
  const initialTab: TabKey = VALID_TABS.includes(tabParam) ? tabParam : "pl";

  const [tab, setTab] = useState<TabKey>(initialTab);
  const [data, setData] = useState<ScenarioDetail | null>(null);
  const [pl, setPl] = useState<PLResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // URL değişince sekmeyi senkronize et
  useEffect(() => {
    const t = (searchParams.get("tab") as TabKey) || "pl";
    if (VALID_TABS.includes(t) && t !== tab) setTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Sekme değişince URL paramını güncelle
  useEffect(() => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("tab", tab);
      return p;
    });
  }, [tab, setSearchParams]);

  const fetchScenario = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPl(null);
    try {
      // 1) Ana senaryo
      const base = await apiGet<ScenarioDetail>(`/business-cases/scenarios/${sid}`);

      // 2) BOQ kalemleri (opsiyonel endpoint)
      let boq_items: ScenarioBOQItem[] = [];
      try {
        boq_items = await apiGet<ScenarioBOQItem[]>(
          `/business-cases/scenarios/${sid}/boq-items`
        );
      } catch {
        /* optional */
      }

      // 3) CAPEX satırları (opsiyonel endpoint)
      let capex: CapexEntry[] = [];
      try {
        capex = await apiGet<CapexEntry[]>(
          `/business-cases/scenarios/${sid}/capex`
        );
      } catch {
        /* optional */
      }

      setData({ ...base, boq_items, capex });
    } catch (e: any) {
      const msg =
        (e instanceof ApiError && e.message) ||
        e?.response?.data?.detail ||
        e?.message ||
        "Load failed";
      setError(String(msg));
    } finally {
      setLoading(false);
    }
  }, [sid]);

  useEffect(() => {
    if (!sid || Number.isNaN(sid)) {
      setError("Invalid scenario id");
      setLoading(false);
      return;
    }
    fetchScenario();
  }, [sid, fetchScenario]);

  const onCompute = async () => {
    if (!data) return;
    setComputing(true);
    try {
      const res = await apiPost<PLResponse>(`/business-cases/scenarios/${sid}/compute`, {});
      setPl(res);
      setNotice("P&L başarıyla hesaplandı.");
      window.setTimeout(() => setNotice(null), 2500);
    } catch (e: any) {
      alert(
        (e instanceof ApiError && e.message) ||
          e?.response?.data?.detail ||
          e?.message ||
          "Compute failed"
      );
    } finally {
      setComputing(false);
    }
  };

  // Sekme sayaçları
  const boqCount = useMemo(() => data?.boq_items?.length ?? 0, [data?.boq_items]);
  const capexCount = useMemo(() => data?.capex?.length ?? 0, [data?.capex]); // NEW

  return (
    <div className="bg-white rounded-xl shadow p-6">
      {notice && (
        <div className="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {notice}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-2">
        <div>
          <h2 className="text-lg font-medium">Scenario</h2>
          {data && (
            <div className="text-sm text-gray-500">
              ID: <b>{data.id}</b> • Name: <b>{data.name}</b> • Months: <b>{data.months}</b> •
              Start: <b>{formatDate(data.start_date)}</b> • BC:{" "}
              <Link
                className="text-indigo-600 hover:underline"
                to={`/business-cases/${data.business_case_id}`}
              >
                #{data.business_case_id}
              </Link>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={fetchScenario}
            disabled={loading || computing}
            className="px-3 py-1.5 rounded-md border text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          {tab === "pl" && data && (
            <button
              onClick={onCompute}
              disabled={computing}
              className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-500 disabled:opacity-50"
            >
              {computing ? "Computing…" : "Compute P&L"}
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 border-b mb-4">
        {(["pl", "twc", "volumes", "boq", "capex"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 -mb-px border-b-2 text-sm ${
              tab === t
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "pl"
              ? "P&L"
              : t === "twc"
              ? "TWC"
              : t === "volumes"
              ? "Volumes"
              : t === "boq"
              ? `BOQ${boqCount ? ` (${boqCount})` : ""}`
              : `CAPEX${capexCount ? ` (${capexCount})` : ""}`} {/* NEW */}
          </button>
        ))}
      </div>

      {loading && <div className="text-sm text-gray-500">Loading scenario…</div>}
      {error && <div className="text-sm text-red-600">Error: {error}</div>}

      {!loading && !error && data && (
        <>
          {tab === "pl" && (
            <PLTab
              key={`pl-${data.id}`}
              data={data}
              pl={pl}
              onCompute={onCompute}
              refresh={fetchScenario}
            />
          )}

          {tab === "twc" && <TWCTab key={`twc-${data.id}`} data={data} pl={pl} />}

          {tab === "volumes" && (
            <VolumesTab key={`vol-${data.id}`} data={data} refresh={fetchScenario} />
          )}

          {tab === "boq" && <BOQTable key={`boq-${data.id}`} data={data} refresh={fetchScenario} />}

          {tab === "capex" && ( // NEW
            <CapexTable key={`capex-${data.id}`} data={data} refresh={fetchScenario} />
          )}
        </>
      )}
    </div>
  );
}
