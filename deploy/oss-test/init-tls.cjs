#!/usr/bin/env node
'use strict'
// Creates a dedicated LOCAL CA and localhost certificate, but never installs trust.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { validateTLS } = require('./local.cjs')
function main() {
  assert.equal(process.argv.length, 2)
  assert.equal(process.platform, 'win32', 'This launcher targets Windows Docker Desktop')
  const directory = path.join(__dirname, 'private/tls')
  for (const file of ['localhost.pem', 'localhost-key.pem']) assert.ok(!fs.existsSync(path.join(directory, file)), 'Preserve existing test certificates')
  const tools = path.join(__dirname, 'artifacts/tools')
  const binary = path.join(tools, 'mkcert.exe')
  fs.mkdirSync(tools, { recursive: true })
  if (!fs.existsSync(binary)) execFileSync('go', ['install', 'filippo.io/mkcert@v1.4.4'], { env: { ...process.env, GOBIN: tools }, stdio: 'pipe' })
  fs.mkdirSync(path.join(directory, 'ca'), { recursive: true, mode: 0o700 })
  execFileSync(binary, ['-cert-file', path.join(directory, 'localhost.pem'), '-key-file', path.join(directory, 'localhost-key.pem'), 'localhost', '127.0.0.1', '::1'], { env: { ...process.env, CAROOT: path.join(directory, 'ca') }, stdio: 'pipe' })
  validateTLS(directory)
  console.log('Created dedicated local test certificates. System/browser trust was NOT modified; follow the manual trust step. Never share private/tls/ca/rootCA-key.pem.')
}
if (require.main === module) {
  try { main() } catch { console.error('Local certificate preparation refused; preserve existing certificates, check Go/network and read the manual.'); process.exitCode = 1 }
}
