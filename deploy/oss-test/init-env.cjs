#!/usr/bin/env node
const { randomBytes } = require('node:crypto')
const { readFileSync, writeFileSync } = require('node:fs')
const path = require('node:path')

// Never load process credentials or any existing application / production .env.
function initializeEnv(directory = __dirname) {
  const template = readFileSync(path.join(directory, '.env.example'), 'utf8')
  const outputPath = path.join(directory, '.env')
  const output = template.replace(/^(TEST_[A-Z_]+)=replace_with_test_only_(?:secret|access_key)$/gm,
    (_line, key) => {
      // MinIO credentials use the conventional 20 / 40 character lengths.
      const bytes = key.endsWith('_MINIO_ACCESS_KEY') ? 10
        : key.endsWith('_MINIO_SECRET_KEY') ? 20 : 32
      return `${key}=${randomBytes(bytes).toString('hex')}`
    })

  // Exclusive creation protects a running test environment from secret rotation.
  writeFileSync(outputPath, output, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  return outputPath
}

if (require.main === module) {
  try {
    console.log(`Created ${initializeEnv()}; no containers or databases were started.`)
  } catch (error) {
    if (error.code === 'EEXIST') {
      console.error('Test .env already exists; preserved without modification.')
    } else {
      console.error(`Unable to create test .env (${error.code || 'unknown error'}).`)
    }
    process.exitCode = 1
  }
}

module.exports = { initializeEnv }
