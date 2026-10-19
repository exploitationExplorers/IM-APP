import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import tempfile
import unittest
from unittest import mock
import urllib.parse

spec = importlib.util.spec_from_file_location("production_oss_deploy", Path(__file__).with_name("deploy-production-oss.py"))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentGuardTests(unittest.TestCase):
    def test_wrong_host_refused_before_loading_credentials_or_docker(self):
        with mock.patch.object(deploy.sys, "argv", ["deploy-production-oss.py", "deploy"]), \
                mock.patch.object(deploy.platform, "system", return_value="Linux"), \
                mock.patch.object(deploy.socket, "gethostname", return_value="another-host"), \
                mock.patch.object(deploy, "deploy") as action:
            with self.assertRaises(deploy.Failed): deploy.main()
            action.assert_not_called()

    def test_config_replaces_only_the_object_block_and_disables_public_access(self):
        source = b'rpc:\n  ports: [10300]\nobject:\n  enable: minio\n  oss:\n    secret: old\nafter:\n  enabled: true\n'
        result = deploy.patch_third_config(source, {"access_key_id": "fake-id", "access_key_secret": "fake-key\"\\value"}).decode()
        self.assertTrue(result.startswith('rpc:\n  ports: [10300]\nobject:\n'))
        self.assertTrue(result.endswith('after:\n  enabled: true\n'))
        self.assertNotIn("enable: minio", result)
        self.assertIn('publicRead: false', result)
        self.assertIn(json.dumps('fake-key"\\value'), result)
        with self.assertRaises(deploy.Failed): deploy.patch_third_config(b'no_object: true', {})

    def test_signer_does_not_sign_outside_the_production_prefix(self):
        secret = {"access_key_id": "fake-id", "access_key_secret": "fake-secret"}
        with self.assertRaises(deploy.Failed): deploy.signed_url("chat", "oss-test/chat/anything", "PUT", "", secret)
        url = urllib.parse.urlsplit(deploy.signed_url("chat", "im-app-production/chat/check.bin", "PUT", "application/octet-stream", secret))
        self.assertEqual(url.netloc, "oss-chat-test.xn--jprz53bj9s.com")
        self.assertNotIn("fake-secret", url.query)

    def test_tampered_bundle_refused_before_loading_server_config(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "im-server").write_bytes(b"changed")
            (root / "bundle-manifest.json").write_text(json.dumps({"platform": "linux/amd64", "openim": "v3.8.3-patch.15", "files": {"im-server": hashlib.sha256(b"original").hexdigest()}}))
            with self.assertRaisesRegex(deploy.Failed, "CHECKSUM"):
                deploy.check_manifest(root)

    def test_compose_uses_original_project_and_explicit_env_file(self):
        args = deploy.compose_args(PurePosixPath("/www/wwwroot/deploy/openim/docker-compose.yml"), "openim", PurePosixPath("/root/im-app-oss-production/private/openim.compose.json"))
        self.assertIn("/www/wwwroot/deploy/.env", args)
        self.assertEqual(args[args.index("--project-name") + 1], "openim")
        self.assertEqual(args[-1], "/root/im-app-oss-production/private/openim.compose.json")

    def test_cors_failure_stops_before_object_writes(self):
        with mock.patch.object(deploy, "request", return_value=(403, {}, b"")) as request:
            with self.assertRaisesRegex(deploy.Failed, "CORS_NOT_READY"):
                deploy.probe_storage({})
            self.assertEqual(request.call_count, 1)
            self.assertEqual(request.call_args.args[1], "OPTIONS")

    def test_compose_dollar_escaping_keeps_literal_credentials(self):
        self.assertEqual(deploy.compose_env({"SECRET": "a$token${other}"}), {"SECRET": "a$$token$${other}"})


if __name__ == "__main__":
    unittest.main()
