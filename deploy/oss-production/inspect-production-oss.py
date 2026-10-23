#!/usr/bin/env python3
"""Read-only inventory for the existing backend; never dumps config or env."""
import hashlib
import json
import os
import platform
import re
import socket
import subprocess
import sys

EXPECTED_HOST = "iZbp15qkzomsmdhdmtx27dZ"
CONFIG_PATHS = (
    "/openim-server/config/openim-rpc-third.yml",
    "/openim-server/config/minio.yml",
)
SCHEMA_QUERY = """SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('files','app_releases','users','groups')
ORDER BY table_name, ordinal_position"""
SAFE_SETTINGS = {
    "APP_ENV": {"oss-production", "oss-test", "production", "prod", "staging"},
    "STORAGE_PROVIDER": {"minio", "oss"},
    "MIGRATIONS_MODE": {"auto", "verify"},
    "SEED_DEMO": {"true", "false"},
    "IMENV_OBJECT_ENABLE": {"minio", "oss", ""},
}


def candidate(name):
    return bool(re.match(r"^(im-app|im-admin|openim)([-_]|$)", name)) and not re.search(
        r"(^|[-_])(staging|oss[-_]test)([-_]|$)", name
    )


def setting_map(detail):
    result = {}
    for entry in detail.get("Config", {}).get("Env", []) or []:
        key, separator, value = entry.partition("=")
        if separator:
            result[key] = value
    return result


def summary(detail):
    config = detail.get("Config", {})
    state = detail.get("State", {})
    labels = config.get("Labels") or {}
    env = setting_map(detail)
    return {
        "name": detail.get("Name", "").lstrip("/"),
        "image": config.get("Image"),
        "image_id": detail.get("Image"),
        "status": state.get("Status"),
        "health": (state.get("Health") or {}).get("Status", "not-configured"),
        "compose_project": labels.get("com.docker.compose.project"),
        "compose_service": labels.get("com.docker.compose.service"),
        "compose_directory": labels.get("com.docker.compose.project.working_dir"),
        "compose_files": labels.get("com.docker.compose.project.config_files"),
        "working_directory": config.get("WorkingDir"),
        "ports": detail.get("NetworkSettings", {}).get("Ports", {}),
        "mounts": [
            {key: mount.get(key) for key in ("Type", "Name", "Source", "Destination", "RW")}
            for mount in detail.get("Mounts", [])
        ],
        "settings": {
            key: env[key] if env[key] in values else "<set>"
            for key, values in SAFE_SETTINGS.items() if key in env
        },
    }


def object_engine(config_bytes):
    # Report only an allowlisted scalar. Never return an arbitrary YAML value.
    in_object = False
    for line in config_bytes.decode("utf-8-sig").splitlines():
        if re.match(r"^object:\s*(#.*)?$", line):
            in_object = True
            continue
        if in_object and line and not line[0].isspace() and not line.startswith("#"):
            break
        if in_object:
            match = re.match(r"^  enable:\s*['\"]?(minio|oss)['\"]?\s*(#.*)?$", line)
            if match:
                return match.group(1)
    return "not-determined"


def docker(args, required=True):
    # Always inspect this host's existing daemon, regardless of shell overrides.
    env = {key: value for key, value in os.environ.items() if not key.startswith("DOCKER_")}
    try:
        result = subprocess.run(
            ["docker", "--host=unix:///var/run/docker.sock", *args],
            env=env, capture_output=True, timeout=20, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        if required:
            raise RuntimeError("local Docker read failed; no service was changed") from None
        return None
    if result.returncode:
        if required:
            # Docker/psql stderr may contain secrets. Do not echo it.
            raise RuntimeError("local Docker read refused; no service was changed")
        return None
    return result.stdout


def postgres_schema(detail, run=docker):
    env = setting_map(detail)
    username = env.get("POSTGRES_USER", "postgres")
    database = env.get("POSTGRES_DB", username)
    if not all(re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]{0,62}", item) for item in (username, database)):
        return {"status": "not-inspected"}
    result = run([
        "exec", "--env", "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000",
        detail["Id"], "psql", "--no-psqlrc", "--no-password", "--tuples-only", "--no-align",
        "--field-separator=|", "--username", username, "--dbname", database, "--command", SCHEMA_QUERY,
    ], required=False)
    if result is None:
        return {"status": "unavailable-without-interactive-auth"}
    columns = {}
    for line in result.decode().splitlines():
        parts = line.split("|")
        if len(parts) == 2 and parts[0] in {"files", "app_releases", "users", "groups"} and re.fullmatch(r"[a-z_0-9]+", parts[1]):
            columns.setdefault(parts[0], []).append(parts[1])
    return {"status": "read-only-metadata", "database": database, "columns": columns}


def inspect(run=docker):
    version = run(["version", "--format", "{{.Server.Version}}"])
    print("docker_version=" + version.decode().strip())
    rows = run(["ps", "-a", "--format", "{{json .}}"])
    count = 0
    for line in rows.decode().splitlines():
        row = json.loads(line)
        if not candidate(row.get("Names", "")):
            continue
        detail = json.loads(run(["inspect", row["ID"]]))[0]
        item = summary(detail)
        image_id = detail.get("Image")
        if image_id:
            digests = run(["image", "inspect", image_id, "--format", "{{json .RepoDigests}}"], required=False)
            if digests is not None:
                item["image_repo_digests"] = json.loads(digests)
        running = detail.get("State", {}).get("Running", False)
        name = item["name"]
        if running and name.startswith("openim") and any(part in name for part in ("api", "third", "server")):
            item["openim_config"] = []
            for path in CONFIG_PATHS:
                data = run(["exec", detail["Id"], "cat", path], required=False)
                if data is None:
                    continue
                record = {"path": path, "sha256": hashlib.sha256(data).hexdigest()}
                if path.endswith("openim-rpc-third.yml"):
                    record["file_object_engine"] = object_engine(data)
                item["openim_config"].append(record)
        if running and "postgres" in name:
            item["schema"] = postgres_schema(detail, run)
        print(json.dumps(item, ensure_ascii=False, sort_keys=True))
        count += 1
    if not count:
        raise RuntimeError("no expected production containers found; preserve this host unchanged")


def main():
    if len(sys.argv) != 1 or platform.system() != "Linux" or socket.gethostname().lower() != EXPECTED_HOST.lower():
        raise RuntimeError("run without arguments on backend 8.154.44.197 only")
    print("IM_APP_PRODUCTION_OSS_INVENTORY_BEGIN")
    inspect()
    print("IM_APP_PRODUCTION_OSS_INVENTORY_OK: read-only; no deployment, backup, migration or upload performed")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Do not expose subprocess output, config text, env, or tracebacks.
        print("IM_APP_PRODUCTION_OSS_INVENTORY_FAILED: read-only inspection incomplete; no service was changed", file=sys.stderr)
        sys.exit(1)
