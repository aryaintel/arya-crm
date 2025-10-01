# [BEGIN FILE] backend/app/api/rebates_runtime.py
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Literal, Optional, Tuple
import sqlite3
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/scenarios", tags=["rebates-preview"])

# Resolve DB (align with other sqlite-based APIs like service_pricing/boq_pricing)
DB_PATH = Path(__file__).resolve().parents[2] / "app.db"

def _db() -> sqlite3.Connection:
    cx = sqlite3.connect(str(DB_PATH))
    cx.row_factory = sqlite3.Row
    cx.execute("PRAGMA foreign_keys = ON;")
    return cx

# ----------------- Time helpers -----------------

def _parse_ym(ym: str) -> Tuple[int, int]:
    # "YYYY-MM"
    try:
        y, m = ym.split("-", 1)
        year, month = int(y), int(m)
        if not (1 <= month <= 12):
            raise ValueError
        return year, month
    except Exception:
        raise HTTPException(400, f"Invalid ym='{ym}', expected YYYY-MM")

def _ym_add(y: int, m: int, k: int) -> Tuple[int, int]:
    base = (y * 12 + (m - 1)) + k
    ny = base // 12
    nm = base % 12 + 1
    return ny, nm

def _months_between(y0: int, m0: int, y1: int, m1: int) -> int:
    # inclusive months count
    return (y1 * 12 + (m1 - 1)) - (y0 * 12 + (m0 - 1)) + 1

def _ym_key(y: int, m: int) -> str:
    return f"{y:04d}-{m:02d}"

# ----------------- Domain models -----------------

@dataclass
class RebateDef:
    id: int
    scenario_id: int
    name: str
    scope: Literal["all", "boq", "services", "product"]
    kind: Literal["percent", "tier_percent", "lump_sum"]
    basis: Literal["revenue", "gross_margin", "volume"]
    product_id: Optional[int]
    valid_from_year: Optional[int]
    valid_from_month: Optional[int]
    valid_to_year: Optional[int]
    valid_to_month: Optional[int]
    accrual_method: Literal["monthly", "quarterly", "annual", "on_invoice"]
    pay_month_lag: int
    is_active: int

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
    description: Optional[str]

# ----------------- Loaders -----------------

def _load_rebates(cx: sqlite3.Connection, scenario_id: int) -> List[RebateDef]:
    rows = cx.execute(
        """
        SELECT id, scenario_id, name, scope, kind, COALESCE(basis,'revenue') as basis,
               product_id, valid_from_year, valid_from_month, valid_to_year, valid_to_month,
               COALESCE(accrual_method,'monthly') as accrual_method,
               COALESCE(pay_month_lag,0) as pay_month_lag,
               COALESCE(is_active,1) as is_active
        FROM scenario_rebates
        WHERE scenario_id = ?
        """,
        (scenario_id,),
    ).fetchall()
    out: List[RebateDef] = []
    for r in rows:
        out.append(
            RebateDef(
                id=int(r["id"]),
                scenario_id=int(r["scenario_id"]),
                name=str(r["name"]),
                scope=str(r["scope"]).lower() if r["scope"] else "all",  # type: ignore
                kind=str(r["kind"]).lower(),  # type: ignore
                basis=str(r["basis"]).lower(),  # type: ignore
                product_id=int(r["product_id"]) if r["product_id"] is not None else None,
                valid_from_year=int(r["valid_from_year"]) if r["valid_from_year"] is not None else None,
                valid_from_month=int(r["valid_from_month"]) if r["valid_from_month"] is not None else None,
                valid_to_year=int(r["valid_to_year"]) if r["valid_to_year"] is not None else None,
                valid_to_month=int(r["valid_to_month"]) if r["valid_to_month"] is not None else None,
                accrual_method=str(r["accrual_method"]).lower(),  # type: ignore
                pay_month_lag=int(r["pay_month_lag"]) if r["pay_month_lag"] is not None else 0,
                is_active=int(r["is_active"] or 0),
            )
        )
    return out

def _load_tiers(cx: sqlite3.Connection, rebate_id: int) -> List[RebateTier]:
    rows = cx.execute(
        """
        SELECT min_value, max_value, percent, amount, COALESCE(sort_order,0) as sort_order
        FROM scenario_rebate_tiers
        WHERE rebate_id = ?
        ORDER BY sort_order ASC, id ASC
        """,
        (rebate_id,),
    ).fetchall()
    out: List[RebateTier] = []
    for r in rows:
        out.append(
            RebateTier(
                min_value=float(r["min_value"] or 0),
                max_value=float(r["max_value"]) if r["max_value"] is not None else None,
                percent=float(r["percent"]) if r["percent"] is not None else None,
                amount=float(r["amount"]) if r["amount"] is not None else None,
                sort_order=int(r["sort_order"] or 0),
            )
        )
    return out

def _load_lumps(cx: sqlite3.Connection, rebate_id: int) -> List[RebateLump]:
    rows = cx.execute(
        """
        SELECT year, month, amount, description
        FROM scenario_rebate_lumps
        WHERE rebate_id = ?
        ORDER BY year ASC, month ASC, id ASC
        """,
        (rebate_id,),
    ).fetchall()
    out: List[RebateLump] = []
    for r in rows:
        out.append(
            RebateLump(
                year=int(r["year"]),
                month=int(r["month"]),
                amount=float(r["amount"] or 0),
                description=(r["description"] if r["description"] is not None else None),
            )
        )
    return out

# ----------------- Basis computation (first pass = BOQ revenue) -----------------

def _basis_revenue_boq(cx: sqlite3.Connection, scenario_id: int, y: int, m: int, product_id: Optional[int]) -> float:
    """
    Approximate revenue basis from BOQ static fields (quantity * unit_price).
    Respect start_year/month and frequency/months similar to FE P&L tab.
    This will be upgraded to dynamic price previews (formulation + escalation) later.
    """
    # Pull active BOQ items
    rows = cx.execute(
        """
        SELECT id, quantity, unit_price, unit_cogs, frequency, months, start_year, start_month, product_id, is_active
        FROM scenario_boq_items
        WHERE scenario_id = ?
        """,
        (scenario_id,),
    ).fetchall()

    total = 0.0
    for r in rows:
        if (r["is_active"] or 0) != 1:
            continue
        sy = r["start_year"]; sm = r["start_month"]
        if sy is None or sm is None:
            continue

        # is this row active at (y,m)?
        freq = (r["frequency"] or "once").lower()
        months = int(r["months"] or 1)

        # optional product filter
        if product_id is not None:
            pid = r["product_id"]
            if pid is None or int(pid) != int(product_id):
                continue

        # schedule membership
        in_month = False
        if freq == "monthly":
            # month index k: 0 .. months-1
            # check if (y,m) lies within that span
            start_idx = sy * 12 + (sm - 1)
            cur_idx = y * 12 + (m - 1)
            in_month = 0 <= (cur_idx - start_idx) < max(1, months)
        else:
            # once/per_shipment/per_tonne → treat as single charge at start month
            in_month = (y == sy and m == sm)

        if in_month:
            qty = float(r["quantity"] or 0)
            unit_price = float(r["unit_price"] or 0)
            total += qty * unit_price

    return total

def _basis_value(
    cx: sqlite3.Connection,
    scenario_id: int,
    rebate: RebateDef,
    y: int,
    m: int,
) -> float:
    """
    Compute basis value for one month and rebate.
    Supported today:
      - basis=revenue with scope in {all, boq, product}
    Placeholders (return 0 for now): services scope, basis in {gross_margin, volume}
    """
    if rebate.basis != "revenue":
        return 0.0

    if rebate.scope in ("all", "boq"):
        return _basis_revenue_boq(cx, scenario_id, y, m, rebate.product_id)
    elif rebate.scope == "product":
        return _basis_revenue_boq(cx, scenario_id, y, m, rebate.product_id)
    elif rebate.scope == "services":
        # TODO: implement services revenue basis using services_price preview or static fields
        return 0.0
    return 0.0

# ----------------- Validity -----------------

def _is_within_validity(rebate: RebateDef, y: int, m: int) -> bool:
    if rebate.valid_from_year is not None and rebate.valid_from_month is not None:
        y0, m0 = rebate.valid_from_year, rebate.valid_from_month
        if (y * 12 + (m - 1)) < (y0 * 12 + (m0 - 1)):
            return False
    if rebate.valid_to_year is not None and rebate.valid_to_month is not None:
        y1, m1 = rebate.valid_to_year, rebate.valid_to_month
        if (y * 12 + (m - 1)) > (y1 * 12 + (m1 - 1)):
            return False
    return True

# ----------------- Tier resolution -----------------

def _resolve_percent_for_value(tiers: List[RebateTier], value: float) -> Optional[float]:
    """
    Return the 'percent' matching the given value using [min, max) semantics.
    If multiple tiers qualify, first by sort_order.
    """
    for t in tiers:
        lo = t.min_value
        hi = t.max_value if t.max_value is not None else float("inf")
        if lo <= value < hi:
            return float(t.percent or 0.0) if t.percent is not None else None
    # if no max bound tiers matched, try the last tier that has percent and no max
    for t in reversed(tiers):
        if t.max_value is None and t.percent is not None:
            if value >= t.min_value:
                return float(t.percent)
    return None

# ----------------- Main logic -----------------

@router.get("/{scenario_id}/rebates/preview")
def rebates_preview(
    scenario_id: int,
    frm: str = Query(..., alias="from", description="Start month (YYYY-MM), inclusive"),
    to: str = Query(..., description="End month (YYYY-MM), inclusive"),
    mode: Literal["monthly", "ytd"] = Query("monthly", description="Tier evaluation mode"),
    include_breakdown: bool = Query(False, description="Include per-rebate breakdown"),
) -> Dict[str, object]:
    """
    Return monthly rebate accruals (contra revenue) and simple cash timing.
    NOTE: First release focuses on basis=revenue and scope in {all,boq,product}.
          Services scope and GM/Volume bases are placeholders for now.
    """
    y0, m0 = _parse_ym(frm)
    y1, m1 = _parse_ym(to)
    if (y1 * 12 + (m1 - 1)) < (y0 * 12 + (m0 - 1)):
        raise HTTPException(400, "to < from")

    with _db() as cx:
        rebates = [r for r in _load_rebates(cx, scenario_id) if r.is_active == 1]
        # Preload tiers/lumps per rebate
        tiers_map: Dict[int, List[RebateTier]] = {}
        lumps_map: Dict[int, List[RebateLump]] = {}
        for r in rebates:
            if r.kind in ("percent", "tier_percent"):
                tiers_map[r.id] = _load_tiers(cx, r.id)
            elif r.kind == "lump_sum":
                lumps_map[r.id] = _load_lumps(cx, r.id)

        months = _months_between(y0, m0, y1, m1)
        # Accumulators
        out_rows: List[Dict[str, object]] = []
        # cash schedule map for lag application
        cash_map: Dict[str, float] = {}
        # YTD accumulators per rebate id
        ytd_basis: Dict[int, float] = {}

        for i in range(months):
            y, m = _ym_add(y0, m0, i)
            ym = _ym_key(y, m)
            month_total = 0.0
            month_cash = 0.0
            brk: List[Dict[str, object]] = []

            for r in rebates:
                if not _is_within_validity(r, y, m):
                    continue

                accrual = 0.0
                cash = 0.0

                if r.kind in ("percent", "tier_percent"):
                    # compute basis for this month
                    basis_val = _basis_value(cx, scenario_id, r, y, m)

                    # choose percent
                    pct = 0.0
                    if r.kind == "percent":
                        # conventional: take first tier.percent
                        tiers = tiers_map.get(r.id, [])
                        pct = 0.0
                        if tiers:
                            # prefer first tier.percent, or 0
                            for t in tiers:
                                if t.percent is not None:
                                    pct = float(t.percent)
                                    break
                    else:
                        # tier_percent
                        tiers = tiers_map.get(r.id, [])
                        if mode == "monthly":
                            pct_resolved = _resolve_percent_for_value(tiers, basis_val)
                            pct = float(pct_resolved or 0.0)
                        else:
                            # YTD: evaluate against cumulative
                            prev = ytd_basis.get(r.id, 0.0)
                            cum = prev + basis_val
                            ytd_basis[r.id] = cum
                            pct_resolved = _resolve_percent_for_value(tiers, cum)
                            pct = float(pct_resolved or 0.0)
                            # NOTE: first release does not compute retro true-up; it applies the YTD tier to the current month only.

                    accrual = - (basis_val * (pct / 100.0))  # contra-revenue
                    # Accrual timing: for "on_invoice", we still accrue in-month; cash follows pay_month_lag
                    # Cash timing: apply lag (can be 0)
                    cash_target_y, cash_target_m = _ym_add(y, m, int(r.pay_month_lag or 0))
                    cash_key = _ym_key(cash_target_y, cash_target_m)
                    cash_map[cash_key] = cash_map.get(cash_key, 0.0) + accrual
                    cash = accrual

                elif r.kind == "lump_sum":
                    # pick lumps scheduled exactly at (y,m)
                    for l in lumps_map.get(r.id, []):
                        if l.year == y and l.month == m:
                            amount = -float(l.amount or 0.0)  # contra
                            accrual += amount
                            # cash with lag
                            cash_target_y, cash_target_m = _ym_add(y, m, int(r.pay_month_lag or 0))
                            cash_key = _ym_key(cash_target_y, cash_target_m)
                            cash_map[cash_key] = cash_map.get(cash_key, 0.0) + amount
                            cash += amount

                if accrual != 0.0 or include_breakdown:
                    month_total += accrual
                    month_cash += cash
                    if include_breakdown:
                        brk.append(
                            {
                                "rebate_id": r.id,
                                "name": r.name,
                                "kind": r.kind,
                                "basis": r.basis,
                                "scope": r.scope,
                                "accrual": round(accrual, 2),
                                "cash": round(cash, 2),
                            }
                        )

            # add any lagged cash from prior months
            month_cash += cash_map.get(ym, 0.0)

            out_rows.append(
                {
                    "ym": ym,
                    "accrual": round(month_total, 2),
                    "cash": round(month_cash, 2),
                    **({"breakdown": brk} if include_breakdown else {}),
                }
            )

        return {
            "scenario_id": scenario_id,
            "from": frm,
            "to": to,
            "mode": mode,
            "items": out_rows,
            "notes": [
                "First release: basis=revenue only; scope supported: all/boq/product; services=0 for now.",
                "YTD mode applies the resolved YTD tier to current-month basis (no retro true-up yet).",
                "Accruals are contra-revenue (negative). Cash timing respects pay_month_lag.",
            ],
        }
# [END FILE] backend/app/api/rebates_runtime.py
