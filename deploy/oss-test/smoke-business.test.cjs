'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { target, uploadForm } = require('./smoke-business.cjs')
const host = 'https://oss-business-test.xn--jprz53bj9s.com'
const fixture = () => ({ uploadUrl: `${host}/`, formUrl: `${host}/`, formData: {
  key: 'oss-test/business/uploads/test/new.png', policy: 'test-policy', 'x-oss-signature': 'test-signature', 'x-oss-forbid-overwrite': 'true',
} })
test('smoke requests refuse nonlocal APIs, foreign/cloud production hosts and malformed origins', () => {
  assert.equal(target('https://localhost:18443/api/v1/me', 'local').hostname, 'localhost')
  for (const url of ['http://localhost:18443/', 'https://localhost:18444/', 'https://127.0.0.1:18443/', 'https://www.xn--jprz53bj9s.com/', 'https://user@localhost:18443/', 'https://localhost:18443/#secret']) {
    assert.throws(() => target(url, 'local'))
  }
  assert.throws(() => target('https://yikeliao-188-business.oss-cn-hangzhou.aliyuncs.com/', 'form'))
  assert.throws(() => target(`${host}/?signature=unexpected`, 'form'))
})
test('signed reads can only target business test-prefix objects', () => {
  assert.doesNotThrow(() => target(`${host}/oss-test/business/uploads/test/new.png?signature=opaque`, 'object'))
  for (const p of ['/production.png', '/oss-test/chat/a.png', '/oss-test/business/', '/oss-test/business/../outside', '/oss-test/business/a%2F..%2Foutside', '/oss-test/business/a%5Cb']) {
    assert.throws(() => target(`${host}${p}`, 'object'))
  }
})
test('multipart preserves signed fields unchanged and always places file last', () => {
  const init = fixture()
  const before = structuredClone(init)
  const { body, contentType } = uploadForm(init, Buffer.from('test-image'))
  assert.deepEqual(init, before)
  assert.match(contentType, /^multipart\/form-data; boundary=oss-test-/)
  const text = body.toString()
  for (const [name, value] of Object.entries(init.formData)) {
    assert.ok(text.includes(`name="${name}"\r\n\r\n${value}\r\n`))
    assert.ok(text.indexOf(`name="${name}"`) < text.indexOf('name="file"'))
  }
  assert.ok(text.includes('test-image'))
})
test('multipart refuses prefix escape, overwrite and field/header injection', () => {
  for (const fields of [{ key: 'production/test.png' }, { key: 'oss-test/business/' }, { key: 'oss-test/business/a/../b' },
    { 'x-oss-forbid-overwrite': 'false' }, { 'file': 'injected' }, { 'bad"\r\n': 'injected' }, { policy: 12 }]) {
    const init = fixture()
    Object.assign(init.formData, fields)
    assert.throws(() => uploadForm(init))
  }
})
