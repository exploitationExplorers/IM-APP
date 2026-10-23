"""Explicit local H5 chat smoke; creates test users/messages and OSS test objects.

Strict HTTPS, fresh browser contexts, local API/WebSocket and chat-prefix OSS only.
No cleanup, production data, HAR/trace, token, signed URL or console output.
Android/iOS native bridges and interrupted multipart recovery are NOT covered.
"""
import argparse
import json
import re
import ssl
import struct
import subprocess
import time
import uuid
import zlib
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import unquote, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

ROOT = Path(__file__).resolve().parent
BASE = "https://localhost:18443"
CHAT_HOST = "oss-chat-test.xn--jprz53bj9s.com"
PREFIX = "oss-test/chat/"
PHONES = ("15013938612", "15013938613")
PASSWORD = "asd.12345"  # Disposable local-only accounts, never production.


def safe_chat_url(url, method, headers=None):
    """Fail closed: only prefixed HTTPS objects, never another host or deletion."""
    u = urlsplit(url)
    key = unquote(u.path.lstrip("/"))
    headers = {k.lower(): v for k, v in (headers or {}).items()}
    return (
        u.scheme == "https" and u.netloc == CHAT_HOST and not u.fragment
        and method in ("GET", "HEAD", "OPTIONS", "POST", "PUT")
        and key.startswith(PREFIX) and len(key) > len(PREFIX)
        and "\\" not in key and "%" not in key
        and all(p not in ("", ".", "..") for p in key.split("/"))
        and not headers.get("cookie")
        and not headers.get("authorization", "").lower().startswith("bearer ")
    )


def make_png(seed):
    """Synthetic RGB fixture, unique per run to exercise real original/thumbnail writes."""
    width, height = 960, 640
    raw = b"".join(b"\0" + bytes(
        channel for x in range(width)
        for channel in ((x + seed) % 256, (y + (seed >> 8)) % 256, (x * y + (seed >> 16)) % 256)
    ) for y in range(height))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"tEXt", b"oss-test\0" + str(seed).encode()) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def api(route, body=None, token=None, statuses=(200,)):
    assert route.startswith("/api/v1/") and ".." not in route and "?" not in route
    ca = ssl.create_default_context(cafile=str(ROOT / "private/tls/ca/rootCA.pem"))
    opener = build_opener(HTTPSHandler(context=ca), NoRedirect())
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = Request(BASE + route, headers=headers,
                  data=None if body is None else json.dumps(body).encode())
    try:
        response = opener.open(req, timeout=30)
    except HTTPError as error:
        response = error
    with response:
        assert response.status in statuses, f"local-status-{response.status}"
        result = json.loads(response.read(2 * 1024 * 1024))
        if response.status == 200:
            assert result["code"] == 0
        return result.get("data")


def fixtures():
    accounts = []
    for phone in PHONES:
        credentials = {"countryCode": "86", "phone": phone, "password": PASSWORD,
                       "deviceId": "oss-test-chat-smoke"}
        api("/api/v1/auth/register", {**credentials, "code": "246810"}, statuses=(200, 409))
        login = api("/api/v1/auth/login", credentials)
        assert re.fullmatch(r"[0-9a-f-]{36}", login["user"]["id"])
        accounts.append({"id": login["user"]["id"], "token": login["accessToken"], "phone": phone})
    first, second = accounts
    contacts = api("/api/v1/contacts", token=first["token"])
    items = contacts if isinstance(contacts, list) else contacts["items"]
    if not any(c["id"] == second["id"] for c in items):
        request = api("/api/v1/friend-requests", {"toUserId": second["id"], "message": "OSS local verification"}, first["token"])
        if request["status"] == "pending":
            api(f"/api/v1/friend-requests/{request['id']}/accept", {}, second["token"])
        else:
            assert request["status"] == "accepted"
    # Register both OpenIM users and synchronize the isolated friendship before UI login.
    for account in accounts:
        im = api("/api/v1/im/token", {"platformId": 5}, account["token"])
        assert im["apiAddr"] == BASE + "/openim-api"
        assert im["wsAddr"] == "wss://localhost:18443/openim-ws"
        del account["token"]
    return accounts


def install_routes(context, evidence):
    def object_shape(value, depth=0):
        # Only schema/types and public origins; no credentials/signatures/IDs.
        if depth > 5:
            return type(value).__name__
        if isinstance(value, dict):
            return {k: object_shape(v, depth + 1) for k, v in value.items()}
        if isinstance(value, list):
            return {"length": len(value), "item": object_shape(value[0], depth + 1) if value else None}
        if isinstance(value, str) and value.startswith(("https://", "http://")):
            u = urlsplit(value)
            return {"origin": f"{u.scheme}://{u.netloc}", "chatPrefix": unquote(u.path).startswith("/" + PREFIX)}
        return type(value).__name__

    def route_request(route):
        request = route.request
        u = urlsplit(request.url)
        if u.scheme in ("blob", "data", "about") or (
            u.scheme == "https" and u.netloc == "localhost:18443"
        ) or safe_chat_url(request.url, request.method, request.headers):
            route.continue_()
            return
        optional = request.method == "GET" and (
            u.hostname == "cdn.dcloud.net.cn" or (
                u.hostname == "nxbf.yuntsy.com" and u.path == "/contents/headimg.jpg" and not u.query
            )
        )
        if not optional:
            evidence["blocked"].add(u.hostname or "unknown")
        route.abort("blockedbyclient")

    def route_socket(socket):
        u = urlsplit(socket.url)
        if u.scheme == "wss" and u.netloc == "localhost:18443" and u.path == "/openim-ws":
            socket.connect_to_server()
        else:
            evidence["blocked"].add(u.hostname or "unknown")
            socket.close()

    def response_seen(response):
        request = response.request
        u = urlsplit(response.url)
        if safe_chat_url(response.url, request.method):
            evidence["cloudStatuses"].add(f"{request.method}:{response.status}")
            if response.status >= 400:
                try:
                    code = re.search(r"<Code>([A-Za-z0-9_]+)</Code>", response.text())
                    if code:
                        evidence["cloudStatuses"].add(code.group(1))
                except Exception:
                    pass
            if request.method in ("PUT", "POST") and 200 <= response.status < 300:
                evidence["writes"].add(unquote(u.path))
            if request.method == "GET" and response.status == 200:
                evidence["reads"].add(unquote(u.path))
        elif u.netloc == "localhost:18443" and u.path.startswith("/openim-api/object/") and u.path.rsplit("/", 1)[-1] in {
            "part_size", "initiate_multipart_upload", "auth_sign", "complete_multipart_upload", "form_data", "complete_form_data",
        }:
            evidence["objectCalls"].add(u.path.rsplit("/", 1)[-1])
            try:
                body = response.json()
                code = body.get("errCode")
                evidence["objectResults"][u.path.rsplit("/", 1)[-1]] = {
                    "status": response.status, "errCode": code if isinstance(code, int) else type(code).__name__,
                    "dataShape": object_shape(body.get("data")),
                }
            except Exception as error:
                evidence["objectResults"][u.path.rsplit("/", 1)[-1]] = {"status": response.status, "parseError": type(error).__name__}
        if u.netloc == "localhost:18443" and (u.path.startswith("/api/v1/") or u.path.startswith("/openim-api/")):
            if response.status >= 400:
                route_name = re.sub(r"[0-9a-f]{8}-[0-9a-f-]{27}", ":id", u.path)
                evidence["localErrors"].add(f"{response.status} {route_name}")
            if "application/json" in response.headers.get("content-type", ""):
                try:
                    body = response.json()
                    code = body.get("errCode", 0)
                    if isinstance(code, int) and code != 0:
                        evidence["localErrors"].add("openim-" + str(code))
                except Exception:
                    pass

    context.route("**/*", route_request)
    context.route_web_socket("**/*", route_socket)
    context.on("response", response_seen)


def install_console_classification(page, evidence):
    def classified(message):
        # Whitelisted categories only, never serialize SDK console arguments.
        for category in ("Failed to fetch", "Invalid URL", "CORS", "unsafe header", "Cannot read", "SignatureDoesNotMatch"):
            if category.lower() in message.text.lower():
                evidence["browserCategories"].add(category)
    page.on("console", classified)


def login(page, phone):
    page.goto(BASE + "/#/", wait_until="networkidle", timeout=45000)
    page.get_by_text("开启聊天快捷版", exact=True).click()
    page.get_by_text("账号密码登录", exact=True).wait_for(state="visible")
    try:
        page.locator(".npd-cancel").wait_for(state="visible", timeout=2000)
    except Exception:
        pass
    if page.locator(".npd-cancel").is_visible():
        page.locator(".npd-cancel").click()
    page.locator("input[type=number]").fill(phone)
    page.locator("input[type=password]").fill(PASSWORD)
    page.locator(".auth-login-btn").click()
    page.wait_for_url("**/#/pages/chat/index", timeout=45000)
    page.locator(".list-panel .header .title").get_by_text("聊天", exact=True).wait_for(state="visible")


def open_room(page, peer_id):
    # After the required landing/login UI, use the real profile's message action.
    page.goto(BASE + f"/#/pages/contacts/user-profile?id={peer_id}", wait_until="networkidle")
    page.get_by_text("发消息", exact=True).click()
    page.locator(".room .composer-row textarea").wait_for(state="visible", timeout=45000)
    page.wait_for_load_state("networkidle")


def image_count(page):
    return page.locator(".room .image-bubble:not(.video-bubble)").count()


def image_ids(page):
    return set(page.locator(".room .msg-row").evaluate_all("""rows => rows
        .filter(row => row.querySelector('.image-bubble:not(.video-bubble)'))
        .map(row => row.id)"""))


def assert_loaded(page, minimum):
    page.wait_for_function("""minimum => {
      const images = [...document.querySelectorAll('.room .image-bubble:not(.video-bubble) img')];
      const pending = document.querySelector('.room .msg-row[id^="msg_local_"]');
      return !pending && images.filter(i => i.complete && i.naturalWidth > 0).length >= minimum;
    }""", arg=minimum, timeout=60000)
    assert page.locator(".room .retry-flag").count() == 0


def wait_for_writes(page, evidence, minimum):
    # Preview bubbles are deliberately optimistic and can load a local blob
    # before UploadFile even starts. Pump Playwright events until REAL OSS writes.
    deadline = time.monotonic() + 60
    while len(evidence["writes"]) < minimum:
        if time.monotonic() >= deadline:
            raise TimeoutError("original-and-thumbnail-writes-not-confirmed")
        page.wait_for_timeout(100)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write-test-objects", action="store_true", required=True)
    parser.add_argument("--storage-only", action="store_true",
                        help="Test OSS writes, send and cold history separately; does NOT assert realtime reception.")
    args = parser.parse_args()
    subprocess.run(["node", "-e", """
      const c=require('./deploy/oss-test/local.cjs'); const e=require('node:child_process');
      c.validateRuntime(); c.validateTLS();
      const ctx=e.execFileSync('docker',['context','show'],{encoding:'utf8'}).trim();
      const endpoint=JSON.parse(e.execFileSync('docker',['context','inspect',ctx],{encoding:'utf8'}))[0].Endpoints.docker.Host;
      c.assertLocalDocker(process.env,ctx,endpoint);
    """], cwd=str(ROOT.parent.parent), check=True, capture_output=True)
    accounts = fixtures()
    print(json.dumps({"check": "two-local-chat-accounts-and-friendship", "ok": True}), flush=True)
    from playwright.sync_api import sync_playwright
    output = ROOT / "artifacts" / "browser-chat-verify" / uuid.uuid4().hex
    output.mkdir(parents=True)
    evidence = {"writes": set(), "reads": set(), "objectCalls": set(), "blocked": set(), "localErrors": set(), "objectResults": {}, "cloudStatuses": set(), "browserCategories": set()}
    results = []
    sent_image_ids = set()
    stage = "browser-start"
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        contexts, pages = [], []
        try:
            for name, viewport, account in zip(("pc", "mobile-web"),
                    ({"width": 1280, "height": 800}, {"width": 390, "height": 844}), accounts):
                stage = name + "-login-room"
                context = browser.new_context(viewport=viewport, service_workers="block")
                contexts.append(context)
                install_routes(context, evidence)
                page = context.new_page()
                install_console_classification(page, evidence)
                pages.append(page)
                login(page, account["phone"])
                open_room(page, accounts[1 if name == "pc" else 0]["id"])
                page.screenshot(path=str(output / f"{name}-room.png"))
                results.append({"check": stage, "ok": True})
                print(json.dumps(results[-1]), flush=True)
            if not args.storage_only:
                # Text round-trip proves the receive path before full media E2E.
                stage = "openim-text-roundtrip"
                marker = "OSS local smoke " + uuid.uuid4().hex[:8]
                pages[0].bring_to_front()
                pages[0].locator(".composer-row textarea").fill(marker)
                pages[0].locator(".composer .send-btn").click()
                pages[0].locator(".msg-list").get_by_text(marker, exact=True).wait_for(timeout=15000)
                # Two contexts share one browser rather than two physical devices.
                pages[1].bring_to_front()
                pages[1].locator(".msg-list").get_by_text(marker, exact=True).wait_for(timeout=60000)
                results.append({"check": stage, "ok": True})
                print(json.dumps(results[-1]), flush=True)
            seed = uuid.uuid4().int
            for i, name in enumerate(("pc", "mobile-web")):
                stage = name + ("-image-oss-upload-send" if args.storage_only else "-image-send-receive")
                sender, receiver = pages[i], pages[1 - i]
                sender.bring_to_front()
                before_send, before_recv = image_count(sender), image_count(receiver)
                before_ids = image_ids(sender)
                before_writes = len(evidence["writes"])
                sender.locator(".composer-row .tool").last.click()
                with sender.expect_file_chooser(timeout=10000) as chooser:
                    sender.locator(".plus-item").filter(has_text="照片").click()
                chooser.value.set_files({"name": f"oss-local-{name}.png", "mimeType": "image/png",
                                         "buffer": make_png(seed + (i * 65537))})
                stage = name + "-original-and-thumbnail-oss-writes"
                wait_for_writes(sender, evidence, before_writes + 2)
                stage = name + ("-image-oss-upload-send" if args.storage_only else "-image-send-receive")
                assert_loaded(sender, before_send + 1)
                new_ids = image_ids(sender) - before_ids
                assert new_ids and all(not row_id.startswith("msg_local_") for row_id in new_ids)
                sent_image_ids.update(new_ids)
                if not args.storage_only:
                    receiver.bring_to_front()
                    assert_loaded(receiver, before_recv + 1)
                # Original and its independent thumbnail must both have real OSS writes.
                assert len(evidence["writes"]) >= before_writes + 2, "original-and-thumbnail-not-written"
                sender.screenshot(path=str(output / f"{name}-image-sent.png"))
                if not args.storage_only:
                    receiver.screenshot(path=str(output / f"{name}-image-received.png"))
                results.append({"check": stage, "ok": True})
                print(json.dumps(results[-1]), flush=True)
            stage = "cold-context-history-and-private-image-read"
            contexts[1].close()
            context = browser.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
            contexts.append(context)
            install_routes(context, evidence)
            page = context.new_page()
            install_console_classification(page, evidence)
            pages[1] = page
            login(page, accounts[1]["phone"])
            open_room(page, accounts[0]["id"])
            assert_loaded(page, 2)
            # Wait for this run's ACKNOWLEDGED message IDs, not unrelated old images.
            page.wait_for_function("""ids => ids.every(id => {
              const img = document.getElementById(id)?.querySelector('.image-bubble img');
              return img?.complete && img.naturalWidth > 0;
            })""", arg=sorted(sent_image_ids), timeout=60000)
            page.screenshot(path=str(output / "mobile-web-cold-history.png"))
            assert not evidence["blocked"], "unexpected-external-request"
            assert evidence["reads"], "no-successful-oss-image-read"
            results.append({"check": stage, "ok": True})
        except Exception as error:
            results.append({"check": stage, "ok": False, "errorType": type(error).__name__})
            for i, page in enumerate(pages):
                if not page.is_closed():
                    page.screenshot(path=str(output / f"{i}-failed.png"), mask=[page.locator("input")])
        finally:
            browser.close()
    summary = {"successfulObjectWriteKeys": len(evidence["writes"]),
               "successfulObjectReadKeys": len(evidence["reads"]),
               "localObjectAPIs": sorted(evidence["objectCalls"]),
               "objectResponseSchemas": evidence["objectResults"],
               "cloudStatuses": sorted(evidence["cloudStatuses"]),
               "browserErrorCategories": sorted(evidence["browserCategories"]),
               "localErrorCodes": sorted(evidence["localErrors"]),
               "unexpectedHostsBlocked": sorted(evidence["blocked"])}
    report = {"mode": "storage-only" if args.storage_only else "full-chat", "results": results, "evidence": summary}
    (output / "result.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    for result in results:
        print(json.dumps(result))
    print(json.dumps(summary))
    print(f"Local screenshots/report: {output}")
    if args.storage_only:
        print("STORAGE-ONLY: realtime text/image reception was not asserted and must not be reported as passed.")
    print("Native App, group chat, other media and interrupted multipart recovery are not covered.")
    return 0 if all(result["ok"] for result in results) else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"check": "local-chat-smoke-refused", "ok": False, "errorType": type(error).__name__}))
        raise SystemExit(1)
