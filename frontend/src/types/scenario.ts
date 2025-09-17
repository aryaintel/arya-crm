// src/types/scenario.ts
export type ProductMonth = { year: number; month: number; quantity: number };

export type ScenarioProduct = {
  id: number;
  name: string;
  price: number;
  unit_cogs: number;
  is_active: boolean;
  months: ProductMonth[];
};

export type ScenarioOverhead = {
  id: number;
  name: string;
  type: "fixed" | "%_revenue";
  amount: number;
};

export type BOQFrequency = "once" | "monthly" | "per_shipment" | "per_tonne";

export const BOQ_FREQUENCIES: BOQFrequency[] = [
  "once",
  "monthly",
  "per_shipment",
  "per_tonne",
];

// ---------- Category tipi & yardımcı sabitler ----------
export type BOQCategory = "bulk_with_freight" | "bulk_ex_freight" | "freight";

export const BOQ_CATEGORIES: BOQCategory[] = [
  "bulk_with_freight",
  "bulk_ex_freight",
  "freight",
];

export const BOQ_CATEGORY_LABELS: Record<BOQCategory, string> = {
  bulk_with_freight: "Bulk (with Freight)",
  bulk_ex_freight: "Bulk (ex Freight)",
  freight: "Freight",
};
// ------------------------------------------------------

export type ScenarioBOQItem = {
  id: number;
  scenario_id?: number;
  section?: string | null;
  item_name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  unit_cogs?: number | null; // <-- burada null'a izin veriyoruz
  frequency: BOQFrequency;
  start_year?: number;
  start_month?: number;
  months?: number;
  is_active?: boolean;
  notes?: string | null;
  category?: BOQCategory | null; // NEW
};

export type NewScenarioBOQItem = Omit<ScenarioBOQItem, "id">;

/* ===================== CAPEX ===================== */
export type CapexEntry = {
  id: number;
  year: number;          // 2025
  month: number;         // 1..12
  amount: number;        // yatırım çıkışı (-) veya iade (+)
  notes?: string | null;
};
export type NewCapexEntry = Omit<CapexEntry, "id">;
/* ================================================= */

export type ScenarioDetail = {
  id: number;
  business_case_id: number;
  name: string;
  months: number;
  start_date: string;
  products: ScenarioProduct[];
  overheads: ScenarioOverhead[];
  boq_items?: ScenarioBOQItem[];
  capex?: CapexEntry[];  // NEW: CAPEX satırları
};

export type PLMonth = {
  year: number;
  month: number;
  revenue: number;
  cogs: number;
  gross_margin: number;
  overhead_fixed: number;
  overhead_var_pct: number;
  overhead_var_amount: number;
  overhead_total: number;
  ebit: number;
  net_income: number;
};

export type PLResponse = {
  scenario: {
    id: number;
    name: string;
    months: number;
    start_date: string;
    overheads: { fixed_sum: number; pct_sum: number };
  };
  months: PLMonth[];
  totals: {
    revenue: number;
    cogs: number;
    gross_margin: number;
    overhead_fixed_total: number;
    overhead_var_total: number;
    overhead_total: number;
    ebit: number;
    net_income: number;
  };
};

export type CapexRow = { year: number; month: number; amount: number };
export type FinanceMode = "proxy" | "fcf";
