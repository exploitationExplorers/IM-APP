#!/usr/bin/env python3
"""Known backend only. Short deploy/control commands; never sweep a bucket.

No credentials are printed or copied from the saved OSS overrides. Database
containers/volumes stay running. Activation requires all live writer hashes,
the business reference guard, private ports and a scoped OSS permission probe.
"""
import argparse
import contextlib
import importlib.util
import io
import ipaddress
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

SPEC = importlib.util.spec_from_file_location("retention_production", Path(__file__).with_name("prepare-production.py"))
p = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(p)


def request(path, body=None):
    chat, api = p.detail("openim-api"), p.detail("im-app-api")
    p.require(chat["HostConfig"].get("NetworkMode") != "host" and
              not chat["HostConfig"].get("PortBindings", {}).get("19094/tcp"), "GC_PRIVATE_PORT_IS_PUBLISHED")
    addr = chat["NetworkSettings"]["Networks"][p.SHARED]["IPAddress"]
    p.require(ipaddress.ip_address(addr).is_private, "GC_PRIVATE_ADDRESS_REQUIRED")
    key = p.settings(api).get("GROUP_RETENTION_ADAPTER_KEY", "")
    p.require(len(key) >= 32 and p.settings(chat).get("IM_APP_RETENTION_KEY") == key, "PRIVATE_KEY_MISMATCH")
    req = urllib.request.Request("http://"+addr+":19094/internal/media-gc/"+path,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": "Bearer "+key, "Content-Type": "application/json"})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), p.NoRedirect())
    try:
        with opener.open(req,timeout=55) as response:
            result = json.load(response)
    except (OSError, ValueError, urllib.error.URLError):
        raise p.Refused("GC_PRIVATE_API_UNAVAILABLE_OR_OSS_PERMISSION_CHECK_FAILED") from None
    return result


def shell(root, action):
    result = subprocess.run(["bash",str(root/"production.sh"),action,str(root)],capture_output=True,timeout=600)
    p.require(result.returncode==0,"DEPLOY_STEP_FAILED_"+action.upper().replace("-","_"))


def quiet_verify(root):
    # Retry read-only checks while mage brings up ALL eight transfer writers;
    # do not blindly restart a healthy container because the first curl fails.
    last = None
    for _ in range(40):
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                p.verify(root)
            return
        except p.Refused as error:
            last = error
            time.sleep(3)
    raise last or p.Refused("WRITER_STARTUP_TIMEOUT")


def apply_migrations(root):
    # Only additive, reviewed 052-055. No historical bootstrap or DB restores.
    for name in ("052_media_preservation.sql","053_forward_media_preservation.sql",
                 "054_group_retention_plans.sql","055_group_retention_visibility.sql"):
        sql = "BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='10s'; SET LOCAL search_path=public;\n"+(root/"migrations"/name).read_text()+"\nCOMMIT;\n"
        result = subprocess.run(p.DOCKER+["exec","-i","im-app-postgres","sh","-c",
            'exec psql --no-psqlrc -X --set=ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
            input=sql.encode(),capture_output=True,timeout=45)
        p.require(result.returncode==0,"INCREMENTAL_DDL_FAILED_"+name[:3])


def status():
    state = request("status")
    api = p.settings(p.detail("im-app-api"))
    state["groupRetentionMode"] = api.get("GROUP_RETENTION_MODE","missing")
    state["groupPolicy"] = "last_168_hours_and_at_most_1500_visible_messages_per_group_configurable"
    print(json.dumps(state,ensure_ascii=False,indent=2))


def deploy(root):
    p.verify_manifest(root)
    if not (root/"private").exists():
        p.prepare(root,"")
    else:
        prepared=json.loads((root/"private/prepared.json").read_text())
        p.require(prepared["sourceCommit"]==p.verify_manifest(root)["sourceCommit"],"PREPARED_RELEASE_MISMATCH")
    current = p.settings(p.detail("openim-api"))
    if current.get("IM_APP_MEDIA_GC_REFERENCES")=="true":
        request("configure",{"active":False}) # Wait for any in-flight batch before replacing writers.
    print("step=incremental_ddl_052_055; existing_data_and_volumes_retained",flush=True)
    apply_migrations(root)
    print("step=local_overlay_images; original_OSS_config_preserved",flush=True)
    shell(root,"build")
    print("step=restart_openim_application_only; waiting_for_all_writers",flush=True)
    shell(root,"up-openim")
    # Poll topology before bringing the default-on visibility worker online.
    expected=json.loads((root/"private/prepared.json").read_text())["openim_process_counts"]
    for _ in range(60):
        if p.process_counts()==expected:
            break
        time.sleep(3)
    else:
        raise p.Refused("OPENIM_STARTUP_TIMEOUT_KEEP_GC_INACTIVE")
    print("step=restart_business_application_only; visibility_default_on",flush=True)
    shell(root,"up-api")
    quiet_verify(root)
    print("step=OSS_permission_and_versioning_probe_then_enable_daily_GC",flush=True)
    request("configure",{"active":True})
    print("IM_APP_CHAT_CLEANUP_DEPLOY_OK: group_policy_on; managed_GC_on; schedule=03:30_Asia/Shanghai")
    print("legacy_objects_retained; avatars_favorites_forwards_protected; body_purge_off; device_acceptance_pending")
    status()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action",choices=("deploy","status","preview","run","enable","disable","disable-gc"))
    args=parser.parse_args()
    p.require(sys.platform.startswith("linux") and os.geteuid()==0 and socket.gethostname().lower()==p.HOST,
              "RUN_ON_KNOWN_BACKEND_AS_ROOT_ONLY")
    root=Path(__file__).absolute().parent
    p.require(root==root.resolve() and root.is_relative_to(Path("/root/im-app-retention")),"UNSAFE_RELEASE_ROOT")
    p.verify_manifest(root)
    os.umask(0o077)
    if args.action=="deploy":
        deploy(root)
    elif args.action=="status":
        status()
    elif args.action in ("preview","run"):
        p.verify(root)
        print(json.dumps(request("run",{"dryRun":args.action=="preview"}),indent=2))
    elif args.action=="enable":
        shell(root,"up-api")
        quiet_verify(root)
        request("configure",{"active":True})
        status()
    elif args.action=="disable-gc":
        request("configure",{"active":False})
        print("MANAGED_GC_OFF: all_reference_guards_retained")
    else:
        shell(root,"disable")
        status()


if __name__=="__main__":
    try:
        main()
    except Exception as error:
        print("IM_APP_CHAT_CLEANUP_FAILED: "+(str(error) if isinstance(error,p.Refused) else "CHECK_FAILED_NO_PRIVATE_DETAILS_PRINTED"),file=sys.stderr)
        print("Do not restore databases or revert to unfenced OSS writers. Preserve private state; inspect status and the named step.",file=sys.stderr)
        sys.exit(1)
