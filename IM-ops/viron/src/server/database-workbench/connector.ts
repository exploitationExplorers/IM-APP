import type { Readable } from "node:stream";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import mysql, { type ConnectionOptions } from "mysql2/promise";
import type { ClientChannel } from "ssh2";
import type { WorkspaceType } from "../access-control.js";
import { connectSsh, loadSshConnection, type ConnectedSsh } from "../ssh/connector.js";
import { NavicatHttpTunnelConnection } from "./http-tunnel.js";
import { decryptDatabaseCredential, hydrateDatabaseOptions } from "../database-credentials.js";
import { IdleResourcePool } from "../../shared/idle-resource-pool.js";
import { createPgConnection } from "./pg-connector.js";

export interface DatabaseConnectionClient {
  // 返回行统一用 unknown[]：MySQL 传 FieldPacket[]、PostgreSQL 传 pg 字段描述，
  // 上层只消费第一个元素（行数据），第二个元素按需自行断言
  query<T = unknown>(sql: string, values?: unknown): Promise<[T, unknown[]]>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  escape(value: unknown): string;
  end(): Promise<void>;
  destroy(): void;
}

export interface DatabaseConnectionRecord {
  id: string;
  workspaceType: WorkspaceType;
  workspaceId: string;
  name: string;
  engine: "mysql" | "mariadb" | "postgresql";
  host: string;
  port: number;
  username: string;
  password: string;
  httpTunnelUsername: string;
  httpTunnelPassword: string;
  defaultDatabase: string;
  connectionMode: "tcp" | "sshTunnel" | "httpTunnel";
  options: {
    charset?: string;
    timezone?: string;
    connectTimeoutMs?: number;
    sshConnectionId?: string | null;
    ssl?: {
      enabled?: boolean;
      rejectUnauthorized?: boolean;
      ca?: string;
      certificate?: string;
      privateKey?: string;
      passphrase?: string;
    };
    httpTunnelUrl?: string;
    httpTunnelRejectUnauthorized?: boolean;
  };
}

export interface ConnectedDatabase {
  connection: DatabaseConnectionClient;
  record: DatabaseConnectionRecord;
  close(): Promise<void>;
}

function decodeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function loadDatabaseConnection(app: FastifyInstance, connectionId: string): Promise<DatabaseConnectionRecord> {
  const row = await app.db.prepare(`
    SELECT id, workspace_type, workspace_id, name, engine, host, port, username, credential_ciphertext,
      default_database, connection_mode, options_json
    FROM database_connections WHERE id = ?
  `).get(connectionId) as
    | {
        id: string;
        workspace_type: WorkspaceType;
        workspace_id: string;
        name: string;
        engine: "mysql" | "mariadb" | "postgresql";
        host: string;
        port: number;
        username: string;
        credential_ciphertext: string;
        default_database: string;
        connection_mode: "tcp" | "sshTunnel" | "httpTunnel";
        options_json: string;
      }
    | undefined;
  if (!row) throw new Error("数据库连接不存在");
  const credential = decryptDatabaseCredential(app, row.credential_ciphertext);
  const options = hydrateDatabaseOptions(decodeJson(row.options_json, {}), credential);
  return {
    id: row.id,
    workspaceType: row.workspace_type,
    workspaceId: row.workspace_id,
    name: row.name,
    engine: row.engine,
    host: row.host,
    port: Number(row.port),
    username: row.username,
    password: credential.password ?? "",
    httpTunnelUsername: credential.httpTunnelUsername ?? "",
    httpTunnelPassword: credential.httpTunnelPassword ?? "",
    defaultDatabase: row.default_database,
    connectionMode: row.connection_mode,
    options,
  };
}

function forward(client: ConnectedSsh["client"], host: string, port: number): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    client.forwardOut("127.0.0.1", 0, host, port, (error, stream) => {
      if (error) reject(error);
      else resolve(stream);
    });
  });
}

function mysqlOptions(record: DatabaseConnectionRecord, database?: string, stream?: Readable): ConnectionOptions {
  const ssl = record.options.ssl;
  const options: ConnectionOptions = {
    host: record.host,
    port: record.port,
    user: record.username,
    password: record.password,
    database: (database ?? record.defaultDatabase) || undefined,
    charset: record.options.charset || "utf8mb4",
    timezone: (record.options.timezone || "local") as ConnectionOptions["timezone"],
    connectTimeout: record.options.connectTimeoutMs ?? 10_000,
    multipleStatements: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    decimalNumbers: false,
    rowsAsArray: false,
  };
  if (stream) options.stream = stream;
  if (ssl?.enabled) {
    options.ssl = {
      rejectUnauthorized: ssl.rejectUnauthorized !== false,
      ca: ssl.ca || undefined,
      cert: ssl.certificate || undefined,
      key: ssl.privateKey || undefined,
      passphrase: ssl.passphrase || undefined,
    };
  }
  return options;
}

async function createDatabaseConnection(app: FastifyInstance, record: DatabaseConnectionRecord, database?: string): Promise<ConnectedDatabase> {
  if (record.engine === "postgresql") {
    // PostgreSQL 中 database 参数实际是 schema 名，连接时始终用 defaultDatabase
    return createPgConnection(app, record, undefined);
  }

  if (record.connectionMode === "httpTunnel") {
    if (!record.options.httpTunnelUrl) throw new Error("数据库连接没有配置 HTTP Tunnel URL");
    const connection = new NavicatHttpTunnelConnection({
      url: record.options.httpTunnelUrl,
      host: record.host,
      port: record.port,
      username: record.username,
      password: record.password,
      database: (database ?? record.defaultDatabase) || "",
      timeoutMs: record.options.connectTimeoutMs ?? 10_000,
      basicAuthUsername: record.httpTunnelUsername,
      basicAuthPassword: record.httpTunnelPassword,
      rejectUnauthorized: record.options.httpTunnelRejectUnauthorized !== false,
    });
    return { connection, record, close: () => connection.end() };
  }

  let ssh: ConnectedSsh | undefined;
  try {
    let stream: ClientChannel | undefined;
    if (record.connectionMode === "sshTunnel") {
      if (!record.options.sshConnectionId) throw new Error("数据库连接没有配置 SSH Tunnel 连接");
      const tunnel = await loadSshConnection(app, record.options.sshConnectionId);
      if (tunnel.workspaceType !== record.workspaceType || tunnel.workspaceId !== record.workspaceId) {
        throw new Error("SSH Tunnel 连接不属于同一工作空间");
      }
      ssh = await connectSsh(app, record.options.sshConnectionId);
      stream = await forward(ssh.client, record.host, record.port);
    }
    const connection = await mysql.createConnection(mysqlOptions(record, database, stream)) as DatabaseConnectionClient;
    return {
      connection,
      record,
      close: async () => {
        try {
          await connection.end();
        } catch {
          connection.destroy();
        }
        ssh?.close();
      },
    };
  } catch (error) {
    ssh?.close();
    throw error;
  }
}

interface PooledDatabase {
  connected: ConnectedDatabase;
  usable: boolean;
}

const databasePools = new WeakMap<object, IdleResourcePool<PooledDatabase>>();

function databasePool(app: FastifyInstance): IdleResourcePool<PooledDatabase> {
  const existing = databasePools.get(app.server);
  if (existing) return existing;
  const pool = new IdleResourcePool<PooledDatabase>({
    maxIdlePerKey: 2,
    usable: (resource) => resource.usable,
    dispose: (resource) => resource.connected.close(),
  });
  databasePools.set(app.server, pool);
  app.server.once("close", () => { void pool.close(); });
  return pool;
}

function databaseFingerprint(record: DatabaseConnectionRecord): string {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

export async function connectDatabase(app: FastifyInstance, connectionId: string, database?: string): Promise<ConnectedDatabase> {
  const record = await loadDatabaseConnection(app, connectionId);
  const selectedDatabase = database ?? record.defaultDatabase;
  const key = `${record.id}\0${selectedDatabase}\0${databaseFingerprint(record)}`;
  const lease = await databasePool(app).acquire(key, async () => ({
    connected: await createDatabaseConnection(app, record, database),
    usable: true,
  }));
  const pooled = lease.resource;
  const call = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      pooled.usable = false;
      throw error;
    }
  };
  const connection: DatabaseConnectionClient = {
    query: (sql, values) => call(() => pooled.connected.connection.query(sql, values)),
    beginTransaction: () => call(() => pooled.connected.connection.beginTransaction()),
    commit: () => call(() => pooled.connected.connection.commit()),
    rollback: () => call(() => pooled.connected.connection.rollback()),
    escape: (value) => pooled.connected.connection.escape(value),
    end: async () => { await lease.release(!pooled.usable); },
    destroy: () => {
      pooled.usable = false;
      pooled.connected.connection.destroy();
    },
  };
  return {
    connection,
    record: pooled.connected.record,
    close: async () => { await lease.release(!pooled.usable); },
  };
}

export async function closeDatabaseConnectionPool(app: FastifyInstance, connectionId?: string): Promise<void> {
  const pool = databasePools.get(app.server);
  if (!pool) return;
  await pool.invalidate(connectionId ? (key) => key.startsWith(`${connectionId}\0`) : undefined);
}
