# backend/app/api/escalations_api.py
from pathlib import Path
from decimal import Decimal
from typing import Optional, List
import sqlite3

from fastapi import APIRouter, HTTPException, Query, Body
from pydantic import BaseModel, condecimal, validator

router = APIRouter(prefix="/api/escalations", tags=["escalations"])
DB_PATH = Path(__file__).resolve().parents[2] / "app.db"


# --------------- db ---------------
def _db() -> sqlite3.Connection:
    cx = sqlite3.connect(str(DB_PATH))
    cx.row_factory = sqlite3.Row
    cx.execute("PRAGMA foreign_keys = ON;")
    return cx


def _ensure_exists(cx: sqlite3.Connection, table: str, id_: int):
    r = cx.execute(f"SELECT id FROM {table} WHERE id=?", (id_,)).fetchone()
    if not r:
        raise HTTPException(404, f"{table} not found")


# --------------- schemas ---------------
FREQ_ALLOWED = {"monthly", "quarterly", "annual"}
COMP_ALLOWED = {"simple", "compound"}

class PolicyBase(BaseModel):
    name: str
    scope: Optional[str] = None

    # A) Rate-based
    rate_pct: Optional[condecimal(max_digits=9, decimal_places=6)] = None
    frequency: Optional[str] = None          # monthly|quarterly|annual
    compounding: Optional[str] = None        # simple|compound

    # B) Index-based (single index OR component blend)
    index_series_id: Optional[int] = None

    # Common
    start_year: int
    start_month: int
    cap_pct: Optional[condecimal(max_digits=9, decimal_places=6)] = None
    floor_pct: Optional[condecimal(max_digits=9, decimal_places=6)] = None

    @validator("frequency")
    def _freq_ok(cls, v):
        if v is None: return v
        v = v.lower()
        if v not in FREQ_ALLOWED:
            raise ValueError(f"frequency must be one of {sorted(FREQ_ALLOWED)}")
        return v

    @validator("compounding")
    def _comp_ok(cls, v):
        if v is None: return v
        v = v.lower()
        if v not in COMP_ALLOWED:
            raise ValueError(f"compounding must be one of {sorted(COMP_ALLOWED)}")
        return v

    @validator("start_month")
    def _mm_ok(cls, v):
        if not (1 <= v <= 12):
            raise ValueError("start_month must be 1..12")
        return v

    @validator("start_year")
    def _yy_ok(cls, v):
        if v < 1900 or v > 2300:
            raise ValueError("start_year looks invalid")
        return v

class PolicyCreate(PolicyBase):
    pass

class PolicyUpdate(BaseModel):
    name: Optional[str] = None
    scope: Optional[str] = None
    rate_pct: Optional[condecimal(max_digits=9, decimal_places=6)] = None
    frequency: Optional[str] = None
    compounding: Optional[str] = None
    index_series_id: Optional[int] = None
    start_year: Optional[int] = None
    start_month: Optional[int] = None
    cap_pct: Optional[condecimal(max_digits=9, decimal_places=6)] = None
    floor_pct: Optional[condecimal(max_digits=9, decimal_places=6)] = None

    @validator("frequency")
    def _freq_ok(cls, v):
        if v is None: return v
        v = v.lower()
        if v not in FREQ_ALLOWED:
            raise ValueError(f"frequency must be one of {sorted(FREQ_ALLOWED)}")
        return v

    @validator("compounding")
    def _comp_ok(cls, v):
        if v is None: return v
        v = v.lower()
        if v not in COMP_ALLOWED:
            raise ValueError(f"compounding must be one of {sorted(COMP_ALLOWED)}")
        return v

class ComponentIn(BaseModel):
    index_series_id: int
    weight_pct: condecimal(max_digits=9, decimal_places=4)
    base_index_value: Optional[condecimal(max_digits=18, decimal_places=6)] = None
    note: Optional[str] = None

class ComponentsReplace(BaseModel):
    items: List[ComponentIn]


# --------------- helpers ---------------
def _validate_mode(cx: sqlite3.Connection, body: PolicyBase | PolicyUpdate, pid: Optional[int] = None):
    """
    En az bir mod: A) rate_pct, B) index_series_id veya components.
    Aynı anda hem rate hem index verilirse hata.
    PUT için, components kontrolü endpointte; burada sadece rate/index alanlarına bakılır.
    """
    # mevcut components var mı (PUT durumunda ve body alanları boş olabilir)
    has_components = False
    if pid is not None:
        has_components = cx.execute(
            "SELECT 1 FROM escalation_policy_components WHERE policy_id=? LIMIT 1", (pid,)
        ).fetchone() is not None

    has_rate = body.rate_pct is not None
    has_index = (getattr(body, "index_series_id", None) is not None) or has_components

    if has_rate and has_index:
        raise HTTPException(422, "policy cannot be both rate-based and index-based")
    if not has_rate and not has_index:
        raise HTTPException(422, "policy must be rate-based OR index-based")

def _check_weights_sum(items: List[ComponentIn]):
    eps = Decimal("0.01")        # %100 ± 0.01 tol.
    s = sum(Decimal(str(x.weight_pct)) for x in items)
    if abs(s - Decimal("100")) > eps:
        raise HTTPException(422, f"sum(weight_pct) must be 100±0.01, got {s}")


def _referenced(cx: sqlite3.Connection, pid: int) -> bool:
    return cx.execute(
        """
        SELECT 1 FROM scenario_services WHERE price_escalation_policy_id=? LIMIT 1
        """, (pid,)
    ).fetchone() or cx.execute(
        "SELECT 1 FROM scenario_boq_items WHERE price_escalation_policy_id=? LIMIT 1", (pid,)
    ).fetchone() or cx.execute(
        "SELECT 1 FROM scenarios WHERE default_price_escalation_policy_id=? LIMIT 1", (pid,)
    ).fetchone()


# --------------- routes: policies ---------------
@router.get("/policies")
def list_policies(q: Optional[str] = None,
                  limit: int = Query(50, ge=1, le=200),
                  offset: int = Query(0, ge=0)):
    sql = "SELECT * FROM escalation_policies WHERE 1=1"
    args: list = []
    if q:
        sql += " AND (name LIKE ? OR scope LIKE ?)"
        args += [f"%{q}%", f"%{q}%"]
    sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
    args += [limit, offset]
    with _db() as cx:
        rows = [dict(r) for r in cx.execute(sql, args).fetchall()]
    return {"items": rows, "count": len(rows), "limit": limit, "offset": offset}


@router.post("/policies", status_code=201)
def create_policy(payload: PolicyCreate):
    with _db() as cx:
        _validate_mode(cx, payload, None)
        try:
            cur = cx.execute(
                """
                INSERT INTO escalation_policies
                  (name, scope, rate_pct, index_series_id, start_year, start_month,
                   cap_pct, floor_pct, frequency, compounding)
                VALUES (?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    payload.name,
                    payload.scope,
                    float(payload.rate_pct) if payload.rate_pct is not None else None,
                    payload.index_series_id,
                    payload.start_year,
                    payload.start_month,
                    float(payload.cap_pct) if payload.cap_pct is not None else None,
                    float(payload.floor_pct) if payload.floor_pct is not None else None,
                    payload.frequency.lower() if payload.frequency else None,
                    payload.compounding.lower() if payload.compounding else None,
                ),
            )
            pid = cur.lastrowid
            return {"id": pid}
        except sqlite3.IntegrityError as e:
            raise HTTPException(409, f"db integrity error: {e}")


@router.get("/policies/{pid}")
def get_policy(pid: int):
    with _db() as cx:
        _ensure_exists(cx, "escalation_policies", pid)
        p = cx.execute("SELECT * FROM escalation_policies WHERE id=?", (pid,)).fetchone()
        comps = cx.execute(
            """
            SELECT id, index_series_id, weight_pct, base_index_value, note
              FROM escalation_policy_components
             WHERE policy_id=?
             ORDER BY id
            """, (pid,)
        ).fetchall()
    return {"policy": dict(p), "components": [dict(x) for x in comps]}


@router.put("/policies/{pid}")
def update_policy(pid: int, payload: PolicyUpdate):
    with _db() as cx:
        _ensure_exists(cx, "escalation_policies", pid)
        _validate_mode(cx, payload, pid)

        fields: List[str] = []
        vals: list = []
        for col in ("name", "scope", "rate_pct", "index_series_id", "start_year",
                    "start_month", "cap_pct", "floor_pct", "frequency", "compounding"):
            val = getattr(payload, col)
            if val is not None:
                if col in {"rate_pct", "cap_pct", "floor_pct"}:
                    val = float(val)
                if col in {"frequency", "compounding"} and isinstance(val, str):
                    val = val.lower()
                fields.append(f"{col}=?")
                vals.append(val)

        if fields:
            vals.append(pid)
            try:
                cx.execute(f"UPDATE escalation_policies SET {', '.join(fields)} WHERE id=?", vals)
            except sqlite3.IntegrityError as e:
                raise HTTPException(409, f"db integrity error: {e}")

        return {"id": pid, "updated": True}


@router.delete("/policies/{pid}", status_code=204)
def delete_policy(pid: int):
    with _db() as cx:
        _ensure_exists(cx, "escalation_policies", pid)
        if _referenced(cx, pid):
            raise HTTPException(409, "policy is in use by service/boq/scenario")
        cx.execute("DELETE FROM escalation_policy_components WHERE policy_id=?", (pid,))
        cx.execute("DELETE FROM escalation_policies WHERE id=?", (pid,))
        return


# --------------- routes: components (replace) ---------------
@router.get("/policies/{pid}/components")
def list_components(pid: int):
    with _db() as cx:
        _ensure_exists(cx, "escalation_policies", pid)
        rows = cx.execute(
            "SELECT id, index_series_id, weight_pct, base_index_value, note "
            "FROM escalation_policy_components WHERE policy_id=? ORDER BY id",
            (pid,)
        ).fetchall()
    return {"items": [dict(r) for r in rows], "count": len(rows)}

@router.put("/policies/{pid}/components")
def replace_components(pid: int, body: ComponentsReplace = Body(...)):
    with _db() as cx:
        _ensure_exists(cx, "escalation_policies", pid)
        if not body.items:
            # index-based policy bileşensiz de (tek index) çalışabilir ama
            # bu endpoint "replace" olduğu için boş listeye izin vermiyoruz.
            raise HTTPException(400, "items must contain at least 1 component")

        _check_weights_sum(body.items)

        try:
            cx.execute("DELETE FROM escalation_policy_components WHERE policy_id=?", (pid,))
            for it in body.items:
                cx.execute(
                    """
                    INSERT INTO escalation_policy_components
                      (policy_id, index_series_id, weight_pct, base_index_value, note)
                    VALUES (?,?,?,?,?)
                    """,
                    (
                        pid,
                        it.index_series_id,
                        float(it.weight_pct),
                        float(it.base_index_value) if it.base_index_value is not None else None,
                        it.note,
                    ),
                )
        except sqlite3.IntegrityError as e:
            raise HTTPException(409, f"db integrity error: {e}")

        # Tekrar mod doğrulama: artık components var → index-based mod
        _validate_mode(cx, PolicyUpdate(index_series_id=None), pid)
        return {"policy_id": pid, "replaced": True}
