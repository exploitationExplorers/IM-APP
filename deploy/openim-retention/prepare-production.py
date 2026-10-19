#!/usr/bin/env python3
"""Backend-local inspection/configuration only; no build, restart, DDL or purge.

Existing OSS credentials stay in their original private overrides. A separate
retention key is generated on the backend, never in the downloadable bundle.
"""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import socket
import subprocess
import sys
import urllib.error
import urllib.request
import uuid

HOST = "izbp15qkzomsmdhdmtx27dz"
OLD = Path("/root/im-app-oss-production/oss-production-bundle/private")
SHARED = "im-app-openim-net"
PROTOCOL = "im-app-retention-visibility-v2"
DOCKER = ["docker", "--host=unix:///var/run/docker.sock"]
CHAT_SOURCE = "https://oss-chat-test.xn--jprz53bj9s.com/im-app-production/chat/"
BUSINESS_ORIGIN = "https://oss-business-test.xn--jprz53bj9s.com"
BINARIES = ("openim-rpc-msg", "openim-msgtransfer", "openim-rpc-third", "openim-rpc-user", "openim-rpc-group")
GC_POLICY = "managed_v1_only_default_on_after_writer_verification"


class Refused(RuntimeError):
    pass


def require(condition, code):
    if not condition:
        raise Refused(code)


def docker(args):
    # Never inherit a remote Docker context/host or shell Compose overrides.
    env = {k: v for k, v in os.environ.items() if not k.startswith(("DOCKER_", "COMPOSE_"))}
    try:
        result = subprocess.run(DOCKER + args, capture_output=True, env=env, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        raise Refused("LOCAL_DOCKER_READ_FAILED") from None
    require(result.returncode == 0, "LOCAL_DOCKER_READ_FAILED")
    return result.stdout


def detail(name):
    return json.loads(docker(["inspect", name]))[0]


def settings(info):
    return dict(item.split("=", 1) for item in info["Config"].get("Env", []) if "=" in item)


def resolved_environment(service):
    # `compose config` serializes a reusable Compose model, escaping literal
    # dollars again. Compare its runtime values, never rewrite the saved file.
    return {k: str(v if v is not None else "").replace("$$", "$")
            for k, v in service.get("environment", {}).items()}


def old_compose(kind):
    is_api = kind == "api"
    directory = "/www/wwwroot/deploy" + ("" if is_api else "/openim")
    return ["compose", "--project-directory", directory,
            "--env-file", "/www/wwwroot/deploy/.env", "--project-name", "im-app" if is_api else "openim",
            "-f", directory + "/docker-compose.yml", "-f", str(OLD / (kind + ".compose.json"))]


def process_counts():
    # Executable paths only: do not collect process arguments or environment.
    raw = docker(["exec", "openim-api", "sh", "-c",
                  'for p in /proc/[0-9]*/exe; do readlink "$p" 2>/dev/null || :; done'])
    names = [PurePosixPath(p).name for p in raw.decode().splitlines()]
    return {name: names.count(name) for name in BINARIES}


def masked(info, paths):
    return any(PurePosixPath(m["Destination"]) == p or PurePosixPath(m["Destination"]) in p.parents
               for m in info.get("Mounts", []) for p in map(PurePosixPath, paths))


def inspect():
    result = {"kind": "retention_readonly_inventory", "private_port_must_not_be_published": 19093}
    for name in ("im-app-api", "openim-api", "im-app-postgres", "openim-mongodb"):
        info = detail(name)
        env = settings(info)
        item = {"status": info["State"]["Status"], "image_id": info["Image"],
                "health": info["State"].get("Health", {}).get("Status", "not_configured"),
                "compose_files": info["Config"].get("Labels", {}).get("com.docker.compose.project.config_files", ""),
                "networks": sorted(info["NetworkSettings"].get("Networks", {}))}
        if name == "im-app-api":
            item["storage_provider"] = env.get("STORAGE_PROVIDER", "missing")
            item["required_oss_values_present"] = all(env.get(k) for k in
                ("OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET", "OSS_MEDIA_SIGNING_KEY", "OSS_BUCKET"))
            item["retention_mode"] = env.get("GROUP_RETENTION_MODE", "not_explicit")
        result[name] = item
    result["openim_processes"] = process_counts()
    result["saved_oss_overrides_present"] = all((OLD / (kind + ".compose.json")).is_file() for kind in ("api", "openim"))
    print(json.dumps(result, indent=2))
    print("RETENTION_INVENTORY_OK: read_only; no_secrets_printed")


def verify_manifest(root):
    manifest = json.loads((root / "bundle-manifest.json").read_text())
    require(manifest.get("kind") == "retention-incremental" and manifest.get("protocol") == PROTOCOL and
            manifest.get("platform") == "linux/amd64" and manifest.get("groupVisibility") == "enabled_by_default_all_groups" and
            manifest.get("mongoBodyPurge") == "disabled_by_default" and manifest.get("ossObjectPurge") == GC_POLICY and
            manifest.get("mediaGCProtocol") == "im-app-media-gc-v1",
            "WRONG_RELEASE_MANIFEST")
    require(re.fullmatch(r"[0-9a-f]{40}", manifest.get("sourceCommit", "")), "INVALID_SOURCE_COMMIT")
    for name, digest in manifest["files"].items():
        p = PurePosixPath(name)
        require(not p.is_absolute() and not ({"..", "."} & set(p.parts)) and "\\" not in name and ":" not in name,
                "UNSAFE_MANIFEST_PATH")
        file = root.joinpath(*p.parts)
        require(file.resolve().is_relative_to(root) and not file.is_symlink(), "UNSAFE_MANIFEST_PATH")
        require(hashlib.sha256(file.read_bytes()).hexdigest() == digest, "RELEASE_CHECKSUM_MISMATCH")
    return manifest


def validate_runtime():
    configs, infos = {}, {}
    for kind, name, service in (("api", "im-app-api", "api"), ("openim", "openim-api", "openim-api")):
        config = json.loads(docker(old_compose(kind) + ["config", "--format", "json"]))["services"][service]
        info = detail(name)
        env = settings(info)
        require(info["State"]["Running"] and not info["State"].get("Restarting"), "RESTORE_HEALTHY_OSS_APPLICATION_FIRST")
        if kind == "api":
            require(info["State"].get("Health", {}).get("Status") == "healthy", "RESTORE_HEALTHY_OSS_API_FIRST")
        image = json.loads(docker(["image", "inspect", config["image"]]))[0]
        if image["Id"] != info["Image"]:
            # An already installed retention overlay is a valid upgrade base.
            # Never revert to the old OSS image or regenerate its credentials.
            current = json.loads(docker(["image", "inspect", info["Image"]]))[0]
            require(current.get("Config", {}).get("Labels", {}).get("im.app.retention", "").startswith("visibility-v2-"),
                    "RUNNING_IMAGE_DIFFERS_FROM_SAVED_OSS_OVERRIDE")
            image = current
        require(image["Architecture"] == "amd64" and image["Os"] == "linux", "AMD64_IMAGES_REQUIRED")
        # Compare the previously saved runtime values, not newly introduced
        # optional settings in the updated base Compose (e.g. retention mode).
        saved = json.loads((OLD / (kind + ".compose.json")).read_text())["services"][service]
        resolved = resolved_environment(config)
        # Retention/GC overlays intentionally change only these reviewed task
        # settings. Comparing them to the ORIGINAL OSS cutover would reject a
        # valid upgrade (or force operators to restore obsolete task switches).
        mutable = {"MEDIA_GC_REFERENCE_GUARD_ENABLED", "MEDIA_SOURCE_URL_PREFIXES",
                   "FAVORITE_ARCHIVE_WORKER_ENABLED"}
        require(all(env.get(k, "") == resolved.get(k, "")
                    for k in saved.get("environment", {})
                    if not k.startswith(("GROUP_RETENTION_", "IM_APP_RETENTION_", "IM_APP_MEDIA_GC_")) and k not in mutable),
                "RUNNING_ENV_DIFFERS_FROM_SAVED_OSS_OVERRIDE")
        require(SHARED in info["NetworkSettings"]["Networks"] and info["HostConfig"].get("NetworkMode") != "host",
                "EXPECTED_SHARED_BRIDGE_NETWORK_REQUIRED")
        targets = ["/app/im-server", "/app/migrations"] if kind == "api" else [
            "/openim-server/_output/bin/platforms/linux/amd64/" + p for p in BINARIES]
        require(not masked(info, targets), "BINARY_OR_MIGRATIONS_HIDDEN_BY_MOUNT")
        configs[kind], infos[kind] = config, info
    api, chat = settings(infos["api"]), settings(infos["openim"])
    require(api.get("STORAGE_PROVIDER") == "oss" and api.get("MIGRATIONS_MODE") == "verify" and
            api.get("APP_ENV") == "oss-production", "EXISTING_OSS_PRODUCTION_CONFIGURATION_REQUIRED")
    require(all(api.get(k) for k in ("OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET", "OSS_BUCKET", "OSS_MEDIA_SIGNING_KEY")),
            "EXISTING_OSS_CREDENTIALS_OR_SIGNING_KEY_MISSING")
    require(api.get("OSS_PUBLIC_UPLOAD_URL", "").rstrip("/") == BUSINESS_ORIGIN and
            api.get("OSS_KEY_PREFIX") == "im-app-production/business/" and
            chat.get("IM_APP_OSS_PREFIX") == "im-app-production/chat/", "MEDIA_SOURCE_SCOPE_CHANGED_REVIEW_REQUIRED")
    require(chat.get("IM_APP_ENV") == "oss-production", "KEEP_EXISTING_OSS_OPENIM_IMAGE")
    require(all(not infos["openim"]["HostConfig"].get("PortBindings", {}).get(str(p)+"/tcp") for p in (19093,19094)), "PRIVATE_BRIDGE_PORT_IS_PUBLISHED")
    counts = process_counts()
    require(counts["openim-rpc-msg"] == 1 and counts["openim-msgtransfer"] >= 1, "REVIEW_OPENIM_PROCESS_TOPOLOGY")
    pg = detail("im-app-postgres")
    require(settings(pg).get("POSTGRES_DB") == "imapp", "BUSINESS_DATABASE_IDENTITY_CHANGED")
    return infos, api


def private_write(path, text):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as file:
        file.write(text)


def prepare(root, group_id):
    manifest = verify_manifest(root)
    if group_id:
        require(str(uuid.UUID(group_id)) == group_id, "CANARY_REQUIRES_CANONICAL_BUSINESS_GROUP_UUID")
    infos, api = validate_runtime()
    directory = root / "private"
    require(not directory.exists() and not directory.is_symlink(), "PRIVATE_CONFIG_EXISTS_DO_NOT_REGENERATE")
    # Only scoped, public HTTPS origins; never grant the whole OSS bucket here.
    sources = [p.strip() for p in api.get("MEDIA_SOURCE_URL_PREFIXES", "").split(",") if p.strip()]
    sources.extend((CHAT_SOURCE, BUSINESS_ORIGIN + "/im-app-production/business/"))
    require(all(not any(c in p for c in "\r\n'\"$ ") for p in sources), "REVIEW_EXISTING_MEDIA_SOURCE_FORMAT")
    tag = manifest["sourceCommit"][:12] + "-" + secrets.token_hex(4)
    values = {"RETENTION_API_IMAGE": "im-app-retention-api:" + tag,
              "RETENTION_OPENIM_IMAGE": "im-app-retention-openim:" + tag}
    images = {"BASE_API_IMAGE": infos["api"]["Image"], "BASE_OPENIM_IMAGE": infos["openim"]["Image"], **values}
    key = api.get("GROUP_RETENTION_ADAPTER_KEY") or secrets.token_hex(32)
    require(re.fullmatch(r"[0-9a-f]{64}", key), "EXISTING_RETENTION_KEY_FORMAT_REQUIRES_REVIEW")
    if api.get("GROUP_RETENTION_ADAPTER_KEY"):
        require(settings(infos["openim"]).get("IM_APP_RETENTION_KEY") == key, "EXISTING_BRIDGE_KEY_MISMATCH")
    values.update(IM_APP_RETENTION_KEY=key, RETENTION_MEDIA_SOURCE_URL_PREFIXES=",".join(dict.fromkeys(sources)),
                  RETENTION_CANARY_GROUP_ID=group_id)
    directory.mkdir(mode=0o700)
    private_write(directory / "retention.env", "".join(k + "='" + v + "'\n" for k, v in values.items()))
    private_write(directory / "images.env", "".join(k + "='" + v + "'\n" for k, v in images.items()))
    private_write(directory / "prepared.json", json.dumps({"sourceCommit": manifest["sourceCommit"], "images": images,
        "openim_process_counts": process_counts(), "data_containers": {n: {"id": detail(n)["Id"], "started_at": detail(n)["State"]["StartedAt"]}
                            for n in ("im-app-postgres", "openim-mongodb")}}, indent=2) + "\n")
    print("RETENTION_CONFIGURATION_PREPARED: " + str(directory))
    print("key=backend_generated_or_reused; original_oss_keys=unchanged; worker_install=on; final_policy=all_groups")
    print("builds=none; migrations=none; service_restarts=none; acceptance=pending")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def verify(root):
    manifest = verify_manifest(root)
    api, chat = detail("im-app-api"), detail("openim-api")
    env = settings(api)
    require(SHARED in api["NetworkSettings"]["Networks"], "API_NOT_ON_SHARED_NETWORK")
    addr = chat["NetworkSettings"]["Networks"][SHARED]["IPAddress"]
    require(ipaddress.ip_address(addr).is_private, "PRIVATE_BRIDGE_ADDRESS_REQUIRED")
    require(env.get("GROUP_RETENTION_ADAPTER_URL") == "http://openim-api:19093" and
            len(env.get("GROUP_RETENTION_ADAPTER_KEY", "")) >= 32, "API_BRIDGE_CONFIG_MISSING")
    require(all(not chat["HostConfig"].get("PortBindings", {}).get(str(p)+"/tcp") for p in (19093,19094)) and
            chat["HostConfig"].get("NetworkMode") != "host", "PRIVATE_BRIDGE_PORT_IS_PUBLISHED")
    counts = process_counts()
    expected = json.loads((root / "private/prepared.json").read_text()).get("openim_process_counts", {})
    require(all(counts.get(n) == expected.get(n) and counts.get(n,0) >= 1 for n in BINARIES), "REVIEW_OPENIM_PROCESS_TOPOLOGY")
    for name, container, target in [("im-server", "im-app-api", "/app/im-server")] + [
        (n, "openim-api", "/openim-server/_output/bin/platforms/linux/amd64/"+n) for n in BINARIES]:
        digest = docker(["exec", container, "sha256sum", target]).decode().split()[0]
        require(digest == manifest["files"][name], "RUNNING_BINARY_DIFFERS_FROM_RELEASE")
    # Hash actual running /proc/*/exe as well as installed files. A container
    # can hold new files while mage still runs stale or missing writers.
    hashes = docker(["exec", "openim-api", "sh", "-c", '''for p in /proc/[0-9]*/exe; do
      n=$(readlink "$p" 2>/dev/null) || continue; n=${n##*/}
      case "$n" in openim-rpc-msg|openim-msgtransfer|openim-rpc-third|openim-rpc-user|openim-rpc-group)
        h=$(sha256sum "$p" 2>/dev/null) || exit 1; printf '%s %s\\n' "$n" "${h%% *}";; esac
    done''']).decode().splitlines()
    actual = {n: [] for n in BINARIES}
    for row in hashes:
        n, digest = row.split(); actual[n].append(digest)
    require(all(len(actual[n])==counts[n] and all(h==manifest["files"][n] for h in actual[n]) for n in BINARIES),
            "STALE_OR_MISSING_RUNNING_WRITER")
    require(env.get("MEDIA_GC_REFERENCE_GUARD_ENABLED") == "true" and
            settings(chat).get("IM_APP_MEDIA_GC_REFERENCES") == "true", "MEDIA_REFERENCE_GUARDS_REQUIRED")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    def call(key):
        req = urllib.request.Request("http://" + addr + ":19093/internal/retention/capabilities",
                                     headers={"Authorization": "Bearer " + key})
        try:
            with opener.open(req, timeout=10) as response:
                return response.status, response.read(16384)
        except urllib.error.HTTPError as error:
            return error.code, b""
    code, raw = call(env["GROUP_RETENTION_ADAPTER_KEY"])
    require(code == 200, "PRIVATE_BRIDGE_NOT_READY_OR_KEY_MISMATCH")
    caps = json.loads(raw)
    require(caps == {"protocol": PROTOCOL, "mode": "visibility_only", "bodyPurge": "off", "objectPurge": "off"},
            "UNEXPECTED_BRIDGE_CAPABILITIES")
    require(call("invalid-auth-check")[0] == 401, "PRIVATE_BRIDGE_ACCEPTED_WRONG_KEY")
    try:
        with opener.open("http://127.0.0.1:8080/health",timeout=5) as response:
            require(response.headers.get("X-IM-Media-Reference-Guard")=="im-app-media-gc-v1", "BUSINESS_REFERENCE_GUARD_NOT_RUNNING")
    except (urllib.error.URLError, OSError):
        raise Refused("BUSINESS_HEALTH_UNAVAILABLE") from None
    baseline = json.loads((root / "private/prepared.json").read_text())
    for name, before in baseline["data_containers"].items():
        now = detail(name)
        require(now["Id"] == before["id"] and now["State"]["StartedAt"] == before["started_at"], "DATA_CONTAINER_WAS_RESTARTED")
    print("RETENTION_SERVER_CHECKS_OK: all_live_writer_hashes_match; protocol=v2; wrong_key=401; body_purge=off; managed_GC_activation_separate")
    print("scope=server_capabilities_only; full_OpenIM_and_device_acceptance=still_required")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("inspect", "prepare", "verify"))
    parser.add_argument("--group-id", default="", help="optional single canary business UUID, not sg_ conversation ID")
    args = parser.parse_args()
    require(sys.platform.startswith("linux") and os.geteuid() == 0 and socket.gethostname().lower() == HOST,
            "RUN_ON_THE_KNOWN_BACKEND_AS_ROOT_ONLY")
    root = Path(__file__).absolute().parent
    require(root == root.resolve(), "SYMLINK_RELEASE_DIRECTORY_REFUSED")
    if args.action == "inspect":
        inspect()
    elif args.action == "prepare":
        require(root.is_relative_to(Path("/root/im-app-retention")), "EXTRACT_NEW_RELEASE_UNDER_ROOT_IM_APP_RETENTION")
        os.umask(0o077)
        prepare(root, args.group_id)
    else:
        verify(root)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("RETENTION_CONFIGURATION_FAILED: " + (str(error) if isinstance(error, Refused) else "CHECK_FAILED_NO_PRIVATE_DETAILS_PRINTED"),
              file=sys.stderr)
        sys.exit(1)
