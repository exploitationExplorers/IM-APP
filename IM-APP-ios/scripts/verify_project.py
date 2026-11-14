"""跨平台检查工程引用、共享样本与发布阻断；不替代 Swift/Xcode 编译。"""

import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import unittest
import xml.etree.ElementTree as ET


IOS = Path(__file__).resolve().parents[1]
ROOT = IOS.parent
PROJECT = IOS / "IMNative.xcodeproj/project.pbxproj"


class IOSProjectStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.project = PROJECT.read_text(encoding="utf-8")

    def test_project_object_references_are_defined(self):
        definitions = re.findall(r"^\s*([A-F0-9]{24})\s*(?:/\*.*?\*/\s*)?=\s*\{", self.project, re.M)
        references = set(re.findall(r"\b[A-F0-9]{24}\b", self.project))
        self.assertEqual(len(definitions), len(set(definitions)))
        self.assertEqual(references, set(definitions))
        # 忽略字符串和注释后检查 OpenStep 容器配对，不声称完成编译器语义检查。
        stripped = re.sub(r'"(?:\\.|[^"\\])*"', '""', self.project)
        stripped = re.sub(r"/\*.*?\*/|//[^\n]*", "", stripped, flags=re.S)
        stack = []
        for char in stripped:
            if char in "{(": stack.append(char)
            elif char in "})":
                self.assertTrue(stack)
                self.assertEqual(stack.pop(), "{" if char == "}" else "(")
        self.assertEqual(stack, [])

    def test_all_app_sources_are_in_build_phase(self):
        source_phase = re.search(r"isa = PBXSourcesBuildPhase;.*?files = \((.*?)\);", self.project, re.S).group(1)
        sources = sorted((IOS / "IMNative").glob("*.swift")) + sorted((IOS / "IMNative").glob("*.m"))
        for source in sources:
            reference = re.search(r"([A-F0-9]{24})\s*=\s*\{isa = PBXFileReference;[^}]*path = " + re.escape(source.name) + r";", self.project)
            self.assertIsNotNone(reference, source.name)
            build = re.search(r"([A-F0-9]{24})\s*/\*.*?\*/\s*=\s*\{isa = PBXBuildFile; fileRef = " + reference.group(1), self.project)
            self.assertIsNotNone(build, source.name)
            self.assertIn(build.group(1), source_phase)
        self.assertIn("path = Info.plist", self.project)

    def test_app_links_local_core_package_and_scheme(self):
        self.assertIn("isa = XCLocalSwiftPackageReference; relativePath = Packages/IMCore", self.project)
        self.assertIn("packageProductDependencies = (AC0000000000000000000001", self.project)
        self.assertIn("productRef = AC0000000000000000000001", self.project)
        self.assertIn("import IMCore", (IOS / "IMNative/LoginViewController.swift").read_text(encoding="utf-8"))
        scheme = ET.parse(IOS / "IMNative.xcodeproj/xcshareddata/xcschemes/IMNative.xcscheme")
        references = scheme.findall(".//BuildableReference")
        self.assertTrue(references)
        for reference in references:
            self.assertEqual(reference.attrib["BlueprintIdentifier"], "A50000000000000000000001")
            self.assertIn(reference.attrib["BlueprintIdentifier"], self.project)
        self.assertEqual(scheme.find("LaunchAction").attrib["buildConfiguration"], "Debug")
        podfile = (IOS / "Podfile").read_text(encoding="utf-8")
        self.assertIn("pod 'OpenIMSDK', '3.8.3-hotfix.15'", podfile)
        self.assertIn("pod 'OpenIMSDKCore', '3.8.3-hotfix.15'", podfile)
        self.assertIn("workspace 'IMNative'", podfile)
        self.assertIn('SWIFT_OBJC_BRIDGING_HEADER = "IMNative/IMNative-Bridging-Header.h";', self.project)
        self.assertTrue((IOS / "IMNative/NativeOpenIMBridge.h").is_file())
        self.assertIn('#import "NativeOpenIMBridge.h"', (IOS / "IMNative/IMNative-Bridging-Header.h").read_text(encoding="utf-8"))
        service = (IOS / "IMNative/NativeIMService.swift").read_text(encoding="utf-8")
        self.assertIn("import OpenIMSDK", service)
        self.assertNotIn("canImport(OpenIMSDK)", service)
        self.assertIn("FileProtectionType.completeUntilFirstUserAuthentication", service)
        self.assertNotIn("noFileProtection", service)
        # 官方固定tag的header是静态签名证据；CI可能没有D盘研究缓存，不替代pod编译。
        research = ROOT / ".native-cache/openim-sdk/research"
        if (research / "OIMManager+Message.h").is_file():
            expected = {
                "OIMManager+Message.h": ["+ (OIMMessageInfo *)createTextMessage:", "- (void)sendMessage:", "- (void)getAdvancedHistoryMessageList:", "- (void)findMessageList:"],
                "OIMManager+Conversation.h": ["getConversationListSplitWithOffset:", "getOneConversationWithSessionType:"],
                "OIMManager+Connection.h": ["initSDKWithConfig:", "- (void)unInitSDK;"],
                "OIMSearchParam.h": ["NSString *startClientMsgID", "clientMsgIDList"],
                "core-Open_im_sdk.objc.h": ["Open_im_sdkSetAppBackgroundStatus(", "Open_im_sdkNetworkStatusChanged("],
            }
            for name, signatures in expected.items():
                header = (research / name).read_text(encoding="utf-8")
                for signature in signatures: self.assertIn(signature, header, name + ": " + signature)
        bridge = (IOS / "IMNative/NativeOpenIMBridge.m").read_text(encoding="utf-8")
        self.assertIn("request.startClientMsgID = cursor", bridge)
        self.assertNotIn("request.lastMinSeq =", bridge)
        self.assertIn("result.status != OIMMessageStatusSendSuccess", bridge)
        for selector in ["removeConversationListener:self", "removeAdvancedMsgListener:self", "Open_im_sdkSetAppBackgroundStatus", "Open_im_sdkNetworkStatusChanged"]:
            self.assertIn(selector, bridge)

    def test_info_plist_and_staging_identity(self):
        with (IOS / "IMNative/Info.plist").open("rb") as file:
            info = plistlib.load(file)
        self.assertEqual(info["CFBundleIdentifier"], "$(PRODUCT_BUNDLE_IDENTIFIER)")
        self.assertNotIn("NSAppTransportSecurity", info)
        self.assertEqual(self.project.count("PRODUCT_BUNDLE_IDENTIFIER = com.im.nativebootstrap.staging;"), 2)
        self.assertNotIn("DEVELOPMENT_TEAM", self.project)
        self.assertEqual(self.project.count("MARKETING_VERSION = 0.3.0;"), 2)
        self.assertEqual(self.project.count("CURRENT_PROJECT_VERSION = 4;"), 2)
        endpoints = json.loads((ROOT / "contracts/native-bootstrap/v1/runtime-endpoints.json").read_text(encoding="utf-8"))
        login = (IOS / "IMNative/LoginViewController.swift").read_text(encoding="utf-8")
        self.assertIn('private var serverAddress = "' + endpoints["api_base_url"] + '"', login)
        self.assertIn("api.businessPasswordLogin", login)
        self.assertNotIn("api.imToken", login)
        self.assertNotIn("authenticationSucceeded", login)
        service = (IOS / "IMNative/NativeIMService.swift").read_text(encoding="utf-8")
        self.assertEqual(service.count("api.imToken("), 1)
        # 媒体临时文件可以清理，但SDK目录/账号数据库不得自动删除。
        self.assertNotRegex(service, r"removeItem\s*\(\s*at:\s*(?:storageDirectory|sdkDirectory|namespace|root|directory)\b")
        self.assertNotIn('removeItem(atPath:', service)

    def test_shared_fixture_bytes_have_not_drifted(self):
        shared = ROOT / "contracts/native-bootstrap/v1/fixtures"
        resources = IOS / "Packages/IMCore/Tests/IMCoreTests/Fixtures"
        shared_files = sorted(p.name for p in shared.glob("*.json"))
        self.assertEqual(shared_files, sorted(p.name for p in resources.glob("*.json")))
        for name in shared_files:
            self.assertEqual((shared / name).read_bytes(), (resources / name).read_bytes(), name)
        package = (IOS / "Packages/IMCore/Package.swift").read_text(encoding="utf-8")
        self.assertIn('.copy("Fixtures")', package)

    def test_ui_assets_are_bundled_and_referenced_files_exist(self):
        resources = re.search(r"isa = PBXResourcesBuildPhase;.*?files = \((.*?)\);", self.project, re.S).group(1)
        for name in ["Assets.xcassets", "Legal"]:
            reference = re.search(r"([A-F0-9]{24})\s*=\s*\{isa = PBXFileReference;[^}]*path = " + re.escape(name) + r";", self.project)
            self.assertIsNotNone(reference, name)
            build = re.search(r"([A-F0-9]{24})\s*/\*.*?\*/\s*=\s*\{isa = PBXBuildFile; fileRef = " + reference.group(1), self.project)
            self.assertIsNotNone(build, name)
            self.assertIn(build.group(1), resources)
        catalog = IOS / "IMNative/Assets.xcassets"
        for contents in catalog.glob("*.imageset/Contents.json"):
            data = json.loads(contents.read_text(encoding="utf-8-sig"))
            for image in data["images"]:
                if "filename" in image:
                    self.assertTrue((contents.parent / image["filename"]).is_file(), str(contents))
        source = "\n".join(p.read_text(encoding="utf-8-sig") for p in (IOS / "IMNative").glob("*.swift"))
        names = set(re.findall(r'"(uni_[a-z0-9_]+)"', source)) - {"uni_tab_"}
        names |= {"uni_tab_" + tab + active for tab in ["contacts", "chat", "mine"] for active in ["", "_active"]}
        for name in names:
            self.assertTrue((catalog / (name + ".imageset/Contents.json")).is_file(), name)

    def test_legal_documents_exist_and_webview_restricts_navigation(self):
        for name in ["agreement.html", "privacy.html"]:
            path = IOS / "IMNative/Legal" / name
            self.assertTrue(path.is_file(), str(path))
            self.assertGreater(path.stat().st_size, 100)
        source = (IOS / "IMNative/LegalViewController.swift").read_text(encoding="utf-8")
        self.assertIn("allowsContentJavaScript = false", source)
        self.assertIn("url.isFileURL", source)
        self.assertIn("decisionHandler(.cancel)", source)

    def test_release_guard_rejects_release_and_archive(self):
        encoded = re.search(r'shellScript = ("(?:\\.|[^"\\])*");', self.project).group(1)
        script = json.loads(encoded)
        shell = "/bin/sh" if os.name != "nt" else r"C:\Program Files\Git\bin\bash.exe"
        if not Path(shell).is_file():
            self.skipTest("本机无可执行 POSIX shell；发布脚本运行待验证")
        for configuration, action, expected in [("Debug", "build", 0), ("Release", "build", 1), ("Debug", "install", 1)]:
            environment = dict(os.environ, CONFIGURATION=configuration, ACTION=action)
            result = subprocess.run([shell, "-c", script], env=environment, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, expected, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
