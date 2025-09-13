import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiGet, ApiError } from "../lib/api";

type Opportunity = {
  id: number;
  tenant_id: number;
  account_id: number;
  account_name?: string | null;
  owner_id: number;
  owner_email?: string | null;

  name: string;
  amount?: number | null;
  currency?: string | null;
  stage_id: number;

  expected_close_date?: string | null;
  source?: string | null;

  created_at?: string | null;
  updated_at?: string | null;
};

// /deals/stages -> { id, no, name }
type StageRow = { id: number; no: number; name: string };

export default function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [opp, setOpp] = useState<Opportunity | null>(null);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const currentStage = useMemo(
    () => (opp ? stages.find((s) => s.id === opp.stage_id) : undefined),
    [opp, stages]
  );

  const fetchAll = async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const [data, st] = await Promise.all([
        apiGet<Opportunity>(`/deals/${id}`),
        apiGet<StageRow[]>(`/deals/stages`),
      ]);
      setOpp(data);
      setStages(Array.isArray(st) ? st : []);
    } catch (e: any) {
      const msg =
        (e instanceof ApiError && e.message) ||
        e?.response?.data?.detail ||
        e?.message ||
        "Failed to load opportunity";
      setErr(String(msg));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="text-xs text-gray-500">
            <Link to="/deals" className="hover:underline">
              Opportunities
            </Link>{" "}
            / <span>Detail</span>
          </div>
          <h1 className="text-xl font-semibold">
            {opp?.name ?? (loading ? "Loading…" : "Opportunity")}
          </h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate("/deals")}
            className="px-3 py-1.5 rounded-md border text-sm hover:bg-gray-50"
          >
            Back to list
          </button>
        </div>
      </div>

      {/* States */}
      {loading && <div className="text-sm text-gray-500">Loading opportunity…</div>}
      {err && <div className="text-sm text-red-600">Error: {err}</div>}

      {/* Content */}
      {!loading && !err && opp && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* LEFT — Pipeline + Overview */}
          <div className="lg:col-span-2 space-y-4">
            {/* Pipeline */}
            <div className="bg-white rounded-xl shadow p-5">
              <div className="text-lg font-medium mb-4">Pipeline</div>
              <PipelineArrows stages={stages} currentStageId={opp.stage_id} />
            </div>

            {/* Overview */}
            <div className="bg-white rounded-xl shadow p-5">
              <div className="text-lg font-medium mb-4">Overview</div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <KV label="Account" value={opp.account_name ?? opp.account_id} />
                <KV label="Owner" value={opp.owner_email ?? opp.owner_id} />
                <KV
                  label="Amount"
                  value={opp.amount != null ? opp.amount.toLocaleString() : "—"}
                />
                <KV label="Currency" value={opp.currency ?? "—"} />
                <KV
                  label="Expected Close"
                  value={
                    opp.expected_close_date
                      ? new Date(opp.expected_close_date).toLocaleDateString()
                      : "—"
                  }
                />
                <KV label="Source" value={opp.source ?? "—"} />
              </div>
            </div>
          </div>

          {/* RIGHT — Meta */}
          <div className="bg-white rounded-xl shadow p-5">
            <div className="text-lg font-medium mb-4">Opportunity Info</div>
            <div className="text-sm space-y-2">
              <KV label="Stage" value={currentStage?.name ?? "—"} />
              <KV
                label="Created"
                value={opp.created_at ? new Date(opp.created_at).toLocaleString() : "—"}
              />
              <KV
                label="Updated"
                value={opp.updated_at ? new Date(opp.updated_at).toLocaleString() : "—"}
              />
              <KV label="Opportunity ID" value={String(opp.id)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Büyük, tek renkli, birbirine giren oklar — stage ilerledikçe koyulaşır; aktif stage daha vurgulu */
/** Büyük, eşit genişlikte oklar — aktif aşama kırmızı çerçeveli */
/** Büyük, eşit genişlikte oklar — aktif aşama siyah çerçeveli */
/** Salesforce benzeri oklar – sadece aktif stage siyah konturlu */
function PipelineArrows({
  stages,
  currentStageId,
}: {
  stages: { id: number; no: number; name: string }[];
  currentStageId: number;
}) {
  if (!stages.length) return <div className="text-sm text-gray-500">No stages.</div>;

  // soldan sağa koyulaşan mavi tonlar
  const colorFor = (idx: number) => {
    const total = stages.length;
    const startL = 78; // açık
    const endL = 45;   // koyu
    const L = startL - ((startL - endL) * idx) / Math.max(1, total - 1);
    return `hsl(214 70% ${L}%)`;
  };

  // tüm aşamalar için aynı ok şekli
  const shape = "polygon(0 0, calc(100% - 24px) 0, 100% 50%, calc(100% - 24px) 100%, 0 100%, 24px 50%)";

  return (
    <div className="w-full flex items-stretch overflow-hidden select-none">
      {stages.map((s, idx) => {
        const isActive = s.id === currentStageId;
        const bg = colorFor(idx);
        const label = idx === stages.length - 1 ? "Won / Lost" : s.name;

        return (
          <div
            key={s.id}
            className="relative flex-1 min-w-0 h-16 flex items-center justify-center"
            style={{ marginLeft: idx === 0 ? 0 : -24 }}
          >
            {/* Kontur SADECE aktif aşamada çizilir */}
            {isActive && (
              <div className="absolute inset-0" style={{ clipPath: shape, background: "#000" }} />
            )}

            {/* İç dolgu */}
            <div
              className="absolute flex items-center justify-center px-6 text-white font-semibold text-sm truncate"
              style={{
                clipPath: shape,
                top: isActive ? 6 : 0,
                bottom: isActive ? 6 : 0,
                left: isActive ? 6 : 0,
                right: isActive ? 6 : 0,
                background: bg,
              }}
            >
              {label}
            </div>
          </div>
        );
      })}
    </div>
  );
}


function KV({ label, value }: { label: string; value?: React.ReactNode | string | null }) {
  const display =
    value == null || value === "" ? <span className="text-gray-500">—</span> : value;
  return (
    <div>
      <div className="text-gray-500 text-xs mb-1">{label}</div>
      <div>{display}</div>
    </div>
  );
}
