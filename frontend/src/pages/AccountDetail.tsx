// src/pages/AccountDetail.tsx
import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { apiGet, ApiError } from "../lib/api";

type Account = {
  id: number;
  name: string;
  industry?: string | null;
  type?: string | null;
  website?: string | null;
  phone?: string | null;
  billing_address?: string | null;
  shipping_address?: string | null;

  // SF-like fields
  account_number?: string | null;
  employees?: number | null;
  annual_revenue?: number | null;
  rating?: string | null;
  ownership?: string | null;
  description?: string | null;

  owner_id?: number | null;
  owner_email?: string | null;
  created_at?: string | null;
};

export default function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAccount = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const acc = await apiGet<Account>(`/accounts/${id}`);
      setData(acc);
    } catch (e: any) {
      const msg =
        (e instanceof ApiError && e.message) ||
        e?.response?.data?.detail ||
        e?.message ||
        "Failed to load account";
      setError(String(msg));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="space-y-4">
      {/* Header / Breadcrumbs */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="text-xs text-gray-500">
            <Link to="/accounts" className="hover:underline">
              Accounts
            </Link>{" "}
            / <span>Detail</span>
          </div>
          <h1 className="text-xl font-semibold">
            {data?.name ?? (loading ? "Loading…" : "Account")}
          </h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate("/accounts")}
            className="px-3 py-1.5 rounded-md border text-sm hover:bg-gray-50"
          >
            Back to list
          </button>
          {/* İleride: Edit düğmesi buraya gelebilir */}
        </div>
      </div>

      {/* States */}
      {loading && <div className="text-sm text-gray-500">Loading account…</div>}
      {error && <div className="text-sm text-red-600">Error: {error}</div>}

      {/* Content */}
      {!loading && !error && data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Overview card (2/3) */}
          <div className="lg:col-span-2 bg-white rounded-xl shadow p-5">
            <div className="text-lg font-medium mb-4">Overview</div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <KV label="Industry" value={data.industry} />
              <KV label="Type" value={data.type} />
              <KV
                label="Website"
                value={
                  data.website ? (
                    <a
                      href={data.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-600 hover:underline"
                    >
                      {data.website}
                    </a>
                  ) : (
                    "—"
                  )
                }
              />
              <KV label="Phone" value={data.phone} />

              <KV label="Account Number" value={data.account_number} />
              <KV
                label="Employees"
                value={
                  data.employees != null ? data.employees.toLocaleString() : "—"
                }
              />
              <KV
                label="Annual Revenue"
                value={
                  data.annual_revenue != null
                    ? data.annual_revenue.toLocaleString()
                    : "—"
                }
              />
              <KV label="Rating" value={data.rating} />
              <KV label="Ownership" value={data.ownership} />

              <div className="md:col-span-2">
                <KV label="Billing Address" value={data.billing_address} />
              </div>
              <div className="md:col-span-2">
                <KV label="Shipping Address" value={data.shipping_address} />
              </div>
              <div className="md:col-span-2">
                <KV label="Description" value={data.description} multiline />
              </div>
            </div>
          </div>

          {/* Side meta (1/3) */}
          <div className="bg-white rounded-xl shadow p-5">
            <div className="text-lg font-medium mb-4">Account Info</div>
            <div className="text-sm space-y-2">
              <KV label="Owner" value={data.owner_email} />
              <KV
                label="Created"
                value={
                  data.created_at
                    ? new Date(data.created_at).toLocaleString()
                    : "—"
                }
              />
              <KV label="Account ID" value={String(data.id)} />
            </div>
          </div>

          {/* İlerisi: Tabs (Contacts / Opportunities / Activity) */}
        </div>
      )}
    </div>
  );
}

function KV({
  label,
  value,
  multiline,
}: {
  label: string;
  value?: React.ReactNode | string | null;
  multiline?: boolean;
}) {
  const display =
    value == null || value === "" ? (
      <span className="text-gray-500">—</span>
    ) : typeof value === "string" && multiline ? (
      <div className="whitespace-pre-line">{value}</div>
    ) : (
      value
    );
  return (
    <div>
      <div className="text-gray-500 text-xs mb-1">{label}</div>
      <div>{display}</div>
    </div>
  );
}
