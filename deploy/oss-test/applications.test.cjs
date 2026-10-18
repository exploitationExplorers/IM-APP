'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { before, test } = require('node:test')
const YAML = require('yaml')
const { parseEnv, validateEnv, createConfiguration, upstreamConfigs, binaries, hash } = require('./prepare-apps.cjs')
const { validateApps, validateRuntime, assertLocalDocker } = require('./local.cjs')
const { testFrontendConfig } = require('./frontend-vite.cjs')
const { frontendCommand } = require('./frontend.cjs')

let env, envText, output, template
before(() => {
  // Never reads deploy/oss-test/.env or private/runtime: all credentials are fake.
  let seq = 0
  envText = fs.readFileSync(path.join(__dirname, '.env.example'), 'utf8')
    .replace(/^(TEST_[A-Z_]+)=replace_with_test_only_(?:secret|access_key)$/gm, (_, key) => {
      const length = key.endsWith('_MINIO_ACCESS_KEY') ? 20 : key.endsWith('_MINIO_SECRET_KEY') ? 40 : 64
      return `${key}=${crypto.createHash('sha256').update(`fake-${seq++}`).digest('hex').slice(0, length)}`
    }).replace('TEST_OSS_ACCESS_KEY_ID=\n', 'TEST_OSS_ACCESS_KEY_ID=FakeTestAccessKeyID\n')
    .replace('TEST_OSS_ACCESS_KEY_SECRET=\n', 'TEST_OSS_ACCESS_KEY_SECRET=FakeTestAccessKeySecret000\n')
  env = parseEnv(envText)
  output = createConfiguration(env, upstreamConfigs())
  // Replace both env_file declarations BEFORE Compose resolves them. This avoids
  // reading real ignored runtime files even when an actual test stack exists.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'im-app-oss-compose-test-'))
  const override = path.join(scratch, 'compose.yml')
  fs.writeFileSync(override, `services:\n  api:\n    env_file: !override [{path: './never-created-fake-api.env', required: false}]\n  admin:\n    env_file: !override [{path: './never-created-fake-admin.env', required: false}]\n`)
  let result
  try {
    result = spawnSync('docker', ['compose', '--project-name', 'im-app-oss-test', '--env-file', path.join(__dirname, '.env.example'), '-f', path.join(__dirname, 'compose.infra.yml'), '-f', path.join(__dirname, 'compose.apps.yml'), '-f', override, 'config', '--no-env-resolution', '--format', 'json'], {
      encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(TEST_|COMPOSE_)/i.test(k))),
    })
  } finally { fs.unlinkSync(override); fs.rmdirSync(scratch) }
  assert.equal(result.status, 0, 'Compose CLI must render the application template without an engine')
  template = JSON.parse(result.stdout)
  // Normalize optional files independently of any existing real runtime directory.
  template.services.api.environment = { APP_ENV: 'oss-test', GODEBUG: 'decoratemappings=0' }
  template.services.admin.environment = { APP_ENV: 'oss-test', GODEBUG: 'decoratemappings=0' }
  const locations = [
    ['postgres', 'POSTGRES_PASSWORD', 'TEST_PG_ADMIN_PASSWORD'], ['postgres', 'TEST_PG_APP_PASSWORD', 'TEST_PG_APP_PASSWORD'],
    ['redis', 'REDISCLI_AUTH', 'TEST_REDIS_PASSWORD'], ['openim-redis', 'REDISCLI_AUTH', 'TEST_OPENIM_REDIS_PASSWORD'],
    ['openim-mongodb', 'MONGO_INITDB_ROOT_PASSWORD', 'TEST_MONGO_ROOT_PASSWORD'], ['openim-mongodb', 'TEST_MONGO_APP_PASSWORD', 'TEST_MONGO_APP_PASSWORD'],
    ['minio-source', 'MINIO_ROOT_USER', 'TEST_MINIO_ACCESS_KEY'], ['minio-source', 'MINIO_ROOT_PASSWORD', 'TEST_MINIO_SECRET_KEY'],
    ['openim-minio-source', 'MINIO_ROOT_USER', 'TEST_OPENIM_MINIO_ACCESS_KEY'], ['openim-minio-source', 'MINIO_ROOT_PASSWORD', 'TEST_OPENIM_MINIO_SECRET_KEY'],
  ]
  for (const [s, k, v] of locations) template.services[s].environment[k] = env[v]
})

test('generates the complete minimal pinned OpenIM configuration with no cron service', () => {
  assert.equal(Object.keys(output.configs).length, 21)
  assert.equal(binaries.length, 11)
  assert.ok(!Object.keys(output.configs).some(n => /crontask|prometheus|grafana/.test(n)))
  for (const c of Object.values(output.configs)) assert.deepEqual(YAML.parse(YAML.stringify(c)), c)
  assert.equal(output.configs['openim-push'].enable, 'disabled')
  assert.equal(output.configs['openim-rpc-third'].object.oss.publicRead, false)
  for (const name of binaries) assert.equal(output.configs[`openim-${name}`].prometheus.enable, false)
})

test('local WSL workaround disables only Go diagnostic mapping annotations', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, 'openim.Dockerfile'), 'utf8')
  assert.equal((dockerfile.match(/GODEBUG=decoratemappings=0/g) || []).length, 2)
  assert.ok(dockerfile.indexOf('GODEBUG=decoratemappings=0') < dockerfile.indexOf('RUN go mod download'))
  for (const name of ['api', 'admin']) assert.equal(template.services[name].environment.GODEBUG, 'decoratemappings=0')
})
test('business/admin share only the new database and use independent login secrets', () => {
  assert.equal(output.business.APP_ENV, 'oss-test')
  assert.equal(output.business.DATABASE_URL, output.admin.DATABASE_URL)
  const u = new URL(output.business.DATABASE_URL)
  assert.equal(u.host, 'postgres:5432')
  assert.equal(u.username, 'im_oss_test')
  assert.equal(u.pathname, '/imapp_oss_test')
  assert.notEqual(output.business.JWT_SECRET, output.admin.ADMIN_JWT_SECRET)
  assert.equal(output.admin.SERVER_INTERNAL_KEY, output.business.IM_INTERNAL_API_KEY)
  assert.equal(output.admin.SERVER_BASE_URL, 'http://api:8080')
  assert.equal(output.business.SMS_SIGN_NAME, '')
  assert.equal(output.business.SMS_TEMPLATE_CODE, '')
  assert.equal(output.business.DEV_SMS_CODE, '246810')
  assert.equal(output.business.OSS_MEDIA_PROXY_URL, 'https://localhost:18443/api/v1/public/oss-media')
  assert.equal(output.business.OSS_KEY_PREFIX, 'oss-test/business/')
})

test('both OSS paths use Hong Kong test buckets and sign the exact custom hosts', () => {
  const chat = output.configs['openim-rpc-third'].object.oss
  assert.equal(chat.endpoint, 'https://oss-chat-test.xn--jprz53bj9s.com')
  assert.equal(chat.bucketURL, chat.endpoint)
  assert.equal(chat.bucket, 'yikeliao-188-hk-test')
  assert.equal(chat.publicRead, false)
  assert.equal(output.business.OSS_REGION, 'cn-hongkong')
  assert.equal(output.business.OSS_ENDPOINT, 'https://oss-cn-hongkong.aliyuncs.com')
  assert.equal(output.business.OSS_BUCKET, 'yikeliao-188-business-hk-test')
  assert.equal(output.business.OSS_PUBLIC_UPLOAD_URL, 'https://oss-business-test.xn--jprz53bj9s.com')
  assert.equal(output.business.OSS_PUBLIC_BASE_URL, '')
  assert.ok(!JSON.stringify(output).includes('cn-hangzhou'))
})
test('OpenIM uses isolated data, callback secret, Kafka topics and dummy offline push', () => {
  const c = output.configs
  assert.equal(c.mongodb.database, 'openim_oss_test')
  assert.equal(c.mongodb.authSource, 'openim_oss_test')
  assert.equal(c.mongodb.username, 'im_oss_test')
  assert.deepEqual(c.mongodb.address, ['openim-mongodb:27017'])
  assert.deepEqual(c.redis.address, ['openim-redis:6379'])
  assert.deepEqual(c.kafka.address, ['openim-kafka:9092'])
  assert.deepEqual(c.discovery.etcd.address, ['openim-etcd:2379'])
  for (const [key, value] of Object.entries(c.kafka)) if (/Topic$|GroupID$/.test(key)) assert.ok(value.endsWith('_oss_test'))
  assert.equal(c.share.secret, output.business.OPENIM_SECRET)
  assert.equal(c.webhooks.url, `http://api:8080/internal/openim/webhooks/${output.business.OPENIM_WEBHOOK_SECRET}`)
  assert.equal(c.webhooks.beforeSendGroupMsg.failedContinue, false)
  assert.equal(c.webhooks.beforeSendSingleMsg.failedContinue, false)
  assert.ok(output.business.OPENIM_WEBHOOK_ALLOW_CIDRS.includes('172.30.187.0/24'))
})
for (const [risk, change] of Object.entries({
  'cloud deletion': e => { e.TEST_OSS_DELETE_ENABLED = 'true' },
  'chat prefix escape': e => { e.TEST_OSS_CHAT_PREFIX = 'chat/' },
  'business prefix escape': e => { e.TEST_OSS_BUSINESS_PREFIX = '../business/' },
  'another bucket': e => { e.TEST_OSS_CHAT_BUCKET = 'production' },
  'legacy Hangzhou chat bucket': e => { e.TEST_OSS_CHAT_BUCKET = 'yikeliao-188' },
  'legacy Hangzhou business bucket': e => { e.TEST_OSS_BUSINESS_BUCKET = 'yikeliao-188-business' },
  'legacy Hangzhou region': e => { e.TEST_OSS_REGION = 'cn-hangzhou' },
  'wrong chat signing host': e => { e.TEST_OSS_CHAT_ORIGIN = 'https://yikeliao-188-hk-test.oss-cn-hongkong.aliyuncs.com' },
  'wrong business signing host': e => { e.TEST_OSS_BUSINESS_ORIGIN = 'https://www.xn--jprz53bj9s.com' },
  'production origin': e => { e.TEST_PUBLIC_ORIGIN = 'https://www.xn--jprz53bj9s.com' },
  'missing cloud credentials': e => { e.TEST_OSS_ACCESS_KEY_SECRET = '' },
  'reused test secret': e => { e.TEST_ADMIN_JWT_SECRET = e.TEST_JWT_SECRET },
  'unsupported env key': e => { e.DATABASE_URL = 'postgres://production' },
})) test(`preparation refuses ${risk}`, () => { const e = structuredClone(env); change(e); assert.throws(() => validateEnv(e)) })

test('renders 23 services and supports explicit generated application environments', () => {
  assert.equal(validateApps(template), 23)
  const c = structuredClone(template)
  c.services.api.environment = { ...output.business, GODEBUG: 'decoratemappings=0' }
  c.services.admin.environment = { ...output.admin, GODEBUG: 'decoratemappings=0' }
  assert.equal(validateApps(c, { api: output.business, admin: output.admin }), 23)
})
for (const [risk, change] of Object.entries({
  'unscoped upstream image': c => { c.services['openim-rpc-third'].image = 'openim/openim-server:latest' },
  'delete enabled': c => { c.services['openim-rpc-third'].environment.IM_APP_OSS_TEST_DELETE_ENABLED = 'true' },
  'extra cron task': c => { c.services.crontask = structuredClone(c.services['openim-rpc-third']) },
  'production application env': c => { c.services.api.environment.DATABASE_URL = 'postgres://production' },
  'unreviewed runtime debug override': c => { c.services.api.environment.GODEBUG = 'decoratemappings=1' },
  'production env file': c => { c.services.admin.env_file = ['../../.env'] },
  'production build context': c => { c.services.api.build.context = path.resolve(__dirname, '../..') },
  'build secret injection': c => { c.services['openim-rpc-third'].build.args = { TOKEN: 'fake' } },
  'writable OpenIM config': c => { c.services['openim-rpc-third'].volumes[0].read_only = false },
  'production config mount': c => { c.services['openim-api'].volumes[0].source = path.resolve(__dirname, '../openim/config') },
  'internet data network': c => { c.networks.data.internal = false },
  'external egress network': c => { c.networks.egress.external = true },
  'public application ports': c => { c.services.gateway.ports[0].host_ip = '0.0.0.0' },
  'concurrent schema migrations': c => { c.services.admin.depends_on.api.condition = 'service_started' },
})) test(`application isolation rejects ${risk}`, () => { const c = structuredClone(template); change(c); assert.throws(() => validateApps(c)) })

test('launch guard refuses remote contexts and shell endpoint overrides', () => {
  const endpoint = 'npipe:////./pipe/dockerDesktopLinuxEngine'
  assert.doesNotThrow(() => assertLocalDocker({}, 'desktop-linux', endpoint))
  assert.throws(() => assertLocalDocker({}, 'production', endpoint))
  assert.throws(() => assertLocalDocker({}, 'desktop-linux', 'ssh://production'))
  for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'COMPOSE_FILE', 'TEST_PG_APP_PASSWORD']) assert.throws(() => assertLocalDocker({ [key]: 'override' }, 'desktop-linux', endpoint))
})
test('prepared runtime hashes reject stale env, tampering and cron configs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-app-oss-app-test-'))
  const owned = []
  const write = (n, text) => { const f = path.join(dir, n); fs.writeFileSync(f, text); owned.push(f) }
  fs.mkdirSync(path.join(dir, 'openim'))
  try {
    const contents = { 'business.env': '', 'admin.env': '', 'frontend.json': '{}' }
    for (const name of Object.keys(output.configs)) contents[`openim/${name}.yml`] = YAML.stringify(output.configs[name])
    for (const [n, text] of Object.entries(contents)) write(n, text)
    write('manifest.json', JSON.stringify({ version: 'v3.8.3-patch.15', envHash: hash(envText), files: Object.fromEntries(Object.entries(contents).map(([n, t]) => [n, hash(t)])) }))
    assert.doesNotThrow(() => validateRuntime(dir, envText))
    assert.throws(() => validateRuntime(dir, envText + '# changed\n'))
    fs.appendFileSync(path.join(dir, 'business.env'), 'DATABASE_URL=production')
    assert.throws(() => validateRuntime(dir, envText))
    fs.writeFileSync(path.join(dir, 'business.env'), '')
    write('openim/openim-crontask.yml', 'deleteAll: true')
    assert.throws(() => validateRuntime(dir, envText))
  } finally {
    for (const f of owned.reverse()) fs.unlinkSync(f)
    fs.rmdirSync(path.join(dir, 'openim')); fs.rmdirSync(dir)
  }
})
test('frontend test config replaces every production proxy and uses no normal dotenv directory', () => {
  for (const kind of ['client', 'admin']) {
    const c = testFrontendConfig(kind, output.frontend)
    assert.equal(c.server.host, '127.0.0.1')
    assert.equal(c.server.strictPort, true)
    assert.equal(c.envDir, path.join(__dirname, 'empty-env'))
    for (const p of Object.values(c.server.proxy)) { assert.match(p.target, /^https:\/\/localhost:1844[34]$/); assert.equal(p.secure, true) }
    assert.ok(!Object.keys(c.server.proxy).some(n => /minio|object/.test(n)))
    assert.throws(() => testFrontendConfig(kind, { ...output.frontend, apiBaseUrl: 'https://production/api/v1' }))
  }
})
test('frontend commands are allowlisted, local, and never publish WGT', () => {
  assert.throws(() => frontendCommand('publish'))
  assert.throws(() => frontendCommand('pack:wgt:canary'))
  // Admin dependencies may not be installed on a fresh checkout; native uses installed client CLI.
  for (const action of ['client-build', 'client-dev', 'app-resources']) {
    const c = frontendCommand(action, () => true)
    assert.ok(c.args.includes('oss-test'))
    assert.ok(c.env.UNI_OUTPUT_DIR.startsWith(path.join(__dirname, 'artifacts')))
    assert.ok(!c.args.some(n => /pack-wgt|publish/.test(n)))
  }
})
