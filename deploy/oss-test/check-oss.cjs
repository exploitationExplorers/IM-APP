#!/usr/bin/env node
'use strict'
// READ ONLY: strict HTTPS, CORS preflight and signed GET/HEAD in test prefixes.
// Never logs Authorization, signatures, policies, URLs with queries or bodies.
const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { parseEnv, validateEnv } = require('./prepare-apps.cjs')
const { assertCleanEnvironment } = require('./validate-config.cjs')

function probes(e, now = new Date(), id = crypto.randomUUID()) {
  validateEnv(e)
  assert.match(id, /^[a-zA-Z0-9-]+$/)
  const checks = []
  for (const kind of ['CHAT', 'BUSINESS']) {
    const bucket = e[`TEST_OSS_${kind}_BUCKET`]
    const host = new URL(e[`TEST_OSS_${kind}_ORIGIN`]).hostname
    const key = `${e[`TEST_OSS_${kind}_PREFIX`]}connectivity/${id}.txt`
    const add = (check, method, headers = {}) => checks.push({ bucket, host, path: `/${key}`, check, method, headers })
    add('anonymous-private-read', 'GET')
    for (const origin of [e.TEST_PUBLIC_ORIGIN, e.TEST_ADMIN_ORIGIN]) {
      add(`cors-${new URL(origin).port}`, 'OPTIONS', {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,authorization,x-oss-date,x-oss-forbid-overwrite',
      })
    }
    const date = now.toUTCString()
    for (const method of ['GET', 'HEAD']) {
      const signature = crypto.createHmac('sha1', e.TEST_OSS_ACCESS_KEY_SECRET)
        .update(`${method}\n\n\n${date}\n/${bucket}/${key}`).digest('base64')
      add(`ram-signed-${method.toLowerCase()}`, method, { Date: date, Authorization: `OSS ${e.TEST_OSS_ACCESS_KEY_ID}:${signature}` })
    }
  }
  return checks
}

function request(p) {
  return new Promise(resolve => {
    const req = https.request({ hostname: p.host, path: p.path, method: p.method, headers: p.headers,
      agent: false, rejectUnauthorized: true, timeout: 12000 }, res => {
      const tls = res.socket.authorized === true
      let body = ''
      res.on('data', chunk => { if (body.length < 32768) body += chunk.toString() })
      res.on('error', () => resolve({ error: 'RESPONSE_ERROR' }))
      res.on('end', () => resolve({ statusCode: res.statusCode, tls, headers: res.headers,
        ossCode: /<Code>([A-Za-z0-9_]+)<\/Code>/.exec(body)?.[1] }))
    })
    req.on('timeout', () => req.destroy(Object.assign(new Error(), { code: 'TIMEOUT' })))
    req.on('error', error => resolve({ error: /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'NETWORK_ERROR' }))
    req.end()
  })
}

function verdict(p, r) {
  let ok = r.tls === true && !r.error
  if (p.check === 'anonymous-private-read') ok &&= r.statusCode === 403 && r.ossCode === 'AccessDenied'
  else if (p.check.startsWith('ram-signed-')) ok &&= r.statusCode === 404 && (p.method === 'HEAD' || r.ossCode === 'NoSuchKey')
  else {
    const methods = (r.headers?.['access-control-allow-methods'] || '').split(/\s*,\s*/)
    const headers = (r.headers?.['access-control-allow-headers'] || '').toLowerCase().split(/\s*,\s*/)
    ok &&= r.statusCode === 200 && r.headers?.['access-control-allow-origin'] === p.headers.Origin &&
      ['GET', 'HEAD', 'POST', 'PUT'].every(x => methods.includes(x)) &&
      p.headers['Access-Control-Request-Headers'].split(',').every(x => headers.includes('*') || headers.includes(x))
  }
  // Whitelist public fields. Never spread request/response objects into logs.
  return { bucket: p.bucket, host: p.host, check: p.check, ok, status: r.statusCode, tls: r.tls, error: r.error, ossCode: r.ossCode }
}

async function main() {
  assert.equal(process.argv.length, 2, 'No arguments accepted')
  assertCleanEnvironment(process.env)
  const e = parseEnv(fs.readFileSync(path.join(__dirname, '.env'), 'utf8'))
  const results = []
  for (const p of probes(e)) {
    const result = verdict(p, await request(p))
    results.push(result)
    console.log(JSON.stringify(result))
  }
  console.log('Read-only checks complete. No objects, cloud settings or databases were changed; upload/multipart testing is still separate.')
  return results.every(x => x.ok) ? 0 : 1
}
if (require.main === module) main().then(code => { process.exitCode = code }, () => {
  console.error('Read-only OSS check failed. Check local test settings and network; no secrets printed.')
  process.exitCode = 1
})
module.exports = { probes, verdict }
