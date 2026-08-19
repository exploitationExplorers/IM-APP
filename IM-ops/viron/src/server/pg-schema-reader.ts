/**
 * PostgreSQL 元数据读取 — 对象树、表结构、索引、约束、函数/视图/触发器
 * 用于数据库工作台的对象浏览、表设计器和 SQL 补全
 */
import type { DatabaseConnectionClient } from "./database-workbench/connector.js";

export interface PgDatabase {
  name: string;
  encoding: string;
  owner: string;
}

export interface PgSchema {
  name: string;
}

export interface PgTable {
  schema: string;
  name: string;
  type: "table" | "view" | "materialized_view";
  owner: string;
  estimatedRows: number;
  comment: string;
}

export interface PgColumn {
  schema: string;
  table: string;
  name: string;
  ordinal: number;
  dataType: string;
  udtName: string;
  nullable: boolean;
  defaultValue: string | null;
  maxLength: number | null;
  numericPrecision: number | null;
  numericScale: number | null;
  isPrimaryKey: boolean;
  comment: string;
  isIdentity: boolean;
  identityGeneration: string | null;
}

export interface PgIndex {
  schema: string;
  table: string;
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
  indexType: string;
  definition: string;
}

export interface PgConstraint {
  schema: string;
  table: string;
  name: string;
  type: "PRIMARY KEY" | "UNIQUE" | "FOREIGN KEY" | "CHECK" | "EXCLUDE";
  columns: string[];
  definition: string;
  foreignTable: string | null;
  foreignColumns: string[];
}

export interface PgFunction {
  schema: string;
  name: string;
  returnType: string;
  argumentTypes: string;
  type: "function" | "procedure";
}

export interface PgTrigger {
  schema: string;
  table: string;
  name: string;
  timing: string;
  events: string;
  definition: string;
}

export interface PgSequence {
  schema: string;
  name: string;
  dataType: string;
  startValue: string;
  increment: string;
  minValue: string;
  maxValue: string;
}

// ── 数据库列表 ──

export async function listDatabases(conn: DatabaseConnectionClient): Promise<PgDatabase[]> {
  const [rows] = await conn.query<Array<Record<string, unknown>>>(
    `SELECT d.datname AS name, pg_encoding_to_char(d.encoding) AS encoding, r.rolname AS owner
     FROM pg_database d JOIN pg_roles r ON d.datdba = r.oid
     WHERE d.datistemplate = false ORDER BY d.datname`,
  );
  return (rows as unknown as PgDatabase[]);
}

// ── Schema 列表 ──

export async function listSchemas(conn: DatabaseConnectionClient): Promise<PgSchema[]> {
  const [rows] = await conn.query<Array<Record<string, unknown>>>(
    `SELECT schema_name AS name FROM information_schema.schemata
     WHERE schema_name NOT IN ('pg_toast','pg_catalog','information_schema')
     ORDER BY schema_name`,
  );
  return (rows as unknown as PgSchema[]);
}

// ── 表/视图列表 ──

export async function listTables(conn: DatabaseConnectionClient, schema: string): Promise<PgTable[]> {
  const [rows] = await conn.query<Array<Record<string, unknown>>>(
    `SELECT
       n.nspname AS schema,
       c.relname AS name,
       CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view' END AS type,
       pg_get_userbyid(c.relowner) AS owner,
       c.reltuples::bigint AS "estimatedRows",
       COALESCE(obj_description(c.oid), '') AS comment
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relkind IN ('r','v','m')
     ORDER BY c.relname`,
    [schema],
  );
  return (rows as unknown as PgTable[]);
}

// ── 列信息 ──

export async function listColumns(conn: DatabaseConnectionClient, schema: string, table: string): Promise<PgColumn[]> {
  const [rows] = await conn.query<Array<Record<string, unknown>>>(
    `SELECT
       c.table_schema AS schema,
       c.table_name AS table,
       c.column_name AS name,
       c.ordinal_position AS ordinal,
       c.data_type AS "dataType",
       c.udt_name AS "udtName",
       (c.is_nullable = 'YES') AS nullable,
       c.column_default AS "defaultValue",
       c.character_maximum_length::int AS "maxLength",
       c.numeric_precision::int AS "numericPrecision",
       c.numeric_scale::int AS "numericScale",
       COALESCE(col_description(
         (SELECT oid FROM pg_class WHERE relname = c.table_name AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = c.table_schema)),
         c.ordinal_position
       ), '') AS comment,
       (c.is_identity = 'YES') AS "isIdentity",
       c.identity_generation AS "identityGeneration",
       EXISTS (
         SELECT 1 FROM information_schema.key_column_usage kcu
         JOIN information_schema.table_constraints tc ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         WHERE tc.constraint_type = 'PRIMARY KEY'
           AND kcu.table_schema = c.table_schema AND kcu.table_name = c.table_name AND kcu.column_name = c.column_name
       ) AS "isPrimaryKey"
     FROM information_schema.columns c
     WHERE c.table_schema = $1 AND c.table_name = $2
     ORDER BY c.ordinal_position`,
    [schema, table],
  );
  return (rows as unknown as PgColumn[]);
}

// ── 索引 ──

export async function listIndexes(conn: DatabaseConnectionClient, schema: string, table: string): Promise<PgIndex[]> {
  const [rows] = await conn.query<Array<Record<string, unknown>>>(
    `SELECT
       schemaname AS schema,
       tablename AS table,
       indexname AS name,
       (SELECT array_agg(a.attname ORDER BY k.n)
        FROM pg_index ix
        JOIN pg_class ic ON ic.oid = ix.indexrelid
        JOIN pg_class tc ON tc.oid = ix.indrelid
        JOIN pg_namespace ns ON ns.oid = tc.relnamespace
        CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, n)
        JOIN pg_attribute a ON a.attrelid = tc.oid AND a.attnum = k.attnum
        WHERE ns.nspname = schemaname AND tc.relname = tablename AND ic.relname = indexname
       ) AS columns,
       NOT indexdef LIKE '%UNIQUE%' IS FALSE AS "isUnique",
       (SELECT ix.indisprimary FROM pg_index ix JOIN pg_class ic ON ic.oid = ix.indexrelid WHERE ic.relname = indexname LIMIT 1) AS "isPrimary",
       (regexp_match(indexdef, 'USING (\\w+)'))[1] AS "indexType",
       indexdef AS definition
     FROM pg_indexes
     WHERE schemaname = $1 AND tablename = $2
     ORDER BY indexname`,
    [schema, table],
  );
  return (rows as unknown as PgIndex[]);
}

// ── 约束 ──

export async function listConstraints(conn: DatabaseConnectionClient, schema: string, table: string): Promise<PgConstraint[]> {
  const [rows] = await conn.query<Array<Record<string, unknown>>>(
    `SELECT
       tc.table_schema AS schema,
       tc.table_name AS table,
       tc.constraint_name AS name,
       tc.constraint_type AS type,
       array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS columns,
       pg_get_constraintdef(
         (SELECT oid FROM pg_constraint WHERE conname = tc.constraint_name AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = tc.table_schema) LIMIT 1)
       ) AS definition,
       ccu.table_name AS "foreignTable",
       array_agg(DISTINCT ccu.column_name) FILTER (WHERE tc.constraint_type = 'FOREIGN KEY') AS "foreignColumns"
     FROM information_schema.table_constraints tc
     LEFT JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
     LEFT JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema AND tc.constraint_type = 'FOREIGN KEY'
     WHERE tc.table_schema = $1 AND tc.table_name = $2
     GROUP BY tc.table_schema, tc.table_name, tc.constraint_name, tc.constraint_type, ccu.table_name
     ORDER BY tc.constraint_type, tc.constraint_name`,
    [schema, table],
  );
  return (rows as unknown as PgConstraint[]);
}

// ── 函数/存储过程 ──

export async function listFunctions(conn: DatabaseConnectionClient, schema: string): Promise<PgFunction[]> {
  const [rows] = await conn.query<Array<Record<string, unknown>>>(
    `SELECT
       n.nspname AS schema,
       p.proname AS name,
       pg_get_function_result(p.oid) AS "returnType",
       pg_get_function_identity_arguments(p.oid) AS "argumentTypes",
       CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END AS type
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = $1 AND p.prokind IN ('f','p')
     ORDER BY p.proname`,
    [schema],
  );
  return (rows as unknown as PgFunction[]);
}

// ── 触发器 ──

export async function listTriggers(conn: DatabaseConnectionClient, schema: string, table: string): Promise<PgTrigger[]> {
  const [rows] = await conn.query<Array<Record<string, unknown>>>(
    `SELECT
       trigger_schema AS schema,
       event_object_table AS table,
       trigger_name AS name,
       action_timing AS timing,
       string_agg(event_manipulation, ' OR ' ORDER BY event_manipulation) AS events,
       action_statement AS definition
     FROM information_schema.triggers
     WHERE trigger_schema = $1 AND event_object_table = $2
     GROUP BY trigger_schema, event_object_table, trigger_name, action_timing, action_statement
     ORDER BY trigger_name`,
    [schema, table],
  );
  return (rows as unknown as PgTrigger[]);
}

// ── 序列 ──

export async function listSequences(conn: DatabaseConnectionClient, schema: string): Promise<PgSequence[]> {
  const [rows] = await conn.query<Array<Record<string, unknown>>>(
    `SELECT
       sequence_schema AS schema,
       sequence_name AS name,
       data_type AS "dataType",
       start_value::text AS "startValue",
       increment::text AS increment,
       minimum_value::text AS "minValue",
       maximum_value::text AS "maxValue"
     FROM information_schema.sequences
     WHERE sequence_schema = $1
     ORDER BY sequence_name`,
    [schema],
  );
  return (rows as unknown as PgSequence[]);
}

// ── SQL 补全用的表+列元数据 ──

export async function completionMetadata(conn: DatabaseConnectionClient, schema: string): Promise<{
  tables: Array<{ name: string; type: string }>;
  columns: Array<{ table: string; name: string; dataType: string }>;
}> {
  const [tables] = await conn.query<Array<Record<string, unknown>>>(
    `SELECT c.relname AS name,
       CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view' END AS type
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relkind IN ('r','v','m') ORDER BY c.relname`,
    [schema],
  );
  const [columns] = await conn.query<Array<Record<string, unknown>>>(
    `SELECT table_name AS table, column_name AS name, data_type AS "dataType"
     FROM information_schema.columns WHERE table_schema = $1 ORDER BY table_name, ordinal_position`,
    [schema],
  );
  return {
    tables: tables as unknown as Array<{ name: string; type: string }>,
    columns: columns as unknown as Array<{ table: string; name: string; dataType: string }>,
  };
}
