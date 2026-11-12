/** 从既有 uni-app 同步原生素材；不下载、不访问业务服务。需要 Node 22+ 与本机 Edge。 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, openSync, closeSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = resolve(root, 'IM-APP-fronend/src/static');
const cache = resolve(root, '.native-cache/browser/ui-assets');
const chromium = process.env.NATIVE_CHROMIUM || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const port = 9237;
const sha = value => createHash('sha256').update(value).digest('hex');
const pngs = {
  uni_avatar_1: 'avatar-1.png', uni_avatar_me: 'avatar-me.png',
  uni_icon_mic: 'icon-mic.png', uni_icon_photo: 'icon-photo.png',
  uni_icon_camera: 'icon-camera.png', uni_icon_file: 'icon-file.png',
  uni_icon_card: 'icon-card.png', uni_icon_favorite: 'icon-favorite.png',
};
const svgs = {
  uni_tab_contacts: 'tab/contacts.svg', uni_tab_contacts_active: 'tab/contacts-active.svg',
  uni_tab_chat: 'tab/chat.svg', uni_tab_chat_active: 'tab/chat-active.svg',
  uni_tab_mine: 'tab/mine.svg', uni_tab_mine_active: 'tab/mine-active.svg',
  uni_auth_eye: 'auth/icon-eye.svg', uni_auth_eye_off: 'auth/icon-eye-off.svg',
  uni_auth_chevron_down: 'auth/icon-chevron-down.svg',
  uni_icon_plus: 'icons/icon-plus.svg', uni_icon_back: 'icons/icon-back.svg',
  uni_icon_more: 'icons/icon-more.svg', uni_icon_pin: 'icons/icon-pin.svg',
  uni_icon_bell_slash: 'icons/icon-bell-slash.svg',
  uni_menu_add_friend: 'icons/menu-add-friend.svg', uni_menu_add_group: 'icons/menu-add-group.svg',
  uni_menu_create_group: 'icons/menu-create-group.svg', uni_group_default: 'group-default.svg',
  uni_avatar_default: 'avatar-default.svg',
};
await mkdir(cache, { recursive: true });
if (!existsSync(chromium)) throw new Error('Set NATIVE_CHROMIUM to a local Edge/Chromium executable.');
const log = openSync(resolve(cache, 'chromium.log'), 'a');
const browser = spawn(chromium, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--disable-extensions', '--metrics-recording-only', '--disable-features=msEdgeSidebarV2,msEdgeShoppingAssistant',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
  `--user-data-dir=${cache}`, `--disk-cache-dir=${cache}/disk-cache`,
  `--remote-debugging-port=${port}`, 'about:blank',
], { cwd: root, windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env, TEMP: resolve(root, '.native-cache/temp'), TMP: resolve(root, '.native-cache/temp') } });
let ws;
try {
  let pages;
  for (let i = 0; i < 100; i++) {
    try { pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; }
    catch { await new Promise(done => setTimeout(done, 150)); }
  }
  if (!pages) throw new Error('Local Chromium debugging endpoint did not start.');
  ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let sequence = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const result = JSON.parse(data);
    const receiver = pending.get(result.id);
    if (receiver) { clearTimeout(receiver.timeout); pending.delete(result.id); result.error ? receiver.reject(result.error) : receiver.resolve(result.result); }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Chromium timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timeout }); ws.send(JSON.stringify({ id, method, params }));
  });
  const raster = async (bytes, type, size) => {
    const dataURL = `data:${type};base64,${bytes.toString('base64')}`;
    const expression = `(async () => {
      const image = new Image(); image.src = ${JSON.stringify(dataURL)};
      await image.decode(); const canvas = document.createElement('canvas');
      canvas.width = ${size}; canvas.height = ${size};
      const context = canvas.getContext('2d'); context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, ${size}, ${size}); return canvas.toDataURL('image/png').split(',')[1];
    })()`;
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return Buffer.from(result.result.value, 'base64');
  };
  const records = [];
  const iosCatalog = resolve(root, 'IM-APP-ios/IMNative/Assets.xcassets');
  await mkdir(iosCatalog, { recursive: true });
  await writeFile(resolve(iosCatalog, 'Contents.json'), JSON.stringify({ info: { author: 'xcode', version: 1 } }, null, 2) + '\n');
  const deliver = async (name, source, bytes, transformation) => {
    const android = `IM-APP-android/app/src/main/res/drawable-nodpi/${name}.png`;
    const ios = `IM-APP-ios/IMNative/Assets.xcassets/${name}.imageset/${name}.png`;
    for (const destination of [android, ios]) {
      await mkdir(dirname(resolve(root, destination)), { recursive: true });
      await writeFile(resolve(root, destination), bytes);
    }
    await writeFile(resolve(root, dirname(ios), 'Contents.json'), JSON.stringify({
      images: [{ filename: `${name}.png`, idiom: 'universal', scale: '3x' }],
      info: { author: 'xcode', version: 1 },
    }, null, 2) + '\n');
    records.push({ name, source: `IM-APP-fronend/src/static/${source}`, source_sha256: sha(await readFile(resolve(sourceRoot, source))), transformation, output_sha256: sha(bytes), destinations: [android, ios] });
  };
  for (const [name, source] of Object.entries(pngs)) await deliver(name, source, await readFile(resolve(sourceRoot, source)), 'byte-copy');
  for (const [name, source] of Object.entries(svgs)) await deliver(name, source, await raster(await readFile(resolve(sourceRoot, source)), 'image/svg+xml', 96), 'original SVG rasterized to transparent 96x96 PNG; displayed at original logical size');
  await deliver('uni_logo', 'logo/logo.png', await raster(await readFile(resolve(sourceRoot, 'logo/logo.png')), 'image/png', 168), 'original PNG downsampled to 168x168; login uses 56 logical pixels');
  for (const name of ['agreement', 'privacy']) {
    const source = `IM-APP-fronend/src/static/legal/${name}.html`;
    const bytes = await readFile(resolve(root, source));
    const destinations = [`IM-APP-android/app/src/main/assets/legal/${name}.html`, `IM-APP-ios/IMNative/Legal/${name}.html`];
    for (const destination of destinations) { await mkdir(dirname(resolve(root, destination)), { recursive: true }); await writeFile(resolve(root, destination), bytes); }
    records.push({ name, source, source_sha256: sha(bytes), output_sha256: sha(bytes), transformation: 'byte-copy', destinations });
  }
  const manifest = { schema_version: 1, source_of_truth: 'existing uni-app source assets; no competitor assets', generated_by: 'node scripts/native/sync_ui_assets.mjs', records };
  const manifestFile = resolve(root, 'contracts/ui-parity/v1/asset-source-manifest.json');
  await mkdir(dirname(manifestFile), { recursive: true });
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Synced ${records.length} original assets to both native projects; manifest: contracts/ui-parity/v1/asset-source-manifest.json`);
  await call('Browser.close').catch(() => {});
} finally {
  ws?.close();
  browser.kill();
  closeSync(log);
}
