# backend/api/products_api.py
from __future__ import annotations

from typing import Optional, List, Dict, Any
from pathlib import Path
import sqlite3

from fastapi import APIRouter, HTTPException, Query

DB_PATH = Path(__file__).resolve().parents[1] / "app.db"

# Tüm endpointleri /api altında topluyoruz
router = APIRouter(prefix="/api", tags=["products"])


def cx():
    con = sqlite3.connect(str(DB_PATH))
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON;")
    return con


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------
def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return dict(row)


# ---------------------------------------------------------------------
# PRODUCTS
#  - Slash’lı ve slash’sız tüm yolları birlikte tanımlıyoruz (CORS/307 önlemek için)
# ---------------------------------------------------------------------

@router.get("/products")
@router.get("/products/")
def list_products(
    q: Optional[str] = Query(None, description="FTS araması (code/name/description)"),
    active: Optional[bool] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> Dict[str, Any]:
    """
    Ürün listesi. FTS5 var ise q ile arama yapılır.
    active parametresi: true/false → is_active filtresi
    """
    with cx() as con:
        params: List[Any] = []
        if q:
            sql = (
                "SELECT p.* FROM products_fts f "
                "JOIN products p ON p.id = f.rowid "
                "WHERE products_fts MATCH ? "
            )
            params.append(q)
            if active is not None:
                sql += "AND p.is_active = ? "
                params.append(1 if active else 0)
            sql += "AND p.deleted_at IS NULL "
            sql += "ORDER BY p.id DESC LIMIT ? OFFSET ?"
            params += [limit, offset]
            rows = con.execute(sql, params).fetchall()

            # toplamı da aramaya göre yapalım
            cnt_sql = (
                "SELECT COUNT(*) c FROM products_fts f "
                "JOIN products p ON p.id = f.rowid "
                "WHERE products_fts MATCH ? AND p.deleted_at IS NULL"
            )
            cnt_params: List[Any] = [q]
            if active is not None:
                cnt_sql += " AND p.is_active = ?"
                cnt_params.append(1 if active else 0)
            total = con.execute(cnt_sql, cnt_params).fetchone()["c"]
        else:
            sql = "SELECT * FROM products WHERE deleted_at IS NULL"
            if active is not None:
                sql += " AND is_active = ?"
                params.append(1 if active else 0)
            sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
            params += [limit, offset]
            rows = con.execute(sql, params).fetchall()
            total = con.execute(
                "SELECT COUNT(*) c FROM products WHERE deleted_at IS NULL"
            ).fetchone()["c"]

        items = [_row_to_dict(r) for r in rows]
        return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/products/{pid}")
@router.get("/products/{pid}/")
def get_product(pid: int):
    with cx() as con:
        r = con.execute(
            "SELECT * FROM products WHERE id = ? AND deleted_at IS NULL", (pid,)
        ).fetchone()
        if not r:
            raise HTTPException(404, "Product not found")
        return _row_to_dict(r)


@router.post("/products")
@router.post("/products/")
def create_product(payload: Dict[str, Any]):
    required = ["code", "name"]
    for k in required:
        if not payload.get(k):
            raise HTTPException(422, f"Field required: {k}")

    with cx() as con:
        try:
            cur = con.execute(
                """
                INSERT INTO products
                (code, name, description, uom, currency, base_price, tax_rate_pct, barcode_gtin, is_active, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload.get("code"),
                    payload.get("name"),
                    payload.get("description"),
                    payload.get("uom"),
                    payload.get("currency", "USD"),
                    payload.get("base_price", 0),
                    payload.get("tax_rate_pct"),
                    payload.get("barcode_gtin"),
                    1 if payload.get("is_active", True) else 0,
                    payload.get("metadata"),
                ),
            )
            pid = cur.lastrowid
            con.commit()
            return {"id": pid}
        except sqlite3.IntegrityError as e:
            # örn: UNIQUE(code) ihlali
            raise HTTPException(409, f"Integrity error: {e}")


@router.put("/products/{pid}")
@router.put("/products/{pid}/")
def update_product(pid: int, payload: Dict[str, Any]):
    with cx() as con:
        exists = con.execute(
            "SELECT 1 FROM products WHERE id = ? AND deleted_at IS NULL", (pid,)
        ).fetchone()
        if not exists:
            raise HTTPException(404, "Product not found")

        fields = [
            "code",
            "name",
            "description",
            "uom",
            "currency",
            "base_price",
            "tax_rate_pct",
            "barcode_gtin",
            "is_active",
            "metadata",
        ]
        sets: List[str] = []
        params: List[Any] = []
        for f in fields:
            if f in payload:
                sets.append(f"{f} = ?")
                v = payload[f]
                if f == "is_active":
                    v = 1 if bool(v) else 0
                params.append(v)

        if not sets:
            return {"updated": 0}

        params.append(pid)
        con.execute(
            f"UPDATE products SET {', '.join(sets)} WHERE id = ? AND deleted_at IS NULL",
            params,
        )
        con.commit()
        return {"updated": 1}


@router.delete("/products/{pid}")
@router.delete("/products/{pid}/")
def delete_product(
    pid: int, hard: bool = Query(False, description="true=hard delete")
):
    with cx() as con:
        if hard:
            con.execute("DELETE FROM products WHERE id = ?", (pid,))
        else:
            con.execute(
                "UPDATE products SET deleted_at = datetime('now') "
                "WHERE id = ? AND deleted_at IS NULL",
                (pid,),
            )
        con.commit()
        return {"deleted": True}


# ---------------------------------------------------------------------
# PRICE BOOKS
# ---------------------------------------------------------------------

@router.get("/price-books")
@router.get("/price-books/")
def list_price_books(active: Optional[bool] = None):
    with cx() as con:
        sql = "SELECT * FROM price_books"
        params: List[Any] = []
        if active is not None:
            sql += " WHERE is_active = ?"
            params.append(1 if active else 0)
        sql += " ORDER BY is_default DESC, id DESC"
        return {"items": [_row_to_dict(r) for r in con.execute(sql, params).fetchall()]}


@router.get("/price-books/{book_id}/entries")
@router.get("/price-books/{book_id}/entries/")
def list_price_book_entries(book_id: int, product_id: Optional[int] = None):
    with cx() as con:
        sql = """
        SELECT e.*, p.code AS product_code, p.name AS product_name
        FROM price_book_entries e
        JOIN products p ON p.id = e.product_id
        WHERE e.price_book_id = ?
        """
        params: List[Any] = [book_id]
        if product_id:
            sql += " AND e.product_id = ?"
            params.append(product_id)
        sql += " ORDER BY e.product_id, e.valid_from"
        rows = con.execute(sql, params).fetchall()
        return {"items": [_row_to_dict(r) for r in rows]}
