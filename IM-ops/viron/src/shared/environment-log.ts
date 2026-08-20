export const MAX_ENVIRONMENT_LOG_FILES = 10;
export const DEFAULT_ENVIRONMENT_LOG_LINES = 200;
export const MIN_ENVIRONMENT_LOG_LINES = 1;
export const MAX_ENVIRONMENT_LOG_LINES = 5000;
export const DOCKER_LOG_REF_PREFIX = "docker://";
const DOCKER_CONTAINER_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const RESOLVED_DOCKER_LOG_PATH_PATTERN = /^\/var\/lib\/docker\/containers\/[a-f0-9]{64}\/[a-f0-9]{64}-json\.log$/;

export function parseStoredLogFilePaths(value: unknown, fallback: unknown): string[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (Array.isArray(parsed)) {
      const paths = parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
      if (paths.length) return paths;
    }
  } catch {
    // Older rows only have file_path; fall through to the compatibility value.
  }
  return typeof fallback === "string" && fallback.length > 0 ? [fallback] : [];
}

export function isDockerLogRef(value: string): boolean {
  return value.startsWith(DOCKER_LOG_REF_PREFIX);
}

export function parseDockerContainerName(value: string): string {
  if (!isDockerLogRef(value)) throw new Error("不是 Docker 容器引用");
  const name = value.slice(DOCKER_LOG_REF_PREFIX.length).trim();
  if (!DOCKER_CONTAINER_NAME_PATTERN.test(name)) {
    throw new Error("Docker 容器名格式无效，仅支持字母、数字、._-，且不能以符号开头");
  }
  return name;
}

export function validateConfiguredLogPath(value: string): void {
  if (isDockerLogRef(value)) {
    parseDockerContainerName(value);
    return;
  }
  if (!value.startsWith("/") || /[\0\r\n]/.test(value)) {
    throw new Error("日志路径必须是无换行的绝对路径，或使用 docker://容器名");
  }
}

export function validateResolvedDockerLogPath(value: string): void {
  if (!RESOLVED_DOCKER_LOG_PATH_PATTERN.test(value)) {
    throw new Error("Docker 日志路径格式异常");
  }
}

export function quotePosixShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function buildDockerLogPathInspectCommand(containerName: string): string {
  parseDockerContainerName(`${DOCKER_LOG_REF_PREFIX}${containerName}`);
  return `docker inspect -f '{{.LogPath}}' ${quotePosixShellArg(containerName)}`;
}

export function buildSshDockerLogsFollowCommand(containerName: string, initialLines: number): string {
  validateLineCount(initialLines);
  parseDockerContainerName(`${DOCKER_LOG_REF_PREFIX}${containerName}`);
  return `docker logs -f --tail ${initialLines} ${quotePosixShellArg(containerName)} 2>&1`;
}

export function buildSshDockerLogsSnapshotCommand(containerName: string, initialLines: number): string {
  validateLineCount(initialLines);
  parseDockerContainerName(`${DOCKER_LOG_REF_PREFIX}${containerName}`);
  return `docker logs --tail ${initialLines} ${quotePosixShellArg(containerName)} 2>&1`;
}

export function buildSshLogTailCommand(filePaths: string[], initialLines: number): string {
  validateLogRequest(filePaths, initialLines);
  return `tail -n ${initialLines} -F -- ${filePaths.map(quotePosixShellArg).join(" ")}`;
}

export function buildSshLogSnapshotCommand(filePaths: string[], initialLines: number): string {
  validateLogRequest(filePaths, initialLines);
  return `tail -n ${initialLines} -- ${filePaths.map(quotePosixShellArg).join(" ")}`;
}

function validateLineCount(initialLines: number): void {
  if (!Number.isInteger(initialLines) || initialLines < MIN_ENVIRONMENT_LOG_LINES || initialLines > MAX_ENVIRONMENT_LOG_LINES) {
    throw new Error(`初始行数必须是 ${MIN_ENVIRONMENT_LOG_LINES}–${MAX_ENVIRONMENT_LOG_LINES} 的整数`);
  }
}

function validateLogRequest(filePaths: string[], initialLines: number): void {
  validateLineCount(initialLines);
  if (!filePaths.length || filePaths.length > MAX_ENVIRONMENT_LOG_FILES) {
    throw new Error(`日志文件数量必须是 1–${MAX_ENVIRONMENT_LOG_FILES}`);
  }
  if (filePaths.some((filePath) => isDockerLogRef(filePath) || !filePath.startsWith("/") || /[\0\r\n]/.test(filePath))) {
    throw new Error("日志文件必须是无换行的绝对路径");
  }
}
