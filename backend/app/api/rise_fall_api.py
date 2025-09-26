from __future__ import annotations

from pathlib import Path
from typing import List, Optional
import sqlite3
import re

from fastapi import APIRouter, HTTPException, Path as FPath, Body
from pydantic import BaseModel, Field, conint, confloat, root_validator, validator

# ------------------------------------------------------------------------------
# Router
# ------------------------------------------------------------------------------
router = APIRouter(prefix="/business-cases/scenarios", tags=["rise-fall"])

DB_PATH = Path(__file__).resolve().parents[2] / "app.db"


# ------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------
_YM_RE = re.compile(r"(?P<y>\d{4})[-/](?P<m>\d{1,2})")

def _to_float(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None

def _to_int(v):
    if v is None:
        return None
    if isinstance(v, int):
        return v
    s = str(v).strip()
    try:
        return int(s)
    except ValueError:
        return None


# ------------------------------------------------------------------------------
# Pydantic Schemas (FE ile uyumlu olacak şekilde isimler ve alanlar)
# ------------------------------------------------------------------------------
class RFComponentIn(BaseModel):
    index_series_id: int = Field(..., description="Selected global index series id")
    weight_pct: confloat(ge=0, le=100) = 100
    base_ref_year: conint(ge=1900, le=3000)
    base_ref_month: conint(ge=1, le=12)
    lag_m: conint(ge=0, le=120) = 0
    factor: confloat(ge=0) = 1.0
    cap_pct: Optional[confloat(ge=0)] = None
    floor_pct: Optional[confloat(ge=0)] = None
    sort_order: Optional[int] = None

    # FE farklı anahtarlar gönderebilir → normalize et
    @root_validator(pre=True)
    def _coerce_alt_keys(cls, values):
        # index_series_id: 'index_series', 'series_id'
        if values.get("index_series_id") is None:
            alt = values.get("index_series") or values.get("series_id")
            if alt is not None:
                values["index_series_id"] = _to_int(alt)

        # weight_pct: 'weight'
        if values.get("weight_pct") is None and values.get("weight") is not None:
            values["weight_pct"] = _to_float(values.get("weight"))

        # lag_m: 'lag'
        if values.get("lag_m") is None and values.get("lag") is not None:
            values["lag_m"] = _to_int(values.get("lag"))

        # cap_pct: 'cap'
        if values.get("cap_pct") is None and values.get("cap") is not None:
            values["cap_pct"] = _to_float(values.get("cap"))

        # floor_pct: 'floor'
        if values.get("floor_pct") is None and values.get("floor") is not None:
            values["floor_pct"] = _to_float(values.get("floor"))

        # base_ref_year / base_ref_month: 'base_ref' | 'base_ref_ym' | 'base' | 'baseRef'
        by = values.get("base_ref_year")
        bm = values.get("base_ref_month")
        if by is None or bm is None:
            alt = (
                values.get("base_ref")
                or values.get("base_ref_ym")
                or values.get("base")
                or values.get("baseRef")
            )
            if isinstance(alt, str):
                m = _YM_RE.search(alt)
                if m:
                    values["base_ref_year"] = int(m.group("y"))
                    values["base_ref_month"] = int(m.group("m"))
            elif isinstance(alt, int):
                y, m = divmod(alt, 100)
                values["base_ref_year"], values["base_ref_month"] = int(y), int(m)
            elif isinstance(alt, (list, tuple)) and len(alt) >= 2:
                values["base_ref_year"], values["base_ref_month"] = int(alt[0]), int(alt[1])

        # sayı alanlarını string gelirse dönüştür
        for k in ("weight_pct", "lag_m", "factor", "cap_pct", "floor_pct", "sort_order"):
            if k in values:
                if k in ("lag_m", "sort_order"):
                    values[k] = _to_int(values[k])
                else:
                    values[k] = _to_float(values[k])

        return values


class RiseFallPolicyIn(BaseModel):
    # Header (Formulation)
    frequency: str = Field(..., description="Annual | Quarterly | Monthly")
    compounding: str = Field(..., description="Simple | Compound")
    preview_months: conint(gt=0, le=240) = 36

    # FE bazen 'start'/'start_date' stringi yollar → normalize edeceğiz
    start_year: conint(ge=1900, le=3000)
    start_month: conint(ge=1, le=12)
    base_price: Optional[float] = None

    components: List[RFComponentIn] = Field(default_factory=list)

    @root_validator(pre=True)
    def _coerce_start_fields(cls, values):
        sy = values.get("start_year")
        sm = values.get("start_month")
        if sy is None or sm is None:
            alt = (
                values.get("start")
                or values.get("start_ym")
                or values.get("start_date")
                or values.get("startYYYYMM")
                or values.get("start_yyyymm")
                or values.get("startYm")
            )
            if isinstance(alt, str):
                m = _YM_RE.search(alt)
                if m:
                    values["start_year"] = int(m.group("y"))
                    values["start_month"] = int(m.group("m"))
            elif isinstance(alt, int):
                y, m = divmod(alt, 100)
                values["start_year"], values["start_month"] = int(y), int(m)
            elif isinstance(alt, (list, tuple)) and len(alt) >= 2:
                values["start_year"], values["start_month"] = int(alt[0]), int(alt[1])
        return values

    @validator("frequency")
    def _v_freq(cls, v: str) -> str:
        allowed = {"annual", "quarterly", "monthly"}
        if v.lower() not in allowed:
            raise ValueError(f"frequency must be one of {sorted(allowed)}")
        return v

    @validator("compounding")
    def _v_cmp(cls, v: str) -> str:
        allowed = {"simple", "compound"}
        if v.lower() not in allowed:
            raise ValueError(f"compounding must be one of {sorted(allowed)}")
        return v


class RFComponentOut(RFComponentIn):
    id: int


class RiseFallPolicyOut(BaseModel):
    id: int
    scenario_id: int
    scope: str  # 'service' | 'boq'
    scope_id: int
    frequency: str
    compounding: str
    preview_months: int
    start_year: int
    start_month: int
    base_price: Optional[float]
    components: List[RFComponentOut]


# ------------------------------------------------------------------------------
# DB Helpers
# ------------------------------------------------------------------------------
def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def _init_db():
    with _conn() as cx:
        cx.execute(
            """
            CREATE TABLE IF NOT EXISTS rise_fall_policy (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scenario_id INTEGER NOT NULL,
                scope TEXT NOT NULL,                 -- 'service' | 'boq'
                scope_id INTEGER NOT NULL,
                frequency TEXT NOT NULL,
                compounding TEXT NOT NULL,
                preview_months INTEGER NOT NULL,
                start_year INTEGER NOT NULL,
                start_month INTEGER NOT NULL,
                base_price REAL
            );
        """
        )
        cx.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_rfp_unique
            ON rise_fall_policy (scenario_id, scope, scope_id);
        """
        )
        cx.execute(
            """
            CREATE TABLE IF NOT EXISTS rise_fall_component (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                policy_id INTEGER NOT NULL,
                index_series_id INTEGER NOT NULL,
                weight_pct REAL NOT NULL,
                base_ref_year INTEGER NOT NULL,
                base_ref_month INTEGER NOT NULL,
                lag_m INTEGER NOT NULL DEFAULT 0,
                factor REAL NOT NULL DEFAULT 1.0,
                cap_pct REAL,
                floor_pct REAL,
                sort_order INTEGER,
                FOREIGN KEY(policy_id) REFERENCES rise_fall_policy(id) ON DELETE CASCADE
            );
        """
        )


_init_db()


def _row_to_policy_out(row: sqlite3.Row, comps: List[sqlite3.Row]) -> RiseFallPolicyOut:
    return RiseFallPolicyOut(
        id=row["id"],
        scenario_id=row["scenario_id"],
        scope=row["scope"],
        scope_id=row["scope_id"],
        frequency=row["frequency"],
        compounding=row["compounding"],
        preview_months=row["preview_months"],
        start_year=row["start_year"],
        start_month=row["start_month"],
        base_price=row["base_price"],
        components=[
            RFComponentOut(
                id=c["id"],
                index_series_id=c["index_series_id"],
                weight_pct=c["weight_pct"],
                base_ref_year=c["base_ref_year"],
                base_ref_month=c["base_ref_month"],
                lag_m=c["lag_m"],
                factor=c["factor"],
                cap_pct=c["cap_pct"],
                floor_pct=c["floor_pct"],
                sort_order=c["sort_order"],
            )
            for c in comps
        ],
    )


# ------------------------------------------------------------------------------
# Core upsert/get helpers
# ------------------------------------------------------------------------------
def _upsert_policy_and_replace_components(
    *, scenario_id: int, scope: str, scope_id: int, payload: RiseFallPolicyIn
) -> RiseFallPolicyOut:
    _init_db()
    with _conn() as cx:
        row = cx.execute(
            "SELECT id FROM rise_fall_policy WHERE scenario_id=? AND scope=? AND scope_id=?",
            (scenario_id, scope, scope_id),
        ).fetchone()

        if row is None:
            cx.execute(
                """
                INSERT INTO rise_fall_policy
                (scenario_id, scope, scope_id, frequency, compounding, preview_months, start_year, start_month, base_price)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    scenario_id, scope, scope_id,
                    payload.frequency, payload.compounding, payload.preview_months,
                    payload.start_year, payload.start_month, payload.base_price,
                ),
            )
            policy_id = cx.execute("SELECT last_insert_rowid() AS id;").fetchone()["id"]
        else:
            policy_id = row["id"]
            cx.execute(
                """
                UPDATE rise_fall_policy
                SET frequency=?, compounding=?, preview_months=?, start_year=?, start_month=?, base_price=?
                WHERE id=?;
                """,
                (
                    payload.frequency, payload.compounding, payload.preview_months,
                    payload.start_year, payload.start_month, payload.base_price, policy_id,
                ),
            )

        cx.execute("DELETE FROM rise_fall_component WHERE policy_id=?", (policy_id,))
        for i, comp in enumerate(payload.components):
            cx.execute(
                """
                INSERT INTO rise_fall_component
                (policy_id, index_series_id, weight_pct, base_ref_year, base_ref_month, lag_m, factor, cap_pct, floor_pct, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    policy_id,
                    comp.index_series_id,
                    float(comp.weight_pct),
                    comp.base_ref_year,
                    comp.base_ref_month,
                    int(comp.lag_m),
                    float(comp.factor),
                    float(comp.cap_pct) if comp.cap_pct is not None else None,
                    float(comp.floor_pct) if comp.floor_pct is not None else None,
                    comp.sort_order if comp.sort_order is not None else i,
                ),
            )

        pol = cx.execute("SELECT * FROM rise_fall_policy WHERE id=?", (policy_id,)).fetchone()
        comps = cx.execute(
            "SELECT * FROM rise_fall_component WHERE policy_id=? ORDER BY COALESCE(sort_order,0), id",
            (policy_id,),
        ).fetchall()
        return _row_to_policy_out(pol, comps)


def _get_policy(*, scenario_id: int, scope: str, scope_id: int) -> RiseFallPolicyOut:
    _init_db()
    with _conn() as cx:
        pol = cx.execute(
            "SELECT * FROM rise_fall_policy WHERE scenario_id=? AND scope=? AND scope_id=?",
            (scenario_id, scope, scope_id),
        ).fetchone()
        if pol is None:
            raise HTTPException(status_code=404, detail="Rise & Fall policy not found")
        comps = cx.execute(
            "SELECT * FROM rise_fall_component WHERE policy_id=? ORDER BY COALESCE(sort_order,0), id",
            (pol["id"],),
        ).fetchall()
        return _row_to_policy_out(pol, comps)


# ------------------------------------------------------------------------------
# SERVICE — PUT / GET
# ------------------------------------------------------------------------------
@router.put(
    "/{scenario_id}/rise-fall/service/{service_id}",
    response_model=RiseFallPolicyOut,
    summary="Upsert Rise & Fall policy for a Service row",
)
def upsert_service_rise_fall(
    scenario_id: int = FPath(..., ge=1),
    service_id: int = FPath(..., ge=1),
    payload: RiseFallPolicyIn = Body(...),
):
    return _upsert_policy_and_replace_components(
        scenario_id=scenario_id, scope="service", scope_id=service_id, payload=payload
    )


@router.get(
    "/{scenario_id}/rise-fall/service/{service_id}",
    response_model=RiseFallPolicyOut,
    summary="Get Rise & Fall policy for a Service row",
)
def get_service_rise_fall(
    scenario_id: int = FPath(..., ge=1),
    service_id: int = FPath(..., ge=1),
):
    return _get_policy(scenario_id=scenario_id, scope="service", scope_id=service_id)
