import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { ScenarioDetail, PLResponse, ScenarioProduct } from "../../types/scenario";
import { formatDate } from "../../utils/format";
import PLTab from "./tabs/PLTab";
import TWCTab from "./tabs/TWCTab";
import VolumesTab from "./tabs/VolumesTab";

export default function ScenarioPage() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const sid = Number(scenarioId);

  const [tab, setTab] = useState<"pl" | "twc" | "volumes">("pl");
  const [data, setData] = useState<ScenarioDetail | null>(null);
  const [pl, setPl] = useState<PLResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchScenario = async () => {
    setLoading(true); setError(null); setPl(null);
    try {
      const payload = await apiGet<ScenarioDetail>(`/business-cases/scenarios/${sid}`);
      setData(payload);
    } catch (e: any) {
      const msg = (e instanceof ApiError && e.message) || e?.response?.data?.detail || e?.message || "Load failed";
      setError(String(msg));
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (!sid) { setError("Invalid scenario id"); setLoading(false); return; }
    fetchScenario();
  }, [sid]);

  const onCompute = async () => {
    try { const res = await apiPost<PLResponse>(`/business-cases/scenarios/${sid}/compute`, {}); setPl(res); }
    catch (e: any) { alert((e instanceof ApiError && e.message) || e?.response?.data?.detail || e?.message || "Compute failed"); }
  };

  return (
    <div className="bg-white rounded-xl shadow p-6">
      {/* header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-2">
        <div>
          <h2 className="text-lg font-medium">Scenario</h2>
          {data && (
            <div className="text-sm text-gray-500">
              ID: <b>{data.id}</b> • Name: <b>{data.name}</b> • Months: <b>{data.months}</b> •
              Start: <b>{formatDate(data.start_date)}</b> • BC:{" "}
              <Link className="text-indigo-600 hover:underline" to={`/business-cases/${data.business_case_id}`}>#{data.business_case_id}</Link>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button onClick={fetchScenario} className="px-3 py-1.5 rounded-md border text-sm hover:bg-gray-50">Refresh</button>
          {tab === "pl" && <button onClick={onCompute} className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-500">Compute P&L</button>}
        </div>
      </div>

      {/* tabs */}
      <div className="flex items-center gap-3 border-b mb-4">
        {(["pl","twc","volumes"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 -mb-px border-b-2 text-sm ${tab === t ? "border-indigo-600 text-indigo-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {t === "pl" ? "P&L" : t === "twc" ? "TWC" : "Volumes"}
          </button>
        ))}
      </div>

      {loading && <div className="text-sm text-gray-500">Loading scenario…</div>}
      {error && <div className="text-sm text-red-600">Error: {error}</div>}

      {!loading && !error && data && (
        <>
          {tab === "pl"      && <PLTab data={data} pl={pl} onCompute={onCompute} refresh={fetchScenario} openMonthsEditor={(p: ScenarioProduct) => { /* handled inside PLTab modal open */ }} />}
          {tab === "twc"     && <TWCTab data={data} pl={pl} />}
          {tab === "volumes" && <VolumesTab data={data} refresh={fetchScenario} />}
        </>
      )}
    </div>
  );
}
