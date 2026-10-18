'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transform, hashes } = require('./patch-openim.cjs')
const source = process.env.IM_APP_OPENIM_SOURCE || path.resolve(__dirname, '../oss-test/artifacts/openim-src')
test('all upstream hashes and required anchors match the pinned checkout', () => {
  for (const name of Object.keys(hashes)) {
    const data = fs.readFileSync(path.join(source, name))
    const patched = transform(name, data)
    assert.notEqual(patched, data.toString())
    assert.throws(() => transform(name, Buffer.from(patched)), /Pinned/)
  }
})
test('allocator and stale writes cannot reset a durable retention bound', () => {
  const name = 'pkg/common/storage/database/mgo/seq_conversation.go'
  const result = transform(name, fs.readFileSync(path.join(source, name)))
  assert.match(result, /"\$setOnInsert": map\[string\]any\{"min_seq": int64\(0\)\}/)
  assert.match(result, /"\$max": bson.M\{"min_seq": seq\}/)
  assert.doesNotMatch(result, /"\$set": map\[string\]any\{"min_seq":/)
})

test('private API docs and collection expose only static GET reads and POST JSON writes', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'openapi.json'), 'utf8'))
  const collection = JSON.parse(fs.readFileSync(path.join(__dirname, 'postman_collection.json'), 'utf8'))
  assert.deepEqual(Object.keys(doc.paths).sort(), ['/internal/retention/apply','/internal/retention/capabilities','/internal/retention/snapshot'])
  assert.deepEqual(collection.item.map(x => x.request.method), ['GET','GET','POST'])
  assert.equal(doc.paths['/internal/retention/apply'].post.requestBody.content['application/json'].schema.additionalProperties, false)
  for (const item of collection.item) {
    const endpoint = '/'+item.request.url.path.join('/')
    assert.ok(doc.paths[endpoint][item.request.method.toLowerCase()])
    assert.ok(!endpoint.includes('{'))
    if (item.request.method === 'GET') assert.equal(item.request.body, undefined)
    else assert.equal(item.request.url.query, undefined)
  }
  assert.equal(collection.variable.find(v => v.key === 'retention_adapter_key').value, '')
})
