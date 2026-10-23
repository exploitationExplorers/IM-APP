"""Local H5 cache/viewer regression with no credentials or business writes.

Uses synthetic loopback images with Cache-Control:no-store, so reopen/reload
must use the application's IndexedDB, not the browser HTTP cache. All external
network traffic is blocked. Requires Python Playwright and installed Edge.
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
    recover = False
    def log_message(self, *_args):
        pass
    def do_GET(self):
        self.hits.append(self.path)
        path = urlsplit(self.path).path
        broken = path.endswith('/broken.svg') and not self.recover
        index = 0 if path.endswith('/broken.svg') else int(path.rsplit('/', 1)[-1].split('.')[0])
        data = (f'<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200">'
                f'<rect width="900" height="1200" fill="hsl({index * 19},65%,40%)"/>'
                f'<text x="100" y="600" font-size="150" fill="white">{index}</text></svg>').encode()
        self.send_response(404 if broken else 200)
        self.send_header('Content-Type', 'image/svg+xml')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(data)

async def run(args):
    origin = urlsplit(args.base_url)
    if origin.hostname not in ('localhost', '127.0.0.1', '::1'):
        raise ValueError('Only a local Vite URL is allowed')
    server = ThreadingHTTPServer(('127.0.0.1', 0), Images)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    fixture = f'http://127.0.0.1:{server.server_port}'
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    results = []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel=args.browser_channel, headless=True)
            try:
                for name, width, height in (('mobile', 390, 844), ('desktop', 1280, 800)):
                    context = await browser.new_context(viewport={'width': width, 'height': height}, has_touch=name == 'mobile')
                    # Never let a local regression talk to configured live APIs.
                    async def local_only(route):
                        target = urlsplit(route.request.url)
                        same_vite = target.scheme == origin.scheme and target.netloc == origin.netloc
                        same_fixture = target.scheme == 'http' and target.netloc == urlsplit(fixture).netloc
                        business = target.path.startswith(('/api', '/health', '/openim', '/object', '/minio'))
                        if route.request.method in ('GET', 'HEAD', 'OPTIONS') and (same_fixture or (same_vite and not business)):
                            await route.continue_()
                        else:
                            await route.abort()
                    await context.route('**/*', local_only)
                    # Also block WebSockets: Vite's business proxy can otherwise
                    # reach a real OpenIM server despite a loopback browser URL.
                    await context.route_web_socket('**/*', lambda route: route.close())
                    page = await context.new_page()
                    errors = []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    await page.goto(args.base_url.rstrip('/') + '/#/pages/download/index', wait_until='networkidle')
                    urls = [f'{fixture}/{name}/{i}.svg?OSSAccessKeyId=fake&Signature=a%2Bb%3D' for i in range(17)]
                    start_hits = len(Images.hits)
                    async def open_preview(values=urls):
                        await page.evaluate('''async urls => {
                          const {previewImagesWithSave} = await import('/src/utils/chatMedia.ts');
                          await previewImagesWithSave(urls, urls[urls.length - 1]);
                        }''', values)
                        await page.locator('.image-viewer').wait_for()
                    async def loaded(index, total=17):
                        await page.locator('.viewer-counter').filter(has_text=f'{index + 1} / {total}').wait_for()
                        await page.wait_for_function('''() => [...document.querySelectorAll('.preview-image img')]
                          .some(image => image.complete && image.naturalWidth > 0 && image.getBoundingClientRect().height > 100)''')
                        await page.locator('.preview-state').wait_for(state='detached')
                    async def close():
                        await page.locator('.viewer-close').click()
                        await page.locator('.image-viewer').wait_for(state='detached')
                    await open_preview()
                    await loaded(16)
                    await page.wait_for_timeout(300)
                    assert Images.hits[start_hits:] == [urlsplit(urls[16]).path + '?' + urlsplit(urls[16]).query], 'first open fetched unvisited originals'
                    assert await page.locator('.viewer-swiper uni-swiper-item').count() == 17
                    await page.screenshot(path=str(output / f'{name}-first.png'))
                    # Actual swiper drag, not a synthetic change event.
                    await page.mouse.move(width * .2, height * .5)
                    await page.mouse.down()
                    await page.mouse.move(width * .8, height * .5, steps=18)
                    await page.wait_for_timeout(120)
                    await page.mouse.up()
                    await loaded(15)
                    for i in range(14, -1, -1):
                        await page.locator('.viewer-prev').click()
                        await loaded(i)
                    assert len(Images.hits) - start_hits == 17, 'navigation fetched more than visited slides'
                    for i in range(1, 17):
                        await page.locator('.viewer-next').click()
                        await loaded(i)
                    assert len(Images.hits) - start_hits == 17, 'reverse navigation refetched originals'
                    await page.get_by_label('放大图片', exact=True).click()
                    await page.wait_for_function("() => document.querySelector('.preview-pan')?.style.transform.includes('scale(2)')")
                    await page.get_by_label('缩小图片', exact=True).click()
                    await page.wait_for_function("() => document.querySelector('.preview-pan')?.style.transform.includes('scale(1)')")
                    async with page.expect_download() as download:
                        await page.get_by_text('保存', exact=True).click()
                    assert (await download.value).suggested_filename.startswith('image_')
                    assert len(Images.hits) - start_hits == 17, 'save re-downloaded original instead of using cached blob'
                    await close()
                    await open_preview()
                    await loaded(16)
                    assert len(Images.hits) - start_hits == 17, 'reenter missed preview cache'
                    await close()
                    await page.reload(wait_until='networkidle')
                    await open_preview()
                    await loaded(16)
                    assert len(Images.hits) - start_hits == 17, 'full reload missed IndexedDB cache'
                    await page.screenshot(path=str(output / f'{name}-disk-hit.png'))
                    await page.keyboard.press('Escape')
                    await page.locator('.image-viewer').wait_for(state='detached')
                    Images.recover = False
                    await open_preview([f'{fixture}/{name}/broken.svg'])
                    await page.get_by_text('图片不存在或已被删除', exact=True).wait_for()
                    assert await page.get_by_text('保存', exact=True).get_attribute('aria-disabled') == 'true'
                    Images.recover = True
                    await page.get_by_text('重新加载', exact=True).click()
                    await loaded(0, 1)
                    await close()
                    assert not errors, errors
                    results.append({'viewport': name, 'slides': 17, 'firstOriginalRequests': 1,
                                    'unvisitedPrefetch': 0, 'allSlidesReachable': True,
                                    'reverseNetworkRequests': 0, 'reenterNetworkRequests': 0,
                                    'reloadNetworkRequests': 0, 'diskCache': 'IndexedDB',
                                    'swipe': 'mouse drag passed', 'zoomButtons': 'passed',
                                    'saveCachedBlob': 'passed', 'http404AndRetry': 'passed',
                                    'closeAndEscape': 'passed', 'pageErrors': 0})
                    await context.close()
            except Exception as error:
                await page.screenshot(path=str(output / 'failure.png'))
                failure = {'status': 'failed', 'viewport': name, 'error': str(error), 'pageErrors': errors, 'completed': results}
                (output / 'result.json').write_text(json.dumps(failure, indent=2), encoding='utf-8')
                raise
            finally:
                await browser.close()
    finally:
        server.shutdown()
        server.server_close()
    report = {'status': 'passed', 'results': results, 'login': False, 'businessWrites': False,
              'externalNetwork': 'blocked', 'fixtureHTTPCache': 'no-store', 'nativeApp': 'not tested'}
    (output / 'result.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:5191')
    parser.add_argument('--browser-channel', default='msedge')
    parser.add_argument('--output-dir', required=True)
    asyncio.run(run(parser.parse_args()))
