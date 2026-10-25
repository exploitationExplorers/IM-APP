#!/usr/bin/env node
'use strict'
// Explicit opt-in: writes only a local test account/tasks and NEW test-prefix
// OSS objects. No cleanup/delete, production endpoint or automatic redirect.
const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { validateRuntime, validateTLS, assertLocalDocker } = require('./local.cjs')

const origin = 'https://localhost:18443'
const ossOrigin = 'https://oss-business-test.xn--jprz53bj9s.com'
const prefix = 'oss-test/business/'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=', 'base64')

function target(value, kind) {
  const u = new URL(value)
  assert.ok(!u.username && !u.password && !u.hash)
  assert.equal(u.origin, kind === 'local' ? origin : ossOrigin)
  if (kind === 'object') {
    const key = decodeURIComponent(u.pathname.slice(1))
    assert.ok(key.startsWith(prefix) && key.length > prefix.length)
    assert.ok(!key.includes('\\') && !key.split('/').some(p => p === '.' || p === '..'))
  } else if (kind === 'form') {
    assert.equal(u.pathname, '/')
    assert.equal(u.search, '')
  } else assert.equal(kind, 'local')
  return u
}

function uploadForm(init, bytes = png) {
  target(init.formUrl, 'form')
  assert.equal(init.uploadUrl, init.formUrl)
  const fields = init.formData
  assert.ok(fields && typeof fields === 'object' && !Array.isArray(fields))
  assert.ok(typeof fields.key === 'string' && fields.key.startsWith(prefix) && fields.key.length > prefix.length)
  assert.ok(!fields.key.includes('\\') && !fields.key.split('/').some(p => p === '.' || p === '..'))
  assert.equal(fields['x-oss-forbid-overwrite'], 'true')
  const boundary = `oss-test-${randomUUID()}`
  const parts = []
  for (const [name, value] of Object.entries(fields)) {
    assert.match(name, /^[a-zA-Z0-9_-]+$/)
    assert.notEqual(name.toLowerCase(), 'file')
    assert.equal(typeof value, 'string')
    assert.ok(!value.includes(boundary))
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="oss-test.png"\r\nContent-Type: image/png\r\n\r\n`), bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`))
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` }
}

function request(url, kind, { method = 'GET', headers = {}, body, ca } = {}) {
  const u = target(url, kind)
  // Authentication is only allowed on loopback, never forwarded to OSS.
  assert.ok(kind === 'local' || !Object.keys(headers).some(k => /^(authorization|cookie)$/i.test(k)))
  return new Promise((resolve, reject) => {
    const req = https.request(u, { method, headers, ...(kind === 'local' ? { ca } : {}),
      rejectUnauthorized: true, timeout: 30000, agent: false }, res => {
      const chunks = []
      let length = 0
      res.on('data', c => {
        length += c.length
        if (length > 2 * 1024 * 1024) res.destroy(new Error('response-too-large'))
        else chunks.push(c)
      })
      res.on('error', reject)
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })))
    req.on('error', reject)
    req.end(body)
  })
}

async function run() {
  assert.deepEqual(process.argv.slice(2), ['--write-test-objects'])
  validateRuntime()
  validateTLS()
  const context = execFileSync('docker', ['context', 'show'], { encoding: 'utf8' }).trim()
  const endpoint = JSON.parse(execFileSync('docker', ['context', 'inspect', context], { encoding: 'utf8' }))[0].Endpoints.docker.Host
  assertLocalDocker(process.env, context, endpoint)
  const ca = fs.readFileSync(path.join(__dirname, 'private/tls/ca/rootCA.pem'))
  let token
  let step = 'local-health'
  const report = name => console.log(JSON.stringify({ check: name, ok: true }))
  async function api(route, body, expectedStatus = 200) {
    const r = await request(`${origin}${route}`, 'local', { ca,
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    assert.equal(r.status, expectedStatus)
    const json = JSON.parse(r.body.toString('utf8'))
    if (expectedStatus === 200) assert.equal(json.code, 0)
    else assert.notEqual(json.code, 0)
    return json.data
  }
  try {
    const health = await request(`${origin}/health`, 'local', { ca })
    assert.equal(health.status, 200)
    assert.equal(JSON.parse(health.body.toString('utf8')).status, 'ok')
    report(step)
    step = 'local-account-register-login'
    const credentials = { countryCode: '86', phone: '15013938612', password: 'asd.12345', deviceId: 'oss-test-business-smoke' }
    const registered = await request(`${origin}/api/v1/auth/register`, 'local', { ca, method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...credentials, code: '246810' }) })
    assert.ok([200, 409].includes(registered.status))
    const login = await api('/api/v1/auth/login', credentials)
    assert.ok(login.accessToken && login.user?.id)
    token = login.accessToken
    report(step)
    step = 'openim-user-and-token'
    const im = await api('/api/v1/im/token', { platformId: 5 })
    assert.ok(im.token && im.userId)
    assert.equal(im.apiAddr, `${origin}/openim-api`)
    assert.equal(im.wsAddr, 'wss://localhost:18443/openim-ws')
    report(step)
    const init = size => api('/api/v1/files/uploads', { purpose: 'image', fileName: 'oss-test.png', contentType: 'image/png', size })
    const complete = (id, status = 200) => api('/api/v1/files/uploads/complete', { fileId: id }, status)
    step = 'missing-object-not-ready'
    const missing = await init(png.length)
    await complete(missing.file.id, 400)
    report(step)
    step = 'business-oss-post-complete'
    const upload = await init(png.length)
    assert.equal(upload.file.status, 'pending')
    const form = uploadForm(upload)
    step = 'business-oss-post'
    const posted = await request(upload.formUrl, 'form', { ca, method: 'POST',
      headers: { 'Content-Type': form.contentType, 'Content-Length': form.body.length, Origin: origin }, body: form.body })
    assert.equal(posted.status, 204)
    step = 'business-oss-complete'
    const ready = await complete(upload.file.id)
    assert.equal(ready.status, 'ready')
    report(step)
    step = 'private-capability-read'
    const stable = target(ready.url, 'local')
    assert.equal(stable.pathname, '/api/v1/public/oss-media')
    const redirected = await request(stable.href, 'local', { ca })
    assert.equal(redirected.status, 302)
    target(redirected.headers.location, 'object')
    const image = await request(redirected.headers.location, 'object')
    assert.equal(image.status, 200)
    assert.deepEqual(image.body, png)
    report(step)
    step = 'size-mismatch-not-ready'
    const mismatch = await init(png.length + 1)
    const mismatchForm = uploadForm(mismatch)
    const uploaded = await request(mismatch.formUrl, 'form', { method: 'POST',
      headers: { 'Content-Type': mismatchForm.contentType, 'Content-Length': mismatchForm.body.length }, body: mismatchForm.body })
    assert.equal(uploaded.status, 204)
    await complete(mismatch.file.id, 400)
    report(step)
    console.log('Complete: local test data and two NEW business test-prefix objects created; no objects deleted. Browser/native App/chat uploads require separate verification.')
    return 0
  } catch (error) {
    const status = Number.isInteger(error.actual) && error.actual >= 100 && error.actual <= 599 ? error.actual : undefined
    const code = /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : undefined
    console.error(JSON.stringify({ check: step, ok: false, status, code, message: 'No response bodies, tokens, signatures or credentials printed.' }))
    return 1
  }
}
if (require.main === module) run().then(code => { process.exitCode = code }, () => {
  console.error('Smoke test refused. Use the isolated local environment and explicit --write-test-objects flag. No secrets printed.')
  process.exitCode = 1
})
module.exports = { target, uploadForm }
