import {
  buildDockerLogPathInspectCommand,
  buildSshDockerLogsFollowCommand,
  buildSshDockerLogsSnapshotCommand,
  buildSshLogSnapshotCommand,
  buildSshLogTailCommand,
  isDockerLogRef,
  parseDockerContainerName,
  validateResolvedDockerLogPath,
} from "./environment-log.js";

export interface SshExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

async function resolveLogFilePaths(
  exec: (command: string) => Promise<SshExecResult>,
  filePaths: string[],
): Promise<string[]> {
  const resolved: string[] = [];
  for (const filePath of filePaths) {
    if (!isDockerLogRef(filePath)) {
      resolved.push(filePath);
      continue;
    }
    const containerName = parseDockerContainerName(filePath);
    const result = await exec(buildDockerLogPathInspectCommand(containerName));
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || `无法解析 Docker 容器 ${containerName} 的日志路径`);
    }
    const logPath = result.stdout.trim();
    validateResolvedDockerLogPath(logPath);
    resolved.push(logPath);
  }
  return resolved;
}

export async function prepareLogFollowCommand(
  exec: (command: string) => Promise<SshExecResult>,
  filePaths: string[],
  initialLines: number,
): Promise<string> {
  if (filePaths.length === 1 && isDockerLogRef(filePaths[0]!)) {
    return buildSshDockerLogsFollowCommand(parseDockerContainerName(filePaths[0]!), initialLines);
  }
  return buildSshLogTailCommand(await resolveLogFilePaths(exec, filePaths), initialLines);
}

export async function prepareLogSnapshotCommand(
  exec: (command: string) => Promise<SshExecResult>,
  filePaths: string[],
  initialLines: number,
): Promise<string> {
  if (filePaths.length === 1 && isDockerLogRef(filePaths[0]!)) {
    return buildSshDockerLogsSnapshotCommand(parseDockerContainerName(filePaths[0]!), initialLines);
  }
  return buildSshLogSnapshotCommand(await resolveLogFilePaths(exec, filePaths), initialLines);
}
