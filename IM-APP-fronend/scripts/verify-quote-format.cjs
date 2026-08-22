/**
 * 本地验证引用摘要 / 缩略图（App 端 file:// 与 http 对象存储）
 * 用法：node scripts/verify-quote-format.cjs
 */
const assert = require('assert')

function looksLikeImageUrl(value) {
  const t = String(value || '').trim()
  if (!t) return false
  if (/^(file|content):\/\//i.test(t)) {
    return /\.(jpg|jpeg|png|gif|webp|bmp|heic)(\?|#|$)/i.test(t) || /\/storage\//i.test(t)
  }
  if (/^\/(storage|data|sdcard)\//i.test(t) || t.includes('/Android/data/')) return true
  if (!/^https?:\/\//i.test(t)) return false
  if (/\.(jpg|jpeg|png|gif|webp|bmp|heic)(\?|#|$)/i.test(t)) return true
  if (/[?&]type=image\b/i.test(t)) return true
  if (/\/object\/[a-zA-Z0-9_-]+\/?(\?|$)/i.test(t)) return true
  return false
}

function resolveQuoteType(type, content) {
  if (['image', 'video', 'voice', 'file', 'card'].includes(type)) return type
  if (looksLikeImageUrl(content)) return 'image'
  return type || 'text'
}

function quoteSummaryOf(type, content) {
  switch (resolveQuoteType(type, content)) {
    case 'image':
      return '图片'
    case 'video':
      return '视频'
    case 'voice':
      return '语音'
    case 'file':
      return '文件'
    case 'card':
      return '名片'
    case 'system':
      return '消息'
    default: {
      const t = String(content || '').replace(/\s+/g, ' ').trim()
      if (!t) return '消息'
      if (looksLikeImageUrl(t)) return '图片'
      if (/^https?:\/\//i.test(t) || /^(file|content):\/\//i.test(t)) return '消息'
      return t.length > 36 ? `${t.slice(0, 36)}…` : t
    }
  }
}

function quoteThumbOf(type, content, senderAvatar) {
  const resolved = resolveQuoteType(type, content)
  if (resolved === 'image') return String(content || '').trim() || senderAvatar || ''
  return senderAvatar || ''
}

const filePath =
  'file:///storage/emulated/0/Android/data/uni.app.UNIXXXX/apps/__UNI__/doc/uniapp_temp/xxx.jpg'
const httpImg = 'http://www.ke58.com/object/5eac6340cb8649139947bd6d3ec7f09a22efd8bd.jpg?height=640&type=image&width=640'
const objectNoExt = 'http://www.ke58.com/object/5eac6340cb8649139947bd6d3ec7f09a22efd8bd'

assert.strictEqual(quoteSummaryOf('image', filePath), '图片')
assert.strictEqual(quoteSummaryOf('text', filePath), '图片')
assert.strictEqual(quoteSummaryOf('text', httpImg), '图片')
assert.strictEqual(quoteSummaryOf('text', objectNoExt), '图片')
assert.strictEqual(quoteSummaryOf('text', '你好'), '你好')
assert.ok(looksLikeImageUrl(filePath))
assert.ok(looksLikeImageUrl(httpImg))
assert.strictEqual(quoteThumbOf('text', filePath, 'avatar.png'), filePath)
assert.strictEqual(quoteThumbOf('image', httpImg, 'avatar.png'), httpImg)
assert.notStrictEqual(quoteSummaryOf('text', filePath), filePath)
assert.notStrictEqual(quoteSummaryOf('text', httpImg).includes('http'), true)

console.log('verify-quote-format: OK')
