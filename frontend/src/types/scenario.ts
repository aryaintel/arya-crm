// src/types/scenario.ts

export type ProductMonth = { year: number; month: number; quantity: number };

export type ScenarioProduct = {
  id: number;
  name: string;
  price: number;        // unit price
  unit_cogs: number;    // unit cogs
  is_active: boolean;
  months: ProductMonth[];
};

export type ScenarioOverhead = {
  id: number;
  name: string;
  type: "fixed" | "%_revenue";
  amount: number; // fixed: amount, %_revenue: fraction (0.2 -> 20%)
};

export type ScenarioDetail = {
  id: number;
  business_case_id: number;
  name: string;
  months: number;
  start_date: string; // ISO
  products: ScenarioProduct[];
  overheads: ScenarioOverhead[];
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
