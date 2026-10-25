#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { testFrontendConfig } = require('./frontend-vite.cjs')

function frontendCommand(action, exists = fs.existsSync) {
  assert.ok(['client-build', 'client-dev', 'admin-build', 'admin-dev', 'app-resources'].includes(action), 'Unknown frontend action')
  const admin = action.startsWith('admin-')
  const build = action.endsWith('-build') || action === 'app-resources'
  const root = path.resolve(__dirname, '../..', admin ? 'IM-APP-system' : 'IM-APP-fronend')
  const cli = path.join(root, 'node_modules', admin ? 'vite/bin/vite.js' : '@dcloudio/vite-plugin-uni/bin/uni.js')
  assert.ok(exists(cli), 'Install the frontend dependencies with npm ci first')
  const output = path.join(__dirname, 'artifacts', admin ? 'admin-web' : action === 'app-resources' ? 'app-resources' : 'front-h5')
  assert.ok(path.relative(path.join(__dirname, 'artifacts'), output) && !path.relative(path.join(__dirname, 'artifacts'), output).startsWith('..'))
  const args = [cli, ...(build ? ['build'] : []), ...(action === 'app-resources' ? ['-p', 'app-plus'] : []), '--mode', 'oss-test']
  return { root, args, env: { ...process.env, UNI_OUTPUT_DIR: output, UNI_APP_X_CACHE_DIR: path.join(__dirname, 'artifacts/frontend-cache'), NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS } }
}
function main() {
  assert.equal(process.argv.length, 3)
  const action = process.argv[2]
  assert.ok(!Object.keys(process.env).some(k => /^(VITE_|UNI_|IM_APP_)/.test(k)), 'Unset inherited frontend build overrides')
  testFrontendConfig(action.startsWith('admin') ? 'admin' : 'client')
  const command = frontendCommand(action)
  // Uses local CLI only; never invokes pack-wgt, npm publish, or upload helpers.
  const result = spawnSync(process.execPath, command.args, { cwd: command.root, env: command.env, stdio: 'inherit' })
  return result.status ?? 1
}
if (require.main === module) {
  try { process.exitCode = main() } catch { console.error('Frontend test command refused: check dependencies, prepared local configuration and shell build overrides.'); process.exitCode = 1 }
}
module.exports = { frontendCommand }
