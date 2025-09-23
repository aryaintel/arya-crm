# backend/app/api/escalation_policies_api.py
from pathlib import Path
from typing import Optional, List, Literal
from decimal import Decimal
from datetime import datetime
import sqlite3

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, condecimal, validator

router = APIRouter(prefix="/api/escalations", tags=["escalation-policies"])
DB_PATH = Path(__file__).resolve().parents[2] / "app.db"

# ------------- DB helpers -------------
def _db() -> sqlite3.Connection:
    cx = sqlite3.connect(str(DB_PATH))
    cx.row_factory = sqlite3.Row
    cx.execute("PRAGMA foreign_keys = ON;")
    return cx

def _ensure_exists(cx: sqlite3.Connection, table: str, id_: int):
    row = cx.execute(f"SELECT 1 FROM {table} WHERE id=?", (id_,)).fetchone()
    if not row:
        raise HTTPException(404, f"{table} not found")

def _now() -> str:
    return datetime.utcnow().isoformat(timespec="seconds")

# ------------- Schemas -------------
Scope = Literal["price", "cogs", "both"]
Frequency = Literal["none", "annual", "semiannual", "quarterly", "monthly"]
Compounding = Literal["compound", "simple"]

class PolicyComponentIn(BaseModel):
    index_series_id: int
    weight_pct: condecimal(max_digits=9, decimal_places=4)
    base_index_value: Optional[condecimal(max_digits=18, decimal_places=6)] = None
    note: Optional[str] = None

class EscalationCreate(BaseModel):
    name: str
    scope: Scope = "both"
    # iki kullanım: sabit oran (rate_pct) veya endeks referans(lar)ı (components)
    rate_pct: Optional[condecimal(max_digits=9, decimal_places=6)] = None
    index_series_id: Optional[int] = None  # tek seri için shorthand (opsiyonel)
    start_year: int
    start_month: int
    cap_pct: Optional[condecimal(max_digits=9, decimal_places=6)] = None
    floor_pct: Optional[condecimal(max_digits=9, decimal_places=6)] = None
    frequency: Frequency = "annual"
    compounding: Compounding = "compound"
    scenario_id: Optional[int] = None
    components: Optional[List[PolicyComponentIn]] = None  # birden fazla seri karışımı

    @validator("start_month")
    def _m_ok(cls, v):
        if v < 1 or v > 12:
            raise ValueError("start_month must be 1..12")
        return v

class EscalationUpdate(BaseModel):
    name: Optional[str] = None
    scope: Optional[Scope] = None
    rate_pct: Optional[condecimal(max_digits=9, decimal_places=6)] = None
    index_series_id: Optional[int] = None
    start_year: Optional[int] = None
    start_month: Optional[int] = None
    cap_pct: Optional[condecimal(max_digits=9, decimal_places=6)] = None
    floor_pct: Optional[condecimal(max_digits=9, decimal_places=6)] = None
    frequency: Optional[Frequency] = None
    compounding: Optional[Compounding] = None
    scenario_id: Optional[int] = None
    components: Optional[List[PolicyComponentIn]] = None  # verildiyse tam değiştirir

# ------------- Helpers -------------
def _normalize_weights(components: List[PolicyComponentIn]) -> List[dict]:
    vals = [Decimal(str(c.weight_pct)) for c in components]
    total = sum(vals)
    if total <= 0:
        raise HTTPException(400, "sum(weight_pct) must be > 0")

    # 100'e oranla normalize + 4 ondalık
    norm = [(v * Decimal("100")) / total for v in vals]
    rounded = [n.quantize(Decimal("0.0001")) for n in norm]
    residual = Decimal("100") - sum(rounded)
    step = Decimal("0.0001")
    i = 0
    while residual != 0:
        idx = i % len(rounded)
        if residual > 0:
            rounded[idx] += step; residual -= step
        else:
            rounded[idx] -= step; residual += step
        i += 1
        if i > 200000:
            break

    out: List[dict] = []
    for c, w in zip(components, rounded):
        out.append({
            "index_series_id": c.index_series_id,
            "weight_pct": float(w),
            "base_index_value": float(c.base_index_value) if c.base_index_value is not None else None,
            "note": c.note
        })
    return out

def _any_component_given(payload) -> bool:
    return bool(payload.components) or (payload.index_series_id is not None)

# ------------- CRUD -------------
@router.post("", status_code=201)
def create_policy(payload: EscalationCreate):
    with _db() as cx:
        # temel insert
        try:
            cur = cx.execute(
                """
                INSERT INTO escalation_policies
                (name, scope, rate_pct, index_series_id, start_year, start_month,
                 cap_pct, floor_pct, frequency, compounding, scenario_id, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?, ?, ?)
                """,
                (
                    payload.name, payload.scope,
                    float(payload.rate_pct) if payload.rate_pct is not None else None,
                    payload.index_series_id,
                    payload.start_year, payload.start_month,
                    float(payload.cap_pct) if payload.cap_pct is not None else None,
                    float(payload.floor_pct) if payload.floor_pct is not None else None,
                    payload.frequency, payload.compounding,
                    payload.scenario_id,
                    _now(), _now(),
                )
            )
            pid = cur.lastrowid

            # components (varsa)
            if payload.components:
                comps = _normalize_weights(payload.components)
                for c in comps:
                    cx.execute(
                        """
                        INSERT INTO escalation_policy_components
                        (policy_id, index_series_id, weight_pct, base_index_value, note)
                        VALUES (?,?,?,?,?)
                        """,
                        (pid, c["index_series_id"], c["weight_pct"], c["base_index_value"], c["note"])
                    )
        except sqlite3.IntegrityError as e:
            raise HTTPException(409, f"db integrity error: {e}")

        # en az bir tanım (rate_pct veya components/index_series) olmalı
        if (payload.rate_pct is None) and (not _any_component_given(payload)):
            raise HTTPException(400, "either rate_pct or index-based components must be provided")

        return {"id": pid}

@router.get("")
def list_policies(
    q: Optional[str] = None,
    scope: Optional[Scope] = None,
    scenario_id: Optional[int] = None,
    frequency: Optional[Frequency] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    sql = "SELECT * FROM escalation_policies WHERE 1=1"
    args: list = []
    if q:
        sql += " AND name LIKE ?"; args.append(f"%{q}%")
    if scope:
        sql += " AND scope=?"; args.append(scope)
    if scenario_id is not None:
        sql += " AND scenario_id=?"; args.append(scenario_id)
    if frequency:
        sql += " AND frequency=?"; args.append(frequency)
    sql += " ORDER BY id DESC LIMIT ? OFFSET ?"; args += [limit, offset]

    with _db() as cx:
        rows = [dict(r) for r in cx.execute(sql, args).fetchall()]
        return {"items": rows, "count": len(rows), "limit": limit, "offset": offset}

@router.get("/{pid}")
def get_policy(pid: int):
    with _db() as cx:
        p = cx.execute("SELECT * FROM escalation_policies WHERE id=?", (pid,)).fetchone()
        if not p:
            raise HTTPException(404, "policy not found")
        comps = cx.execute(
            """
            SELECT id, index_series_id, weight_pct, base_index_value, note
            FROM escalation_policy_components
            WHERE policy_id=? ORDER BY id
            """,
            (pid,)
        ).fetchall()
        return {"policy": dict(p), "components": [dict(r) for r in comps]}

@router.put("/{pid}")
def update_policy(pid: int, payload: EscalationUpdate):
    with _db() as cx:
        _ensure_exists(cx, "escalation_policies", pid)

        fields: List[str] = []
        vals: list = []
        mapping = {
            "name": payload.name,
            "scope": payload.scope,
            "rate_pct": (None if payload.rate_pct is None else float(payload.rate_pct)),
            "index_series_id": payload.index_series_id,
            "start_year": payload.start_year,
            "start_month": payload.start_month,
            "cap_pct": (None if payload.cap_pct is None else float(payload.cap_pct)),
            "floor_pct": (None if payload.floor_pct is None else float(payload.floor_pct)),
            "frequency": payload.frequency,
            "compounding": payload.compounding,
            "scenario_id": payload.scenario_id,
        }
        for col, val in mapping.items():
            if val is not None:
                fields.append(f"{col}=?")
                vals.append(val)

        if fields:
            fields.append("updated_at=?"); vals.append(_now())
            vals.append(pid)
            try:
                cx.execute(f"UPDATE escalation_policies SET {', '.join(fields)} WHERE id=?", vals)
            except sqlite3.IntegrityError as e:
                raise HTTPException(409, f"db integrity error: {e}")

        # components tam değiştir
        if payload.components is not None:
            comps = _normalize_weights(payload.components) if payload.components else []
            cx.execute("DELETE FROM escalation_policy_components WHERE policy_id=?", (pid,))
            for c in comps:
                cx.execute(
                    """
                    INSERT INTO escalation_policy_components
                    (policy_id, index_series_id, weight_pct, base_index_value, note)
                    VALUES (?,?,?,?,?)
                    """,
                    (pid, c["index_series_id"], c["weight_pct"], c["base_index_value"], c["note"])
                )

        return {"id": pid, "updated": True}

@router.delete("/{pid}", status_code=204)
def delete_policy(pid: int):
    with _db() as cx:
        _ensure_exists(cx, "escalation_policies", pid)
        # kullanım kontrolü (service/boq/scenario default)
        ref = cx.execute(
            """
            SELECT 1 FROM scenario_services WHERE price_escalation_policy_id=? OR cogs_escalation_policy_id=? LIMIT 1
            """,
            (pid, pid)
        ).fetchone()
        if ref:
            raise HTTPException(409, "policy is in use by scenario_services")

        ref2 = cx.execute(
            """
            SELECT 1 FROM scenario_boq_items WHERE price_escalation_policy_id=? OR cogs_escalation_policy_id=? LIMIT 1
            """,
            (pid, pid)
        ).fetchone()
        if ref2:
            raise HTTPException(409, "policy is in use by scenario_boq_items")

        ref3 = cx.execute(
            """
            SELECT 1 FROM scenarios WHERE default_price_escalation_policy_id=? OR default_cogs_escalation_policy_id=? LIMIT 1
            """,
            (pid, pid)
        ).fetchone()
        if ref3:
            raise HTTPException(409, "policy is set as default on scenarios")

        cx.execute("DELETE FROM escalation_policy_components WHERE policy_id=?", (pid,))
        cx.execute("DELETE FROM escalation_policies WHERE id=?", (pid,))
        return

# ------------- Attach helpers (Service / BOQ / Scenario defaults) -------------
class AttachEscalationBody(BaseModel):
    policy_id: int
    target: Literal["price", "cogs"] = "price"

@router.post("/services/{service_id}/attach")
def attach_to_service(service_id: int, body: AttachEscalationBody):
    with _db() as cx:
        _ensure_exists(cx, "scenario_services", service_id)
        _ensure_exists(cx, "escalation_policies", body.policy_id)

        if body.target == "price":
            cx.execute("UPDATE scenario_services SET price_escalation_policy_id=? WHERE id=?",
                       (body.policy_id, service_id))
        else:
            cx.execute("UPDATE scenario_services SET cogs_escalation_policy_id=? WHERE id=?",
                       (body.policy_id, service_id))
        cx.commit()

        row = cx.execute(
            "SELECT id, price_escalation_policy_id, cogs_escalation_policy_id FROM scenario_services WHERE id=?",
            (service_id,)
        ).fetchone()
        return {"service_id": row["id"], "price_policy_id": row["price_escalation_policy_id"],
                "cogs_policy_id": row["cogs_escalation_policy_id"]}

@router.post("/boq-items/{item_id}/attach")
def attach_to_boq_item(item_id: int, body: AttachEscalationBody):
    with _db() as cx:
        _ensure_exists(cx, "scenario_boq_items", item_id)
        _ensure_exists(cx, "escalation_policies", body.policy_id)

        if body.target == "price":
            cx.execute("UPDATE scenario_boq_items SET price_escalation_policy_id=? WHERE id=?",
                       (body.policy_id, item_id))
        else:
            cx.execute("UPDATE scenario_boq_items SET cogs_escalation_policy_id=? WHERE id=?",
                       (body.policy_id, item_id))
        cx.commit()

        row = cx.execute(
            "SELECT id, price_escalation_policy_id, cogs_escalation_policy_id FROM scenario_boq_items WHERE id=?",
            (item_id,)
        ).fetchone()
        return {"boq_item_id": row["id"], "price_policy_id": row["price_escalation_policy_id"],
                "cogs_policy_id": row["cogs_escalation_policy_id"]}

class ScenarioDefaultsBody(BaseModel):
    price_policy_id: Optional[int] = None
    cogs_policy_id: Optional[int] = None

@router.post("/scenarios/{scenario_id}/set-defaults")
def set_scenario_defaults(scenario_id: int, body: ScenarioDefaultsBody):
    with _db() as cx:
        _ensure_exists(cx, "scenarios", scenario_id)
        fields = []
        vals: list = []
        if body.price_policy_id is not None:
            _ensure_exists(cx, "escalation_policies", body.price_policy_id)
            fields.append("default_price_escalation_policy_id=?")
            vals.append(body.price_policy_id)
        if body.cogs_policy_id is not None:
            _ensure_exists(cx, "escalation_policies", body.cogs_policy_id)
            fields.append("default_cogs_escalation_policy_id=?")
            vals.append(body.cogs_policy_id)
        if not fields:
            raise HTTPException(400, "no defaults to set")
        vals.append(scenario_id)
        cx.execute(f"UPDATE scenarios SET {', '.join(fields)} WHERE id=?", vals)
        cx.commit()

        s = cx.execute(
            "SELECT id, default_price_escalation_policy_id, default_cogs_escalation_policy_id FROM scenarios WHERE id=?",
            (scenario_id,)
        ).fetchone()
        return {"scenario_id": s["id"], "default_price_policy_id": s["default_price_escalation_policy_id"],
                "default_cogs_policy_id": s["default_cogs_escalation_policy_id"]}
