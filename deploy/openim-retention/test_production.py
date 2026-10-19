"""Offline production configuration tests; never connect to Docker/servers."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("retention_production", Path(__file__).with_name("prepare-production.py"))
p = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(p)


def bundle(root):
    (root / "example").write_bytes(b"reviewed input")
    data = {"kind": "retention-incremental", "protocol": p.PROTOCOL, "platform": "linux/amd64",
            "sourceCommit": "a" * 40, "groupVisibility": "enabled_by_default_all_groups",
            "mongoBodyPurge": "disabled_by_default", "ossObjectPurge": p.GC_POLICY, "mediaGCProtocol": "im-app-media-gc-v1",
            "files": {"example": hashlib.sha256(b"reviewed input").hexdigest()}}
    (root / "bundle-manifest.json").write_text(json.dumps(data))
    return data


def fixture():
    api = {"STORAGE_PROVIDER": "oss", "APP_ENV": "oss-production", "MIGRATIONS_MODE": "verify",
           "OSS_ACCESS_KEY_ID": "never-print-access-id", "OSS_ACCESS_KEY_SECRET": "never-print-secret-$literal",
           "OSS_MEDIA_SIGNING_KEY": "never-change-signing-key", "OSS_BUCKET": "business",
           "OSS_PUBLIC_UPLOAD_URL": p.BUSINESS_ORIGIN, "OSS_KEY_PREFIX": "im-app-production/business/"}
    chat = {"IM_APP_ENV": "oss-production", "IM_APP_OSS_PREFIX": "im-app-production/chat/"}
    infos = {}
    for kind, env in (("api", api), ("openim", chat)):
        infos[kind] = {"Id": kind, "Image": "sha256:" + ("a" if kind == "api" else "b") * 64,
                       "Config": {"Env": [k + "=" + v for k, v in env.items()], "Labels": {}},
                       "State": {"Status": "running", "Running": True, "Health": {"Status": "healthy"}},
                       "NetworkSettings": {"Networks": {p.SHARED: {}}}, "HostConfig": {}, "Mounts": []}
    return infos, api


class ConfigurationTests(unittest.TestCase):
    def test_manifest_rejects_corruption_policy_and_path_escape(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            data = bundle(root)
            self.assertEqual(p.verify_manifest(root)["sourceCommit"], "a" * 40)
            (root / "example").write_bytes(b"changed")
            with self.assertRaisesRegex(p.Refused, "CHECKSUM"):
                p.verify_manifest(root)
            data["ossObjectPurge"] = True
            (root / "bundle-manifest.json").write_text(json.dumps(data))
            with self.assertRaisesRegex(p.Refused, "MANIFEST"):
                p.verify_manifest(root)
            data["ossObjectPurge"] = p.GC_POLICY
            data["files"] = {"../outside": "0" * 64}
            (root / "bundle-manifest.json").write_text(json.dumps(data))
            with self.assertRaisesRegex(p.Refused, "UNSAFE_MANIFEST_PATH"):
                p.verify_manifest(root)

    def test_prepare_generates_private_key_without_copying_existing_credentials(self):
        infos, api = fixture()
        pg = {"Id": "unchanged-data-id", "State": {"StartedAt": "unchanged-start"}}
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            bundle(root)
            out = io.StringIO()
            with patch.object(p, "validate_runtime", return_value=(infos, api)), patch.object(p, "detail", return_value=pg), patch.object(p,"process_counts",return_value={n:1 for n in p.BINARIES}), contextlib.redirect_stdout(out):
                p.prepare(root, "11111111-1111-4111-8111-111111111111")
                content = (root / "private/retention.env").read_text()
                self.assertRegex(content, r"IM_APP_RETENTION_KEY='[0-9a-f]{64}'")
                self.assertIn(p.CHAT_SOURCE, content)
                self.assertIn("RETENTION_CANARY_GROUP_ID='11111111-1111-4111-8111-111111111111'", content)
                self.assertNotIn("OSS_ACCESS_KEY", content)
                self.assertNotIn("never-print", content + out.getvalue())
                self.assertNotIn("never-change", content + out.getvalue())
                self.assertNotIn("IM_APP_RETENTION_KEY", (root / "private/images.env").read_text())
                with self.assertRaisesRegex(p.Refused, "EXISTS"):
                    p.prepare(root, "")
                self.assertEqual(content, (root / "private/retention.env").read_text())
                if os.name != "nt":
                    self.assertEqual((root / "private").stat().st_mode & 0o777, 0o700)
                    self.assertEqual((root / "private/retention.env").stat().st_mode & 0o777, 0o600)

    def test_runtime_checks_require_saved_oss_images_env_and_single_bridge_process(self):
        infos, _ = fixture()
        configs = {kind: {"image": kind + ":old", "environment": p.settings(info)} for kind, info in infos.items()}
        # Base Compose can acquire new optional keys without changing the old
        # saved production environment. It must not block a staged upgrade.
        configs["api"]["environment"]["GROUP_RETENTION_MODE"] = "visibility_only"
        infos["api"]["Config"]["Env"].append("GROUP_RETENTION_MODE=visibility_only")
        with tempfile.TemporaryDirectory() as temp:
            old = Path(temp)
            for kind, service in (("api", "api"), ("openim", "openim-api")):
                saved_env = p.settings(infos[kind])
                if kind == "api":
                    saved_env["GROUP_RETENTION_MODE"] = "off" # Original OSS cutover, before retention was installed.
                (old / (kind + ".compose.json")).write_text(json.dumps({"services": {service: {
                    "environment": {k: v.replace("$", "$$") for k, v in saved_env.items()}}}}))
            def read(args):
                if args[0] == "compose":
                    kind = "api" if args[args.index("--project-name") + 1] == "im-app" else "openim"
                    service = "api" if kind == "api" else "openim-api"
                    return json.dumps({"services": {service: configs[kind]}}).encode()
                if args[:2] == ["image", "inspect"]:
                    kind = args[2].split(":")[0]
                    return json.dumps([{"Id": infos[kind]["Image"], "Architecture": "amd64", "Os": "linux"}]).encode()
                raise AssertionError("Non-read operation attempted")
            def info(name):
                if name == "im-app-postgres":
                    return {"Config": {"Env": ["POSTGRES_DB=imapp"]}}
                return infos["api" if name == "im-app-api" else "openim"]
            with patch.object(p, "OLD", old), patch.object(p, "docker", side_effect=read), patch.object(p, "detail", side_effect=info), patch.object(p, "process_counts", return_value={"openim-rpc-msg": 1, "openim-msgtransfer": 2}):
                p.validate_runtime()
                original = copy.deepcopy(infos)
                infos["api"]["Config"]["Env"].append("OSS_ACCESS_KEY_SECRET=changed")
                with self.assertRaisesRegex(p.Refused, "ENV_DIFFERS"):
                    p.validate_runtime()
                infos.update(copy.deepcopy(original))
                infos["openim"]["HostConfig"]["PortBindings"] = {"19093/tcp": [{"HostPort": "19093"}]}
                with self.assertRaisesRegex(p.Refused, "PORT_IS_PUBLISHED"):
                    p.validate_runtime()
                infos.update(copy.deepcopy(original))
                infos["api"]["Mounts"] = [{"Destination": "/app"}]
                with self.assertRaisesRegex(p.Refused, "HIDDEN_BY_MOUNT"):
                    p.validate_runtime()
                infos.update(copy.deepcopy(original))
                with patch.object(p, "process_counts", return_value={"openim-rpc-msg": 2, "openim-msgtransfer": 1}):
                    with self.assertRaisesRegex(p.Refused, "TOPOLOGY"):
                        p.validate_runtime()

    def test_inspect_output_is_redacted(self):
        infos, _ = fixture()
        out = io.StringIO()
        with patch.object(p, "detail", return_value=infos["api"]), patch.object(p, "process_counts", return_value={}), contextlib.redirect_stdout(out):
            p.inspect()
        self.assertIn("read_only", out.getvalue())
        self.assertNotIn("never-print", out.getvalue())
        self.assertNotIn("never-change", out.getvalue())

    def test_no_new_file_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            file = Path(temp) / "private.env"
            p.private_write(file, "original")
            with self.assertRaises(FileExistsError):
                p.private_write(file, "replacement")
            self.assertEqual(file.read_text(), "original")

    @unittest.skipUnless(shutil.which("docker"), "Docker Compose CLI not installed")
    def test_real_compose_merge_preserves_oss_secret_and_fails_without_canary_scope(self):
        # `compose config` is a client-only operation; never calls a daemon,
        # starts a container, reads project .env or uses actual credentials.
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            base = root / "base.json"
            old = root / "old.json"
            values = root / "test.env"
            base.write_text(json.dumps({"services": {"api": {"image": "old:unit", "environment": {
                "OSS_ACCESS_KEY_SECRET": "", "OSS_MEDIA_SIGNING_KEY": ""}},
                "openim-api": {"image": "old-chat:unit"}}}))
            old.write_text(json.dumps({"services": {"api": {"environment": {
                "OSS_ACCESS_KEY_SECRET": "sentinel$$literal", "OSS_MEDIA_SIGNING_KEY": "stable-sentinel",
                "GROUP_RETENTION_MODE": "off", "GROUP_RETENTION_GROUP_IDS": "old-scope"}},
                "openim-api": {"volumes": [{"type": "bind", "source": str(root / "third.yml"),
                    "target": "/openim-server/config/openim-rpc-third.yml", "read_only": True}]}}}))
            values.write_text("RETENTION_API_IMAGE=api:unit\nRETENTION_OPENIM_IMAGE=chat:unit\n" +
                "IM_APP_RETENTION_KEY=sentinel-private-retention-key-0123456789\n" +
                "RETENTION_MEDIA_SOURCE_URL_PREFIXES=" + p.CHAT_SOURCE + "\nRETENTION_CANARY_GROUP_ID=\n")
            env = {k: v for k, v in os.environ.items() if not k.startswith(("DOCKER_", "COMPOSE_", "RETENTION_", "IM_APP_"))}
            here = Path(__file__).resolve().parent
            prefix = [shutil.which("docker"), "compose", "--env-file", str(values), "--project-name", "retention-offline-unit",
                      "-f", str(base), "-f", str(old), "-f", str(here / "api.install.compose.json"),
                      "-f", str(here / "openim.bridge.compose.json")]
            def config(extra):
                args = prefix + (["-f", str(here / extra)] if extra else [])
                return subprocess.run(args + ["config", "--format", "json"], capture_output=True, env=env, timeout=30)
            install = config("")
            self.assertEqual(install.returncode, 0, "Offline Compose resolution failed")
            services = json.loads(install.stdout)["services"]
            app = p.resolved_environment(services["api"])
            self.assertEqual(app["OSS_ACCESS_KEY_SECRET"], "sentinel$literal")
            self.assertEqual(app["OSS_MEDIA_SIGNING_KEY"], "stable-sentinel")
            self.assertEqual(app["GROUP_RETENTION_MODE"], "visibility_only")
            disabled = config("api.disable.compose.json")
            self.assertEqual(disabled.returncode,0)
            self.assertEqual(json.loads(disabled.stdout)["services"]["api"]["environment"]["GROUP_RETENTION_MODE"],"off")
            self.assertEqual(services["openim-api"]["environment"]["IM_APP_RETENTION_KEY"], app["GROUP_RETENTION_ADAPTER_KEY"])
            self.assertEqual(services["openim-api"]["volumes"][0]["target"], "/openim-server/config/openim-rpc-third.yml")
            enabled = config("api.enable.compose.json")
            self.assertEqual(enabled.returncode, 0)
            app = json.loads(enabled.stdout)["services"]["api"]["environment"]
            self.assertEqual(app["GROUP_RETENTION_MODE"], "visibility_only")
            self.assertEqual(app["GROUP_RETENTION_ALL_GROUPS"], "true")
            self.assertEqual(app["GROUP_RETENTION_GROUP_IDS"], "")
            self.assertNotEqual(config("api.canary.compose.json").returncode, 0)
            with values.open("a") as file:
                file.write("RETENTION_CANARY_GROUP_ID=11111111-1111-4111-8111-111111111111\n")
            gray = config("api.canary.compose.json")
            self.assertEqual(gray.returncode, 0)
            app = json.loads(gray.stdout)["services"]["api"]["environment"]
            self.assertEqual(app["GROUP_RETENTION_ALL_GROUPS"], "false")
            self.assertEqual(app["GROUP_RETENTION_GROUP_IDS"], "11111111-1111-4111-8111-111111111111")


if __name__ == "__main__":
    unittest.main()
