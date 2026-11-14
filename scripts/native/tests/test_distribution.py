import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace


spec = importlib.util.spec_from_file_location("distribution", Path(__file__).resolve().parents[1] / "prepare_distribution.py")
distribution = importlib.util.module_from_spec(spec)
spec.loader.exec_module(distribution)


class DistributionTests(unittest.TestCase):
    def artifact(self):
        return {"versionCode": 7, "versionName": "0.3.3-media", "sha256": "a" * 64, "sizeBytes": 12, "certificateSha256": ["b" * 64]}

    def test_https_urls_keep_subdirectory_and_reject_credentials_or_unsafe_paths(self):
        self.assertEqual("https://downloads.example.test/native/", distribution.https_url("https://downloads.example.test/native", base=True))
        for value in ("http://example.test/", "https://name:secret@example.test/", "https://example.test/?token=a", "https://example.test/../x", "https://example.test/%2f"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                distribution.https_url(value, base=True)

    def test_existing_testers_require_same_key_and_strictly_increasing_version(self):
        previous = {"applicationId": distribution.APPLICATION_ID, "channel": distribution.CHANNEL, "releaseFamily": distribution.FAMILY, **self.artifact()}
        with self.assertRaises(ValueError):
            distribution.validate_previous(previous, self.artifact())
        newer = {**self.artifact(), "versionCode": 8}
        distribution.validate_previous(previous, newer)
        with self.assertRaises(ValueError):
            distribution.validate_previous(previous, {**newer, "certificateSha256": ["c" * 64]})
        with self.assertRaises(ValueError):
            distribution.validate_previous({**previous, "channel": "prod"}, newer)

    def test_prepared_site_uses_immutable_apk_and_no_fake_ios_installation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            apk = root / "input.apk"
            apk.write_bytes(b"test fixture")
            site = root / "site"
            manifest = distribution.prepare(apk, self.artifact(), "https://downloads.example.test/native/", site, "<script>unsafe</script>")
            self.assertEqual(manifest, json.loads((site / "update.json").read_text(encoding="utf-8")))
            self.assertTrue(manifest["downloadUrl"].endswith("native-0.3.3-media-7-aaaaaaaaaaaa.apk"))
            self.assertEqual(apk.read_bytes(), (site / manifest["downloadUrl"].split("/")[-1]).read_bytes())
            page = (site / "index.html").read_text(encoding="utf-8")
            self.assertIn("&lt;script&gt;unsafe&lt;/script&gt;", page)
            self.assertNotIn("href=\"https://testflight", page)
            self.assertNotIn("itms-services:", page)
            self.assertIn("iOS 内测暂未开放", page)

    def test_real_testflight_public_url_is_required(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); apk = root / "test.apk"; apk.write_bytes(b"fixture")
            with self.assertRaises(ValueError):
                distribution.prepare(apk, self.artifact(), "https://downloads.example.test/", root / "site", testflight="https://example.test/fake.ipa")
            distribution.prepare(apk, self.artifact(), "https://downloads.example.test/", root / "site", testflight="https://testflight.apple.com/join/AbCd1234")
            self.assertIn("https://testflight.apple.com/join/AbCd1234", (root / "site/index.html").read_text(encoding="utf-8"))

    def test_apk_verification_requires_real_tool_success_package_marker_and_expected_certificate(self):
        with tempfile.TemporaryDirectory() as folder:
            apk = Path(folder) / "fixture.apk"; apk.write_bytes(b"fixture")
            badging = "package: name='com.im.nativebootstrap.staging' versionCode='7' versionName='0.3.3-media'\n"
            marker = ' E: meta-data\n   A: android:name="com.im.nativebootstrap.releaseFamily"\n   A: android:value="im-native-android-v1"\n'
            signatures = "Signer #1 certificate SHA-256 digest: " + "b" * 64 + "\n"
            def reply(text, code=0): return SimpleNamespace(stdout=text, returncode=code)
            with patch.object(distribution.subprocess, "run", side_effect=[reply(badging), reply(marker), reply(signatures)]):
                actual = distribution.inspect_apk(apk, "aapt", "apksigner", "b" * 64)
                self.assertEqual(7, actual["versionCode"])
                self.assertEqual(["b" * 64], actual["certificateSha256"])
            for replies in (
                [reply(badging.replace("com.im.nativebootstrap.staging", "io.dcloud.old"))],
                [reply(badging), reply(marker.replace("im-native-android-v1", "legacy"))],
                [reply(badging), reply(marker), reply(signatures.replace("b" * 64, "c" * 64))],
                [reply(badging), reply(marker), reply("verification failed", 1)],
            ):
                with patch.object(distribution.subprocess, "run", side_effect=replies), self.assertRaises(ValueError):
                    distribution.inspect_apk(apk, "aapt", "apksigner", "b" * 64)


if __name__ == "__main__":
    unittest.main()
