"""核验已签名的 Android 内测包，生成独立固定下载站；不上传、不修改发布 API。"""

import argparse
import hashlib
import html
import json
from pathlib import Path
import re
import shutil
import subprocess
from urllib.parse import urlsplit

APPLICATION_ID = "com.im.nativebootstrap.staging"
FAMILY = "im-native-android-v1"
CHANNEL = "native-staging"
MAX_BYTES = 200 * 1024 * 1024


def https_url(value, *, base=False):
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username is not None or parsed.password is not None or parsed.fragment or (base and parsed.query):
        raise ValueError("Require an HTTPS URL without credentials or fragment; the base URL must also have no query")
    if base and (".." in parsed.path.split("/") or "%" in parsed.path):
        raise ValueError("Use the canonical public base URL without encoded path components")
    return value.rstrip("/") + "/" if base else value


def certificate(value):
    result = value.replace(":", "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", result):
        raise ValueError("Expected a SHA-256 signing certificate fingerprint")
    return result


def inspect_apk(apk, aapt, apksigner, expected_certificate):
    def run(*command):
        result = subprocess.run(command, check=False, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if result.returncode:
            # 不回显完整命令，避免未来的签名参数进入日志。
            raise ValueError(f"APK verification command failed: {Path(command[0]).name}")
        return result.stdout

    size = apk.stat().st_size
    if not 0 < size <= MAX_BYTES:
        raise ValueError("APK must be nonempty and at most 200 MiB")
    badging = run(str(aapt), "dump", "badging", str(apk))
    match = re.search(r"^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", badging, re.M)
    if not match or match[1] != APPLICATION_ID:
        raise ValueError("Only the isolated native staging application may be distributed by this script")
    version, name = int(match[2]), match[3]
    if not 0 < version <= 2_100_000_000 or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.+_-]{0,31}", name):
        raise ValueError("Invalid package version")
    manifest = run(str(aapt), "dump", "xmltree", str(apk), "AndroidManifest.xml")
    metadata = re.findall(r"(?m)^\s*E: meta-data[^\n]*\n((?:\s*A:[^\n]*\n)*)", manifest + "\n")
    if not any('"com.im.nativebootstrap.releaseFamily"' in block and f'"{FAMILY}"' in block for block in metadata):
        raise ValueError("APK is missing the native release family marker")
    verified = run(str(apksigner), "verify", "--verbose", "--print-certs", str(apk))
    signers = {certificate(raw) for raw in re.findall(r"^Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F:]+)\s*$", verified, re.M)}
    if signers != {certificate(expected_certificate)}:
        raise ValueError("APK signing certificate does not match the configured stable native testing key")
    with apk.open("rb") as stream:
        digest_state = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest_state.update(chunk)
        digest = digest_state.hexdigest()
    return {"versionCode": version, "versionName": name, "sha256": digest, "sizeBytes": size, "certificateSha256": sorted(signers)}


def validate_previous(previous, artifact):
    if previous.get("applicationId") != APPLICATION_ID or previous.get("channel") != CHANNEL or previous.get("releaseFamily") != FAMILY:
        raise ValueError("Previous manifest does not belong to the native staging distribution")
    if previous.get("certificateSha256") != artifact["certificateSha256"]:
        raise ValueError("Signing key changed; existing testers cannot install this as an update")
    if int(previous["versionCode"]) >= artifact["versionCode"]:
        raise ValueError("versionCode must strictly increase; publish a higher code even when rolling back code changes")


def render_page(manifest, testflight, appstore):
    apk_url = html.escape(manifest["downloadUrl"], quote=True)
    version = html.escape(manifest["versionName"])
    changelog = html.escape(manifest["changelog"])
    apple = (f'<a class="button secondary" href="{html.escape(testflight, quote=True)}" rel="noopener">通过 TestFlight 安装 iOS 内测版</a>' if testflight else '<p class="muted">iOS 内测暂未开放。开放后将通过 TestFlight 安装与更新。</p>')
    if appstore:
        apple += f'<a class="button secondary" href="{html.escape(appstore, quote=True)}" rel="noopener">在 App Store 查看正式版</a>'
    return f'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>易可聊 · 原生内测下载</title>
<style>*{{box-sizing:border-box}}body{{margin:0;background:#f4f6fb;color:#212121;font:16px/1.75 system-ui,-apple-system,sans-serif}}main{{max-width:680px;margin:6vh auto;padding:32px;background:white;border-radius:20px}}h1{{font-size:28px;margin:0 0 12px}}h2{{font-size:19px;margin:30px 0 8px}}.muted{{color:#626e8d}}.button{{display:block;border-radius:10px;padding:14px 20px;background:#0a2fc2;color:white;text-decoration:none;text-align:center;margin:14px 0}}.secondary{{background:#edf1ff;color:#0a2fc2}}pre{{white-space:pre-wrap;font:inherit}}@media(max-width:720px){{main{{margin:20px 16px;padding:24px}}}}</style></head>
<body><main><p class="muted">易可聊 / 原生内测</p><h1>下载与更新</h1><p>请收藏此页，后续内测版本会在这里更新。</p>
<h2>Android</h2><p id="version">当前内测版本：{version}</p><a id="android" class="button" href="{apk_url}">下载 Android 内测版</a>
<p class="muted">首次安装后，后续版本可在 App「关于我们 → 检查更新」中安装。系统提示时，允许当前浏览器或 App 安装应用，再按系统提示确认。原生内测版与现有正式版可同时保留。</p>
<h2>本次更新</h2><pre id="changelog">{changelog}</pre><h2>iPhone / iPad</h2>{apple}<p class="muted">iOS 内测更新在 TestFlight 中完成；本页不提供直接安装 IPA。</p>
<p id="status" class="muted"></p></main><script>
fetch('./update.json',{{cache:'no-store'}}).then(r=>{{if(!r.ok)throw Error();return r.json()}}).then(v=>{{
if(v.schemaVersion!==1||v.platform!=='android'||v.channel!=='native-staging'||v.applicationId!=='{APPLICATION_ID}'||v.releaseFamily!=='{FAMILY}')throw Error();
const u=new URL(v.downloadUrl);if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error();
document.getElementById('android').href=u.href;document.getElementById('version').textContent='当前内测版本：'+v.versionName;document.getElementById('changelog').textContent=v.changelog||'';
}}).catch(()=>{{document.getElementById('status').textContent='版本信息暂未刷新，可稍后重新打开本页。'}});
</script></body></html>'''


def prepare(apk, artifact, base_url, output, changelog="", testflight="", previous=None, appstore=""):
    base_url = https_url(base_url, base=True)
    if testflight and not re.fullmatch(r"https://testflight\.apple\.com/join/[A-Za-z0-9]{8}/?", testflight):
        raise ValueError("Use the real public TestFlight invitation URL from App Store Connect")
    if appstore and not re.fullmatch(r"https://apps\.apple\.com/(?:[a-z]{2}/)?app/(?:[^/?#]+/)?id[0-9]+/?", appstore):
        raise ValueError("Use the real apps.apple.com application URL")
    if len(changelog) > 2000:
        raise ValueError("Changelog must be at most 2000 characters")
    if previous:
        validate_previous(previous, artifact)
    filename = f"native-{artifact['versionName']}-{artifact['versionCode']}-{artifact['sha256'][:12]}.apk"
    manifest = {"schemaVersion": 1, "platform": "android", "channel": CHANNEL, "applicationId": APPLICATION_ID, "releaseFamily": FAMILY, **artifact, "downloadUrl": base_url + filename, "changelog": changelog, "ios": {"testFlightURL": testflight, "appStoreURL": appstore}}
    # APK 先写，清单最后替换；实际托管也应遵守相同次序。
    output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(apk, output / filename)
    (output / "index.html").write_text(render_page(manifest, testflight, appstore), encoding="utf-8")
    (output / "_headers").write_text("/\n  Cache-Control: no-store\n/index.html\n  Cache-Control: no-store\n/update.json\n  Cache-Control: no-store\n/*.apk\n  Cache-Control: public, max-age=31536000, immutable\n", encoding="utf-8")
    temporary = output / "update.json.tmp"
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(output / "update.json")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--expected-certificate-sha256", required=True)
    parser.add_argument("--aapt", default="aapt")
    parser.add_argument("--apksigner", default="apksigner")
    parser.add_argument("--changelog-file", type=Path)
    parser.add_argument("--testflight-url", default="")
    parser.add_argument("--appstore-url", default="")
    parser.add_argument("--previous-manifest", type=Path)
    args = parser.parse_args()
    artifact = inspect_apk(args.apk.resolve(strict=True), args.aapt, args.apksigner, args.expected_certificate_sha256)
    changelog = args.changelog_file.read_text(encoding="utf-8").strip() if args.changelog_file else "修复问题并优化聊天体验。"
    previous = json.loads(args.previous_manifest.read_text(encoding="utf-8")) if args.previous_manifest else None
    manifest = prepare(args.apk, artifact, args.base_url, args.out, changelog, args.testflight_url, previous, args.appstore_url)
    print(json.dumps({"status": "prepared_not_uploaded", "directory": str(args.out.resolve()), "versionCode": manifest["versionCode"], "sha256": manifest["sha256"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
