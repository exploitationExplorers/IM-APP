"""Offline safety checks: no .env, cloud, Docker, browser or database access."""
import importlib.util
from pathlib import Path
import struct
import unittest
import zlib

spec = importlib.util.spec_from_file_location("smoke_chat_h5", Path(__file__).with_name("smoke-chat-h5.py"))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class ChatSafetyTests(unittest.TestCase):
    def test_signed_chat_object_allowed_unchanged(self):
        url = f"https://{smoke.CHAT_HOST}/oss-test/chat/hash?signature=opaque&partNumber=1&uploadId=opaque"
        for method in ("GET", "HEAD", "PUT", "POST", "OPTIONS"):
            self.assertTrue(smoke.safe_chat_url(url, method))

    def test_foreign_hosts_paths_and_delete_refused(self):
        for url in (
            f"http://{smoke.CHAT_HOST}/oss-test/chat/hash",
            f"https://user@{smoke.CHAT_HOST}/oss-test/chat/hash",
            f"https://{smoke.CHAT_HOST}:443/oss-test/chat/hash",
            f"https://{smoke.CHAT_HOST}/oss-test/chat/hash#secret",
            "https://oss-business-test.xn--jprz53bj9s.com/oss-test/chat/hash",
            "https://yikeliao-188.oss-cn-hangzhou.aliyuncs.com/oss-test/chat/hash",
            *(f"https://{smoke.CHAT_HOST}{path}" for path in (
                "/", "/production/a", "/oss-test/business/a", "/oss-test/chat/",
                "/oss-test/chat/a/../b", "/oss-test/chat/a%2F..%2Fb", "/oss-test/chat/a%5Cb",
                "/oss-test/chat/%252e%252e/b", "/oss-test/chat//a",
            )),
        ):
            with self.subTest(url=url):
                self.assertFalse(smoke.safe_chat_url(url, "PUT"))
        self.assertFalse(smoke.safe_chat_url(f"https://{smoke.CHAT_HOST}/oss-test/chat/hash", "DELETE"))

    def test_business_auth_not_forwarded_to_cloud(self):
        url = f"https://{smoke.CHAT_HOST}/oss-test/chat/hash"
        self.assertFalse(smoke.safe_chat_url(url, "PUT", {"Authorization": "Bearer fake-local-token"}))
        self.assertFalse(smoke.safe_chat_url(url, "PUT", {"Cookie": "session=fake"}))
        self.assertTrue(smoke.safe_chat_url(url, "PUT", {"Authorization": "OSS fake-signature"}))

    def test_fixture_is_valid_png_and_run_specific(self):
        first = smoke.make_png(1)
        self.assertNotEqual(first, smoke.make_png(2))
        self.assertLess(len(first), 2_000_000)
        self.assertEqual(first[:8], b"\x89PNG\r\n\x1a\n")
        pos = 8
        while pos < len(first):
            size = struct.unpack(">I", first[pos:pos + 4])[0]
            chunk = first[pos + 4:pos + 8 + size]
            crc = struct.unpack(">I", first[pos + 8 + size:pos + 12 + size])[0]
            self.assertEqual(zlib.crc32(chunk), crc)
            pos += size + 12
        self.assertEqual(pos, len(first))


if __name__ == "__main__":
    unittest.main()
