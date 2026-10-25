const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { copyFileSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, existsSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { before, test } = require('node:test')
const { initializeEnv } = require('./init-env.cjs')
const { assertCleanEnvironment, validateIsolation } = require('./validate-config.cjs')

let template
before(() => {
  // Config rendering needs only the Compose CLI, not a running Docker Engine.
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/^(TEST_|COMPOSE_)/i.test(key)))
  const rendered = spawnSync('docker', [
    'compose', '--project-name', 'im-app-oss-test',
    '--env-file', path.join(__dirname, '.env.example'),
    '-f', path.join(__dirname, 'compose.infra.yml'), 'config', '--format', 'json',
  ], { encoding: 'utf8', env: environment })
  assert.ok(!rendered.error && rendered.status === 0, 'Docker Compose CLI must render the test template')
  template = JSON.parse(rendered.stdout)
})

test('the actual template contains nine isolated services', () => {
  assert.equal(validateIsolation(template, { example: true }), 9)
})

const unsafeChanges = {
  'a production project name': config => { config.name = 'im-app' },
  'a production database': config => { config.services.postgres.environment.POSTGRES_DB = 'imapp' },
  'a production MongoDB': config => { config.services['openim-mongodb'].environment.MONGO_INITDB_DATABASE = 'openim_v3' },
  'a production bucket': config => { config.services['minio-source'].environment.MINIO_DEFAULT_BUCKETS = 'im-uploads' },
  'an external network': config => { config.networks.data.external = true },
  'an internet-facing data network': config => { config.networks.data.internal = false },
  'a different data subnet': config => { config.networks.data.ipam.config[0].subnet = '172.20.0.0/16' },
  'a production volume name': config => { config.volumes.postgres_data.name = 'im-app_postgres_data' },
  'an external volume': config => { config.volumes.postgres_data.external = true },
  'a host directory through volume driver options': config => { config.volumes.postgres_data.driver_opts = { device: '/production' } },
  'a non-local volume driver': config => { config.volumes.postgres_data.driver = 'remote-data' },
  'a non-loopback database port': config => { config.services.postgres.ports[0].host_ip = '0.0.0.0' },
  'a production database port': config => { config.services.postgres.ports[0].published = '5432' },
  'a production directory bind mount': config => {
    config.services.postgres.volumes.push({ type: 'bind', source: path.resolve(__dirname, '../../deploy'), target: '/production', read_only: true })
  },
  'a writable init script': config => { config.services.postgres.volumes.find(mount => mount.type === 'bind').read_only = false },
  'a fixed production container name': config => { config.services.postgres.container_name = 'im-app-postgres' },
  'host networking': config => { config.services.postgres.network_mode = 'host' },
  'a privileged data service': config => { config.services.postgres.privileged = true },
  'an extra environment file': config => { config.services.postgres.env_file = ['../../.env'] },
}
for (const [risk, change] of Object.entries(unsafeChanges)) {
  test(`rejects ${risk}`, () => {
    const config = structuredClone(template)
    change(config)
    assert.throws(() => validateIsolation(config, { example: true }))
  })
}

test('deployment validation rejects template placeholder credentials', () => {
  assert.throws(() => validateIsolation(template))
})

test('deployment validation accepts distinct test credentials and rejects reuse', () => {
  const config = structuredClone(template)
  const locations = [
    ['postgres', 'POSTGRES_PASSWORD', 64], ['postgres', 'TEST_PG_APP_PASSWORD', 64],
    ['redis', 'REDISCLI_AUTH', 64], ['openim-redis', 'REDISCLI_AUTH', 64],
    ['openim-mongodb', 'MONGO_INITDB_ROOT_PASSWORD', 64], ['openim-mongodb', 'TEST_MONGO_APP_PASSWORD', 64],
    ['minio-source', 'MINIO_ROOT_USER', 20], ['minio-source', 'MINIO_ROOT_PASSWORD', 40],
    ['openim-minio-source', 'MINIO_ROOT_USER', 20], ['openim-minio-source', 'MINIO_ROOT_PASSWORD', 40],
  ]
  locations.forEach(([service, key, length], index) => {
    // Deliberately fake values; no real test secrets are read in this test.
    config.services[service].environment[key] = (index + 1).toString(16).repeat(length)
  })
  assert.equal(validateIsolation(config), 9)
  config.services.postgres.environment.TEST_PG_APP_PASSWORD = config.services.postgres.environment.POSTGRES_PASSWORD
  assert.throws(() => validateIsolation(config))
})

test('rejects inherited shell overrides instead of silently overriding the test env file', () => {
  assert.doesNotThrow(() => assertCleanEnvironment({ PATH: '/tools', HOME: '/test' }))
  assert.throws(() => assertCleanEnvironment({ TEST_PG_APP_PASSWORD: 'outside-file' }))
  assert.throws(() => assertCleanEnvironment({ COMPOSE_FILE: 'production.yml' }))
})

test('initializer creates independent secrets, leaves cloud keys blank and cannot rotate an existing file', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'im-app-oss-env-test-'))
  const examplePath = path.join(directory, '.env.example')
  const outputPath = path.join(directory, '.env')
  try {
    copyFileSync(path.join(__dirname, '.env.example'), examplePath)
    assert.equal(initializeEnv(directory), outputPath)
    const output = readFileSync(outputPath, 'utf8')
    const entries = Object.fromEntries(output.split(/\r?\n/)
      .map(line => /^([A-Z_]+)=(.*)$/.exec(line)).filter(Boolean)
      .map(([, key, value]) => [key, value]))
    assert.ok(!output.includes('replace_with_test_only_'))
    const generated = Object.entries(entries).filter(([, value]) => /^[a-f0-9]+$/.test(value))
    assert.equal(generated.length, 16)
    assert.equal(new Set(generated.map(([, value]) => value)).size, 16)
    for (const [key, value] of generated) {
      const length = key.endsWith('_MINIO_ACCESS_KEY') ? 20 : key.endsWith('_MINIO_SECRET_KEY') ? 40 : 64
      assert.equal(value.length, length)
    }
    assert.equal(entries.TEST_OSS_ACCESS_KEY_ID, '')
    assert.equal(entries.TEST_OSS_ACCESS_KEY_SECRET, '')
    assert.equal(entries.TEST_OSS_REGION, 'cn-hongkong')
    assert.equal(entries.TEST_OSS_CHAT_BUCKET, 'yikeliao-188-hk-test')
    assert.equal(entries.TEST_OSS_BUSINESS_BUCKET, 'yikeliao-188-business-hk-test')
    assert.equal(entries.TEST_OSS_CHAT_ORIGIN, 'https://oss-chat-test.xn--jprz53bj9s.com')
    assert.equal(entries.TEST_OSS_BUSINESS_ORIGIN, 'https://oss-business-test.xn--jprz53bj9s.com')
    assert.equal(entries.TEST_OSS_CHAT_PREFIX, 'oss-test/chat/')
    assert.equal(entries.TEST_OSS_BUSINESS_PREFIX, 'oss-test/business/')
    assert.equal(entries.TEST_OSS_DELETE_ENABLED, 'false')
    const beforeHash = createHash('sha256').update(output).digest('hex')
    assert.throws(() => initializeEnv(directory), { code: 'EEXIST' })
    assert.equal(createHash('sha256').update(readFileSync(outputPath)).digest('hex'), beforeHash)
  } finally {
    // Only remove the two exact files created here, never recursive deletion.
    for (const file of [outputPath, examplePath]) if (existsSync(file)) unlinkSync(file)
    rmdirSync(directory)
  }
})
