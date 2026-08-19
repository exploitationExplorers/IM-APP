import type { Readable } from "node:stream";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import type { ClientChannel } from "ssh2";
import type { WorkspaceType } from "../access-control.js";
import { connectSsh, loadSshConnection, type ConnectedSsh } from "../ssh/connector.js";
import { decryptDatabaseCredential, hydrateDatabaseOptions } from "../database-credentials.js";
import { IdleResourcePool } from "../../shared/idle-resource-pool.js";
import type { DatabaseConnectionClient, DatabaseConnectionRecord, ConnectedDatabase } from "./connector.js";

const { Client: PgClient } = pg;

class PgDatabaseClient implements DatabaseConnectionClient {
  constructor(private client: pg.Client) {}

  async query<T = unknown>(sql: string, values?: unknown): Promise<[T, unknown[]]> {
    const result = await this.client.query(sql, values as unknown[]);
    const fields = (result.fields ?? []).map((f) => ({
      name: f.name,
      table: (f as unknown as Record<string, string>).tableID?.toString() ?? "",
      type: f.dataTypeID,
    }));
    const rows = result.rows ?? [];
    const merged = Object.assign(rows, {
      affectedRows: result.rowCount ?? 0,
      insertId: 0,
      info: result.command ?? "",
    });
    return [merged as T, fields as unknown[]];
  }

  async beginTransaction(): Promise<void> {
    await this.client.query("BEGIN");
  }

  async commit(): Promise<void> {
    await this.client.query("COMMIT");
  }

  async rollback(): Promise<void> {
    await this.client.query("ROLLBACK");
  }

  escape(value: unknown): string {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  async end(): Promise<void> {
    await this.client.end();
  }

  destroy(): void {
    this.client.end().catch(() => {});
  }
}

function forward(client: ConnectedSsh["client"], host: string, port: number): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    client.forwardOut("127.0.0.1", 0, host, port, (error, stream) => {
      if (error) reject(error);
      else resolve(stream);
    });
  });
}

export async function createPgConnection(
  app: FastifyInstance,
  record: DatabaseConnectionRecord,
  database?: string,
): Promise<ConnectedDatabase> {
  let ssh: ConnectedSsh | undefined;
  try {
    let stream: ClientChannel | Readable | undefined;
    if (record.connectionMode === "sshTunnel") {
      if (!record.options.sshConnectionId) throw new Error("数据库连接没有配置 SSH Tunnel 连接");
      const tunnel = await loadSshConnection(app, record.options.sshConnectionId);
      if (tunnel.workspaceType !== record.workspaceType || tunnel.workspaceId !== record.workspaceId) {
        throw new Error("SSH Tunnel 连接不属于同一工作空间");
      }
      ssh = await connectSsh(app, record.options.sshConnectionId);
      stream = await forward(ssh.client, record.host, record.port);
    }

    const ssl = record.options.ssl;
    const pgConfig: pg.ClientConfig = {
      host: record.host,
      port: record.port,
      user: record.username,
      password: record.password,
      database: (database ?? record.defaultDatabase) || undefined,
      connectionTimeoutMillis: record.options.connectTimeoutMs ?? 10_000,
      statement_timeout: 30_000,
    };

    if (stream) {
      pgConfig.stream = stream as unknown as pg.ClientConfig["stream"];
    }

    if (ssl?.enabled) {
      pgConfig.ssl = {
        rejectUnauthorized: ssl.rejectUnauthorized !== false,
        ca: ssl.ca || undefined,
        cert: ssl.certificate || undefined,
        key: ssl.privateKey || undefined,
      };
    }

    const client = new PgClient(pgConfig);
    await client.connect();

    const connection = new PgDatabaseClient(client);
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
