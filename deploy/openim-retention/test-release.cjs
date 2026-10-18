'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { overlayFiles, binaries, migrations, validateBinary } = require('./build-release.cjs')

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

test('rejects non-Linux, wrong-architecture and truncated binaries', () => {
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(100), Buffer.from('MZ'+'.'.repeat(100))]) assert.throws(() => validateBinary(bytes))
  const elf = Buffer.alloc(100)
  Buffer.from([0x7f,0x45,0x4c,0x46,2,1]).copy(elf)
  elf.writeUInt16LE(62,18)
  assert.doesNotThrow(() => validateBinary(elf))
  elf.writeUInt16LE(183,18)
  assert.throws(() => validateBinary(elf))
})
