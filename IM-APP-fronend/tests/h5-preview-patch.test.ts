import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const { ensureLazyPreview, patchPreviewSource } = createRequire(import.meta.url)('../scripts/fix-uni-h5-preview.cjs')
const sdkPath = path.resolve(__dirname, '../node_modules/@dcloudio/uni-h5/dist/uni-h5.es.js')

// Execute the real installed component's setup/render, without a DOM. Browser
// regression additionally checks real network requests, swiping and closing.
function previewHarness(urls: string[], current: number | string) {
  ensureLazyPreview()
  const source = fs.readFileSync(sdkPath, 'utf8')
  const start = source.indexOf('function getIndex(props2)')
  const end = source.indexOf('let state$2 = null;', start)
  const watchers: Array<() => void> = []
  const props = { urls, current }
  const vnode = (type: string, props: unknown, children: unknown) => ({ type, props, children })
  const dependencies = {
    defineSystemComponent: (options: unknown) => options,
    props$9: {}, usePreventScroll: () => {},
    useKeyboard: () => ({ key: { value: '' } }),
    ref: (value: unknown) => ({ value }), reactive: (value: unknown) => value,
    watch: (_getter: unknown, callback: () => void) => watchers.push(callback),
    onMounted: () => {}, nextTick: (callback: () => void) => callback(),
    createVNode: vnode, isVNode: () => false,
    Swiper: 'swiper', SwiperItem: 'slide', ImageView: 'image',
    _isSlot$2: () => true,
    createSvgIconVNode: () => null, ICON_PATH_CLOSE: '',
  }
  const component = new Function(...Object.keys(dependencies), `${source.slice(start, end)}; return ImagePreview;`)(...Object.values(dependencies))
  let closed = false
  const render = component.setup(props, { emit: () => { closed = true } })
  const gallery = () => render().children[0]
  const slides = () => gallery().children
  return {
    count: () => slides().length,
    loaded: () => slides().flatMap((slide: { children: { default: () => unknown[] } }) => slide.children.default()),
    select: (index: number) => gallery().props.onChange({ detail: { current: index } }),
    replace: (nextUrls: string[], nextCurrent: number | string) => {
      props.urls = nextUrls
      props.current = nextCurrent
      watchers.forEach((callback) => callback())
    },
    close: () => render().props.onClick(),
    closed: () => closed,
  }
}

describe('pinned uni H5 original-image preview', () => {
  const urls = Array.from({ length: 17 }, (_, index) => `https://images.example/${index}?Signature=a%2Bb%3D`)

  it('keeps the complete gallery but mounts only the selected original', () => {
    const gallery = previewHarness(urls, urls[16])
    expect(gallery.count()).toBe(17)
    expect(gallery.loaded().map((image: { props: { src: string } }) => image.props.src)).toEqual([urls[16]])
  })

  it('loads visited slides on demand, retaining them for reverse swipes', () => {
    const gallery = previewHarness(urls, 8)
    gallery.select(7)
    gallery.select(6)
    gallery.select(7)
    expect(gallery.count()).toBe(17)
    expect(gallery.loaded().map((image: { props: { src: string } }) => image.props.src)).toEqual(urls.slice(6, 9))
    gallery.close()
    expect(gallery.closed()).toBe(true)
  })

  it('resets visited slides when reusing the preview for another list/current', () => {
    const gallery = previewHarness(urls, 0)
    gallery.select(1)
    gallery.replace(urls.slice(3), 5)
    expect(gallery.loaded().map((image: { props: { src: string } }) => image.props.src)).toEqual([urls[8]])
    gallery.replace(urls, 'missing')
    expect(gallery.loaded().map((image: { props: { src: string } }) => image.props.src)).toEqual([urls[0]])
  })

  it('is idempotent and rejects changed/incomplete upstream implementations', () => {
    ensureLazyPreview()
    const source = fs.readFileSync(sdkPath, 'utf8')
    expect(patchPreviewSource(source)).toBe(source)
    expect(() => patchPreviewSource('const OtherPreview = {};')).toThrow(/layout changed/)
    expect(() => patchPreviewSource(source.replace('visitedImages.add(indexRef.value);', ''))).toThrow(/Incomplete/)
    // Every edit must remain confined to ImagePreview, not ImageView or App code.
    expect(source).toContain('"scale-max": "4"')
  })

  it('patches a clean install without touching Swiper or ImageView', () => {
    const patched = fs.readFileSync(sdkPath, 'utf8')
    const clean = patched
      .replace(/    \/\/ im-app: load originals only after visiting their slide\n[\s\S]*?    \}\);/, '    watch(() => props2.current, () => indexRef.value = getIndex(props2));')
      .replace('\n      visitedImages.add(indexRef.value);', '')
      .replace('props2.urls.map((src, imageIndex) => createVNode(SwiperItem', 'props2.urls.map((src) => createVNode(SwiperItem')
      .replace('default: () => visitedImages.has(imageIndex) ? [createVNode(ImageView', 'default: () => [createVNode(ImageView')
      .replace('}, null, 8, ["src"])] : []', '}, null, 8, ["src"])]')
    expect(clean).not.toContain('visitedImages')
    expect(patchPreviewSource(clean)).toBe(patched)
    expect(() => patchPreviewSource(clean.replace('props2.urls.map((src)', 'props2.urls.flatMap((src)'))).toThrow(/layout changed/)
  })

  it('refuses an SDK upgrade until the preview patch has been reviewed', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'im-preview-test-'))
    try {
      const dir = path.join(root, 'node_modules', '@dcloudio', 'uni-h5')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: 'next-version' }))
      expect(() => ensureLazyPreview(root)).toThrow(/needs review/)
    } finally {
      if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('im-preview-test-')) {
        throw new Error('Refusing to remove an unexpected test directory')
      }
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
