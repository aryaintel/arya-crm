# backend/scripts/upgrade_rebates_schema.py
"""
Scenario Rebates şemasını oluşturur/günceller (SQLite/app.db).

Kapsam:
- scenario_rebates (kural başlığı; yüzde, tiered, lump-sum)
- scenario_rebate_tiers (kademeler: min/max eşiği → % veya tutar)
- scenario_rebate_lumps (dönemsel peşin/geriye dönük toplu tutarlar)
- Index'ler, updated_at tetikleyicileri (idempotent)
- --seed ile örnek veri basılır
- --drop ile yalnız rebates şeması temizlenir

Çalıştırma:
    cd backend
    python scripts/upgrade_rebates_schema.py
    python scripts/upgrade_rebates_schema.py --seed
    python scripts/upgrade_rebates_schema.py --drop
"""

from __future__ import annotations
from pathlib import Path
import sqlite3
import argparse
import sys
from typing import Iterable

DB_PATH = Path(__file__).resolve().parents[1] / "app.db"

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def table_exists(cx: sqlite3.Connection, name: str) -> bool:
    return cx.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?;", (name,)
    ).fetchone() is not None

def index_exists(cx: sqlite3.Connection, name: str) -> bool:
    return cx.execute(
        "SELECT 1 FROM sqlite_master WHERE type='index' AND name=?;", (name,)
    ).fetchone() is not None

def trigger_exists(cx: sqlite3.Connection, name: str) -> bool:
    return cx.execute(
        "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?;", (name,)
    ).fetchone() is not None

def column_names(cx: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in cx.execute(f"PRAGMA table_info({table});").fetchall()}

def ensure_index(cx: sqlite3.Connection, name: str, sql: str) -> None:
    if not index_exists(cx, name):
        cx.execute(sql)

def ensure_trigger(cx: sqlite3.Connection, name: str, sql: str) -> None:
    if not trigger_exists(cx, name):
        cx.executescript(sql)

# -----------------------------------------------------------------------------
# Core tables
# -----------------------------------------------------------------------------
REBATES_CREATE = """
CREATE TABLE IF NOT EXISTS scenario_rebates (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id      INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,

  -- İsim ve kapsam
  name             TEXT NOT NULL,
  scope            TEXT NOT NULL DEFAULT 'all'
                     CHECK (scope IN ('all','boq','services','product')),

  -- Tür ve baz
  kind             TEXT NOT NULL DEFAULT 'percent'
                     CHECK (kind IN ('percent','tier_percent','lump_sum')),
  basis            TEXT NOT NULL DEFAULT 'revenue'
                     CHECK (basis IN ('revenue','volume')),

  -- Opsiyonel: ürün odaklı rebate ise bağlamak için
  product_id       INTEGER REFERENCES products(id) ON DELETE SET NULL,

  -- Geçerlilik aralığı (Excel karşılığı)
  valid_from_year  INTEGER,
  valid_from_month INTEGER,
  valid_to_year    INTEGER,
  valid_to_month   INTEGER,

  -- Tahakkuk/ödeme politikası
  accrual_method   TEXT NOT NULL DEFAULT 'monthly'
                     CHECK (accrual_method IN ('monthly','quarterly','annual','on_invoice')),
  pay_month_lag    INTEGER DEFAULT 0,   -- Ödeme gecikmesi (ay)

  is_active        INTEGER NOT NULL DEFAULT 1,  -- 1:true, 0:false
  notes            TEXT,

  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

REBATES_ADD_COL = {
    "scenario_id":      "ALTER TABLE scenario_rebates ADD COLUMN scenario_id INTEGER;",
    "name":             "ALTER TABLE scenario_rebates ADD COLUMN name TEXT;",
    "scope":            "ALTER TABLE scenario_rebates ADD COLUMN scope TEXT NOT NULL DEFAULT 'all';",
    "kind":             "ALTER TABLE scenario_rebates ADD COLUMN kind TEXT NOT NULL DEFAULT 'percent';",
    "basis":            "ALTER TABLE scenario_rebates ADD COLUMN basis TEXT NOT NULL DEFAULT 'revenue';",
    "product_id":       "ALTER TABLE scenario_rebates ADD COLUMN product_id INTEGER;",
    "valid_from_year":  "ALTER TABLE scenario_rebates ADD COLUMN valid_from_year INTEGER;",
    "valid_from_month": "ALTER TABLE scenario_rebates ADD COLUMN valid_from_month INTEGER;",
    "valid_to_year":    "ALTER TABLE scenario_rebates ADD COLUMN valid_to_year INTEGER;",
    "valid_to_month":   "ALTER TABLE scenario_rebates ADD COLUMN valid_to_month INTEGER;",
    "accrual_method":   "ALTER TABLE scenario_rebates ADD COLUMN accrual_method TEXT NOT NULL DEFAULT 'monthly';",
    "pay_month_lag":    "ALTER TABLE scenario_rebates ADD COLUMN pay_month_lag INTEGER DEFAULT 0;",
    "is_active":        "ALTER TABLE scenario_rebates ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;",
    "notes":            "ALTER TABLE scenario_rebates ADD COLUMN notes TEXT;",
    "created_at":       "ALTER TABLE scenario_rebates ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'));",
    "updated_at":       "ALTER TABLE scenario_rebates ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));",
}

REBATES_UPDATED_TRG = """
CREATE TRIGGER IF NOT EXISTS trg_scnr_rebates_updated
AFTER UPDATE ON scenario_rebates
BEGIN
  UPDATE scenario_rebates SET updated_at = datetime('now') WHERE id = OLD.id;
END;
"""

# Tiers (kademeli kurallar). percent VEYA amount sunar; ikisi birden zorunlu değil.
TIERS_CREATE = """
CREATE TABLE IF NOT EXISTS scenario_rebate_tiers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rebate_id   INTEGER NOT NULL REFERENCES scenario_rebates(id) ON DELETE CASCADE,

  -- Eşikler: min <= x < max (max NULL ise sonsuz)
  min_value   NUMERIC NOT NULL DEFAULT 0,
  max_value   NUMERIC,

  -- Sonuç: yüzdelik veya sabit tutar (basis'e göre revenue/volume)
  percent     NUMERIC,   -- örn. 5.0 => %5
  amount      NUMERIC,   -- örn. 10 => 10 USD / 10 birim başına

  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,

  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),

  CHECK (percent IS NOT NULL OR amount IS NOT NULL)
);
"""

TIERS_UPDATED_TRG = """
CREATE TRIGGER IF NOT EXISTS trg_scnr_rebate_tiers_updated
AFTER UPDATE ON scenario_rebate_tiers
BEGIN
  UPDATE scenario_rebate_tiers SET updated_at = datetime('now') WHERE id = OLD.id;
END;
"""

# Dönemsel toplu (lump-sum) ödemeler. Yıllık/çeyreklik/aylık kullanılabilir.
LUMPS_CREATE = """
CREATE TABLE IF NOT EXISTS scenario_rebate_lumps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rebate_id   INTEGER NOT NULL REFERENCES scenario_rebates(id) ON DELETE CASCADE,

  year        INTEGER NOT NULL,
  month       INTEGER NOT NULL,  -- 1..12
  amount      NUMERIC NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'USD',

  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),

  CHECK (month >= 1 AND month <= 12)
);
"""

LUMPS_UPDATED_TRG = """
CREATE TRIGGER IF NOT EXISTS trg_scnr_rebate_lumps_updated
AFTER UPDATE ON scenario_rebate_lumps
BEGIN
  UPDATE scenario_rebate_lumps SET updated_at = datetime('now') WHERE id = OLD.id;
END;
"""

# -----------------------------------------------------------------------------
# Drops
# -----------------------------------------------------------------------------
DROP_SQL = """
PRAGMA foreign_keys = OFF;

DROP TRIGGER IF EXISTS trg_scnr_rebate_lumps_updated;
DROP TABLE   IF EXISTS scenario_rebate_lumps;

DROP TRIGGER IF EXISTS trg_scnr_rebate_tiers_updated;
DROP TABLE   IF EXISTS scenario_rebate_tiers;

DROP TRIGGER IF EXISTS trg_scnr_rebates_updated;
DROP TABLE   IF EXISTS scenario_rebates;

PRAGMA foreign_keys = ON;
"""

# -----------------------------------------------------------------------------
# Indexes
# -----------------------------------------------------------------------------
def ensure_indexes(cx: sqlite3.Connection) -> None:
    ensure_index(cx, "ix_rebates_scenario", "CREATE INDEX ix_rebates_scenario ON scenario_rebates(scenario_id);")
    ensure_index(cx, "ix_rebates_active",   "CREATE INDEX ix_rebates_active   ON scenario_rebates(is_active);")
    ensure_index(cx, "ix_rebates_period",
                 "CREATE INDEX ix_rebates_period ON scenario_rebates(valid_from_year, valid_from_month, valid_to_year, valid_to_month);")

    ensure_index(cx, "ix_tiers_rebate",     "CREATE INDEX ix_tiers_rebate ON scenario_rebate_tiers(rebate_id, sort_order);")
    ensure_index(cx, "ix_tiers_range",      "CREATE INDEX ix_tiers_range  ON scenario_rebate_tiers(min_value, max_value);")

    ensure_index(cx, "ix_lumps_rebate",     "CREATE INDEX ix_lumps_rebate ON scenario_rebate_lumps(rebate_id);")
    ensure_index(cx, "ix_lumps_period",     "CREATE INDEX ix_lumps_period ON scenario_rebate_lumps(year, month);")

# -----------------------------------------------------------------------------
# Seed data
# -----------------------------------------------------------------------------
SEED_SQL = """
-- Basit % of revenue (aylık tahakkuk)
INSERT INTO scenario_rebates (scenario_id, name, scope, kind, basis, accrual_method, is_active, notes)
VALUES (1, 'Std Rebate %5', 'all', 'percent', 'revenue', 'monthly', 1, 'Global %5 rebate');

-- Tiered: revenue bazlı kademeler
INSERT INTO scenario_rebates (scenario_id, name, scope, kind, basis, accrual_method, is_active, notes)
VALUES (1, 'Tiered Annual', 'all', 'tier_percent', 'revenue', 'annual', 1, 'Annual tiers based on revenue');

INSERT INTO scenario_rebate_tiers (rebate_id, min_value, max_value, percent, sort_order, description)
SELECT id, 0,     100000, 2.0,  1, '0..100k  → %2'  FROM scenario_rebates WHERE name='Tiered Annual';
INSERT INTO scenario_rebate_tiers (rebate_id, min_value, max_value, percent, sort_order, description)
SELECT id, 100000, 250000, 3.5,  2, '100k..250k → %3.5' FROM scenario_rebates WHERE name='Tiered Annual';
INSERT INTO scenario_rebate_tiers (rebate_id, min_value, max_value, percent, sort_order, description)
SELECT id, 250000, NULL,   5.0,  3, '>250k → %5' FROM scenario_rebates WHERE name='Tiered Annual';

-- Lump-sum örneği (yıl sonu ödemesi)
INSERT INTO scenario_rebates (scenario_id, name, scope, kind, basis, accrual_method, is_active, notes)
VALUES (1, 'Year-End Bonus', 'all', 'lump_sum', 'revenue', 'annual', 1, 'Year end fixed bonus');

INSERT INTO scenario_rebate_lumps (rebate_id, year, month, amount, currency, note)
SELECT id, 2025, 12, 10000, 'USD', 'Annual lump' FROM scenario_rebates WHERE name='Year-End Bonus';
"""

# -----------------------------------------------------------------------------
# Ensure/Upgrade
# -----------------------------------------------------------------------------
def ensure_rebates(cx: sqlite3.Connection) -> None:
    if not table_exists(cx, "scenario_rebates"):
        print("[+] Creating scenario_rebates…")
        cx.executescript(REBATES_CREATE)
    else:
        print("[=] scenario_rebates exists. Checking columns…")
        cols = column_names(cx, "scenario_rebates")
        for col, sql in REBATES_ADD_COL.items():
            if col not in cols:
                print(f"[+] Adding scenario_rebates.{col}")
                cx.execute(sql)
    ensure_trigger(cx, "trg_scnr_rebates_updated", REBATES_UPDATED_TRG)

def ensure_tiers(cx: sqlite3.Connection) -> None:
    if not table_exists(cx, "scenario_rebate_tiers"):
        print("[+] Creating scenario_rebate_tiers…")
        cx.executescript(TIERS_CREATE)
    ensure_trigger(cx, "trg_scnr_rebate_tiers_updated", TIERS_UPDATED_TRG)

def ensure_lumps(cx: sqlite3.Connection) -> None:
    if not table_exists(cx, "scenario_rebate_lumps"):
        print("[+] Creating scenario_rebate_lumps…")
        cx.executescript(LUMPS_CREATE)
    ensure_trigger(cx, "trg_scnr_rebate_lumps_updated", LUMPS_UPDATED_TRG)

def drop_rebates_schema(cx: sqlite3.Connection) -> None:
    print("[!] Dropping rebates schema…")
    cx.executescript(DROP_SQL)

def print_summary(cx: sqlite3.Connection) -> None:
    def _print_cols(tbl: str):
        print(f"\n=== {tbl} columns ===")
        for row in cx.execute(f"PRAGMA table_info({tbl});"):
            print(f"- {row[1]:22} | {row[2]:10} | notnull={row[3]} | default={row[4]!r} | pk={row[5]}")
        cnt = cx.execute(f"SELECT COUNT(*) FROM {tbl};").fetchone()[0]
        print(f"[✓] {tbl} ready. Row count: {cnt}")

    for t in ("scenario_rebates", "scenario_rebate_tiers", "scenario_rebate_lumps"):
        if table_exists(cx, t):
            _print_cols(t)
        else:
            print(f"[!] {t} not found.")

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Upgrade Scenario Rebates schema (SQLite)")
    ap.add_argument("--db", type=Path, default=DB_PATH, help=f"DB path (default: {DB_PATH})")
    ap.add_argument("--seed", action="store_true", help="Örnek veri yükle")
    ap.add_argument("--drop", action="store_true", help="Yalnız rebates şemasını temizle")
    args = ap.parse_args()

    print(f"[i] Using DB = {args.db}")
    cx = sqlite3.connect(str(args.db))
    cx.execute("PRAGMA foreign_keys = ON;")

    try:
        if args.drop:
            drop_rebates_schema(cx)
            cx.commit()
            print("[✓] Dropped.")
            return

        # Senaryolar tablosu var mı, en azından uyarı verelim
        if not table_exists(cx, "scenarios"):
            print("[WARN] 'scenarios' table not found. FKs may fail later if schema differs.", file=sys.stderr)

        ensure_rebates(cx)
        ensure_tiers(cx)
        ensure_lumps(cx)
        ensure_indexes(cx)

        if args.seed:
            print("[+] Seeding sample data…")
            cx.executescript(SEED_SQL)

        cx.commit()
        print_summary(cx)
    except Exception as e:
        cx.rollback()
        print(f"[ERROR] {e}", file=sys.stderr)
        raise
    finally:
        cx.close()

if __name__ == "__main__":
    main()
