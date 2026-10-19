'use strict'
// Local builds only. Never connects to databases, uploads objects or deploys.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const patch = require('./openim-scope/patch-openim.cjs')
const { validateBinary } = require('../oss-test/build-openim-host.cjs')
const root = path.resolve(__dirname, '../..')
const artifacts = path.join(__dirname, 'artifacts')
fs.mkdirSync(artifacts, { recursive: true })
const output = path.join(artifacts, 'oss-production-bundle')
if (fs.existsSync(output)) throw new Error('Preserve existing bundle; refusing overwrite')
fs.mkdirSync(output)
const native = { ...process.env, GOENV: 'off', GOFLAGS: '', CGO_ENABLED: '0', GOOS: process.platform === 'win32' ? 'windows' : 'linux', GOARCH: 'amd64', GOPROXY: 'https://goproxy.cn,direct', GODEBUG: 'decoratemappings=0' }
const linux = { ...native, GOOS: 'linux' }
function go(args, cwd, env = native) { return execFileSync('go', args, { cwd, env, stdio: 'inherit' }) }
console.log('Validating business API')
go(['test', './...'], path.join(root, 'IM-APP-server'))
go(['test', '-mod=mod', './...'], path.join(__dirname, 'openim-scope'))
const upstreamModule = JSON.parse(execFileSync('go', ['mod', 'download', '-json', 'github.com/openimsdk/open-im-server/v3@v3.8.3-patch.15'], { env: native, encoding: 'utf8' }))
const checkout = fs.mkdtempSync(path.join(artifacts, 'production-openim-src-'))
fs.cpSync(upstreamModule.Dir, checkout, { recursive: true, force: false })
function writable(dir) {
  fs.chmodSync(dir, 0o755)
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error('Unexpected source symlink')
    const file = path.join(dir, item.name)
    if (item.isDirectory()) writable(file); else fs.chmodSync(file, 0o644)
  }
}
writable(checkout)
patch.apply(checkout)
go(['mod', 'tidy'], checkout)
go(['test', 'github.com/openimsdk/tools/s3/oss'], checkout)
go(['test', './internal/rpc/third'], checkout)
console.log('Cross-compiling business API and production OSS third service')
go(['build', '-trimpath', '-o', path.join(output, 'im-server'), './cmd/server'], path.join(root, 'IM-APP-server'), linux)
go(['build', '-trimpath', '-o', path.join(output, 'openim-rpc-third'), './cmd/openim-rpc/openim-rpc-third'], checkout, linux)
for (const name of ['im-server', 'openim-rpc-third']) validateBinary(fs.readFileSync(path.join(output, name)))
fs.cpSync(path.join(root, 'IM-APP-server/migrations'), path.join(output, 'migrations'), { recursive: true })
fs.writeFileSync(path.join(output, 'api.Dockerfile'), 'ARG BASE_IMAGE\nFROM ${BASE_IMAGE}\nCOPY --chmod=0755 im-server /app/im-server\nCOPY migrations /app/migrations\nLABEL im.app.oss-build="production"\n')
fs.writeFileSync(path.join(output, 'openim.Dockerfile'), 'ARG BASE_IMAGE\nFROM ${BASE_IMAGE}\nCOPY --chmod=0755 openim-rpc-third /openim-server/_output/bin/platforms/linux/amd64/openim-rpc-third\nLABEL im.app.oss-build="production"\n')
const files = {}
function collect(dir) { for (const item of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, item.name); if (item.isDirectory()) collect(p); else files[path.relative(output, p).replaceAll('\\', '/')] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') } }
collect(output)
fs.writeFileSync(path.join(output, 'bundle-manifest.json'), JSON.stringify({ platform: 'linux/amd64', openim: 'v3.8.3-patch.15', source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), files }, null, 2) + '\n')
console.log('OSS_PRODUCTION_BINARIES_BUILT: ' + output)
