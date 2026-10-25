#!/usr/bin/env node
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')

function assertCleanEnvironment(environment) {
  // Shell variables override --env-file in Compose, including during `up`.
  assert.ok(!Object.keys(environment).some(key => /^(TEST_|COMPOSE_)/i.test(key)),
    'Unset shell TEST_* / COMPOSE_* overrides; use only the dedicated test .env.')
}

function validateIsolation(config, { example = false } = {}) {
  const project = 'im-app-oss-test'
  const services = [
    'postgres', 'redis', 'openim-mongodb', 'openim-redis', 'openim-etcd',
    'kafka', 'openim-kafka', 'minio-source', 'openim-minio-source',
  ]
  assert.equal(config.name, project)
  assert.deepEqual(Object.keys(config.services).sort(), services.sort())
  assert.deepEqual(Object.keys(config.networks), ['data'])
  assert.equal(config.networks.data.internal, true)
  assert.equal(config.networks.data.name, `${project}_data`)
  assert.ok(!config.networks.data.external)
  assert.ok(!config.networks.data.driver || config.networks.data.driver === 'bridge')
  assert.ok(!config.networks.data.driver_opts)
  assert.deepEqual(config.networks.data.ipam.config, [{ subnet: '172.30.187.0/24' }])
  assert.deepEqual(Object.keys(config.volumes).sort(), [
    'postgres_data', 'redis_data', 'mongo_data', 'openim_redis_data', 'etcd_data',
    'kafka_data', 'openim_kafka_data', 'minio_source_data', 'openim_minio_source_data',
  ].sort())
  for (const [key, volume] of Object.entries(config.volumes)) {
    assert.equal(volume.name, `${project}_${key}`)
    assert.ok(!volume.external)
    assert.ok(!volume.driver_opts)
    assert.ok(!volume.driver || volume.driver === 'local')
  }
  const allowedPorts = new Set(['15433', '16379', '16380', '27027', '19000', '19001', '19100', '19101'])
  const allowedFiles = new Set(['postgres-init.sh', 'mongo-init.js'].map(file => path.join(__dirname, file)))
  for (const service of Object.values(config.services)) {
    assert.ok(!service.container_name)
    assert.ok(!service.network_mode && !service.privileged)
    assert.deepEqual(Object.keys(service.networks), ['data'])
    assert.equal(service.labels['im.app.environment'], 'oss-test')
    assert.ok(!service.env_file)
    for (const port of service.ports || []) {
      assert.equal(port.host_ip, '127.0.0.1')
      assert.ok(allowedPorts.has(String(port.published)))
    }
    for (const mount of service.volumes || []) {
      if (mount.type === 'volume') {
        assert.ok(Object.hasOwn(config.volumes, mount.source))
      } else {
        assert.equal(mount.type, 'bind')
        assert.ok(allowedFiles.has(path.normalize(mount.source)))
        assert.equal(mount.read_only, true)
      }
    }
  }
  const pg = config.services.postgres.environment
  assert.equal(pg.POSTGRES_DB, 'imapp_oss_test')
  assert.equal(pg.POSTGRES_USER, 'oss_test_admin')
  const mongo = config.services['openim-mongodb'].environment
  assert.equal(mongo.MONGO_INITDB_DATABASE, 'openim_oss_test')
  assert.equal(mongo.MONGO_INITDB_ROOT_USERNAME, 'oss_test_admin')
  assert.equal(config.services['minio-source'].environment.MINIO_DEFAULT_BUCKETS, 'im-uploads-oss-test')
  assert.equal(config.services['openim-minio-source'].environment.MINIO_DEFAULT_BUCKETS, 'openim-oss-test')
  if (!example) {
    const secrets = [pg.POSTGRES_PASSWORD, pg.TEST_PG_APP_PASSWORD,
      config.services.redis.environment.REDISCLI_AUTH,
      config.services['openim-redis'].environment.REDISCLI_AUTH,
      mongo.MONGO_INITDB_ROOT_PASSWORD, mongo.TEST_MONGO_APP_PASSWORD,
      config.services['minio-source'].environment.MINIO_ROOT_USER,
      config.services['minio-source'].environment.MINIO_ROOT_PASSWORD,
      config.services['openim-minio-source'].environment.MINIO_ROOT_USER,
      config.services['openim-minio-source'].environment.MINIO_ROOT_PASSWORD]
    const lengths = [64, 64, 64, 64, 64, 64, 20, 40, 20, 40]
    assert.ok(secrets.every((value, index) =>
      new RegExp(`^[a-f0-9]{${lengths[index]}}$`).test(value || '')))
    assert.equal(new Set(secrets).size, secrets.length)
  }
  return services.length
}

function main() {
  // Rendering Compose does not contact databases or start containers.
  const example = process.argv.length === 3 && process.argv[2] === '--example'
  if (process.argv.length > 2 && !example) {
    console.error('Usage: node deploy/oss-test/validate-config.cjs [--example]')
    return 1
  }
  try {
    assertCleanEnvironment(process.env)
  } catch (error) {
    console.error(error.message)
    return 1
  }
  const envPath = path.join(__dirname, example ? '.env.example' : '.env')
  if (!existsSync(envPath)) {
    console.error('Test .env is missing; run node deploy/oss-test/init-env.cjs first.')
    return 1
  }
  const result = spawnSync('docker', [
    'compose', '--project-name', 'im-app-oss-test', '--env-file', envPath,
    '-f', path.join(__dirname, 'compose.infra.yml'), 'config', '--format', 'json',
  ], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 })
  if (result.error || result.status !== 0) {
    // Avoid printing rendered configuration or credentials to the terminal.
    console.error('Compose validation failed. Check Docker Compose installation and the test env keys.')
    return 1
  }
  try {
    const count = validateIsolation(JSON.parse(result.stdout), { example })
    console.log(`Validated ${count} isolated test data services${example ? ' (template only)' : ''}; no containers started.`)
    return 0
  } catch {
    console.error('Isolation check failed; test resource names, mounts, ports or credentials are unsafe.')
    return 1
  }
}

if (require.main === module) process.exitCode = main()
module.exports = { assertCleanEnvironment, validateIsolation }
