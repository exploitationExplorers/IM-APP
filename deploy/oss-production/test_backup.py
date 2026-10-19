import contextlib
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("production_oss_backup", Path(__file__).with_name("backup-production-oss.py"))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class ProductionBackupTests(unittest.TestCase):
    def fixture(self, name):
        image, volume = backup.CONTAINERS[name]
        return {"Id": name + "-id", "Name": "/" + name, "Image": image,
                "State": {"Running": True, "StartedAt": "2026-10-18T00:00:00Z", "Health": {"Status": "healthy"}},
                "Mounts": [] if not volume else [{"Type": "volume", "Destination": volume[0], "Name": volume[1]}],
                "Config": {"Env": ["MONGO_INITDB_ROOT_USERNAME=root", "MONGO_INITDB_ROOT_PASSWORD=NEVER_PRINT_SECRET\"\\\n#value",
                                    "POSTGRES_USER=im", "POSTGRES_DB=imapp"]}}

    def test_wrong_host_refused_before_any_command_or_file_write(self):
        with mock.patch.object(backup.sys, "argv", ["backup-production-oss.py"]), \
                mock.patch.object(backup.platform, "system", return_value="Linux"), \
                mock.patch.object(backup.socket, "gethostname", return_value="wrong-host"), \
                mock.patch.object(backup, "backup") as operation:
            with self.assertRaisesRegex(backup.Refused, "RUN_AS_ROOT_ON_BACKEND"):
                backup.main()
            operation.assert_not_called()

    def test_exact_data_volume_image_and_health_are_required(self):
        for changed in ("image", "volume", "health", "paused"):
            with self.subTest(changed=changed):
                detail = self.fixture("im-app-postgres")
                if changed == "image": detail["Image"] = "sha256:new-image"
                if changed == "volume": detail["Mounts"][0]["Name"] = "im-app-staging_postgres"
                if changed == "health": detail["State"]["Health"]["Status"] = "unhealthy"
                if changed == "paused": detail["State"]["Paused"] = True
                with self.assertRaises(backup.Refused): backup.check_detail("im-app-postgres", detail)

    def test_mongo_password_is_only_in_stdin_config(self):
        detail = self.fixture("openim-mongodb")
        config = backup.mongo_input(detail).decode()
        password_line = config.splitlines()[1]
        self.assertEqual(json.loads(password_line[len("password: "):]), backup.settings(detail)["MONGO_INITDB_ROOT_PASSWORD"])
        args = backup.mongo_args(detail, "standalone")
        self.assertIn("--config=/dev/stdin", args)
        self.assertNotIn("NEVER_PRINT", " ".join(args))
        self.assertNotIn("--password", args)
        self.assertNotIn("--oplog", args)
        self.assertIn("--numParallelCollections=1", args)
        self.assertIn("--oplog", backup.mongo_args(detail, "replica-primary"))
        with self.assertRaises(backup.Refused): backup.mongo_args(detail, "sharded")

    def test_disk_reserve_and_total_backup_budget_refuse(self):
        disk = mock.Mock(free=backup.RESERVE - 1)
        with mock.patch.object(backup.shutil, "disk_usage", return_value=disk):
            with self.assertRaises(backup.Refused): backup.guard_space(Path("."), 0)
        with mock.patch.object(backup.shutil, "disk_usage", return_value=mock.Mock(free=100 * backup.GIB)):
            with self.assertRaises(backup.Refused): backup.guard_space(Path("."), backup.BUDGET + 1)

    def test_remote_docker_overrides_removed(self):
        with mock.patch.dict(os.environ, {"DOCKER_HOST": "tcp://wrong:2375", "DOCKER_CONTEXT": "production-other"}), \
                mock.patch.object(backup.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, b"ok", b"")) as run:
            self.assertEqual(backup.read(["version"]), b"ok")
            args, kwargs = run.call_args
            self.assertEqual(args[0][:2], ["docker", "--host=unix:///var/run/docker.sock"])
            self.assertFalse(any(key.startswith("DOCKER_") for key in kwargs["env"]))

    def test_preflight_reads_metadata_only_and_requires_space_before_backup(self):
        details = {name: self.fixture(name) for name in backup.CONTAINERS}
        config = b"object:\n  enable: minio\n"
        calls = []

        def read(args, timeout=30):
            calls.append(args)
            if args[0] == "inspect": return json.dumps([details[args[1]]]).encode()
            if args[0] == "image": return b'[{"Size": 1024}]'
            if args[0] == "exec" and args[2] == "cat": return config
            if "psql" in args: return b"1024\n"
            if "mongosh" in args: return b'{"topology":"standalone","data_bytes":2048}'
            if "sh" in args: return b""
            self.fail("unexpected preflight command")

        with mock.patch.object(backup, "read", side_effect=read), \
                mock.patch.object(backup, "HOST_FILES", ()), \
                mock.patch.object(backup, "CONFIG_HASHES", {"config.yml": hashlib.sha256(config).hexdigest()}), \
                mock.patch.object(backup, "guard_space", side_effect=backup.Refused("BACKUP_DISK_BUDGET_EXCEEDED")), \
                mock.patch.object(backup, "write_private") as write:
            with self.assertRaisesRegex(backup.Refused, "BACKUP_DISK_BUDGET"):
                backup.preflight()
            write.assert_not_called()
        self.assertFalse(any("mongodump" in args or "pg_dump" in args or "save" in args for args in calls))
        self.assertTrue(any("default_transaction_read_only=on" in " ".join(args) for args in calls))

    def test_stream_retains_failed_output_and_stops_on_disk_limit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            # Exercise real process teardown using a harmless local helper.
            helper = [sys.executable, "-c", "import time; print('partial', flush=True); time.sleep(10)"]
            with mock.patch.object(backup, "command", return_value=helper), \
                    mock.patch.object(backup, "guard_space", side_effect=backup.Refused("BACKUP_DISK_BUDGET_EXCEEDED")):
                with self.assertRaisesRegex(backup.Refused, "BACKUP_DISK_BUDGET"):
                    backup.stream([], root / "partial.dump")
            self.assertTrue((root / "partial.dump").exists())

    def exercise_backup(self, topology, corrupt=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            host_file = root / "compose.yml"
            host_file.write_text("NEVER_PRINT_HOST_SECRET", encoding="utf-8")
            details = {name: self.fixture(name) for name in backup.CONTAINERS}
            config = b"object:\n  enable: minio\n  password: NEVER_PRINT_CONFIG_SECRET\n"
            config_path = "/openim-server/config/openim-rpc-third.yml"
            calls = []

            def read(args, timeout=30):
                calls.append(args)
                if args[0] == "inspect": return json.dumps([details[args[1]]]).encode()
                if args[0] == "exec" and args[2] == "cat": return config
                self.fail("unexpected command " + str(args[0]))

            def stream(args, path, input_data=None, timeout=900):
                calls.append(args)
                data = (b"bad-gzip" if corrupt else gzip.compress(b"fixture BSON archive")) if "mongodump" in args else b"fixture archive"
                backup.write_private(path, data)

            output = io.StringIO()
            with mock.patch.object(backup, "BACKUP_ROOT", root / "private"), \
                    mock.patch.object(backup, "HOST_FILES", (str(host_file),)), \
                    mock.patch.object(backup, "CONFIG_HASHES", {config_path: hashlib.sha256(config).hexdigest()}), \
                    mock.patch.object(backup, "preflight", return_value=(details, {"topology": topology}, ["old-api", "old-openim"], 1024)), \
                    mock.patch.object(backup, "private_directory", side_effect=lambda p: p.mkdir(parents=True, exist_ok=True)), \
                    mock.patch.object(backup, "stream", side_effect=stream), \
                    mock.patch.object(backup, "read", side_effect=read), \
                    mock.patch.object(backup.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)), \
                    contextlib.redirect_stdout(output):
                if corrupt:
                    with self.assertRaises(gzip.BadGzipFile): backup.backup()
                else:
                    backup.backup()
            folder = next((root / "private").iterdir())
            self.assertNotIn("NEVER_PRINT", output.getvalue())
            self.assertFalse(any(args[0] in {"up", "restart", "stop", "rm", "run", "volume", "compose"} for args in calls))
            if corrupt:
                self.assertTrue((folder / "INCOMPLETE").exists())
                self.assertNotIn("IM_APP_PRODUCTION_OSS_BACKUP_CREATED", output.getvalue())
                return
            manifest = json.loads((folder / "manifest.private.json").read_text())
            self.assertIn("NOT_PERFORMED", manifest["restore_rehearsal"])
            self.assertEqual(manifest["status"], "archives_created_not_restore_tested")
            self.assertFalse((folder / "INCOMPLETE").exists())
            self.assertTrue((folder / "ARCHIVES_CREATED_NOT_RESTORE_TESTED").exists())
            for relative, expected in manifest["files"].items():
                self.assertEqual(backup.fingerprint(folder / relative), expected)
            if topology == "standalone":
                self.assertIn("NOT a point-in-time", manifest["mongodb"])
                self.assertIn("online_baseline_NOT_point_in_time", output.getvalue())
            else:
                self.assertIn("oplog", manifest["mongodb"])

    def test_standalone_backup_never_claims_consistent_mongo_or_restore_verified(self):
        self.exercise_backup("standalone")

    def test_replica_dump_includes_oplog(self):
        self.exercise_backup("replica-primary")

    def test_corrupt_mongo_dump_leaves_incomplete_marker(self):
        self.exercise_backup("standalone", corrupt=True)


if __name__ == "__main__":
    unittest.main()
