import { describe, expect, it } from "vitest";
import {
  DOCKER_LOG_REF_PREFIX,
  buildSshDockerLogsFollowCommand,
  buildSshDockerLogsSnapshotCommand,
  parseDockerContainerName,
  validateConfiguredLogPath,
} from "../src/shared/environment-log.js";
import { prepareLogFollowCommand, prepareLogSnapshotCommand } from "../src/shared/log-path-resolver.js";

describe("docker log references", () => {
  it("accepts docker container references in configured paths", () => {
    const ref = `${DOCKER_LOG_REF_PREFIX}im-app-api`;
    expect(parseDockerContainerName(ref)).toBe("im-app-api");
    expect(() => validateConfiguredLogPath(ref)).not.toThrow();
    expect(() => validateConfiguredLogPath("/var/log/app.log")).not.toThrow();
    expect(() => validateConfiguredLogPath("relative.log")).toThrow();
    expect(() => validateConfiguredLogPath(`${DOCKER_LOG_REF_PREFIX}bad name`)).toThrow();
  });

  it("builds docker logs follow and snapshot commands with quoted container names", () => {
    expect(buildSshDockerLogsFollowCommand("im-app-api", 200)).toBe("docker logs -f --tail 200 'im-app-api' 2>&1");
    expect(buildSshDockerLogsSnapshotCommand("im-app-api", 50)).toBe("docker logs --tail 50 'im-app-api' 2>&1");
  });

  it("uses docker logs directly for a single docker reference", async () => {
    const command = await prepareLogFollowCommand(async () => ({ stdout: "", stderr: "", exitCode: 0 }), [`${DOCKER_LOG_REF_PREFIX}im-app-api`], 100);
    expect(command).toBe("docker logs -f --tail 100 'im-app-api' 2>&1");
  });

  it("resolves docker references before tailing multiple paths", async () => {
    const containerId = "a".repeat(64);
    const logPath = `/var/lib/docker/containers/${containerId}/${containerId}-json.log`;
    const commands: string[] = [];
    const command = await prepareLogFollowCommand(async (shellCommand) => {
      commands.push(shellCommand);
      return { stdout: `${logPath}\n`, stderr: "", exitCode: 0 };
    }, [`${DOCKER_LOG_REF_PREFIX}im-app-api`, "/var/log/nginx/access.log"], 200);
    expect(commands).toEqual([`docker inspect -f '{{.LogPath}}' 'im-app-api'`]);
    expect(command).toBe(`tail -n 200 -F -- '${logPath}' '/var/log/nginx/access.log'`);
  });

  it("prepares docker snapshot commands without resolving file paths", async () => {
    const command = await prepareLogSnapshotCommand(async () => ({ stdout: "", stderr: "", exitCode: 0 }), [`${DOCKER_LOG_REF_PREFIX}im-app-api`], 80);
    expect(command).toBe("docker logs --tail 80 'im-app-api' 2>&1");
  });
});
