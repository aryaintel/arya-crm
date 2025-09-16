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

/* ---------------- BOQ (Bill of Quantities) ----------------
   Not: Bu tipler UI'da satır-bazlı BOQ ekranı için kullanılacak.
   Backend'e bağlanana kadar opsiyonel (?), hiçbir şey kırmaz.
*/

export type BOQFrequency =
  | "once"          // tek seferlik
  | "monthly"       // her ay
  | "per_shipment"  // gönderi başına (ileride kullanılabilir)
  | "per_tonne";    // ton başına (ileride kullanılabilir)

// Dropdown vs. için ortak liste (opsiyonel kalite artırımı)
export const BOQ_FREQUENCIES: BOQFrequency[] = [
  "once",
  "monthly",
  "per_shipment",
  "per_tonne",
];

export type ScenarioBOQItem = {
  id: number;
  scenario_id?: number;
  section?: string | null;   // gruplama (örn. “AN”, “EM”)
  item_name: string;         // kalem adı
  unit: string;              // ölçü birimi (ton, m3, adet, vb.)
  quantity: number;          // miktar
  unit_price: number;        // birim satış fiyatı
  unit_cogs?: number;        // birim maliyet (opsiyonel)
  frequency: BOQFrequency;   // hesaplama sıklığı
  start_year?: number;       // opsiyonel başlangıç
  start_month?: number;      // opsiyonel başlangıç
  months?: number;           // kaç ay sürecek (opsiyonel)
  is_active?: boolean;       // satır geçerli mi
  notes?: string | null;     // serbest açıklama
};

// Yeni kayıt (POST) / güncelleme (PATCH) payload'larında kullanışlı
export type NewScenarioBOQItem = Omit<ScenarioBOQItem, "id">;

export type ScenarioDetail = {
  id: number;
  business_case_id: number;
  name: string;
  months: number;
  start_date: string; // ISO
  products: ScenarioProduct[];
  overheads: ScenarioOverhead[];
  /** BOQ satırları (opsiyonel; backend hazır değilse gelmeyebilir) */
  boq_items?: ScenarioBOQItem[];
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
