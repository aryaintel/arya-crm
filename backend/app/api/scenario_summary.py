# backend/app/api/scenario_summary.py
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Literal, Optional, Tuple
import sqlite3

from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/scenarios", tags=["scenario-summary"])

DB_PATH = Path(__file__).resolve().parents[2] / "app.db"

def _db() -> sqlite3.Connection:
    cx = sqlite3.connect(str(DB_PATH))
    cx.row_factory = sqlite3.Row
    cx.execute("PRAGMA foreign_keys = ON;")
    return cx

# ---------- small utils ----------
def _parse_ym(ym: str) -> Tuple[int, int]:
    try:
        y, m = ym.split("-", 1)
        y, m = int(y), int(m)
        if not (1 <= m <= 12):
            raise ValueError
        return y, m
    except Exception:
        raise HTTPException(400, f"Invalid ym='{ym}', expected YYYY-MM")

def _ym_add(y: int, m: int, k: int) -> Tuple[int, int]:
    base = y * 12 + (m - 1) + k
    return base // 12, base % 12 + 1

def _months_between(y0: int, m0: int, y1: int, m1: int) -> int:
    return (y1 * 12 + (m1 - 1)) - (y0 * 12 + (m0 - 1)) + 1

def _ym_key(y: int, m: int) -> str:
    return f"{y:04d}-{m:02d}"

def _table_has_column(cx: sqlite3.Connection, table: str, col: str) -> bool:
    rows = cx.execute(f"PRAGMA table_info({table});").fetchall()
    cols = {str(r["name"]).lower() for r in rows}
    return col.lower() in cols

# ---------- rebates models ----------
@dataclass
class RebateDef:
    id: int
    scope: Literal["all", "boq", "services", "product"]
    kind: Literal["percent", "tier_percent", "lump_sum"]
    basis: Literal["revenue", "volume", "gross_margin"]
    product_id: Optional[int]
    valid_from_year: Optional[int]
    valid_from_month: Optional[int]
    valid_to_year: Optional[int]
    valid_to_month: Optional[int]
    accrual_method: Literal["monthly", "quarterly", "annual", "on_invoice"]
    pay_month_lag: int
    is_active: int
    name: str

@dataclass
class RebateTier:
    min_value: float
    max_value: Optional[float]
    percent: Optional[float]
    amount: Optional[float]
    sort_order: int

@dataclass
class RebateLump:
    year: int
    month: int
    amount: float

# ---------- rebates helpers ----------
def _is_within_validity(r: RebateDef, y: int, m: int) -> bool:
    if r.valid_from_year and r.valid_from_month:
        if (y * 12 + (m - 1)) < (r.valid_from_year * 12 + (r.valid_from_month - 1)):
            return False
    if r.valid_to_year and r.valid_to_month:
        if (y * 12 + (m - 1)) > (r.valid_to_year * 12 + (r.valid_to_month - 1)):
            return False
    return True

def _resolve_percent_for_value(tiers: List[RebateTier], value: float) -> float:
    for t in tiers:
        lo = t.min_value
        hi = t.max_value if t.max_value is not None else float("inf")
        if lo <= value < hi and t.percent is not None:
            return float(t.percent)
    # fallback: last open-ended tier with percent
    for t in reversed(tiers):
        if t.max_value is None and t.percent is not None and value >= t.min_value:
            return float(t.percent)
    return 0.0

# ---------- main endpoint ----------
@router.get("/{scenario_id}/summary")
def get_summary(
    scenario_id: int,
    frm: str = Query(..., alias="from"),
    to: str = Query(...),
    mode: Literal["monthly", "ytd"] = Query("monthly"),
) -> Dict[str, object]:
    """
    Robust monthly summary:
      * BOQ Revenue/COGS schedule
      * Rebates overlay (basis=revenue; scope: all/boq/product[*])
      * Services/Overheads/Depr./FX/Tax placeholders = 0 (for now)
    NOTE: If 'scenario_boq_items.product_id' column does not exist,
          product-scoped rebates contribute 0 instead of erroring.
    """
    y0, m0 = _parse_ym(frm)
    y1, m1 = _parse_ym(to)
    if (y1 * 12 + (m1 - 1)) < (y0 * 12 + (m0 - 1)):
        raise HTTPException(400, "to < from")

    with _db() as cx:
        # 0) feature-detect product_id on BOQ
        has_pid = _table_has_column(cx, "scenario_boq_items", "product_id")

        # 1) initialize month rows
        n = _months_between(y0, m0, y1, m1)
        rows: Dict[str, Dict[str, float]] = {}
        for i in range(n):
            y, m = _ym_add(y0, m0, i)
            rows[_ym_key(y, m)] = {
                "revenue_boq": 0.0, "services_rev": 0.0, "rebates_contra": 0.0,
                "cogs_boq": 0.0, "services_cogs": 0.0,
                "overheads": 0.0, "capex_depr": 0.0, "fx": 0.0, "tax": 0.0,
            }

        # per-month per-product revenue (only if has_pid)
        prod_rev: Dict[str, Dict[int, float]] = {}

        # 2) load BOQ
        select_cols = """
            id, quantity, unit_price, unit_cogs, frequency, months, start_year, start_month, is_active
        """
        if has_pid:
            select_cols = select_cols + ", product_id"
        boq = cx.execute(
            f"SELECT {select_cols} FROM scenario_boq_items WHERE scenario_id = ?",
            (scenario_id,),
        ).fetchall()

        for r in boq:
            if int(r["is_active"] or 0) != 1:
                continue
            sy, sm = r["start_year"], r["start_month"]
            if sy is None or sm is None:
                continue

            freq = (r["frequency"] or "once").lower()
            span = int(r["months"] or 1)
            qty = float(r["quantity"] or 0)
            unit_price = float(r["unit_price"] or 0)
            unit_cogs = float(r["unit_cogs"] or 0)
            line_rev = qty * unit_price
            line_cogs = qty * unit_cogs
            pid = int(r["product_id"]) if has_pid and (r["product_id"] is not None) else None

            def _apply(year: int, month: int):
                key = _ym_key(year, month)
                if key not in rows:
                    return
                rows[key]["revenue_boq"] += line_rev
                rows[key]["cogs_boq"] += line_cogs
                if has_pid and pid is not None:
                    d = prod_rev.setdefault(key, {})
                    d[pid] = d.get(pid, 0.0) + line_rev

            if freq == "monthly":
                for k in range(max(1, span)):
                    y, m = _ym_add(int(sy), int(sm), k)
                    _apply(y, m)
            else:
                _apply(int(sy), int(sm))

        # 3) load rebates
        rebates_rows = cx.execute(
            """
            SELECT id, name,
                   COALESCE(scope,'all') as scope,
                   kind,
                   COALESCE(basis,'revenue') as basis,
                   product_id,
                   valid_from_year, valid_from_month,
                   valid_to_year, valid_to_month,
                   COALESCE(accrual_method,'monthly') as accrual_method,
                   COALESCE(pay_month_lag,0) as pay_month_lag,
                   COALESCE(is_active,1) as is_active
            FROM scenario_rebates
            WHERE scenario_id = ?
            """,
            (scenario_id,),
        ).fetchall()

        rebates: List[RebateDef] = []
        for r in rebates_rows:
            rebates.append(
                RebateDef(
                    id=int(r["id"]),
                    name=str(r["name"] or ""),
                    scope=str(r["scope"]).lower(),  # type: ignore
                    kind=str(r["kind"]).lower(),    # type: ignore
                    basis=str(r["basis"]).lower(),  # type: ignore
                    product_id=int(r["product_id"]) if r["product_id"] is not None else None,
                    valid_from_year=int(r["valid_from_year"]) if r["valid_from_year"] is not None else None,
                    valid_from_month=int(r["valid_from_month"]) if r["valid_from_month"] is not None else None,
                    valid_to_year=int(r["valid_to_year"]) if r["valid_to_year"] is not None else None,
                    valid_to_month=int(r["valid_to_month"]) if r["valid_to_month"] is not None else None,
                    accrual_method=str(r["accrual_method"]).lower(),  # type: ignore
                    pay_month_lag=int(r["pay_month_lag"] or 0),
                    is_active=int(r["is_active"] or 0),
                )
            )

        # tiers
        tiers_map: Dict[int, List[RebateTier]] = {}
        rows_tiers = cx.execute(
            """
            SELECT rebate_id, min_value, max_value, percent, amount, COALESCE(sort_order,0) as sort_order
            FROM scenario_rebate_tiers
            WHERE rebate_id IN (SELECT id FROM scenario_rebates WHERE scenario_id = ?)
            ORDER BY sort_order ASC, id ASC
            """,
            (scenario_id,),
        ).fetchall()
        for r in rows_tiers:
            tiers_map.setdefault(int(r["rebate_id"]), []).append(
                RebateTier(
                    min_value=float(r["min_value"] or 0),
                    max_value=float(r["max_value"]) if r["max_value"] is not None else None,
                    percent=float(r["percent"]) if r["percent"] is not None else None,
                    amount=float(r["amount"]) if r["amount"] is not None else None,
                    sort_order=int(r["sort_order"] or 0),
                )
            )

        # lumps
        lumps_map: Dict[int, List[RebateLump]] = {}
        rows_lumps = cx.execute(
            """
            SELECT rebate_id, year, month, amount
            FROM scenario_rebate_lumps
            WHERE rebate_id IN (SELECT id FROM scenario_rebates WHERE scenario_id = ?)
            """,
            (scenario_id,),
        ).fetchall()
        for r in rows_lumps:
            lumps_map.setdefault(int(r["rebate_id"]), []).append(
                RebateLump(
                    year=int(r["year"]), month=int(r["month"]), amount=float(r["amount"] or 0)
                )
            )

        # 4) apply rebates per month
        ytd_basis: Dict[int, float] = {}
        for i in range(n):
            y, m = _ym_add(y0, m0, i)
            key = _ym_key(y, m)
            rrow = rows[key]

            for rb in rebates:
                if rb.is_active != 1 or not _is_within_validity(rb, y, m):
                    continue
                if rb.basis != "revenue":
                    continue  # current release

                # basis value
                basis_val = 0.0
                if rb.scope in ("all", "boq"):
                    basis_val = rrow["revenue_boq"]
                elif rb.scope == "product":
                    # only if product_id exists on BOQ table and we tracked product revenue
                    if has_pid and rb.product_id is not None:
                        basis_val = prod_rev.get(key, {}).get(int(rb.product_id), 0.0)
                    else:
                        basis_val = 0.0
                elif rb.scope == "services":
                    basis_val = 0.0  # placeholder

                accrual = 0.0
                if rb.kind in ("percent", "tier_percent"):
                    pct = 0.0
                    tiers = tiers_map.get(rb.id, [])
                    if rb.kind == "percent":
                        # use first tier.percent if present
                        for t in tiers:
                            if t.percent is not None:
                                pct = float(t.percent)
                                break
                    else:
                        # tier_percent
                        if mode == "ytd":
                            prev = ytd_basis.get(rb.id, 0.0)
                            cum = prev + basis_val
                            ytd_basis[rb.id] = cum
                            pct = _resolve_percent_for_value(tiers, cum)
                        else:
                            pct = _resolve_percent_for_value(tiers, basis_val)

                    accrual = - basis_val * (pct / 100.0)

                elif rb.kind == "lump_sum":
                    for l in lumps_map.get(rb.id, []):
                        if l.year == y and l.month == m:
                            accrual += -float(l.amount or 0.0)

                if accrual:
                    rrow["rebates_contra"] += accrual

        # 5) build response
        out_items: List[Dict[str, object]] = []
        for i in range(n):
            y, m = _ym_add(y0, m0, i)
            key = _ym_key(y, m)
            r = rows[key]
            total_rev = r["revenue_boq"] + r["services_rev"] + r["rebates_contra"]
            total_cogs = r["cogs_boq"] + r["services_cogs"]
            gm = total_rev - total_cogs
            net = gm - r["overheads"] - r["capex_depr"] + r["fx"] - r["tax"]

            out_items.append(
                {
                    "ym": key,
                    "revenue_boq": round(r["revenue_boq"], 2),
                    "services_rev": round(r["services_rev"], 2),
                    "rebates_contra": round(r["rebates_contra"], 2),
                    "cogs_boq": round(r["cogs_boq"], 2),
                    "services_cogs": round(r["services_cogs"], 2),
                    "overheads": round(r["overheads"], 2),
                    "capex_depr": round(r["capex_depr"], 2),
                    "fx": round(r["fx"], 2),
                    "tax": round(r["tax"], 2),
                    "gm": round(gm, 2),
                    "net": round(net, 2),
                }
            )

        return {
            "scenario_id": scenario_id,
            "from": frm,
            "to": to,
            "mode": mode,
            "items": out_items,
            "notes": [
                "Product-scoped rebates are applied only if scenario_boq_items.product_id column exists.",
                "Services/Overheads/Deprec./FX/Tax are placeholders (0) in this release.",
            ],
        }
