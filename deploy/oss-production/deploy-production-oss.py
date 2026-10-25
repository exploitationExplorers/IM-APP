#!/usr/bin/env python3
"""Apply the reviewed OSS upload cutover on the existing backend only."""
import base64
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ORIGIN = "https://www.xn--jprz53bj9s.com"
# 聊天桶的 CDN 基址。留空 = 关闭，OpenIM 的 AccessURL 会逐字节回退到「签名直连 OSS」
# （也就是 2026-10-21 之前的线上行为），不会有任何可见变化。
# 要启用时，在部署机上先 export IM_APP_CHAT_CDN_BASE=https://oss-chat.whs188.xin 再跑本脚本。
# 必须是干净的 HTTPS 源站：不能带路径 / 查询串 / fragment / 凭据（scopedoss 会校验并拒绝）。
CHAT_CDN_BASE = os.environ.get("IM_APP_CHAT_CDN_BASE", "").strip()
STORES = {
    "chat": ("yikeliao-188-hk-test", "https://oss-chat-test.xn--jprz53bj9s.com", "im-app-production/chat/"),
    "business": ("yikeliao-188-business-hk-test", "https://oss-business-test.xn--jprz53bj9s.com", "im-app-production/business/"),
}
BACKUP = Path("/root/im-app-oss-production/backups/20261018T052055Z-acf70ebb")
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class Failed(RuntimeError):
    pass


def load_helper(root):
    spec = importlib.util.spec_from_file_location("oss_backup_helper", root / "backup-production-oss.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def request(url, method="GET", data=None, headers=None):
    try:
        with HTTP.open(urllib.request.Request(url, method=method, data=data, headers=headers or {}), timeout=15) as response:
            return response.status, response.headers, response.read(1024 * 1024)
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read(1024 * 1024)
    except Exception:
        raise Failed("HTTP_CONNECTION_FAILED") from None


def signed_url(kind, key, method, content_type, secrets):
    bucket, origin, prefix = STORES[kind]
    if not key.startswith(prefix) or any(part in ("", ".", "..") for part in key.split("/")):
        raise Failed("OSS_PROBE_KEY_INVALID")
    expires = str(int(time.time()) + 300)
    canonical = method + "\n\n" + content_type + "\n" + expires + "\n/" + bucket + "/" + key
    signature = base64.b64encode(hmac.new(secrets["access_key_secret"].encode(), canonical.encode(), hashlib.sha1).digest()).decode()
    return origin + "/" + key + "?" + urllib.parse.urlencode({"OSSAccessKeyId": secrets["access_key_id"], "Expires": expires, "Signature": signature})


def check_cors(kind):
    _, origin, prefix = STORES[kind]
    for method, headers in (("PUT", "content-type"), ("POST", "content-type"), ("PUT", "authorization,content-type,x-oss-date")):
        status, result, _ = request(origin + "/" + prefix + "__cors_check", "OPTIONS", headers={"Origin": ORIGIN, "Access-Control-Request-Method": method, "Access-Control-Request-Headers": headers})
        if status != 200 or result.get("Access-Control-Allow-Origin") not in (ORIGIN, "*"):
            raise Failed("OSS_CORS_NOT_READY_" + kind.upper())


def probe_storage(secrets):
    results = {}
    for kind in STORES:
        check_cors(kind)
        key = STORES[kind][2] + "__deploy_probe/" + uuid.uuid4().hex + ".bin"
        payload = ("im-app-oss-deploy-check:" + uuid.uuid4().hex).encode()
        url = signed_url(kind, key, "PUT", "application/octet-stream", secrets)
        if request(url, "PUT", payload, {"Content-Type": "application/octet-stream"})[0] not in (200, 204):
            raise Failed("OSS_WRITE_PROBE_FAILED_" + kind.upper())
        status, _, raw = request(signed_url(kind, key, "GET", "", secrets))
        if status != 200 or raw != payload:
            raise Failed("OSS_READ_PROBE_FAILED_" + kind.upper())
        results[kind] = (key, payload)
    return results


def check_manifest(root):
    manifest = json.loads((root / "bundle-manifest.json").read_text())
    if manifest.get("platform") != "linux/amd64" or manifest.get("openim") != "v3.8.3-patch.15":
        raise Failed("BUNDLE_PLATFORM_MISMATCH")
    for relative, digest in manifest["files"].items():
        path = Path(relative)
        if path.is_absolute() or ".." in path.parts or "\\" in relative or ":" in relative:
            raise Failed("BUNDLE_PATH_UNSAFE")
        source = root / path
        if source.is_symlink() or hashlib.sha256(source.read_bytes()).hexdigest() != digest:
            raise Failed("BUNDLE_CHECKSUM_MISMATCH")
    for name in ("im-server", "openim-rpc-third", "schema-required.json", "migrations/051_file_storage_location.sql", "api.Dockerfile", "openim.Dockerfile", "backup-production-oss.py", "deploy-production-oss.py"):
        if name not in manifest["files"]:
            raise Failed("BUNDLE_FILE_MISSING")


def json_private(b, path, value):
    b.write_private(path, (json.dumps(value, indent=2) + "\n").encode())


def run(b, args, log, input_data=None, timeout=300):
    with log.open("ab") as output:
        os.chmod(log, 0o600)
        try:
            result = subprocess.run(b.command(args), input=input_data, stdout=output, stderr=output,
                                    env=b.local_env(), timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise Failed("DEPLOY_COMMAND_TIMEOUT_OR_UNAVAILABLE") from None
    if result.returncode:
        raise Failed("DEPLOY_COMMAND_FAILED")


def pg_args(b, detail, readonly):
    identity, database = b.pg_identity(detail)
    options = "PGOPTIONS=-c default_transaction_read_only=" + ("on" if readonly else "off") + " -c statement_timeout=10000 -c lock_timeout=2000"
    return ["exec", "-i", "--env", options, detail["Id"], "timeout", "30s", "psql", "--no-psqlrc", *identity, "--dbname", database, "--set=ON_ERROR_STOP=1"]


def check_schema(b, detail, root):
    required = json.loads((root / "schema-required.json").read_text())
    raw = b.read([*pg_args(b, detail, True), "-At", "-F", "|", "-c",
                  "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'"])
    columns = {tuple(line.split("|")) for line in raw.decode().splitlines()}
    for table, names in required.items():
        for column in names:
            if table == "files" and column in ("storage_provider", "storage_bucket"):
                continue
            if (table, column) not in columns:
                raise Failed("REQUIRED_COLUMN_MISSING_" + table + "_" + column)


def patch_third_config(raw, secrets):
    text = raw.decode("utf-8-sig")
    matches = list(re.finditer(r"^object:[ \t]*(?:#.*)?$", text, re.MULTILINE))
    if len(matches) != 1:
        raise Failed("OPENIM_OBJECT_CONFIG_NOT_UNIQUE")
    start = matches[0].start()
    next_section = re.search(r"^[A-Za-z_][A-Za-z_0-9-]*:", text[matches[0].end():], re.MULTILINE)
    end = matches[0].end() + next_section.start() if next_section else len(text)
    bucket, origin, _ = STORES["chat"]
    fields = {"endpoint": origin, "bucket": bucket, "bucketURL": origin, "accessKeyID": secrets["access_key_id"], "accessKeySecret": secrets["access_key_secret"], "sessionToken": "", "publicRead": False}
    block = "object:\n  enable: oss\n  oss:\n" + "".join("    " + key + ": " + json.dumps(value) + "\n" for key, value in fields.items())
    return (text[:start] + block + "\n" + text[end:]).encode()


def compose_args(original, project, override):
    return ["compose", "--project-directory", str(original.parent), "--env-file", "/www/wwwroot/deploy/.env", "--project-name", project, "-f", str(original), "-f", str(override)]


def compose_env(values):
    # Compose interpolates dollar signs even in JSON. Preserve runtime secrets.
    return {key: value.replace("$", "$$") for key, value in values.items()}


def openim_call(path, body, token=""):
    status, _, raw = request("http://127.0.0.1:10002" + path, "POST", json.dumps(body).encode(), {"Content-Type": "application/json", "operationID": "oss-cutover-" + uuid.uuid4().hex, "token": token})
    if status != 200:
        raise Failed("OPENIM_HTTP_CHECK_FAILED")
    result = json.loads(raw)
    if result.get("errCode") != 0:
        raise Failed("OPENIM_RPC_CHECK_FAILED")
    return result.get("data") or {}


def admin_token(env):
    secret = env.get("OPENIM_SECRET")
    if not secret:
        raise Failed("OPENIM_SECRET_NOT_IN_EXISTING_API_ENV")
    return openim_call("/auth/get_admin_token", {"secret": secret, "userID": env.get("OPENIM_ADMIN_USER") or "imAdmin"})["token"]


def wait_healthy(check, seconds=150):
    for _ in range(seconds // 3):
        try:
            check()
            return
        except Exception:
            time.sleep(3)
    raise Failed("SERVICE_HEALTH_CHECK_TIMED_OUT")


def api_health():
    if request("http://127.0.0.1:8080/health")[0] != 200:
        raise Failed("API_HEALTH_FAILED")


def verify_business(secrets, probe):
    key, payload = probe
    token = base64.urlsafe_b64encode(hmac.new(secrets["media_signing_key"].encode(), (STORES["business"][0] + "\n" + key).encode(), hashlib.sha256).digest()).decode().rstrip("=")
    query = urllib.parse.urlencode({"key": key, "token": token})
    status, _, result = request(ORIGIN + "/api/v1/public/oss-media?" + query)
    if status != 200 or result != payload:
        raise Failed("BUSINESS_PUBLIC_MEDIA_CHECK_FAILED")


def verify_chat(env):
    token = admin_token(env)
    limit = openim_call("/object/part_limit", {}, token)
    if int(limit.get("minPartSize", 0)) != 1048576:
        raise Failed("OPENIM_THIRD_ENGINE_NOT_OSS")
    payload = ("im-app-openim-oss-check:" + uuid.uuid4().hex).encode()
    name = (env.get("OPENIM_ADMIN_USER") or "imAdmin") + "/oss-deploy-check-" + uuid.uuid4().hex + ".bin"
    part_md5 = hashlib.md5(payload).hexdigest()
    # OpenIM's hash is MD5 of the joined part MD5 strings, even for one PUT.
    body = {"name": name, "hash": hashlib.md5(part_md5.encode()).hexdigest(), "size": len(payload), "contentType": "application/octet-stream", "maxParts": 1, "cause": "oss-deploy-check", "urlPrefix": ORIGIN + "/object/"}
    upload = openim_call("/object/initiate_multipart_upload", body, token)["upload"]
    part = upload["sign"]["parts"][0]
    parsed = urllib.parse.urlsplit(part["url"])
    # SDK URLs may percent-encode slashes. Decode only for checking the scope;
    # send the original signed URL unchanged.
    if "https://" + parsed.netloc != STORES["chat"][1] or not urllib.parse.unquote(parsed.path).startswith("/" + STORES["chat"][2]) or part.get("query"):
        raise Failed("OPENIM_UPLOAD_SIGNING_HOST_OR_PREFIX_WRONG")
    headers = {item["key"]: item["values"][0] for item in part.get("header", [])}
    if request(part["url"], "PUT", payload, headers)[0] not in (200, 204):
        raise Failed("OPENIM_SIGNED_UPLOAD_FAILED")
    complete = dict(body, uploadID=upload["uploadID"], parts=[part_md5])
    openim_call("/object/complete_multipart_upload", complete, token)
    access = openim_call("/object/access_url", {"name": name}, token)["url"]
    if urllib.parse.urlsplit(access).netloc != urllib.parse.urlsplit(STORES["chat"][1]).netloc:
        raise Failed("OPENIM_READ_HOST_WRONG")
    if request(access)[2] != payload:
        raise Failed("OPENIM_NEW_OBJECT_READ_FAILED")


def deploy(root):
    check_manifest(root)
    b = load_helper(root)
    secrets = json.loads((root / "oss.private.json").read_text())
    if not re.fullmatch(r"[A-Za-z0-9]{12,128}", secrets.get("access_key_id", "")) or len(secrets.get("access_key_secret", "")) < 16 or not re.fullmatch(r"[a-f0-9]{64}", secrets.get("media_signing_key", "")):
        raise Failed("OSS_PRIVATE_SETTINGS_INVALID")
    private = root / "private"
    b.private_directory(private)
    if (private / "deployment-state.private.json").exists():
        raise Failed("PREVIOUS_DEPLOYMENT_STATE_EXISTS_KEEP_FOR_REVIEW")
    details = {name: b.check_detail(name, json.loads(b.read(["inspect", name]))[0]) for name in b.CONTAINERS}
    old_manifest = json.loads((BACKUP / "manifest.private.json").read_text())
    if old_manifest.get("status") != "archives_created_not_restore_tested" or (BACKUP / "INCOMPLETE").exists():
        raise Failed("EXISTING_BACKUP_RECORD_INCOMPLETE")
    for name, path in b.CONFIG_HASHES.items():
        if hashlib.sha256(b.read(["exec", details["openim-api"]["Id"], "cat", name])).hexdigest() != path:
            raise Failed("OPENIM_CONFIG_CHANGED_SINCE_INVENTORY")
    for local, original in old_manifest["host_files"].items():
        if Path(original).read_bytes() != (BACKUP / "host-config" / local).read_bytes():
            raise Failed("HOST_CONFIG_CHANGED_SINCE_BACKUP")
    for name in ("im-app-api", "openim-api"):
        image = json.loads(b.read(["image", "inspect", details[name]["Image"]]))[0]
        if image.get("Architecture") != "amd64" or image.get("Os") != "linux":
            raise Failed("SERVER_IMAGE_PLATFORM_MISMATCH")
    b.read(["exec", details["im-app-api"]["Id"], "test", "-x", "/app/im-server"])
    b.read(["exec", details["openim-api"]["Id"], "test", "-x", "/openim-server/_output/bin/platforms/linux/amd64/openim-rpc-third"])
    check_schema(b, details["im-app-postgres"], root)
    api_health()
    env = b.settings(details["im-app-api"])
    admin_token(env)
    print("step=oss_permissions_cors_and_read_write_probe", flush=True)
    probes = probe_storage(secrets)
    print("preflight=passed; probes=2_new_objects; database_restores=none", flush=True)
    tag = "20261018-" + uuid.uuid4().hex[:8]
    state = {"tag": tag, "phase": "building", "original_containers": details}
    state_path = private / "deployment-state.private.json"
    json_private(b, state_path, state)
    def phase(value):
        state["phase"] = value
        state_path.write_text(json.dumps(state, indent=2) + "\n")
        os.chmod(state_path, 0o600)
        print("step=" + value, flush=True)
    images = {}
    for kind, name in (("api", "im-app-api"), ("openim", "openim-api")):
        base = "im-app-oss-original-" + kind + ":" + tag
        images[kind] = "im-app-oss-production-" + kind + ":" + tag
        b.read(["tag", details[name]["Image"], base])
        run(b, ["build", "--pull=false", "--network=none", "--build-arg", "BASE_IMAGE=" + base, "-f", str(root / (kind + ".Dockerfile")), "-t", images[kind], str(root)], private / "build.private.log", timeout=600)
    bucket, origin, prefix = STORES["business"]
    api_env = dict(env, APP_ENV="oss-production", MIGRATIONS_MODE="verify", SEED_DEMO="false", STORAGE_PROVIDER="oss", OSS_REGION="cn-hongkong", OSS_ENDPOINT="https://oss-cn-hongkong.aliyuncs.com", OSS_BUCKET=bucket,
                   OSS_ACCESS_KEY_ID=secrets["access_key_id"], OSS_ACCESS_KEY_SECRET=secrets["access_key_secret"], OSS_SESSION_TOKEN="", OSS_KEY_PREFIX=prefix, OSS_PUBLIC_UPLOAD_URL=origin,
                   OSS_PUBLIC_BASE_URL="", OSS_MEDIA_PROXY_URL=ORIGIN + "/api/v1/public/oss-media", OSS_MEDIA_SIGNING_KEY=secrets["media_signing_key"])
    third_path = private / "openim-rpc-third.yml"
    b.write_private(third_path, patch_third_config(b.read(["exec", details["openim-api"]["Id"], "cat", "/openim-server/config/openim-rpc-third.yml"]), secrets))
    openim_env = dict(b.settings(details["openim-api"]), IM_APP_ENV="oss-production", IM_APP_OSS_PREFIX=STORES["chat"][2], IM_APP_CHAT_CDN_BASE=CHAT_CDN_BASE)
    # Explicitly override object-related legacy env keys already present.
    for key in list(openim_env):
        if key.endswith("OBJECT_ENABLE"):
            openim_env[key] = "oss"
    api_override, openim_override = private / "api.compose.json", private / "openim.compose.json"
    json_private(b, api_override, {"services": {"api": {"image": images["api"], "environment": compose_env(api_env)}}})
    json_private(b, openim_override, {"services": {"openim-api": {"image": images["openim"], "environment": compose_env(openim_env), "volumes": [{"type": "bind", "source": str(third_path), "target": "/openim-server/config/openim-rpc-third.yml", "read_only": True}]}}})
    business = compose_args(Path("/www/wwwroot/deploy/docker-compose.yml"), "im-app", api_override)
    chat = compose_args(Path("/www/wwwroot/deploy/openim/docker-compose.yml"), "openim", openim_override)
    run(b, [*business, "config", "--quiet"], private / "compose.private.log")
    run(b, [*chat, "config", "--quiet"], private / "compose.private.log")
    state["new_images"] = images
    state["compose"] = {"business": business, "chat": chat}
    phase("add_two_file_storage_columns")
    sql = b"BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='10s'; SET LOCAL search_path=public;\n" + (root / "migrations/051_file_storage_location.sql").read_bytes() + b"\nCOMMIT;\n"
    run(b, pg_args(b, details["im-app-postgres"], False), private / "schema.private.log", input_data=sql, timeout=35)
    phase("update_business_api_only")
    run(b, [*business, "up", "-d", "--no-deps", "--no-build", "--pull", "never", "api"], private / "compose.private.log")
    wait_healthy(api_health)
    verify_business(secrets, probes["business"])
    phase("update_openim_application_only")
    run(b, [*chat, "up", "-d", "--no-deps", "--no-build", "--pull", "never", "openim-api"], private / "compose.private.log")
    def chat_ready():
        result = openim_call("/object/part_limit", {}, admin_token(env))
        if int(result.get("minPartSize", 0)) != 1048576:
            raise Failed("WAITING_FOR_OSS_THIRD_SERVICE")
    wait_healthy(chat_ready)
    verify_chat(env)
    for name in ("im-app-postgres", "openim-mongodb", "im-app-minio", "openim-minio"):
        current = b.check_detail(name, json.loads(b.read(["inspect", name]))[0])
        if current["Id"] != details[name]["Id"] or current["State"].get("StartedAt") != details[name]["State"].get("StartedAt"):
            raise Failed("DATA_SERVICE_CHANGED_DURING_DEPLOY")
    phase("server_upload_checks_passed")
    print("IM_APP_PRODUCTION_OSS_DEPLOY_OK", flush=True)
    print("business=public_media_read_passed; chat=signed_upload_complete_and_read_passed", flush=True)
    print("old_database_records_and_minio=retained; database_restores=none; frontend_native_acceptance=pending", flush=True)
    print("future_compose_commands=require_the_saved_override_files; private_state=" + str(private), flush=True)


def main():
    if sys.argv[1:] != ["deploy"] or platform.system() != "Linux" or socket.gethostname().lower() != "izbp15qkzomsmdhdmtx27dz" or os.geteuid() != 0:
        raise Failed("RUN_PYTHON3_SCRIPT_DEPLOY_ON_BACKEND_ONLY")
    root = Path(__file__).resolve().parent
    if not str(root).startswith("/root/im-app-oss-production/") or root.is_symlink():
        raise Failed("EXTRACT_BUNDLE_UNDER_ROOT_IM_APP_OSS_PRODUCTION")
    os.umask(0o077)
    os.chmod(root, 0o700)
    os.chmod(root / "oss.private.json", 0o600)
    print("IM_APP_PRODUCTION_OSS_DEPLOY_BEGIN", flush=True)
    deploy(root)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        reason = str(error) if isinstance(error, Failed) else "DEPLOY_CHECK_OR_COMMAND_FAILED"
        print("IM_APP_PRODUCTION_OSS_DEPLOY_FAILED: " + reason + "; keep private state; no database restore is performed", file=sys.stderr)
        sys.exit(1)
