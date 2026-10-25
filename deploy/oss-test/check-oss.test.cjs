'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { parseEnv } = require('./prepare-apps.cjs')
const { probes, verdict } = require('./check-oss.cjs')

function fakeEnv() {
  let seq = 0
  const text = fs.readFileSync(path.join(__dirname, '.env.example'), 'utf8')
    .replace(/^(TEST_[A-Z_]+)=replace_with_test_only_(?:secret|access_key)$/gm, (_, key) => {
      const n = key.endsWith('_MINIO_ACCESS_KEY') ? 20 : key.endsWith('_MINIO_SECRET_KEY') ? 40 : 64
      return `${key}=${crypto.createHash('sha256').update(`probe-fake-${seq++}`).digest('hex').slice(0, n)}`
    }).replace('TEST_OSS_ACCESS_KEY_ID=\n', 'TEST_OSS_ACCESS_KEY_ID=FakeTestAccessKeyID\n')
    .replace('TEST_OSS_ACCESS_KEY_SECRET=\n', 'TEST_OSS_ACCESS_KEY_SECRET=FakeTestAccessKeySecret000\n')
  return parseEnv(text)
}

test('live probe only builds read-only requests inside the two Hong Kong prefixes', () => {
  const env = fakeEnv()
  const checks = probes(env, new Date('2026-10-17T13:00:00Z'), 'fake-id')
  assert.equal(checks.length, 10)
  for (const p of checks) {
    assert.ok(['GET', 'HEAD', 'OPTIONS'].includes(p.method))
    assert.match(p.path, /^\/oss-test\/(chat|business)\/connectivity\/fake-id\.txt$/)
    assert.ok(!p.path.includes('?'))
    if (p.check.startsWith('ram-signed-')) {
      const mac = crypto.createHmac('sha1', env.TEST_OSS_ACCESS_KEY_SECRET)
        .update(`${p.method}\n\n\nSat, 17 Oct 2026 13:00:00 GMT\n/${p.bucket}${p.path}`).digest('base64')
      assert.equal(p.headers.Authorization, `OSS ${env.TEST_OSS_ACCESS_KEY_ID}:${mac}`)
    }
  }
  assert.throws(() => probes({ ...env, TEST_OSS_BUSINESS_BUCKET: 'yikeliao-188-business' }))
  assert.throws(() => probes(env, new Date(), '../escape'))
})

test('valid private read, CORS, and authenticated missing key checks pass', () => {
  for (const p of probes(fakeEnv())) {
    const response = { tls: true, statusCode: p.check.startsWith('ram-signed-') ? 404 : p.method === 'GET' ? 403 : 200,
      ossCode: p.check.startsWith('ram-signed-') ? 'NoSuchKey' : 'AccessDenied', headers: { 'access-control-allow-origin': p.headers.Origin,
        'access-control-allow-methods': 'GET, POST, PUT, HEAD', 'access-control-allow-headers': p.headers['Access-Control-Request-Headers'] } }
    assert.equal(verdict(p, response).ok, true)
    assert.equal(verdict(p, { ...response, tls: false }).ok, false)
    assert.equal(verdict(p, { ...response, error: 'ERR_TLS_CERT_ALTNAME_INVALID' }).ok, false)
    if (p.method === 'OPTIONS') {
      assert.equal(verdict(p, { ...response, headers: { ...response.headers, 'access-control-allow-origin': '*' } }).ok, false)
      assert.equal(verdict(p, { ...response, headers: { ...response.headers, 'access-control-allow-methods': 'GET' } }).ok, false)
    }
    if (p.check.startsWith('ram-signed-')) assert.equal(verdict(p, { ...response, statusCode: 403 }).ok, false)
  }
})

test('reports whitelist public fields and never leak auth headers, signed URLs or bodies', () => {
  const p = probes(fakeEnv()).find(x => x.method === 'HEAD')
  const report = JSON.stringify(verdict(p, { tls: true, statusCode: 404, headers: { Authorization: 'fake-secret' },
    body: 'fake-secret', url: 'https://host/?Signature=fake-secret', error: undefined }))
  assert.ok(!/fake-secret|Signature|Authorization|FakeTestAccessKey/.test(report))
})

test('RAM example grants only required test-prefix object operations, not deletion or old buckets', () => {
  const policy = JSON.parse(fs.readFileSync(path.join(__dirname, 'ram-hk-test-policy.json'), 'utf8'))
  assert.equal(policy.Version, '1')
  assert.deepEqual(policy.Statement, [
    { Effect: 'Allow', Action: ['oss:GetObject', 'oss:PutObject', 'oss:ListParts'], Resource: ['acs:oss:*:*:yikeliao-188-hk-test/oss-test/chat/*'] },
    { Effect: 'Allow', Action: ['oss:GetObject', 'oss:PutObject'], Resource: ['acs:oss:*:*:yikeliao-188-business-hk-test/oss-test/business/*'] },
  ])
})
