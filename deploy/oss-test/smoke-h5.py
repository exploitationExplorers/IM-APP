"""Local browser smoke only. Use the ignored verification venv/system Edge.

No cloud writes, persistent browser profile, trace, HAR, token/body/console log.
Native Android/iOS are NOT covered by this test.
"""
import argparse
import json
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
BASE = "https://localhost:18443"
ADMIN = "https://localhost:18444"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local-only", action="store_true", required=True)
    parser.parse_args()
    # Refuse stale runtime/artifacts. The Node guard suppresses secret details.
    subprocess.run(["node", str(ROOT / "local.cjs"), "check"], check=True, capture_output=True)
    output = ROOT / "artifacts" / "browser-verify"
    output.mkdir(parents=True, exist_ok=True)
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        try:
            for name, viewport in [("pc", {"width": 1280, "height": 800}), ("mobile-web", {"width": 390, "height": 844})]:
                # Fresh context, strict system-trusted TLS, no production account.
                context = browser.new_context(viewport=viewport, service_workers="block")
                blocked = set()
                unexpected = set()

                def route_request(route):
                    u = urlsplit(route.request.url)
                    if u.scheme in ("data", "blob", "about") or (u.scheme == "https" and u.netloc == "localhost:18443"):
                        route.continue_()
                    else:
                        blocked.add(u.hostname or "unknown")
                        optional = route.request.method == "GET" and (
                            u.hostname == "cdn.dcloud.net.cn" or
                            (u.hostname == "nxbf.yuntsy.com" and u.path == "/contents/headimg.jpg" and not u.query)
                        )
                        if not optional:
                            unexpected.add(u.hostname or "unknown")
                        route.abort("blockedbyclient")

                context.route("**/*", route_request)
                # SDK WebSocket must also remain on the local test gateway.
                def route_socket(socket):
                    u = urlsplit(socket.url)
                    if u.scheme == "wss" and u.netloc == "localhost:18443" and u.path == "/openim-ws":
                        socket.connect_to_server()
                    else:
                        blocked.add(u.hostname or "unknown")
                        socket.close()

                context.route_web_socket("**/*", route_socket)
                page = context.new_page()
                stage = "download-landing"
                try:
                    page.goto(f"{BASE}/#/", wait_until="networkidle", timeout=45000)
                    page.get_by_text("开启聊天快捷版", exact=True).wait_for(state="visible")
                    page.screenshot(path=str(output / f"{name}-landing.png"), full_page=True)
                    page.get_by_text("开启聊天快捷版", exact=True).click()
                    stage = "local-login"
                    page.get_by_text("账号密码登录", exact=True).wait_for(state="visible")
                    # Fresh profiles show the project's notification prompt. Cancel
                    # through the real UI rather than granting push permissions.
                    try:
                        page.locator(".npd-cancel").wait_for(state="visible", timeout=2500)
                    except Exception:
                        pass
                    if page.locator(".npd-cancel").is_visible():
                        page.locator(".npd-cancel").click()
                    # Discover from rendered controls; do not navigate around landing.
                    page.locator("input[type=number]").fill("15013938612")
                    # uni-input renders its hint outside the native input, so
                    # get_by_placeholder is not an actual DOM selector here.
                    page.locator("input[type=password]").fill("asd.12345")
                    page.locator(".auth-login-btn").click()
                    page.wait_for_url("**/#/pages/chat/index", timeout=45000)
                    page.wait_for_load_state("networkidle")
                    stage = "responsive-chat-layout"
                    # Hash navigation is earlier than uni-app's async page mount.
                    page.locator(".list-panel .header .title").get_by_text("聊天", exact=True).wait_for(state="visible")
                    page.wait_for_function("expected => document.documentElement.classList.contains('im-desktop') === expected", arg=name == "pc")
                    if name == "pc":
                        page.locator(".im-desktop-workspace .im-desktop-room-column").wait_for(state="visible")
                    page.screenshot(path=str(output / f"{name}-chat.png"), full_page=True)
                    # uni-app attempts its optional DCloud push asset. It stays
                    # blocked: no real push service is needed for these checks.
                    assert not unexpected, "unexpected-external-request"
                    results.append({"viewport": name, "check": "landing-login-layout", "ok": True,
                                    "blockedOptionalAssets": sorted(blocked)})
                except Exception as error:
                    # Do not serialize Playwright exception text: it can contain URLs.
                    page.screenshot(path=str(output / f"{name}-failed.png"), full_page=True, mask=[page.locator("input")])
                    results.append({"viewport": name, "check": stage, "ok": False,
                                    "externalRequestBlocked": bool(blocked), "externalHosts": sorted(blocked),
                                    "errorType": type(error).__name__,
                                    "route": page.evaluate("location.hash.split('?')[0]")})
                finally:
                    context.close()
            context = browser.new_context(viewport={"width": 1280, "height": 800}, service_workers="block")
            try:
                context.route("**/*", lambda route: route.continue_() if (urlsplit(route.request.url).scheme, urlsplit(route.request.url).netloc) == ("https", "localhost:18444") else route.abort("blockedbyclient"))
                page = context.new_page()
                page.goto(ADMIN, wait_until="networkidle", timeout=45000)
                page.get_by_placeholder("请输入管理员账号").wait_for(state="visible")
                page.get_by_placeholder("请输入登录密码").wait_for(state="visible")
                page.screenshot(path=str(output / "admin-login.png"), full_page=True)
                results.append({"viewport": "admin-pc", "check": "admin-login-page", "ok": True})
            except Exception as error:
                results.append({"viewport": "admin-pc", "check": "admin-login-page", "ok": False, "errorType": type(error).__name__})
            finally:
                context.close()
        finally:
            browser.close()
    for result in results:
        print(json.dumps(result))
    print("Native App, chat media uploads and full business flows are not covered.")
    return 0 if all(result["ok"] for result in results) else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        print("Local browser smoke failed/refused; no raw URLs, credentials or responses printed.")
        raise SystemExit(1)
