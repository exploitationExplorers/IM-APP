#!/usr/bin/env node
'use strict'
// Generates only ignored local files. No DB connection, container startup or OSS call.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const assert = require('node:assert/strict')
const YAML = require('yaml')
const { assertCleanEnvironment } = require('./validate-config.cjs')

const version = 'v3.8.3-patch.15'
const binaries = ['api', 'msggateway', 'msgtransfer', 'push', ...['auth', 'conversation', 'friend', 'group', 'msg', 'third', 'user'].map(x => `rpc-${x}`)]
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

function parseEnv(text) {
  const entries = {}
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const m = /^([A-Z_]+)=(.*)$/.exec(line)
    assert.ok(m && !Object.hasOwn(entries, m[1]), 'Invalid or duplicate test env key')
    assert.ok(!/[\r\n\x00]/.test(m[2]), 'Invalid test env value')
    entries[m[1]] = m[2]
  }
  return entries
}

function validateEnv(e) {
  const template = parseEnv(fs.readFileSync(path.join(__dirname, '.env.example'), 'utf8'))
  assert.deepEqual(Object.keys(e).sort(), Object.keys(template).sort(), 'Test env keys differ; compare .env.example (do not regenerate existing secrets)')
  for (const [key, placeholder] of Object.entries(template)) {
    if (!placeholder.startsWith('replace_with_test_only_')) continue
    const length = key.endsWith('_MINIO_ACCESS_KEY') ? 20 : key.endsWith('_MINIO_SECRET_KEY') ? 40 : 64
    assert.match(e[key], new RegExp(`^[a-f0-9]{${length}}$`), `Invalid generated test credential: ${key}`)
  }
  const secrets = Object.keys(template).filter(k => template[k].startsWith('replace_with_test_only_')).map(k => e[k])
  assert.equal(new Set(secrets).size, secrets.length, 'Test secrets must be distinct')
  for (const key of ['COMPOSE_PROJECT_NAME', 'TEST_OSS_REGION', 'TEST_OSS_CHAT_BUCKET', 'TEST_OSS_BUSINESS_BUCKET', 'TEST_OSS_CHAT_ORIGIN', 'TEST_OSS_BUSINESS_ORIGIN', 'TEST_OSS_CHAT_PREFIX', 'TEST_OSS_BUSINESS_PREFIX', 'TEST_OSS_DELETE_ENABLED']) {
    assert.equal(e[key], template[key], `Unsafe test setting: ${key}`)
  }
  // Phase one is loopback only. LAN/real-device routing needs a separate reviewed setup.
  assert.equal(e.TEST_PUBLIC_ORIGIN, 'https://localhost:18443', 'Use the local test origin')
  assert.equal(e.TEST_ADMIN_ORIGIN, 'https://localhost:18444', 'Use the local admin test origin')
  assert.match(e.TEST_OSS_ACCESS_KEY_ID, /^[A-Za-z0-9]{12,128}$/, 'Fill the existing RAM AccessKey ID locally')
  assert.match(e.TEST_OSS_ACCESS_KEY_SECRET, /^[A-Za-z0-9+/=_-]{16,256}$/, 'Fill the existing RAM AccessKey secret locally')
}

function createConfiguration(e, upstream) {
  validateEnv(e)
  const configs = structuredClone(upstream)
  const required = ['discovery', 'mongodb', 'redis', 'kafka', 'share', 'minio', 'notification', 'local-cache', 'webhooks', 'log', ...binaries.map(x => `openim-${x}`)]
  for (const key of required) assert.ok(configs[key], `Missing pinned upstream config: ${key}`)
  // Do not even generate crontask/monitoring application configs.
  for (const key of Object.keys(configs)) if (!required.includes(key)) delete configs[key]
  configs.discovery = { enable: 'etcd', etcd: { rootDirectory: 'im-app-oss-test', address: ['openim-etcd:2379'], username: '', password: '' } }
  configs.mongodb = { uri: '', address: ['openim-mongodb:27017'], database: 'openim_oss_test', username: 'im_oss_test', password: e.TEST_MONGO_APP_PASSWORD, authSource: 'openim_oss_test', maxPoolSize: 100, maxRetry: 10 }
  configs.redis = { address: ['openim-redis:6379'], username: '', password: e.TEST_OPENIM_REDIS_PASSWORD, redisMode: 'standalone', db: 0, maxRetry: 10, poolSize: 100 }
  Object.assign(configs.kafka, { address: ['openim-kafka:9092'], username: '', password: '' })
  for (const key of Object.keys(configs.kafka)) if (/Topic$|GroupID$/.test(key)) configs.kafka[key] = `${key}_oss_test`
  configs.kafka.tls = { enableTLS: false }
  configs.share.secret = e.TEST_OPENIM_SECRET
  configs.share.imAdminUserID = ['imAdmin']
  configs.minio = { bucket: 'openim-oss-test', accessKeyID: e.TEST_OPENIM_MINIO_ACCESS_KEY, secretAccessKey: e.TEST_OPENIM_MINIO_SECRET_KEY, sessionToken: '', internalAddress: 'openim-minio-source:9000', externalAddress: 'http://localhost:19100', publicRead: false }
  configs.log = { storageLocation: '/tmp/openim-logs', rotationTime: 24, remainRotationCount: 2, remainLogLevel: 3, isStdout: true, isJson: false, isSimplify: true }
  for (const name of binaries) {
    const c = configs[`openim-${name}`]
    c.prometheus = { enable: false, autoSetPorts: false, ports: [12000] }
    if (c.rpc) Object.assign(c.rpc, { registerIP: '', listenIP: '0.0.0.0', autoSetPorts: false, ports: [c.rpc.ports[0]] })
  }
  configs['openim-api'].api.listenIP = '0.0.0.0'
  configs['openim-push'].enable = 'disabled' // Pinned upstream selects its dummy pusher.
  configs['openim-push'].geTui = {}
  configs['openim-push'].fcm = {}
  configs['openim-push'].jpush = {}
  // The test-only tools patch enables CNAME before signing ALL OpenIM URLs.
  // bucketURL alone affects forms/parts, but NOT SDK-signed PUT/GET or HEAD/COPY.
  configs['openim-rpc-third'].object = { enable: 'oss', oss: { endpoint: e.TEST_OSS_CHAT_ORIGIN, bucket: e.TEST_OSS_CHAT_BUCKET, bucketURL: e.TEST_OSS_CHAT_ORIGIN, accessKeyID: e.TEST_OSS_ACCESS_KEY_ID, accessKeySecret: e.TEST_OSS_ACCESS_KEY_SECRET, sessionToken: '', publicRead: false } }
  for (const value of Object.values(configs.webhooks)) if (value && typeof value === 'object') value.enable = false
  configs.webhooks.url = `http://api:8080/internal/openim/webhooks/${e.TEST_WEBHOOK_SECRET}`
  for (const key of ['beforeSendSingleMsg', 'beforeSendGroupMsg', 'afterSendSingleMsg', 'afterSendGroupMsg', 'afterRevokeMsg']) {
    assert.ok(configs.webhooks[key], `Missing callback: ${key}`)
    configs.webhooks[key].enable = true
    if (key.startsWith('before')) configs.webhooks[key].failedContinue = false
  }
  const db = `postgres://im_oss_test:${e.TEST_PG_APP_PASSWORD}@postgres:5432/imapp_oss_test?sslmode=disable`
  const business = {
    APP_ENV: 'oss-test', GIN_MODE: 'release', HTTP_ADDR: ':8080', DATABASE_URL: db,
    JWT_SECRET: e.TEST_JWT_SECRET, IM_INTERNAL_API_KEY: e.TEST_INTERNAL_API_KEY,
    REDIS_URL: `redis://:${e.TEST_REDIS_PASSWORD}@redis:6379/0`,
    LEGACY_CHAT_ENABLED: 'false', SEED_DEMO: 'false', DEV_SMS_CODE: '246810',
    // This OSS smoke stack has no retention bridge; never fall through to the
    // application's default-on retention policy without its required service.
    GROUP_RETENTION_MODE: 'off', GROUP_RETENTION_ALL_GROUPS: 'false',
    KAFKA_BROKERS: 'kafka:19092', KAFKA_FORWARD_TOPIC: 'im-forward-tasks_oss_test', KAFKA_FORWARD_GROUP_ID: 'im-forward-workers_oss_test', FORWARD_WORKER_ENABLED: 'true',
    OPENIM_API_URL: 'http://openim-api:10002', OPENIM_PUBLIC_API_URL: `${e.TEST_PUBLIC_ORIGIN}/openim-api`, OPENIM_PUBLIC_WS_URL: `${e.TEST_PUBLIC_ORIGIN.replace('https:', 'wss:')}/openim-ws`,
    OPENIM_SECRET: e.TEST_OPENIM_SECRET, OPENIM_ADMIN_USER: 'imAdmin', OPENIM_WEBHOOK_SECRET: e.TEST_WEBHOOK_SECRET,
    OPENIM_WEBHOOK_ALLOW_CIDRS: '172.30.187.0/24,172.30.188.0/24',
    MINIO_ENDPOINT: '', MINIO_PUBLIC_READ: 'false',
    ALIYUN_ACCESS_KEY_ID: '', ALIYUN_ACCESS_KEY_SECRET: '', SMS_SIGN_NAME: '', SMS_TEMPLATE_CODE: '',
    CORS_ALLOW_ORIGINS: `${e.TEST_PUBLIC_ORIGIN},http://localhost:15173`, STORAGE_PROVIDER: 'oss',
    OSS_REGION: e.TEST_OSS_REGION, OSS_ENDPOINT: `https://oss-${e.TEST_OSS_REGION}.aliyuncs.com`, OSS_BUCKET: e.TEST_OSS_BUSINESS_BUCKET,
    OSS_PUBLIC_UPLOAD_URL: e.TEST_OSS_BUSINESS_ORIGIN,
    OSS_KEY_PREFIX: e.TEST_OSS_BUSINESS_PREFIX, OSS_ACCESS_KEY_ID: e.TEST_OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET: e.TEST_OSS_ACCESS_KEY_SECRET,
    OSS_PUBLIC_BASE_URL: '', OSS_MEDIA_PROXY_URL: `${e.TEST_PUBLIC_ORIGIN}/api/v1/public/oss-media`,
    OSS_MEDIA_SIGNING_KEY: crypto.createHmac('sha256', e.TEST_INTERNAL_API_KEY).update('oss-test-media-capability-v1').digest('hex'),
  }
  const admin = { APP_ENV: 'oss-test', GIN_MODE: 'release', HTTP_ADDR: ':8090', DATABASE_URL: db, ADMIN_JWT_SECRET: e.TEST_ADMIN_JWT_SECRET, ADMIN_BOOTSTRAP_USERNAME: 'oss_test_admin', ADMIN_BOOTSTRAP_PASSWORD: e.TEST_ADMIN_BOOTSTRAP_PASSWORD, SERVER_BASE_URL: 'http://api:8080', SERVER_INTERNAL_KEY: e.TEST_INTERNAL_API_KEY, ADMIN_CORS_ORIGINS: `${e.TEST_ADMIN_ORIGIN},http://localhost:15180` }
  return { configs, business, admin, frontend: { apiBaseUrl: `${e.TEST_PUBLIC_ORIGIN}/api/v1`, publicOrigin: e.TEST_PUBLIC_ORIGIN, adminOrigin: e.TEST_ADMIN_ORIGIN } }
}

function upstreamConfigs() {
  const result = JSON.parse(execFileSync('go', ['mod', 'download', '-json', `github.com/openimsdk/open-im-server/v3@${version}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  assert.equal(result.Version, version)
  const third = fs.readFileSync(path.join(result.Dir, 'internal/rpc/third/third.go'))
  const patch = require('./openim-scope/patch-openim.cjs')
  patch.transform(third) // Exact pinned source fingerprints; no cache modifications.
  patch.transformOSS(fs.readFileSync(path.join(patch.upstreamTools(), 's3/oss/oss.go')))
  const dir = path.join(result.Dir, 'config')
  return Object.fromEntries(fs.readdirSync(dir).filter(x => x.endsWith('.yml')).map(file => [file.slice(0, -4), YAML.parse(fs.readFileSync(path.join(dir, file), 'utf8'))]))
}

function main() {
  assertCleanEnvironment(process.env)
  assert.ok(process.argv.length === 2, 'Usage: node deploy/oss-test/prepare-apps.cjs')
  const text = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
  const e = parseEnv(text)
  validateEnv(e) // Fail before downloading sources or creating files.
  const output = createConfiguration(e, upstreamConfigs())
  const dir = path.join(__dirname, 'private/runtime')
  assert.ok(!fs.existsSync(dir), 'private/runtime already exists; preserve it. See the refresh procedure in the manual.')
  fs.mkdirSync(path.join(dir, 'openim'), { recursive: true, mode: 0o700 })
  const write = (name, data) => fs.writeFileSync(path.join(dir, name), data, { flag: 'wx', mode: 0o600 })
  for (const [name, obj] of Object.entries(output.configs)) write(`openim/${name}.yml`, YAML.stringify(obj))
  for (const name of ['business', 'admin']) write(`${name}.env`, Object.entries(output[name]).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
  write('frontend.json', JSON.stringify(output.frontend, null, 2))
  const files = ['business.env', 'admin.env', 'frontend.json', ...Object.keys(output.configs).map(n => `openim/${n}.yml`)]
  write('manifest.json', JSON.stringify({ version, envHash: hash(text), files: Object.fromEntries(files.map(n => [n, hash(fs.readFileSync(path.join(dir, n)))])) }))
  // Ensure static mount directories exist, but do not build/publish any frontend.
  for (const name of ['front-h5', 'admin-web']) fs.mkdirSync(path.join(__dirname, 'artifacts', name), { recursive: true })
  console.log('Generated ignored test runtime configuration; no containers, databases or OSS objects were changed.')
}
if (require.main === module) {
  try { main() } catch { console.error('Preparation refused. Check test .env keys/credentials/local origins, existing private/runtime, and pinned Go source availability. No secrets printed. See 本机Docker测试步骤.md.'); process.exitCode = 1 }
}
module.exports = { parseEnv, validateEnv, createConfiguration, upstreamConfigs, binaries, hash }
