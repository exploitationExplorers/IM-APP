// Keep uni's swipe/zoom/close behavior, but don't download every original when
// opening one picture. This patch is deliberately limited to the pinned H5 SDK;
// App uses its native previewImage implementation and is not patched.
const fs = require('node:fs')
const path = require('node:path')

const VERSION = '3.0.0-5020320260806002'
const MARKER = '// im-app: load originals only after visiting their slide'
const REPLACEMENTS = [
  [
    '    watch(() => props2.current, () => indexRef.value = getIndex(props2));',
    `    ${MARKER}
    const visitedImages = reactive(new Set([indexRef.value]));
    watch(() => [props2.current, props2.urls], () => {
      indexRef.value = getIndex(props2);
      visitedImages.clear();
      visitedImages.add(indexRef.value);
    });`,
  ],
  [
    '      indexRef.value = event.detail.current;',
    '      indexRef.value = event.detail.current;\n      visitedImages.add(indexRef.value);',
  ],
  ['props2.urls.map((src) => createVNode(SwiperItem', 'props2.urls.map((src, imageIndex) => createVNode(SwiperItem'],
  [
    '        default: () => [createVNode(ImageView, {\n          "src": src\n        }, null, 8, ["src"])]',
    '        default: () => visitedImages.has(imageIndex) ? [createVNode(ImageView, {\n          "src": src\n        }, null, 8, ["src"])] : []',
  ],
]

function patchPreviewSource(source) {
  const start = source.indexOf('const ImagePreview = ')
  const end = source.indexOf('let state$2 = null;', start)
  if (start < 0 || end < 0) throw new Error('uni-h5 preview layout changed; review the lazy-preview patch')
  let preview = source.slice(start, end)
  if (preview.includes(MARKER)) {
    if (!REPLACEMENTS.every(([, replacement]) => preview.includes(replacement))) {
      throw new Error('Incomplete uni-h5 lazy-preview patch; reinstall dependencies')
    }
    return source
  }
  for (const [before, after] of REPLACEMENTS) {
    if (preview.split(before).length !== 2) {
      throw new Error('uni-h5 preview layout changed; review the lazy-preview patch')
    }
    preview = preview.replace(before, after)
  }
  return source.slice(0, start) + preview + source.slice(end)
}

function ensureLazyPreview(projectRoot = path.join(__dirname, '..')) {
  const packageDir = path.join(projectRoot, 'node_modules', '@dcloudio', 'uni-h5')
  const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'))
  if (pkg.version !== VERSION) {
    throw new Error(`uni-h5 ${pkg.version}: lazy-preview patch needs review (expected ${VERSION})`)
  }
  const target = path.join(packageDir, 'dist', 'uni-h5.es.js')
  const source = fs.readFileSync(target, 'utf8')
  const patched = patchPreviewSource(source)
  if (patched !== source) fs.writeFileSync(target, patched)
}

module.exports = { ensureLazyPreview, patchPreviewSource }
if (require.main === module) ensureLazyPreview()
