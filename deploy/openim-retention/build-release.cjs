'use strict'
// LOCAL BUILD ONLY. Never reads .env/private files, invokes Docker, connects to
// a database, uploads a WGT, copies RAM credentials or restarts a service.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { apply } = require('./patch-openim.cjs')
const objectGC = require('./patch-object-gc.cjs')

const version = 'v3.8.3-patch.15'
const root = path.resolve(__dirname, '../..')
const migrations = ['052_media_preservation.sql', '053_forward_media_preservation.sql', '054_group_retention_plans.sql', '055_group_retention_visibility.sql']
const binaries = {
  'openim-rpc-msg': './cmd/openim-rpc/openim-rpc-msg',
  // REQUIRED: the unpatched transfer allocator resets Mongo min_seq.
  'openim-msgtransfer': './cmd/openim-msgtransfer',
  'openim-rpc-third': './cmd/openim-rpc/openim-rpc-third',
  'openim-rpc-user': './cmd/openim-rpc/openim-rpc-user',
  'openim-rpc-group': './cmd/openim-rpc/openim-rpc-group',
}
const productionFiles = ['api.install.compose.json', 'api.enable.compose.json', 'api.canary.compose.json',
  'api.disable.compose.json', 'openim.bridge.compose.json', 'compose-functions.sh', 'prepare-production.py',
  'cleanup-production.py', 'OBJECT-GC.md', 'ram-chat-gc-policy.json']

function overlayFiles() {
  return {
    'api.Dockerfile': 'ARG BASE_IMAGE\nFROM ${BASE_IMAGE}\nCOPY --chmod=0755 im-server /app/im-server\nCOPY migrations /app/migrations\nENV MIGRATIONS_MODE=verify GROUP_RETENTION_MODE=visibility_only FAVORITE_ARCHIVE_WORKER_ENABLED=false SEED_DEMO=false GROUP_RETENTION_ALL_GROUPS=true MEDIA_GC_REFERENCE_GUARD_ENABLED=true\nLABEL im.app.retention="visibility-v2-managed-gc1"\n',
    // BASE_IMAGE must be the CURRENT production OSS image, pinned by digest/ID.
    // Preserve API, gateway, config, libraries and entrypoint. Replace all five
    // participating writers, not just the message reader.
    'openim.Dockerfile': 'ARG BASE_IMAGE\nFROM ${BASE_IMAGE}\n' + Object.keys(binaries).map(name => `COPY --chmod=0755 ${name} /openim-server/_output/bin/platforms/linux/amd64/${name}\n`).join('') + 'ENV IM_APP_RETENTION_BODY_PURGE_ENABLED=false IM_APP_RETENTION_BODY_PURGE_GROUP_IDS="" IM_APP_RETENTION_BODY_PURGE_ACK=""\nLABEL im.app.retention="visibility-v2-managed-gc1"\n',
  }
}

function validateBinary(data) {
  assert.ok(data.length > 64)
  assert.deepEqual(data.subarray(0, 6), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]))
  assert.equal(data.readUInt16LE(18), 62, 'Linux amd64 binary required')
}

function writable(directory) {
  fs.chmodSync(directory, 0o755)
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    assert.ok(!entry.isSymbolicLink(), 'source symlink refused')
    if (entry.isDirectory()) writable(file)
    else fs.chmodSync(file, 0o644)
  }
}

function build() {
  if (process.argv.length !== 2) throw new Error('No arguments supported; output is a new local artifacts directory')
  const artifacts = path.join(__dirname, 'artifacts')
  fs.mkdirSync(artifacts, { recursive: true })
  const output = fs.mkdtempSync(path.join(artifacts, 'media-gc-release-'))
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'imapp-retention-build-'))
  // -buildvcs=false: OpenIM module checkout under Temp has no usable .git on Windows.
  const env = { ...process.env, GOENV: 'off', GOFLAGS: '-buildvcs=false', CGO_ENABLED: '0', GOOS: process.platform === 'win32' ? 'windows' : process.platform, GOARCH: 'amd64' }
  const linux = { ...env, GOOS: 'linux' }
  const goExe = process.env.GO_EXECUTABLE || 'go'
  const go = (args, cwd, buildEnv = env) => execFileSync(goExe, args, { cwd, env: buildEnv, stdio: 'inherit', timeout: 300000 })
  try {
    go(['test', './...'], path.join(root, 'IM-APP-server'))
    const module = JSON.parse(execFileSync(goExe, ['mod', 'download', '-json', `github.com/openimsdk/open-im-server/v3@${version}`], { env, encoding: 'utf8', timeout: 120000 }))
    assert.equal(module.Version, version)
    const checkout = path.join(temporary, 'openim')
    fs.cpSync(module.Dir, checkout, { recursive: true, errorOnExist: true, force: false })
    writable(checkout)
    apply(checkout)
    objectGC.apply(checkout)
    go(['test', './internal/imappgc', './internal/rpc/third', './internal/imappretention', './internal/rpc/msg', './pkg/common/storage/controller', '-run', 'Test(IMAppRetention|Retention|PlanGroupRetention)', '-count=1'], checkout)
    go(['build', '-trimpath', '-o', path.join(output, 'im-server'), './cmd/server'], path.join(root, 'IM-APP-server'), linux)
    for (const [name, pkg] of Object.entries(binaries)) go(['build', '-trimpath', '-o', path.join(output, name), pkg], checkout, linux)
    for (const name of ['im-server', ...Object.keys(binaries)]) validateBinary(fs.readFileSync(path.join(output, name)))
    // The overlay uses verify mode. Include ONLY the reviewed incremental DDL,
    // not an old production cutover script or a full historical migration set.
    fs.mkdirSync(path.join(output, 'migrations'))
    for (const file of migrations) fs.copyFileSync(path.join(root, 'IM-APP-server/migrations', file), path.join(output, 'migrations', file))
    for (const [name, data] of Object.entries(overlayFiles())) fs.writeFileSync(path.join(output, name), data, { flag: 'wx' })
    fs.writeFileSync(path.join(output,'.dockerignore'), 'private\n*.log\n')
    for (const file of ['README.md', 'ACCEPTANCE.md', 'BODY-PURGE.md', 'openapi.json', 'postman_collection.json', ...productionFiles]) fs.copyFileSync(path.join(__dirname, file), path.join(output, file))
    for (const file of ['production.sh', 'PRODUCTION.md']) fs.copyFileSync(path.join(__dirname, '..', file), path.join(output, file))
    const readme = path.join(output, 'README.md')
    fs.writeFileSync(readme, fs.readFileSync(readme, 'utf8').replace('](../PRODUCTION.md)', '](PRODUCTION.md)'))
    const files = {}
    function collect(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
        assert.ok(!entry.isSymbolicLink())
        const file = path.join(directory, entry.name)
        if (entry.isDirectory()) collect(file)
        else files[path.relative(output, file).replaceAll('\\', '/')] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
      }
    }
    collect(output)
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
    fs.writeFileSync(path.join(output, 'bundle-manifest.json'), JSON.stringify({
      kind: 'retention-incremental', openim: version, protocol: 'im-app-retention-visibility-v2', platform: 'linux/amd64',
      sourceCommit: git(['rev-parse', 'HEAD']), workingTreeDirty: Boolean(git(['status', '--porcelain'])),
      groupVisibility: 'enabled_by_default_all_groups', requiredConfiguration: ['GROUP_RETENTION_ADAPTER_URL', 'GROUP_RETENTION_ADAPTER_KEY'],
      mongoBodyPurge: 'disabled_by_default', ossObjectPurge: 'managed_v1_only_default_on_after_writer_verification',
      mediaGCProtocol: 'im-app-media-gc-v1', mediaGCSchedule: '03:30 Asia/Shanghai',
      automaticDeployment: false, deviceAcceptance: 'pending', files,
    }, null, 2)+'\n', { flag: 'wx' })
    fs.writeFileSync(path.join(output, 'SHA256SUMS'), Object.entries(files).map(([file, sum]) => `${sum}  ${file}\n`).join(''), { flag: 'wx' })
    console.log('RETENTION_LOCAL_BUNDLE_BUILT: '+output)
    console.log('GROUP VISIBILITY + MANAGED CHAT GC DEFAULT ON after deployment verification; MONGO BODY PURGE OFF; legacy objects retained. No deployment/WGT publication.')
  } finally {
    // Only the fresh, explicitly named disposable build root may be removed.
    const resolved = fs.realpathSync(temporary)
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()))
    assert.ok(path.basename(resolved).startsWith('imapp-retention-build-'))
    fs.rmSync(resolved, { recursive: true, force: false })
  }
}

module.exports = { overlayFiles, binaries, migrations, productionFiles, validateBinary }
if (require.main === module) {
  try { build() } catch {
    console.error('RETENTION_LOCAL_BUILD_FAILED: no deployment performed; preserve output and inspect local compiler/test errors.')
    process.exitCode = 1
  }
}
