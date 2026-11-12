"""只读核对认证契约；不联网、不启动 Go 服务、不执行数据库迁移。"""

import json
from pathlib import Path
import re
import unittest


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def load_fixture(name):
    return json.loads((HERE / "fixtures" / name).read_text(encoding="utf-8-sig"))


def go_fields(source, struct):
    match = re.search(r"type\s+" + struct + r"\s+struct\s*\{(.*?)\n\}", source, re.S)
    if not match:
        raise AssertionError("Missing Go struct: " + struct)
    return set(re.findall(r'json:"([^",]+)', match.group(1)))


class ExistingAPIContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads((HERE / "native-api.contract.json").read_text(encoding="utf-8-sig"))
        cls.auth = (ROOT / "IM-APP-server/internal/models/auth.go").read_text(encoding="utf-8-sig")

    def test_static_routes_still_exist(self):
        routes = (ROOT / "IM-APP-server/cmd/server/main.go").read_text(encoding="utf-8-sig")
        for item in self.contract["endpoints"]:
            with self.subTest(endpoint=item["id"]):
                self.assertIn(item["method"] + '("' + item["path"] + '"', routes)
                self.assertNotIn(":", item["path"])

    def test_request_fields_match_current_dtos(self):
        structs = {"passwordLogin": "PasswordLoginRequest", "smsLogin": "SMSLoginRequest", "sendSms": "SendSMSRequest", "refreshToken": "RefreshTokenRequest"}
        im = (ROOT / "IM-APP-server/internal/handler/im.go").read_text(encoding="utf-8-sig")
        for item in self.contract["endpoints"]:
            with self.subTest(endpoint=item["id"]):
                if item["method"] == "GET":
                    self.assertEqual(item["requestFields"], [])
                    continue
                fields = go_fields(im, "imTokenRequest") if item["id"] == "imToken" else go_fields(self.auth, structs[item["id"]])
                self.assertEqual(set(item["requestFields"]), fields)

    def test_success_fixtures_match_response_dtos(self):
        auth = load_fixture("auth-success.json")["data"]
        self.assertTrue(go_fields(self.auth, "TokenPair") <= set(auth))
        self.assertTrue(go_fields(self.auth, "MeProfile") - {"phone"} <= set(auth["user"]))
        im_source = (ROOT / "IM-APP-server/internal/service/im.go").read_text(encoding="utf-8-sig")
        im = load_fixture("im-token-success.json")["data"]
        self.assertEqual(go_fields(im_source, "IMToken"), set(im))
        self.assertNotEqual(auth["user"]["id"], im["userId"])
        self.assertEqual(go_fields(self.auth, "TokenPair"), set(load_fixture("refresh-success.json")["data"]))
        self.assertEqual(go_fields(self.auth, "SendSMSResult") - {"devCode"}, set(load_fixture("sms-success.json")["data"]))

    def test_profile_fixture_is_direct_user_payload(self):
        profile = load_fixture("profile-success.json")["data"]
        self.assertEqual(profile, load_fixture("auth-success.json")["data"]["user"])
        self.assertTrue(go_fields(self.auth, "MeProfile") - {"phone"} <= set(profile))
        self.assertNotIn("user", profile)

    def test_default_backend_keeps_https_and_login_separate_from_im(self):
        from urllib.parse import urlsplit
        runtime = json.loads((HERE / "runtime-endpoints.json").read_text(encoding="utf-8"))
        address = urlsplit(runtime["api_base_url"])
        self.assertEqual(address.scheme, "https")
        self.assertEqual(address.hostname, "www.xn--jprz53bj9s.com")
        self.assertEqual(address.path, "/api/v1")
        self.assertIsNone(address.username)
        self.assertIsNone(address.password)
        self.assertFalse(address.query or address.fragment)
        self.assertEqual(runtime["login_flow"], [
            {"method": "POST", "path": "/auth/login"},
            {"method": "GET", "path": "/me", "authorization": "Bearer accessToken"},
        ])
        self.assertFalse(runtime["im_token_requested_by_login"])

    def test_envelope_and_error_fixture(self):
        response = (ROOT / "IM-APP-server/internal/response/response.go").read_text(encoding="utf-8-sig")
        for path in sorted((HERE / "fixtures").glob("*.json")):
            if path.name.endswith("-request.json"):
                continue
            body = load_fixture(path.name)
            self.assertEqual(set(body), go_fields(response, "Body"))
            self.assertIsInstance(body["code"], int)
        self.assertEqual(load_fixture("api-error.json")["code"], 1)
        self.assertIsNone(load_fixture("api-error.json")["data"])

    def test_legacy_default_platform_is_preserved(self):
        handler = (ROOT / "IM-APP-server/internal/handler/im.go").read_text(encoding="utf-8-sig")
        self.assertRegex(handler, r"if req\.PlatformID == 0\s*\{\s*req\.PlatformID = 5")
        self.assertEqual(self.contract["platformIds"], {"ios": 1, "android": 2, "legacyDefault": 5})


if __name__ == "__main__":
    unittest.main(verbosity=2)
