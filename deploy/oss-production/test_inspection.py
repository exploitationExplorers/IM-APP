import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest import mock
import subprocess

spec = importlib.util.spec_from_file_location("production_oss_inventory", Path(__file__).with_name("inspect-production-oss.py"))
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)


class ProductionInventoryTests(unittest.TestCase):
    def test_wrong_host_refused_before_any_docker_call(self):
        with mock.patch.object(inventory.sys, "argv", ["inspect-production-oss.py"]), \
                mock.patch.object(inventory.platform, "system", return_value="Linux"), \
                mock.patch.object(inventory.socket, "gethostname", return_value="unrelated-host"), \
                mock.patch.object(inventory.subprocess, "run") as run:
            with self.assertRaises(RuntimeError): inventory.main()
            run.assert_not_called()

    def test_docker_connection_overrides_are_ignored(self):
        with mock.patch.dict(inventory.os.environ, {"DOCKER_HOST": "tcp://unexpected:2375", "DOCKER_CONTEXT": "unexpected"}), \
                mock.patch.object(inventory.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, b"28.0.0", b"")) as run:
            inventory.docker(["version"])
            args, kwargs = run.call_args
            self.assertEqual(args[0][:2], ["docker", "--host=unix:///var/run/docker.sock"])
            self.assertFalse(any(key.startswith("DOCKER_") for key in kwargs["env"]))

    def fixture(self):
        return {"Id": "container-id", "Name": "/openim-api", "Image": "sha256:fake",
                "Config": {"Image": "openim/openim-server:v3.8.3-patch.15", "Env": [
                    "DATABASE_URL=postgres://user:NEVER_PRINT_PASSWORD@db/app", "OSS_ACCESS_KEY_SECRET=NEVER_PRINT_KEY",
                    "STORAGE_PROVIDER=minio", "APP_ENV=NEVER_PRINT_ENV_VALUE"],
                    "Cmd": ["NEVER_PRINT_COMMAND"], "Labels": {"arbitrary": "NEVER_PRINT_LABEL"}},
                "State": {"Status": "running", "Running": True}, "Mounts": [], "NetworkSettings": {}}

    def test_only_production_candidates(self):
        for name in ["openim-api", "im-app-api", "im-admin", "im-app-server-postgres-1"]:
            self.assertTrue(inventory.candidate(name))
        for name in ["im-app-staging-postgres-1", "im-app-oss-test-openim-api-1", "unrelated-service"]:
            self.assertFalse(inventory.candidate(name))

    def test_complete_inspection_does_not_emit_credentials_or_config(self):
        calls = []
        config = b"object:\n  enable: minio\n  oss:\n    accessKeySecret: NEVER_PRINT_CONFIG_SECRET\n"

        def run(args, required=True):
            calls.append(args)
            if args[0] == "version": return b"28.0.0"
            if args[0] == "ps": return b'{"ID":"container-id","Names":"openim-api"}\n'
            if args[0] == "inspect": return json.dumps([self.fixture()]).encode()
            if args[:2] == ["image", "inspect"]: return b'[]'
            if args[:3] == ["exec", "container-id", "cat"]: return config
            self.fail("unexpected Docker operation")

        output = io.StringIO()
        with contextlib.redirect_stdout(output): inventory.inspect(run)
        self.assertNotIn("NEVER_PRINT", output.getvalue())
        self.assertIn('"file_object_engine": "minio"', output.getvalue())
        self.assertTrue(all(args[0] in {"version", "ps", "inspect", "image", "exec"} for args in calls))
        self.assertEqual(sum(args[0] == "exec" for args in calls), 2)

    def test_schema_query_has_read_only_session_and_no_business_rows(self):
        detail = self.fixture()
        detail["Config"]["Env"] = ["POSTGRES_USER=im", "POSTGRES_DB=imapp"]
        calls = []

        def run(args, required=True):
            calls.append(args)
            return b"files|object_key\nfiles|url\n"

        result = inventory.postgres_schema(detail, run)
        self.assertEqual(result["columns"]["files"], ["object_key", "url"])
        self.assertIn("default_transaction_read_only=on", calls[0][2])
        self.assertIn("statement_timeout=5000", calls[0][2])
        self.assertIn("--no-password", calls[0])
        self.assertIn("information_schema.columns", calls[0][-1])
        self.assertNotIn("SELECT *", calls[0][-1])


if __name__ == "__main__":
    unittest.main()
