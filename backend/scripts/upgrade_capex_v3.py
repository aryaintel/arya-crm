# backend/scripts/upgrade_capex_v3.py
"""
scenario_capex tablosunu 'i.Capital' sekmesinin tüm ihtiyaçlarına göre genişletir.
- Tablo yoksa TAM şemayla oluşturur.
- Tablo varsa eksik sütunları ADD COLUMN ile ekler.
- Varsayılan değerleri backfill eder.
SQLite (app.db) için tasarlanmıştır.

Çalıştırma:
    cd backend
    python scripts/upgrade_capex_v3.py
"""
from pathlib import Path
import sqlite3

DB_PATH = Path(__file__).resolve().parents[1] / "app.db"

DDL_TABLE_V3 = """
CREATE TABLE IF NOT EXISTS scenario_capex (
    id INTEGER PRIMARY KEY,
    scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    amount NUMERIC(18,2) NOT NULL,
    notes TEXT NULL,
    CONSTRAINT ck_capex_month CHECK (month >= 1 AND month <= 12),

    -- V2 alanları
    asset_name TEXT NULL,
    category TEXT NULL,
    service_start_year INTEGER NULL,
    service_start_month INTEGER NULL,
    useful_life_months INTEGER NULL,
    depr_method TEXT NULL DEFAULT 'straight_line',
    salvage_value NUMERIC(18,2) NULL DEFAULT 0,
    is_active INTEGER NULL DEFAULT 1,

    -- V3: Capital sekmesinden gelen ek alanlar
    disposal_year INTEGER NULL,
    disposal_month INTEGER NULL,
    disposal_proceeds NUMERIC(18,2) NULL DEFAULT 0,
    replace_at_end INTEGER NULL DEFAULT 0, -- bool
    per_unit_cost NUMERIC(18,2) NULL,
    quantity INTEGER NULL,
    contingency_pct NUMERIC(5,2) NULL DEFAULT 0,
    partial_month_policy TEXT NULL DEFAULT 'full_month'
);
"""

ADD_COLS_SQL = {
    # V2 zaten vardı
    "asset_name": "ALTER TABLE scenario_capex ADD COLUMN asset_name TEXT NULL;",
    "category": "ALTER TABLE scenario_capex ADD COLUMN category TEXT NULL;",
    "service_start_year": "ALTER TABLE scenario_capex ADD COLUMN service_start_year INTEGER NULL;",
    "service_start_month": "ALTER TABLE scenario_capex ADD COLUMN service_start_month INTEGER NULL;",
    "useful_life_months": "ALTER TABLE scenario_capex ADD COLUMN useful_life_months INTEGER NULL;",
    "depr_method": "ALTER TABLE scenario_capex ADD COLUMN depr_method TEXT NULL DEFAULT 'straight_line';",
    "salvage_value": "ALTER TABLE scenario_capex ADD COLUMN salvage_value NUMERIC(18,2) NULL DEFAULT 0;",
    "is_active": "ALTER TABLE scenario_capex ADD COLUMN is_active INTEGER NULL DEFAULT 1;",

    # V3 yeni alanlar
    "disposal_year": "ALTER TABLE scenario_capex ADD COLUMN disposal_year INTEGER NULL;",
    "disposal_month": "ALTER TABLE scenario_capex ADD COLUMN disposal_month INTEGER NULL;",
    "disposal_proceeds": "ALTER TABLE scenario_capex ADD COLUMN disposal_proceeds NUMERIC(18,2) NULL DEFAULT 0;",
    "replace_at_end": "ALTER TABLE scenario_capex ADD COLUMN replace_at_end INTEGER NULL DEFAULT 0;",
    "per_unit_cost": "ALTER TABLE scenario_capex ADD COLUMN per_unit_cost NUMERIC(18,2) NULL;",
    "quantity": "ALTER TABLE scenario_capex ADD COLUMN quantity INTEGER NULL;",
    "contingency_pct": "ALTER TABLE scenario_capex ADD COLUMN contingency_pct NUMERIC(5,2) NULL DEFAULT 0;",
    "partial_month_policy": "ALTER TABLE scenario_capex ADD COLUMN partial_month_policy TEXT NULL DEFAULT 'full_month';",
}

BACKFILL_SQL = [
    "UPDATE scenario_capex SET depr_method = COALESCE(depr_method, 'straight_line');",
    "UPDATE scenario_capex SET salvage_value = COALESCE(salvage_value, 0);",
    "UPDATE scenario_capex SET is_active = COALESCE(is_active, 1);",
    "UPDATE scenario_capex SET disposal_proceeds = COALESCE(disposal_proceeds, 0);",
    "UPDATE scenario_capex SET replace_at_end = COALESCE(replace_at_end, 0);",
    "UPDATE scenario_capex SET contingency_pct = COALESCE(contingency_pct, 0);",
    "UPDATE scenario_capex SET partial_month_policy = COALESCE(partial_month_policy, 'full_month');",
]

def table_exists(cx: sqlite3.Connection, name: str) -> bool:
    cur = cx.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?;", (name,)
    )
    return cur.fetchone() is not None

def column_names(cx: sqlite3.Connection, table: str) -> set[str]:
    cols = set()
    for row in cx.execute(f"PRAGMA table_info({table});"):
        cols.add(row[1])
    return cols

def ensure_index(cx: sqlite3.Connection, name: str, sql: str) -> None:
    cur = cx.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND name = ?;", (name,)
    )
    if cur.fetchone() is None:
        cx.execute(sql)

def main() -> None:
    print(f"[i] Using DB = {DB_PATH}")
    cx = sqlite3.connect(str(DB_PATH))
    cx.execute("PRAGMA foreign_keys = ON;")

    if not table_exists(cx, "scenario_capex"):
        print("[+] Creating table scenario_capex (V3 schema)…")
        cx.executescript(DDL_TABLE_V3)
    else:
        print("[=] scenario_capex exists. Checking columns…")
        cols = column_names(cx, "scenario_capex")
        for col, add_sql in ADD_COLS_SQL.items():
            if col not in cols:
                print(f"[+] Adding column: {col}")
                cx.execute(add_sql)
            else:
                print(f"[=] Column already present: {col}")

    # index
    ensure_index(
        cx,
        "ix_capex_scenario_year_month",
        "CREATE INDEX IF NOT EXISTS ix_capex_scenario_year_month "
        "ON scenario_capex (scenario_id, year, month);",
    )

    # backfill defaults
    for sql in BACKFILL_SQL:
        cx.execute(sql)

    cx.commit()

    # summary
    print("\n=== scenario_capex columns ===")
    for row in cx.execute("PRAGMA table_info(scenario_capex);"):
        print(f"- {row[1]:20} | {row[2]:15} | notnull={row[3]} | default={row[4]!r} | pk={row[5]}")

    count = cx.execute("SELECT COUNT(*) FROM scenario_capex;").fetchone()[0]
    print(f"\n[✓] scenario_capex ready. Row count: {count}")
    cx.close()

if __name__ == "__main__":
    main()
