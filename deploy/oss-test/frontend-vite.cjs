'use strict'
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

function testFrontendConfig(kind, runtime = JSON.parse(fs.readFileSync(path.join(__dirname, 'private/runtime/frontend.json'), 'utf8'))) {
  assert.ok(['client', 'admin'].includes(kind))
  assert.deepEqual(runtime, { apiBaseUrl: 'https://localhost:18443/api/v1', publicOrigin: 'https://localhost:18443', adminOrigin: 'https://localhost:18444' }, 'Refusing a non-local frontend test target')
  assert.ok(!fs.readdirSync(path.join(__dirname, 'empty-env')).some(n => n.startsWith('.env')), 'The test env directory must remain empty')
  assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0', 'Do not disable TLS verification for local tests')
  // These are set by uni's CLI itself, none is a request target.
  assert.ok(!Object.keys(process.env).some(k => k.startsWith('VITE_') && !['VITE_ROOT_DIR', 'VITE_CJS_IGNORE_WARNING', 'VITE_USER_NODE_ENV'].includes(k)), 'Unset shell VITE_* overrides before building oss-test')
  const client = kind === 'client'
  const native = client && process.env.UNI_PLATFORM === 'app'
  const target = client ? runtime.publicOrigin : runtime.adminOrigin
  const proxy = Object.fromEntries((client ? ['/api', '/health', '/openim-api', '/openim-ws'] : ['/api']).map(prefix => [prefix, {
    target, changeOrigin: true, ws: prefix === '/openim-ws',
    // Remain secure: install/trust mkcert, never bypass certificate verification.
    secure: true,
  }]))
  const values = client ? {
    VITE_API_BASE_URL: runtime.apiBaseUrl, VITE_UPDATE_CHANNEL: 'test', VITE_OPENIM_ENABLED: 'true',
    VITE_DEFAULT_AVATAR_URL: '/static/group-default.svg', VITE_PERF_REPORT_URL: '',
  } : { VITE_API_URL: '/api', VITE_PUBLIC_PATH: '/' }
  return {
    // A tracked empty directory, NOT the application's ordinary .env directory.
    envDir: path.join(__dirname, 'empty-env'),
    define: Object.fromEntries(Object.entries(values).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
    server: { host: '127.0.0.1', port: client ? 15173 : 15180, strictPort: true, proxy },
    build: { outDir: path.join(__dirname, 'artifacts', native ? 'app-resources' : client ? 'front-h5' : 'admin-web'), emptyOutDir: false },
  }
}
module.exports = { testFrontendConfig }
