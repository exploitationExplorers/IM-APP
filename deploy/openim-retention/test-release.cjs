'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { overlayFiles, binaries, migrations, productionFiles, validateBinary } = require('./build-release.cjs')

test('overlay includes BOTH retention-aware readers and allocator, not third/API/gateway replacements', () => {
  assert.deepEqual(Object.keys(binaries).sort(), ['openim-msgtransfer', 'openim-rpc-msg'])
  const overlay = overlayFiles()
  assert.match(overlay['openim.Dockerfile'], /COPY --chmod=0755 openim-rpc-msg /)
  assert.match(overlay['openim.Dockerfile'], /COPY --chmod=0755 openim-msgtransfer /)
  assert.match(overlay['openim.Dockerfile'], /IM_APP_RETENTION_BODY_PURGE_ENABLED=false IM_APP_RETENTION_BODY_PURGE_GROUP_IDS="" IM_APP_RETENTION_BODY_PURGE_ACK=""/)
  assert.doesNotMatch(overlay['openim.Dockerfile'], /openim-rpc-third|COPY.*openim-api|COPY.*config|ENTRYPOINT|CMD/)
  assert.match(overlay['api.Dockerfile'], /MIGRATIONS_MODE=verify GROUP_RETENTION_MODE=visibility_only/)
  assert.match(overlay['api.Dockerfile'], /FAVORITE_ARCHIVE_WORKER_ENABLED=false SEED_DEMO=false/)
  assert.match(overlay['api.Dockerfile'], /GROUP_RETENTION_ALL_GROUPS=true/)
  assert.deepEqual(migrations.map(m => m.slice(0,3)), ['052','053','054','055'])
})

test('production templates preserve OSS overrides and separate install, canary, enable', () => {
  for (const file of productionFiles) assert.ok(fs.existsSync(path.join(__dirname, file)))
  const read = file => JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'))
  const install = read('api.install.compose.json').services.api
  assert.equal(install.environment.GROUP_RETENTION_MODE, 'off')
  assert.equal(install.environment.MIGRATIONS_MODE, 'verify')
  assert.equal(install.environment.STORAGE_PROVIDER, 'oss')
  assert.match(install.image, /\$\{RETENTION_API_IMAGE:\?/)
  assert.match(install.environment.GROUP_RETENTION_ADAPTER_KEY, /\$\{IM_APP_RETENTION_KEY:\?/)
  for (const key of ['OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_MEDIA_SIGNING_KEY', 'DATABASE_URL']) {
    assert.equal(install.environment[key], undefined, 'preserve the existing saved configuration')
  }
  assert.equal(read('api.enable.compose.json').services.api.environment.GROUP_RETENTION_MODE, 'visibility_only')
  assert.equal(read('api.enable.compose.json').services.api.environment.GROUP_RETENTION_ALL_GROUPS, 'true')
  assert.equal(read('api.canary.compose.json').services.api.environment.GROUP_RETENTION_ALL_GROUPS, 'false')
  assert.match(read('api.canary.compose.json').services.api.environment.GROUP_RETENTION_GROUP_IDS, /:\?/)
  const chat = read('openim.bridge.compose.json').services['openim-api']
  assert.equal(chat.ports, undefined)
  assert.equal(chat.environment.IM_APP_RETENTION_BODY_PURGE_ENABLED, 'false')
  assert.equal(chat.environment.IM_APP_RETENTION_BODY_PURGE_GROUP_IDS, '')
  assert.equal(chat.environment.IM_APP_RETENTION_KEY, install.environment.GROUP_RETENTION_ADAPTER_KEY)
  const functions = fs.readFileSync(path.join(__dirname, 'compose-functions.sh'), 'utf8')
  assert.match(functions, /oss-production-bundle\/private\/api\.compose\.json/)
  assert.match(functions, /oss-production-bundle\/private\/openim\.compose\.json/)
  assert.match(functions, /--project-name im-app/)
  assert.match(functions, /--project-name openim/)
  const entry = fs.readFileSync(path.join(__dirname, '../production.sh'), 'utf8')
  assert.match(entry, /--no-deps --no-build --pull never api/)
  assert.match(entry, /--no-deps --no-build --pull never openim-api/)
  assert.match(entry, /--accept-full-group-retention/)
  assert.doesNotMatch(entry, /down -v|system prune|volume rm|docker compose up/)
  const base = fs.readFileSync(path.join(__dirname, '../docker-compose.yml'), 'utf8')
  for (const name of ['OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_MEDIA_SIGNING_KEY', 'GROUP_RETENTION_MODE', 'GROUP_RETENTION_ADAPTER_KEY']) {
    assert.ok(base.includes(`${name}: \${${name}:-`), `base Compose must forward ${name}`)
  }
})

test('rejects non-Linux, wrong-architecture and truncated binaries', () => {
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(100), Buffer.from('MZ'+'.'.repeat(100))]) assert.throws(() => validateBinary(bytes))
  const elf = Buffer.alloc(100)
  Buffer.from([0x7f,0x45,0x4c,0x46,2,1]).copy(elf)
  elf.writeUInt16LE(62,18)
  assert.doesNotThrow(() => validateBinary(elf))
  elf.writeUInt16LE(183,18)
  assert.throws(() => validateBinary(elf))
})
