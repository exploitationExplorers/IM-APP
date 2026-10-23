#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync, execFileSync } = require('node:child_process')
const { X509Certificate, createPrivateKey, createPublicKey } = require('node:crypto')
const YAML = require('yaml')
const { assertCleanEnvironment, validateIsolation } = require('./validate-config.cjs')
const { parseEnv, validateEnv, hash, binaries } = require('./prepare-apps.cjs')

const project = 'im-app-oss-test'
function composeArgs(apps = false) {
  return ['compose', '--project-name', project, '--env-file', path.join(__dirname, '.env'), '-f', path.join(__dirname, 'compose.infra.yml'), ...(apps ? ['-f', path.join(__dirname, 'compose.apps.yml')] : [])]
}
function render(apps = false) {
  return JSON.parse(execFileSync('docker', [...composeArgs(apps), 'config', '--no-env-resolution', '--format', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024 }))
}
function validateApps(c, applications = {}) {
  // Compose versions may flatten even raw env_file values when rendering JSON.
  // Validate the source declarations too, not an assumed env_file rendering shape.
  const declarations = YAML.parse(fs.readFileSync(path.join(__dirname, 'compose.apps.yml'), 'utf8')).services
  const appNames = ['api', 'admin', 'gateway', ...binaries.map(n => `openim-${n}`)]
  const infra = structuredClone(c)
  for (const name of appNames) delete infra.services[name]
  delete infra.networks.egress
  validateIsolation(infra)
  assert.deepEqual(c.networks.data.ipam.config, [{ subnet: '172.30.187.0/24' }])
  assert.equal(c.networks.egress.name, `${project}_egress`)
  assert.ok(!c.networks.egress.external && !c.networks.egress.internal && !c.networks.egress.driver_opts)
  assert.ok(!c.networks.egress.driver || c.networks.egress.driver === 'bridge')
  assert.deepEqual(c.networks.egress.ipam.config, [{ subnet: '172.30.188.0/24' }])
  assert.equal(Object.keys(c.services).length, 23)
  const expectedMounts = {
    gateway: [['nginx.conf', '/etc/nginx/nginx.conf'], ['private/tls', '/etc/nginx/tls'], ['artifacts/front-h5', '/srv/front'], ['artifacts/admin-web', '/srv/admin']],
  }
  const ports = { api: ['18080:8080'], admin: ['18090:8090'], gateway: ['18443:8443', '18444:8444'], 'openim-api': ['11002:10002'], 'openim-msggateway': ['11001:10001'] }
  for (const name of appNames) {
    const s = c.services[name]
    assert.ok(s, 'Missing test app')
    assert.ok(!s.container_name && !s.network_mode && !s.privileged && !s.devices && !s.cap_add && !s.pid && !s.entrypoint)
    assert.equal(s.labels['im.app.environment'], 'oss-test')
    assert.deepEqual(Object.keys(s.networks).sort(), ['data', 'egress'])
    assert.deepEqual((s.ports || []).map(p => { assert.equal(p.host_ip, '127.0.0.1'); return `${p.published}:${p.target}` }).sort(), (ports[name] || []).sort())
    const mounts = expectedMounts[name] || (name.startsWith('openim-') ? [['private/runtime/openim', '/config']] : [])
    assert.equal((s.volumes || []).length, mounts.length)
    for (const [source, target] of mounts) {
      const mount = s.volumes.find(v => v.target === target)
      assert.equal(mount.type, 'bind')
      assert.equal(path.normalize(mount.source), path.resolve(__dirname, source))
      assert.equal(mount.read_only, true)
      assert.ok(!mount.bind?.create_host_path)
    }
    if (name === 'api' || name === 'admin') {
      assert.equal(s.image, name === 'api' ? 'im-app-oss-test-business:local' : 'im-app-oss-test-admin:local')
      assert.equal(s.build.context, path.resolve(__dirname, '../..', name === 'api' ? 'IM-APP-server' : 'IM-APP-admin'))
      assert.equal(s.build.dockerfile, 'Dockerfile')
      assert.deepEqual(declarations[name].env_file, [{ path: `./private/runtime/${name === 'api' ? 'business' : 'admin'}.env`, required: false, format: 'raw' }])
      assert.ok(!s.env_file)
      assert.deepEqual(s.environment, { ...(applications[name] || {}), APP_ENV: 'oss-test', GODEBUG: 'decoratemappings=0' })
      assert.ok(!s.command)
    } else {
      assert.ok(!s.env_file)
      if (name.startsWith('openim-')) {
        assert.equal(s.image, 'im-app-oss-test-openim:v3.8.3-patch.15-scoped')
        assert.equal(s.build.context, __dirname)
        assert.equal(s.build.dockerfile, 'openim.Dockerfile')
        assert.deepEqual(s.command, [name, '-c', '/config'])
        assert.deepEqual(s.environment, { IM_APP_ENV: 'oss-test', IM_APP_OSS_TEST_PREFIX: 'oss-test/chat/', IM_APP_OSS_TEST_DELETE_ENABLED: 'false' })
      } else {
        assert.equal(s.image, 'nginx:1.28-alpine')
        assert.ok(!s.build && !s.environment && !s.command)
      }
    }
    if (s.build) assert.ok(!s.build.args && !s.build.additional_contexts && !s.build.secrets && !s.build.ssh && !s.build.network)
  }
  assert.equal(c.services.admin.depends_on.api.condition, 'service_healthy', 'Business migrations must complete before admin migrations')
  return 23
}
function validateRuntime(directory = path.join(__dirname, 'private/runtime'), envText = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')) {
  const e = parseEnv(envText)
  validateEnv(e)
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'))
  assert.equal(manifest.version, 'v3.8.3-patch.15')
  assert.equal(manifest.envHash, hash(envText), 'Prepared runtime is stale; follow the documented refresh procedure')
  const expectedFiles = ['business.env', 'admin.env', 'frontend.json', ...['discovery', 'mongodb', 'redis', 'kafka', 'share', 'minio', 'notification', 'local-cache', 'webhooks', 'log', ...binaries.map(n => `openim-${n}`)].map(n => `openim/${n}.yml`)]
  assert.deepEqual(Object.keys(manifest.files).sort(), expectedFiles.sort())
  for (const name of expectedFiles) {
    const file = path.join(directory, name)
    assert.ok(!fs.lstatSync(file).isSymbolicLink())
    assert.equal(hash(fs.readFileSync(file)), manifest.files[name], 'Prepared file was modified; regenerate rather than hand-edit runtime files')
  }
  assert.ok(!fs.existsSync(path.join(directory, 'openim/openim-crontask.yml')))
}
function validateTLS(directory = path.join(__dirname, 'private/tls')) {
  const cert = new X509Certificate(fs.readFileSync(path.join(directory, 'localhost.pem')))
  const key = createPrivateKey(fs.readFileSync(path.join(directory, 'localhost-key.pem')))
  assert.ok(cert.checkHost('localhost'))
  assert.ok(Date.parse(cert.validFrom) <= Date.now() && Date.parse(cert.validTo) > Date.now())
  assert.equal(cert.publicKey.export({ type: 'spki', format: 'pem' }), createPublicKey(key).export({ type: 'spki', format: 'pem' }))
}
function assertLocalDocker(env = process.env, context, endpoint) {
  assertCleanEnvironment(env)
  assert.ok(!Object.keys(env).some(k => /^DOCKER_(HOST|CONTEXT|TLS_VERIFY|CERT_PATH)$/i.test(k)), 'Unset Docker endpoint overrides')
  assert.equal(context, 'desktop-linux', 'Only the local Docker Desktop Linux context is allowed')
  assert.equal(endpoint.toLowerCase(), 'npipe:////./pipe/dockerdesktoplinuxengine', 'Refusing a remote/non-Desktop Docker endpoint')
}
function checkContext() {
  assertCleanEnvironment(process.env)
  assert.ok(!Object.keys(process.env).some(k => /^DOCKER_(HOST|CONTEXT|TLS_VERIFY|CERT_PATH)$/i.test(k)))
  const context = execFileSync('docker', ['context', 'show'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const endpoint = JSON.parse(execFileSync('docker', ['context', 'inspect', context], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))[0].Endpoints.docker.Host
  assertLocalDocker(process.env, context, endpoint)
}
function main() {
  const action = process.argv[2] || 'check'
  assert.ok(process.argv.length <= 3 && ['check', 'infra-up', 'build', 'up', 'ps', 'stop'].includes(action), 'Unknown local test action')
  assertCleanEnvironment(process.env)
  const apps = action !== 'infra-up'
  if (['check', 'build', 'up'].includes(action)) validateRuntime()
  const applications = {}
  if (apps) {
    for (const [name, file] of [['api', 'business.env'], ['admin', 'admin.env']]) {
      const filename = path.join(__dirname, 'private/runtime', file)
      if (fs.existsSync(filename)) applications[name] = parseEnv(fs.readFileSync(filename, 'utf8'))
    }
    validateApps(render(true), applications)
  } else validateIsolation(render())
  if (['check', 'up'].includes(action)) {
    validateTLS()
    for (const name of ['front-h5', 'admin-web']) assert.ok(fs.existsSync(path.join(__dirname, 'artifacts', name, 'index.html')), 'Build the isolated frontends first')
  }
  if (action === 'check') { console.log('Local test configuration/certificate/files validated offline; no services started. Certificate trust and runtime health require manual verification.'); return 0 }
  checkContext()
  if (action === 'up') require('./bootstrap-shared.cjs').bootstrapSharedConfig()
  const args = { 'infra-up': ['up', '-d', '--wait', '--wait-timeout', '300'], build: ['build', 'api', 'admin', 'openim-api'], up: ['up', '-d', '--no-build', '--wait', '--wait-timeout', '300'], ps: ['ps'], stop: ['stop'] }[action]
  const result = spawnSync('docker', [...composeArgs(apps), ...args], { stdio: 'inherit' })
  return result.status ?? 1
}
if (require.main === module) {
  try { process.exitCode = main() } catch { console.error('Local test command refused. Check Docker Desktop/context, dedicated env, prepared file integrity, certificates and frontend builds. No configuration/secrets printed. See 本机Docker测试步骤.md.'); process.exitCode = 1 }
}
module.exports = { composeArgs, validateApps, validateRuntime, validateTLS, assertLocalDocker }
