#!/usr/bin/env node
'use strict'
// Fallback for WSL compiler mmap hangs. Compile on Windows, package only static
// Linux binaries. Never starts apps, reads production config or uploads to OSS.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { binaries, hash } = require('./prepare-apps.cjs')
const { assertLocalDocker, validateRuntime } = require('./local.cjs')
const version = 'v3.8.3-patch.15'

function buildEnv(base = process.env, linux = true) {
  return { ...base, GOENV: 'off', GOFLAGS: '', GOPROXY: 'https://goproxy.cn,direct',
    CGO_ENABLED: '0', GOOS: linux ? 'linux' : 'windows', GOARCH: 'amd64', GODEBUG: 'decoratemappings=0' }
}
function validateBinary(bytes) {
  assert.ok(bytes.length > 64)
  assert.deepEqual(bytes.subarray(0, 4), Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
  assert.equal(bytes[4], 2) // ELF64
  assert.equal(bytes[5], 1) // little endian
  assert.equal(bytes.readUInt16LE(18), 62) // x86_64, not Windows PE
}
function run() {
  assert.equal(process.platform, 'win32')
  assert.equal(process.argv.length, 2)
  validateRuntime()
  const context = execFileSync('docker', ['context', 'show'], { encoding: 'utf8' }).trim()
  const endpoint = JSON.parse(execFileSync('docker', ['context', 'inspect', context], { encoding: 'utf8' }))[0].Endpoints.docker.Host
  assertLocalDocker(process.env, context, endpoint)
  const artifacts = path.join(__dirname, 'artifacts')
  const output = path.join(artifacts, 'openim-linux')
  assert.ok(!fs.existsSync(output), 'Preserve previous outputs; refusing overwrite')
  const env = buildEnv()
  const upstream = JSON.parse(execFileSync('go', ['mod', 'download', '-json', `github.com/openimsdk/open-im-server/v3@${version}`], { env, encoding: 'utf8' }))
  assert.equal(upstream.Version, version)
  const checkout = fs.mkdtempSync(path.join(artifacts, 'openim-host-src-'))
  fs.cpSync(upstream.Dir, checkout, { recursive: true, force: false, errorOnExist: true })
  // Module-cache files are read-only. Make only this owned private copy writable.
  function writable(directory) {
    fs.chmodSync(directory, 0o755)
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      assert.ok(!entry.isSymbolicLink())
      if (entry.isDirectory()) writable(file)
      else fs.chmodSync(file, 0o644)
    }
  }
  writable(checkout)
  execFileSync(process.execPath, [path.join(__dirname, 'openim-scope/patch-openim.cjs'), checkout, '--apply'], { env, stdio: 'inherit' })
  execFileSync('go', ['mod', 'tidy'], { cwd: checkout, env, stdio: 'inherit' })
  execFileSync('go', ['test', 'github.com/openimsdk/tools/s3/oss'], { cwd: checkout, env: buildEnv(process.env, false), stdio: 'inherit' })
  fs.mkdirSync(output)
  const files = {}
  for (const name of binaries) {
    const target = path.join(output, `openim-${name}`)
    const pkg = name.startsWith('rpc-') ? `./cmd/openim-rpc/openim-${name}` : `./cmd/openim-${name}`
    console.log(`Cross-compiling openim-${name} (linux/amd64, CGO disabled)`)
    execFileSync('go', ['build', '-trimpath', '-o', target, pkg], { cwd: checkout, env, stdio: 'inherit' })
    const bytes = fs.readFileSync(target)
    validateBinary(bytes)
    files[`openim-${name}`] = hash(bytes)
  }
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ version, platform: 'linux/amd64', files }, null, 2), { flag: 'wx' })
  assert.deepEqual(fs.readdirSync(output).sort(), ['manifest.json', ...binaries.map(n => `openim-${n}`)].sort())
  for (const [name, digest] of Object.entries(files)) {
    const file = path.join(output, name)
    assert.ok(!fs.lstatSync(file).isSymbolicLink())
    assert.equal(hash(fs.readFileSync(file)), digest)
  }
  execFileSync('docker', ['--context', 'desktop-linux', 'build', '-f', path.join(__dirname, 'openim.prebuilt.Dockerfile'),
    '-t', 'im-app-oss-test-openim:v3.8.3-patch.15-scoped', __dirname], { stdio: 'inherit' })
  console.log('Built scoped local test image from validated Linux binaries; no services started or cloud data changed.')
}
if (require.main === module) {
  try { run() } catch {
    console.error('Host cross-build failed/refused; preserve artifacts and inspect the local build log. No configuration or credentials printed.')
    process.exitCode = 1
  }
}
module.exports = { buildEnv, validateBinary }
