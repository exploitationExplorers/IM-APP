#!/usr/bin/env python3
"""Online backups for the inspected backend. No deployment or database writes.

Standalone MongoDB dumps are explicitly NOT point-in-time snapshots. Archive
checks below are structural checks, not a successful restore rehearsal.
"""
import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import socket
import stat
import subprocess
import sys
import time
import uuid
from urllib.parse import quote

EXPECTED_HOST = "iZbp15qkzomsmdhdmtx27dZ"
BACKUP_ROOT = Path("/root/im-app-oss-production/backups")
GIB = 1024 ** 3
RESERVE = 10 * GIB
BUDGET = 20 * GIB
CONTAINERS = {
    "im-app-api": ("sha256:da6fe40e24b776fad83bdcead41e0752862fd324b4451d16b4a104d9b0619ad3", None),
    "openim-api": ("sha256:0ceab4d1aa3b7cc5a8175ad7a5b3d6e36f00f2f395b04248c9b494ab0769840c", None),
    "im-app-postgres": ("sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea", ("/var/lib/postgresql/data", "im-app_im_pg_data")),
    "openim-mongodb": ("sha256:8b6d8f5bbedb25cb73517b65cf99f13aeb75ad5b157a56c479287a840bbad3ac", ("/data/db", "openim_openim_mongo_data")),
    "im-app-minio": ("sha256:451fe6858cb770cc9d0e77ba811ce287420f781c7c1b806a386f6896471a349c", ("/bitnami/minio/data", "im-app_im_minio_data")),
    "openim-minio": ("sha256:451fe6858cb770cc9d0e77ba811ce287420f781c7c1b806a386f6896471a349c", ("/bitnami/minio/data", "openim_openim_minio_data")),
}
HOST_FILES = (
    "/www/wwwroot/deploy/docker-compose.yml",
    "/www/wwwroot/deploy/.env",
    "/www/wwwroot/deploy/openim/docker-compose.yml",
    "/www/wwwroot/deploy/openim/webhooks.yml",
    "/www/server/panel/vhost/nginx/im-app.conf",
)
CONFIG_HASHES = {
    "/openim-server/config/openim-rpc-third.yml": "a116434991b343567828b2eafea2c682af2044b401c67087444880d3ccc1975d",
    "/openim-server/config/minio.yml": "b981290d4c92119527b22c7b24200c8b0df6c103c679d451139f5cdddb8df9ae",
}
PG_OPTIONS = "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=600000 -c lock_timeout=5000"
MONGO_QUERY = r"""
const a = db.getSiblingDB('admin');
if (!process.env.MONGO_INITDB_ROOT_USERNAME || !process.env.MONGO_INITDB_ROOT_PASSWORD ||
    !a.auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD)) quit(31);
const h = a.runCommand({hello: 1, maxTimeMS: 5000});
if (!h.ok || h.msg === 'isdbgrid' || !h.isWritablePrimary) quit(32);
const names = a.runCommand({listDatabases: 1, nameOnly: true, maxTimeMS: 5000});
if (!names.ok) quit(33);
let bytes = 0;
for (const item of names.databases) {
  if (item.name === 'local') continue;
  const s = db.getSiblingDB(item.name).runCommand({dbStats: 1, scale: 1, maxTimeMS: 5000});
  if (!s.ok) quit(34);
  bytes += Number(s.dataSize);
}
print(JSON.stringify({topology: h.setName ? 'replica-primary' : 'standalone', data_bytes: bytes}));
"""


class Refused(RuntimeError):
    pass


def local_env():
    return {key: value for key, value in os.environ.items() if not key.startswith("DOCKER_")}


def command(args):
    return ["docker", "--host=unix:///var/run/docker.sock", *args]


def read(args, timeout=30):
    try:
        result = subprocess.run(command(args), stdin=subprocess.DEVNULL, capture_output=True,
                                env=local_env(), timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise Refused("DOCKER_READ_FAILED") from None
    if result.returncode:
        raise Refused("DOCKER_READ_FAILED")
    return result.stdout


def settings(detail):
    return dict(item.split("=", 1) for item in detail["Config"].get("Env", []) if "=" in item)


def check_detail(name, detail):
    image, volume = CONTAINERS[name]
    if detail.get("Name") != "/" + name or detail.get("Image") != image:
        raise Refused("CONTAINER_IDENTITY_CHANGED")
    state = detail.get("State", {})
    if not state.get("Running") or state.get("Restarting") or state.get("Paused"):
        raise Refused("CONTAINER_NOT_RUNNING")
    if (state.get("Health") or {}).get("Status") not in (None, "healthy"):
        raise Refused("CONTAINER_NOT_HEALTHY")
    if volume and not any(m.get("Type") == "volume" and m.get("Destination") == volume[0]
                          and m.get("Name") == volume[1] for m in detail.get("Mounts", [])):
        raise Refused("DATA_VOLUME_CHANGED")
    return detail


def mongo_input(detail):
    env = settings(detail)
    username, password = env.get("MONGO_INITDB_ROOT_USERNAME"), env.get("MONGO_INITDB_ROOT_PASSWORD")
    if not username or not password:
        raise Refused("MONGO_AUTH_ENV_MISSING")
    # Database Tools --config supports uri/password. Credentials go through
    # stdin, never command arguments or terminal output; no container temp file.
    uri = "mongodb://" + quote(username, safe="") + "@127.0.0.1:27017/?authSource=admin&directConnection=true&serverSelectionTimeoutMS=5000"
    return ("uri: " + json.dumps(uri) + "\npassword: " + json.dumps(password) + "\n").encode()


def mongo_args(detail, topology):
    args = ["exec", "-i", detail["Id"], "timeout", "900s", "mongodump", "--config=/dev/stdin",
            "--archive", "--gzip", "--numParallelCollections=1", "--quiet"]
    if topology == "replica-primary":
        args.append("--oplog")
    elif topology != "standalone":
        raise Refused("UNSUPPORTED_MONGO_TOPOLOGY")
    return args


def pg_identity(detail):
    env = settings(detail)
    user = env.get("POSTGRES_USER", "postgres")
    database = env.get("POSTGRES_DB", user)
    if database != "imapp" or not re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]{0,62}", user):
        raise Refused("POSTGRES_DATABASE_CHANGED")
    return ["--username", user, "--no-password"], database


def private_directory(path):
    # No symlinks or shared existing directories anywhere in the private tree.
    for item in reversed([path, *path.parents]):
        if item.is_symlink():
            raise Refused("UNSAFE_BACKUP_DIRECTORY")
        if not item.exists():
            item.mkdir(mode=0o700)
        if item == Path("/root") or item == Path("/"):
            continue
        info = item.stat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
            raise Refused("UNSAFE_BACKUP_DIRECTORY")


def write_private(path, data):
    with path.open("xb") as out:
        os.chmod(path, 0o600)
        out.write(data)


def guard_space(root, used, extra=0):
    if used + extra > BUDGET or shutil.disk_usage(root).free < RESERVE + extra:
        raise Refused("BACKUP_DISK_BUDGET_EXCEEDED")


def stream(args, path, input_data=None, timeout=900):
    root = path.parent
    used_before = sum(p.stat().st_size for p in root.rglob("*") if p.is_file())
    started = time.monotonic()
    with path.open("xb") as out, (root / "commands.private.log").open("ab") as err:
        os.chmod(path, 0o600)
        os.chmod(root / "commands.private.log", 0o600)
        proc = subprocess.Popen(command(args), stdin=subprocess.PIPE if input_data is not None else subprocess.DEVNULL,
                                stdout=out, stderr=err, env=local_env())
        try:
            if input_data is not None:
                proc.stdin.write(input_data)
                proc.stdin.close()
            while proc.poll() is None:
                guard_space(root, used_before + path.stat().st_size + (root / "commands.private.log").stat().st_size)
                if time.monotonic() - started > timeout:
                    raise Refused("BACKUP_COMMAND_TIMEOUT")
                time.sleep(0.25)
            if proc.returncode:
                raise Refused("BACKUP_COMMAND_FAILED")
            if path.stat().st_size == 0:
                raise Refused("EMPTY_BACKUP_ARCHIVE")
            guard_space(root, used_before + path.stat().st_size)
        finally:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5)


def fingerprint(path):
    digest = hashlib.sha256()
    with path.open("rb") as src:
        for chunk in iter(lambda: src.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"bytes": path.stat().st_size, "sha256": digest.hexdigest()}


def preflight():
    details = {name: check_detail(name, json.loads(read(["inspect", name]))[0]) for name in CONTAINERS}
    for config, expected in CONFIG_HASHES.items():
        if hashlib.sha256(read(["exec", details["openim-api"]["Id"], "cat", config])).hexdigest() != expected:
            raise Refused("OPENIM_CONFIG_CHANGED")
    for name, programs in (("im-app-postgres", "timeout pg_dump pg_dumpall pg_restore"),
                           ("openim-mongodb", "timeout mongosh mongodump")):
        # Fixed program list; no user input or credentials in shell text.
        read(["exec", details[name]["Id"], "sh", "-c", "for p in " + programs + "; do command -v \"$p\" >/dev/null || exit 1; done"])
    identity, database = pg_identity(details["im-app-postgres"])
    pg_bytes = int(read(["exec", "--env", PG_OPTIONS, details["im-app-postgres"]["Id"], "timeout", "15s",
                         "psql", "--no-psqlrc", *identity, "--dbname", database, "-Atc",
                         "SELECT pg_database_size(current_database())"]).strip())
    mongo = json.loads(read(["exec", details["openim-mongodb"]["Id"], "timeout", "45s", "mongosh",
                            "--quiet", "--norc", "--eval", MONGO_QUERY], timeout=50))
    if mongo.get("topology") not in ("standalone", "replica-primary") or not isinstance(mongo.get("data_bytes"), (int, float)) or mongo["data_bytes"] < 0:
        raise Refused("UNSUPPORTED_MONGO_TOPOLOGY")
    images = [details[name]["Image"] for name in ("im-app-api", "openim-api")]
    image_bytes = sum(int(json.loads(read(["image", "inspect", image]))[0]["Size"]) for image in images)
    for filename in HOST_FILES:
        path = Path(filename)
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 8 * 1024 * 1024:
            raise Refused("HOST_CONFIG_MISSING_OR_UNSAFE")
    # Deliberately conservative: dumps may be larger than on-disk compressed DBs.
    estimate = image_bytes + 2 * (pg_bytes + int(mongo["data_bytes"])) + GIB
    guard_space(Path("/root"), 0, estimate)
    return details, mongo, images, estimate


def backup():
    print("IM_APP_PRODUCTION_OSS_BACKUP_BEGIN", flush=True)
    details, mongo, images, estimate = preflight()
    print("preflight=passed; mongo_topology=" + mongo["topology"], flush=True)
    private_directory(BACKUP_ROOT)
    root = BACKUP_ROOT / (datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex[:8])
    private_directory(root)
    write_private(root / "INCOMPLETE", b"Do not deploy or restore from this incomplete backup.\n")
    write_private(root / "container-inspect.private.json", json.dumps(details, indent=2).encode())
    configs = root / "host-config"
    configs.mkdir(mode=0o700)
    for index, filename in enumerate(HOST_FILES):
        write_private(configs / (str(index) + "-" + Path(filename).name), Path(filename).read_bytes())
    print("backup_directory=" + str(root), flush=True)
    print("step=configuration_and_rollback_images", flush=True)
    stream(["cp", details["openim-api"]["Id"] + ":/openim-server/config/.", "-"], root / "openim-config.tar", timeout=60)
    stream(["image", "save", *images], root / "rollback-images.tar")
    print("step=postgres_snapshot", flush=True)
    identity, database = pg_identity(details["im-app-postgres"])
    prefix = ["exec", "--env", PG_OPTIONS, details["im-app-postgres"]["Id"], "timeout", "900s"]
    stream([*prefix, "pg_dumpall", *identity, "--globals-only"], root / "postgres-globals.sql")
    stream([*prefix, "pg_dump", *identity, "--dbname", database, "--format=custom", "--compress=3", "--lock-wait-timeout=5s"], root / "postgres.dump")
    # Parse the TOC without connecting to a DB. This does not execute a restore.
    with (root / "postgres.dump").open("rb") as src:
        result = subprocess.run(command(["exec", "-i", details["im-app-postgres"]["Id"], "timeout", "60s", "pg_restore", "--list"]),
                                stdin=src, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                env=local_env(), timeout=65, check=False)
    if result.returncode:
        raise Refused("POSTGRES_ARCHIVE_CHECK_FAILED")
    print("step=mongodb_online_dump; parallel_collections=1", flush=True)
    stream(mongo_args(details["openim-mongodb"], mongo["topology"]), root / "mongodb.archive.gz",
           input_data=mongo_input(details["openim-mongodb"]))
    # Stream gzip CRC validation with bounded memory; never print document data.
    with gzip.open(root / "mongodb.archive.gz", "rb") as src:
        while src.read(1024 * 1024):
            pass
    # Refuse to approve a backup if containers/config changed while it was made.
    for name, before in details.items():
        after = check_detail(name, json.loads(read(["inspect", name]))[0])
        if before["Id"] != after["Id"] or before["State"].get("StartedAt") != after["State"].get("StartedAt"):
            raise Refused("CONTAINER_CHANGED_DURING_BACKUP")
    for config, expected in CONFIG_HASHES.items():
        if hashlib.sha256(read(["exec", details["openim-api"]["Id"], "cat", config])).hexdigest() != expected:
            raise Refused("OPENIM_CONFIG_CHANGED_DURING_BACKUP")
    for index, filename in enumerate(HOST_FILES):
        if Path(filename).read_bytes() != (configs / (str(index) + "-" + Path(filename).name)).read_bytes():
            raise Refused("HOST_CONFIG_CHANGED_DURING_BACKUP")
    manifest = {
        "status": "archives_created_not_restore_tested",
        "postgres": "transaction-consistent pg_dump of imapp; globals are a separate export",
        "mongodb": "replica-set oplog archive" if mongo["topology"] == "replica-primary" else "online standalone baseline; NOT a point-in-time snapshot across collections",
        "restore_rehearsal": "NOT_PERFORMED; required before rollout",
        "checks": ["PostgreSQL TOC readable", "MongoDB gzip CRC", "SHA256 files", "original containers and config unchanged"],
        "host_files": {str(index) + "-" + Path(filename).name: filename for index, filename in enumerate(HOST_FILES)},
        "estimated_bytes": estimate,
        "files": {str(p.relative_to(root)): fingerprint(p) for p in sorted(root.rglob("*")) if p.is_file() and p.name != "INCOMPLETE"},
        "not_backed_up": "MinIO objects, Redis, Kafka, etcd and unrelated volumes; all retained in place and unchanged",
    }
    write_private(root / "manifest.private.json", (json.dumps(manifest, indent=2) + "\n").encode())
    (root / "INCOMPLETE").rename(root / "ARCHIVES_CREATED_NOT_RESTORE_TESTED")
    print("IM_APP_PRODUCTION_OSS_BACKUP_CREATED", flush=True)
    print("postgres=consistent_snapshot; archive_toc=readable", flush=True)
    print("mongodb=" + ("oplog_archive" if mongo["topology"] == "replica-primary" else "online_baseline_NOT_point_in_time"), flush=True)
    print("restore_rehearsal=NOT_PERFORMED; deployment=NOT_PERFORMED", flush=True)
    print("old_minio_volumes=retained; no_database_writes_or_service_restarts", flush=True)


def main():
    if len(sys.argv) != 1 or platform.system() != "Linux" or socket.gethostname().lower() != EXPECTED_HOST.lower() or os.geteuid() != 0:
        raise Refused("RUN_AS_ROOT_ON_BACKEND_8_154_44_197_ONLY")
    os.umask(0o077)
    backup()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Never print subprocess output, env, config text or an exception repr.
        reason = str(error) if isinstance(error, Refused) else "UNEXPECTED_BACKUP_ERROR"
        print("IM_APP_PRODUCTION_OSS_BACKUP_FAILED: " + reason + "; keep partial files private; do not deploy", file=sys.stderr)
        sys.exit(1)
