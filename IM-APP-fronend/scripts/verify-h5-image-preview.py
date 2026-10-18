"""Read-only preview regression against local Vite; no login or business writes.

Requires Python Playwright and an installed Chromium/Edge. All test images are
generated on loopback; no customer images, credentials or signed URLs are used.
Do not intercept requests or disable HTTP cache: second-open checks need it.
"""
import argparse
import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from playwright.async_api import async_playwright


class Images(BaseHTTPRequestHandler):
    hits = []

    def log_message(self, *_args):
        pass

    def do_GET(self):
        self.hits.append(self.path)
        index = int(urlsplit(self.path).path.rsplit("/", 1)[-1].split(".")[0])
        data = (f'<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200">'
                f'<rect width="900" height="1200" fill="hsl({index * 19},65%,40%)"/>'
                f'<text x="100" y="600" font-size="150" fill="white">{index}</text></svg>').encode()
        self.send_response(200)
        self.send_header("Content-Type", "image/svg+xml")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        self.wfile.write(data)


async def run(args):
    origin = urlsplit(args.base_url)
    if origin.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("Only a local Vite URL is allowed")
    server = ThreadingHTTPServer(("127.0.0.1", 0), Images)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    fixture = f"http://127.0.0.1:{server.server_port}"
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    results = []
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(channel=args.browser_channel, headless=True)
            try:
                for name, width, height in (("mobile", 390, 844), ("desktop", 1280, 800)):
                    context = await browser.new_context(viewport={"width": width, "height": height}, has_touch=name == "mobile")
                    page = await context.new_page()
                    requests = []
                    errors = []
                    page.on("request", lambda request: requests.append(request.url) if request.url.startswith(fixture) else None)
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    await page.goto(args.base_url.rstrip("/") + "/#/pages/download/index", wait_until="networkidle")
                    urls = [f"{fixture}/{name}/{index}.svg?OSSAccessKeyId=fake&Signature=a%2Bb%3D" for index in range(17)]

                    async def open_preview():
                        await page.evaluate("""async urls => {
                          const {previewImagesWithSave} = await import('/src/utils/chatMedia.ts');
                          await previewImagesWithSave(urls, urls[16]);
                        }""", urls)

                    async def loaded(index):
                        await page.wait_for_function("""url => [...document.querySelectorAll('#u-a-p img')]
                          .some(image => image.src === url && image.complete && image.naturalWidth > 0
                            && Math.abs(image.getBoundingClientRect().x
                              + image.getBoundingClientRect().width / 2 - innerWidth / 2) < 2)""", arg=urls[index])

                    async def close():
                        await page.locator("#u-a-p > div > div:last-child").click()
                        await page.locator("#u-a-p img").wait_for(state="detached")

                    await open_preview()
                    await loaded(16)
                    await page.wait_for_timeout(500)
                    assert requests == [urls[16]], f"{name}: first open fetched {len(requests)} originals"
                    assert await page.locator("#u-a-p uni-swiper-item").count() == 17
                    await page.screenshot(path=str(output / f"{name}-first.png"))
                    # Real mouse drag in both web viewports. Pause before release
                    # to avoid inertia skipping a slide; don't synthesize onChange.
                    async def drag(forward, index):
                        start, step = (0.85, -0.04) if forward else (0.25, 0.04)
                        await page.mouse.move(width * start, 100)
                        await page.mouse.down()
                        for n in range(1, 16):
                            await page.mouse.move(width * (start + n * step), 100)
                            await page.wait_for_timeout(45)
                        await page.wait_for_timeout(100)
                        await page.mouse.up()
                        await loaded(index)

                    await drag(False, 15)
                    assert requests == [urls[16], urls[15]], f"{name}: drag eagerly fetched originals"
                    await drag(True, 16)
                    assert len(requests) == 2, f"{name}: reverse drag refetched originals"
                    # Use uni's real gallery controls (not a synthetic onChange).
                    # Touch gestures/pinch still need a real-device acceptance.
                    async def navigate(direction, index):
                        x = 15 if direction == "prev" else width - 15
                        await page.mouse.move(x, height // 2)
                        await page.locator(f"#u-a-p .uni-swiper-navigation-{direction}").click()
                        await loaded(index)

                    for index in range(15, -1, -1):
                        await navigate("prev", index)
                        assert requests == list(reversed(urls[index:])), f"{name}: navigation fetched unvisited originals"
                    for index in range(1, 17):
                        await navigate("next", index)
                    assert len(requests) == 17, f"{name}: reverse navigation refetched originals"
                    hits_before = len(Images.hits)
                    await close()
                    await open_preview()
                    await loaded(16)
                    assert len(Images.hits) == hits_before, f"{name}: reopen missed HTTP cache"
                    assert await page.locator("#u-a-p img").count() == 1
                    await page.screenshot(path=str(output / f"{name}-second.png"))
                    await page.keyboard.press("Escape")
                    await page.locator("#u-a-p img").wait_for(state="detached")
                    assert not errors, errors
                    results.append({"viewport": name, "gallerySlides": 17,
                                    "firstOpenOriginalRequests": 1, "allSlidesReachable": True,
                                    "navigationOriginalRequests": 17, "reverseNavigationRequests": 0,
                                    "reopenServerRequests": 0, "dragBothDirections": "passed",
                                    "interaction": "mouse drag and built-in gallery navigation",
                                    "reopen": "passed", "closeAndEscape": "passed", "pageErrors": 0})
                    await context.close()
            except Exception as error:
                await page.screenshot(path=str(output / "failure.png"))
                failure = {"status": "failed", "viewport": name, "error": str(error),
                           "requests": requests, "pageErrors": errors, "completed": results}
                (output / "result.json").write_text(json.dumps(failure, indent=2), encoding="utf-8")
                raise
            finally:
                await browser.close()
    finally:
        server.shutdown()
        server.server_close()
    report = {"status": "passed", "results": results, "login": False, "businessWrites": False,
              "requestInterception": False, "cacheDisabled": False, "nativeApp": "not tested"}
    (output / "result.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:5191")
    parser.add_argument("--browser-channel", default="msedge")
    parser.add_argument("--output-dir", required=True)
    asyncio.run(run(parser.parse_args()))
