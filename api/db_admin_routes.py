"""Safe DB admin endpoints for manual dashboard corrections.

The API intentionally exposes only a small whitelist of project tables and
never accepts raw SQL from the browser.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

import psycopg2
import psycopg2.extras
from psycopg2 import sql
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from main import get_conn


router = APIRouter(prefix="/api/db-admin", tags=["db-admin"])

EDITABLE_TABLES: dict[str, str] = {
    "construction_sections": "Участки",
    "construction_section_versions": "Границы участков",
    "objects": "Объекты",
    "object_segments": "Сегменты объектов",
    "constructives": "Конструктивы",
    "work_types": "Виды работ",
    "work_type_aliases": "Алиасы работ",
    "materials": "Материалы",
    "contractors": "Подрядчики",
    "daily_reports": "Суточные отчеты",
    "daily_work_items": "Работы за сутки",
    "daily_work_item_segments": "Сегменты работ",
    "material_movements": "Перевозки материалов",
    "report_equipment_units": "Техника отчета",
    "work_item_equipment_usage": "Техника по работам",
    "temporary_roads": "Временные дороги",
    "temporary_road_status_segments": "Статусы временных дорог",
    "stockpiles": "Накопители",
    "stockpile_balance_snapshots": "Остатки накопителей",
}

SYSTEM_COLUMNS = {"created_at", "updated_at", "approved_at"}


@contextmanager
def _db_cursor():
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            yield conn, cur
    finally:
        conn.close()


class ChangeRequest(BaseModel):
    action: Literal["insert", "update", "delete"]
    pk: dict[str, Any] | None = None
    values: dict[str, Any] | None = None
    confirmed: bool = False
    changed_by: str | None = Field(default="dashboard", max_length=80)


def _json_safe(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    return value


def _allowed_table(table: str) -> None:
    if table not in EDITABLE_TABLES:
        raise HTTPException(status_code=404, detail="Table is not exposed for dashboard editing")


def _fetch_all(cur, query, params=()) -> list[dict[str, Any]]:
    cur.execute(query, params)
    return [dict(row) for row in cur.fetchall()]


def _table_exists(cur, table: str) -> bool:
    cur.execute(
        """
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = %s
        ) AS exists
        """,
        (table,),
    )
    row = cur.fetchone()
    return bool(row and row["exists"])


def _columns(cur, table: str) -> list[dict[str, Any]]:
    return _fetch_all(
        cur,
        """
        SELECT column_name, data_type, udt_name, is_nullable, column_default,
               character_maximum_length, numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        ORDER BY ordinal_position
        """,
        (table,),
    )


def _primary_key(cur, table: str) -> list[str]:
    cur.execute(
        """
        SELECT a.attname AS column_name
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = %s::regclass AND i.indisprimary
        ORDER BY array_position(i.indkey, a.attnum)
        """,
        (f"public.{table}",),
    )
    return [row["column_name"] for row in cur.fetchall()]


def _foreign_keys(cur, table: str) -> list[dict[str, Any]]:
    return _fetch_all(
        cur,
        """
        SELECT c.conname AS constraint_name,
               src.relname AS source_table,
               src_col.attname AS source_column,
               dst.relname AS target_table,
               dst_col.attname AS target_column,
               c.confdeltype AS on_delete
        FROM pg_constraint c
        JOIN pg_class src ON src.oid = c.conrelid
        JOIN pg_class dst ON dst.oid = c.confrelid
        JOIN unnest(c.conkey) WITH ORDINALITY AS src_key(attnum, ord) ON true
        JOIN unnest(c.confkey) WITH ORDINALITY AS dst_key(attnum, ord) ON dst_key.ord = src_key.ord
        JOIN pg_attribute src_col ON src_col.attrelid = src.oid AND src_col.attnum = src_key.attnum
        JOIN pg_attribute dst_col ON dst_col.attrelid = dst.oid AND dst_col.attnum = dst_key.attnum
        WHERE c.contype = 'f' AND src.relname = %s
        ORDER BY c.conname, src_key.ord
        """,
        (table,),
    )


def _incoming_refs(cur, table: str) -> list[dict[str, Any]]:
    return _fetch_all(
        cur,
        """
        SELECT c.conname AS constraint_name,
               src.relname AS source_table,
               src_col.attname AS source_column,
               dst.relname AS target_table,
               dst_col.attname AS target_column,
               c.confdeltype AS on_delete
        FROM pg_constraint c
        JOIN pg_class src ON src.oid = c.conrelid
        JOIN pg_class dst ON dst.oid = c.confrelid
        JOIN unnest(c.conkey) WITH ORDINALITY AS src_key(attnum, ord) ON true
        JOIN unnest(c.confkey) WITH ORDINALITY AS dst_key(attnum, ord) ON dst_key.ord = src_key.ord
        JOIN pg_attribute src_col ON src_col.attrelid = src.oid AND src_col.attnum = src_key.attnum
        JOIN pg_attribute dst_col ON dst_col.attrelid = dst.oid AND dst_col.attnum = dst_key.attnum
        WHERE c.contype = 'f' AND dst.relname = %s
        ORDER BY src.relname, c.conname, src_key.ord
        """,
        (table,),
    )


def _indexes(cur, table: str) -> list[dict[str, Any]]:
    return _fetch_all(
        cur,
        """
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = %s
        ORDER BY indexname
        """,
        (table,),
    )


def _fk_for_column(cur, table: str, column: str) -> dict[str, Any] | None:
    for fk in _foreign_keys(cur, table):
        if fk["source_column"] == column:
            return fk
    return None


def _label_expression(cur, target_table: str, target_alias: str = "d") -> sql.Composed:
    target_columns = {col["column_name"] for col in _columns(cur, target_table)}
    alias = sql.Identifier(target_alias)
    if {"code", "name"} <= target_columns:
        return sql.SQL("CONCAT_WS(' · ', {}.{}, {}.{})").format(
            alias,
            sql.Identifier("code"),
            alias,
            sql.Identifier("name"),
        )
    for column in ("name", "short_name", "object_code", "road_code", "code"):
        if column in target_columns:
            return sql.SQL("{}.{}::text").format(alias, sql.Identifier(column))
    return sql.SQL("NULL")


def _where_pk(pk_cols: list[str], pk: dict[str, Any] | None) -> tuple[sql.SQL, list[Any]]:
    if not pk_cols:
        raise HTTPException(status_code=400, detail="Table has no primary key")
    if not pk:
        raise HTTPException(status_code=400, detail="Primary key is required")
    missing = [col for col in pk_cols if col not in pk]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing primary key column(s): {', '.join(missing)}")
    parts = [sql.SQL("{} = %s").format(sql.Identifier(col)) for col in pk_cols]
    return sql.SQL(" AND ").join(parts), [pk[col] for col in pk_cols]


def _row_by_pk(cur, table: str, pk_cols: list[str], pk: dict[str, Any] | None) -> dict[str, Any] | None:
    where_sql, params = _where_pk(pk_cols, pk)
    query = sql.SQL("SELECT * FROM {} WHERE {} LIMIT 1").format(sql.Identifier(table), where_sql)
    cur.execute(query, params)
    row = cur.fetchone()
    return dict(row) if row else None


def _ensure_audit_table(cur) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS public.db_change_audit (
            id BIGSERIAL PRIMARY KEY,
            table_name TEXT NOT NULL,
            action TEXT NOT NULL,
            pk_json JSONB,
            before_json JSONB,
            after_json JSONB,
            changed_by TEXT NOT NULL DEFAULT 'dashboard',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )


def _validate(cur, table: str, request: ChangeRequest) -> dict[str, Any]:
    _allowed_table(table)
    if not _table_exists(cur, table):
        raise HTTPException(status_code=404, detail="Table does not exist")

    columns = _columns(cur, table)
    column_names = {col["column_name"] for col in columns}
    pk_cols = _primary_key(cur, table)
    values = request.values or {}
    errors: list[str] = []
    warnings: list[str] = []
    before = None
    after = None

    unknown = sorted(set(values) - column_names)
    if unknown:
        errors.append(f"Unknown column(s): {', '.join(unknown)}")

    if request.action == "update":
        if not values:
            errors.append("No changed values provided")
        blocked = sorted((set(values) & set(pk_cols)) | (set(values) & SYSTEM_COLUMNS))
        if blocked:
            errors.append(f"Column(s) are protected: {', '.join(blocked)}")
        before = _row_by_pk(cur, table, pk_cols, request.pk)
        if not before:
            errors.append("Target row was not found")
        else:
            changed = {key: value for key, value in values.items() if _json_safe(before.get(key)) != _json_safe(value)}
            if not changed:
                warnings.append("No effective field changes detected")
            after = {**before, **values}

    elif request.action == "insert":
        missing_required = [
            col["column_name"]
            for col in columns
            if col["is_nullable"] == "NO"
            and col["column_default"] is None
            and col["column_name"] not in values
            and col["column_name"] not in SYSTEM_COLUMNS
        ]
        if missing_required:
            errors.append(f"Required column(s) are missing: {', '.join(missing_required)}")
        after = values

    elif request.action == "delete":
        before = _row_by_pk(cur, table, pk_cols, request.pk)
        if not before:
            errors.append("Target row was not found")
        else:
            for ref in _incoming_refs(cur, table):
                target_col = ref["target_column"]
                if target_col not in before:
                    continue
                count_query = sql.SQL("SELECT COUNT(*) AS cnt FROM {} WHERE {} = %s").format(
                    sql.Identifier(ref["source_table"]),
                    sql.Identifier(ref["source_column"]),
                )
                cur.execute(count_query, (before[target_col],))
                count = int(cur.fetchone()["cnt"])
                if count:
                    errors.append(
                        f"{ref['source_table']}.{ref['source_column']} references this row ({count} row(s))"
                    )

    if values:
        fk_by_column = {fk["source_column"]: fk for fk in _foreign_keys(cur, table)}
        for column, value in values.items():
            if value in (None, "") or column not in fk_by_column:
                continue
            fk = fk_by_column[column]
            exists_query = sql.SQL("SELECT 1 FROM {} WHERE {} = %s LIMIT 1").format(
                sql.Identifier(fk["target_table"]),
                sql.Identifier(fk["target_column"]),
            )
            cur.execute(exists_query, (value,))
            if not cur.fetchone():
                errors.append(f"{column} references missing {fk['target_table']}.{fk['target_column']}")

    diff = []
    if before and values:
        for key in sorted(values):
            diff.append({"column": key, "before": _json_safe(before.get(key)), "after": _json_safe(values[key])})

    return {
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "diff": diff,
        "before": _json_safe(before),
        "after": _json_safe(after),
    }


@router.get("/tables")
def list_tables():
    with _db_cursor() as (conn, cur):
        rows = []
        for table, label in EDITABLE_TABLES.items():
            if not _table_exists(cur, table):
                continue
            cur.execute(sql.SQL("SELECT COUNT(*) AS cnt FROM {}").format(sql.Identifier(table)))
            rows.append({"name": table, "label": label, "rows": int(cur.fetchone()["cnt"]), "editable": True})
        return {"tables": rows}


@router.get("/tables/{table}/schema")
def table_schema(table: str):
    _allowed_table(table)
    with _db_cursor() as (conn, cur):
        if not _table_exists(cur, table):
            raise HTTPException(status_code=404, detail="Table does not exist")
        return {
            "table": table,
            "label": EDITABLE_TABLES[table],
            "primary_key": _primary_key(cur, table),
            "columns": _columns(cur, table),
            "foreign_keys": _foreign_keys(cur, table),
            "incoming_refs": _incoming_refs(cur, table),
            "indexes": _indexes(cur, table),
        }


@router.get("/tables/{table}/rows")
def table_rows(
    table: str,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    _allowed_table(table)
    with _db_cursor() as (conn, cur):
        if not _table_exists(cur, table):
            raise HTTPException(status_code=404, detail="Table does not exist")
        pk_cols = _primary_key(cur, table)
        columns = [col["column_name"] for col in _columns(cur, table)]
        order_cols = pk_cols or columns[:1]
        order_sql = sql.SQL(", ").join(sql.Identifier(col) for col in order_cols)
        query = sql.SQL("SELECT * FROM {} ORDER BY {} LIMIT %s OFFSET %s").format(
            sql.Identifier(table),
            order_sql,
        )
        cur.execute(query, (limit, offset))
        return {"rows": [_json_safe(dict(row)) for row in cur.fetchall()], "limit": limit, "offset": offset}


@router.get("/tables/{table}/columns/{column}/suggestions")
def column_suggestions(
    table: str,
    column: str,
    section_id: str | None = None,
    limit: int = Query(default=25, ge=1, le=100),
):
    _allowed_table(table)
    with _db_cursor() as (conn, cur):
        if not _table_exists(cur, table):
            raise HTTPException(status_code=404, detail="Table does not exist")

        columns = _columns(cur, table)
        column_names = {col["column_name"] for col in columns}
        if column not in column_names:
            raise HTTPException(status_code=400, detail="Column does not exist")

        joins: list[sql.SQL] = []
        params: list[Any] = []
        where_parts = [
            sql.SQL("t.{} IS NOT NULL").format(sql.Identifier(column)),
            sql.SQL("t.{}::text <> ''").format(sql.Identifier(column)),
        ]
        label_expr: sql.SQL | sql.Composed = sql.SQL("NULL")

        fk = _fk_for_column(cur, table, column)
        if fk and _table_exists(cur, fk["target_table"]):
            label_expr = _label_expression(cur, fk["target_table"])
            joins.append(
                sql.SQL("LEFT JOIN {} d ON t.{} = d.{}").format(
                    sql.Identifier(fk["target_table"]),
                    sql.Identifier(column),
                    sql.Identifier(fk["target_column"]),
                )
            )

        if section_id:
            if "section_id" in column_names:
                where_parts.append(sql.SQL("t.section_id = %s"))
                params.append(section_id)
            elif "daily_report_id" in column_names:
                joins.append(sql.SQL("LEFT JOIN daily_reports dr_scope ON t.daily_report_id = dr_scope.id"))
                where_parts.append(sql.SQL("dr_scope.section_id = %s"))
                params.append(section_id)

        query = sql.SQL(
            """
            SELECT t.{column}::text AS value,
                   {label} AS label,
                   COUNT(*)::int AS count
            FROM {table} t
            {joins}
            WHERE {where}
            GROUP BY 1, 2
            ORDER BY COUNT(*) DESC, label NULLS LAST, value
            LIMIT %s
            """
        ).format(
            column=sql.Identifier(column),
            label=label_expr,
            table=sql.Identifier(table),
            joins=sql.SQL(" ").join(joins),
            where=sql.SQL(" AND ").join(where_parts),
        )
        cur.execute(query, params + [limit])
        return {
            "table": table,
            "column": column,
            "section_id": section_id,
            "suggestions": [_json_safe(dict(row)) for row in cur.fetchall()],
        }


@router.post("/tables/{table}/validate")
def validate_change(table: str, request: ChangeRequest):
    with _db_cursor() as (conn, cur):
        result = _validate(cur, table, request)
        conn.rollback()
        return result


@router.post("/tables/{table}/apply")
def apply_change(table: str, request: ChangeRequest):
    if not request.confirmed:
        raise HTTPException(status_code=400, detail="confirmed=true is required")
    _allowed_table(table)
    with _db_cursor() as (conn, cur):
        result = _validate(cur, table, request)
        if not result["ok"]:
            conn.rollback()
            return result

        pk_cols = _primary_key(cur, table)
        values = request.values or {}
        before = result.get("before")
        after = result.get("after")

        if request.action == "update":
            set_sql = sql.SQL(", ").join(
                sql.SQL("{} = %s").format(sql.Identifier(col)) for col in values
            )
            where_sql, pk_params = _where_pk(pk_cols, request.pk)
            query = sql.SQL("UPDATE {} SET {} WHERE {} RETURNING *").format(
                sql.Identifier(table),
                set_sql,
                where_sql,
            )
            cur.execute(query, list(values.values()) + pk_params)
            after = _json_safe(dict(cur.fetchone()))

        elif request.action == "insert":
            columns = list(values.keys())
            query = sql.SQL("INSERT INTO {} ({}) VALUES ({}) RETURNING *").format(
                sql.Identifier(table),
                sql.SQL(", ").join(sql.Identifier(col) for col in columns),
                sql.SQL(", ").join(sql.Placeholder() for _ in columns),
            )
            cur.execute(query, list(values.values()))
            after = _json_safe(dict(cur.fetchone()))

        elif request.action == "delete":
            where_sql, pk_params = _where_pk(pk_cols, request.pk)
            query = sql.SQL("DELETE FROM {} WHERE {} RETURNING *").format(sql.Identifier(table), where_sql)
            cur.execute(query, pk_params)
            before = _json_safe(dict(cur.fetchone()))
            after = None

        _ensure_audit_table(cur)
        cur.execute(
            """
            INSERT INTO public.db_change_audit
              (table_name, action, pk_json, before_json, after_json, changed_by)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (
                table,
                request.action,
                psycopg2.extras.Json(_json_safe(request.pk)),
                psycopg2.extras.Json(before),
                psycopg2.extras.Json(after),
                request.changed_by or "dashboard",
            ),
        )
        conn.commit()
        return {**result, "ok": True, "before": before, "after": after}
