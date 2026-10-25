"""Local H5 smoke against the oss-test dev server, never production.

Requires Python Playwright and system Edge; no persistent profile, HAR, trace,
console/token/body recording, uploads or message sends. Native is not covered.
Start separately: node deploy/oss-test/frontend.cjs client-dev
"""
import argparse
import json
from pathlib import Path
import subprocess
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
BASE = "http://127.0.0.1:15173"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local-only", required=True, action="store_true")
    parser.parse_args()
    # Fail if local runtime config is stale/non-local. Never read credentials.
    subprocess.run(["node", "-e", "require('./deploy/oss-test/frontend-vite.cjs').testFrontendConfig('client')"],
                   cwd=HERE.parents[1], check=True, capture_output=True, timeout=15)
    output = HERE / "artifacts" / "h5-verification"
    output.mkdir(parents=True, exist_ok=True)
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        try:
            for name, width, height in [("pc", 1280, 800), ("mobile-web", 390, 844)]:
                context = browser.new_context(viewport={"width": width, "height": height}, service_workers="block")
                external = set()

                def allowed(url):
                    u = urlsplit(url)
                    return ((u.scheme == "http" and u.netloc == "127.0.0.1:15173") or
                            (u.scheme == "https" and u.netloc == "localhost:18443"))

                def request(route):
                    u = urlsplit(route.request.url)
                    if allowed(route.request.url) or u.scheme in ("blob", "data", "about"):
                        route.continue_()
                    else:
                        external.add(u.hostname or "unknown")
                        route.abort("blockedbyclient")

                def socket(ws):
                    u = urlsplit(ws.url)
                    if ((u.scheme == "ws" and u.netloc == "127.0.0.1:15173") or
                        (u.scheme == "wss" and u.netloc == "localhost:18443" and u.path == "/openim-ws")):
                        ws.connect_to_server()
                    else:
                        external.add(u.hostname or "unknown")
                        ws.close()

                context.route("**/*", request)
                context.route_web_socket("**/*", socket)
                page = context.new_page()
                page.set_default_timeout(15000)
                login_statuses = []
                network_errors = set()

                def response(res):
                    if urlsplit(res.url).path in ("/api/v1/auth/login", "/api/v1/auth/password/login"):
                        login_statuses.append(res.status)

                def failed(req):
                    failure = req.failure or ""
                    # Only Chromium's bounded error code, never request URLs.
                    if failure.startswith("net::ERR_") and all(c.isupper() or c == "_" for c in failure[5:]):
                        network_errors.add(failure[5:])

                page.on("response", response)
                page.on("requestfailed", failed)
                stage = "landing"
                try:
                    page.goto(BASE + "/#/", wait_until="networkidle", timeout=45000)
                    page.get_by_text("开启聊天快捷版", exact=True).click()
                    stage = "local-login"
                    page.get_by_text("账号密码登录", exact=True).wait_for(state="visible")
                    try:
                        page.locator(".npd-cancel").wait_for(state="visible", timeout=2000)
                        page.locator(".npd-cancel").click()
                    except Exception:
                        pass
                    page.locator("input[type=number]").fill("15013938612")
                    page.locator("input[type=password]").fill("asd.12345")
                    page.locator(".auth-login-btn").click()
                    page.wait_for_url("**/#/pages/chat/index", timeout=30000)
                    page.wait_for_load_state("networkidle")
                    stage = "responsive-chat-list"
                    page.locator(".list-panel .header .title").get_by_text("聊天", exact=True).wait_for(state="visible")
                    page.wait_for_function("expected => document.documentElement.classList.contains('im-desktop') === expected", arg=name == "pc")
                    if name == "pc":
                        page.locator(".im-desktop-workspace .im-desktop-room-column").wait_for(state="visible")
                    stage = "existing-local-conversation"
                    page.locator(".conv").first.wait_for(state="visible", timeout=30000)
                    page.locator(".conv").first.click()
                    page.locator(".composer-row textarea").wait_for(state="visible")
                    page.screenshot(path=str(output / (name + ".png")), full_page=True)
                    results.append({"viewport": name, "stage": stage, "ok": True, "loginStatuses": login_statuses})
                except Exception as error:
                    # Exception/console text can include tokens or signed URLs.
                    page.screenshot(path=str(output / (name + "-blocked.png")), full_page=True)
                    results.append({"viewport": name, "stage": stage, "ok": False, "errorType": type(error).__name__,
                                    "loginStatuses": login_statuses, "networkErrors": sorted(network_errors),
                                    "blockedExternalHosts": sorted(external)})
                finally:
                    context.close()
        finally:
            browser.close()
    report = {"kind": "local-landing-login-layout-open-room-only", "results": results,
              "retentionEndToEnd": "not_performed", "nativeAcceptance": "not_performed",
              "productionConnections": "blocked", "messagesSent": 0}
    (output / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    return 0 if all(row["ok"] for row in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
