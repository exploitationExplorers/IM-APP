'use strict'
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')

// Business migration 047 updates two tables owned by admin migration 007, while
// admin migration 001 itself needs business tables. Bootstrap ONLY these two
// empty shared tables from canonical DDL before either application's full run.
function sharedSQL(source = fs.readFileSync(path.resolve(__dirname, '../../IM-APP-admin/migrations/007_admin_config.sql'), 'utf8')) {
  const statements = ['app_configs', 'app_config_versions'].map(name => {
    const matches = [...source.matchAll(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\([\\s\\S]*?\\n\\);`, 'g'))]
    assert.equal(matches.length, 1)
    assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER)\b/i.test(matches[0][0]))
    return matches[0][0]
  })
  return `BEGIN;
DO $$ BEGIN
  IF current_database() <> 'imapp_oss_test' OR current_user <> 'im_oss_test' THEN
    RAISE EXCEPTION 'Shared bootstrap requires isolated test database and role';
  END IF;
END $$;
SELECT pg_advisory_xact_lock(18718443);
${statements.join('\n')}
COMMIT;
`
}
function bootstrapSharedConfig() {
  // Called only AFTER local.cjs verifies the local Desktop context/config.
  const args = ['--context', 'desktop-linux']
  const id = execFileSync('docker', [...args, 'ps', '-q', '--filter', 'label=com.docker.compose.project=im-app-oss-test', '--filter', 'label=com.docker.compose.service=postgres'], { encoding: 'utf8' }).trim()
  assert.match(id, /^[a-f0-9]{12,64}$/)
  const c = JSON.parse(execFileSync('docker', [...args, 'inspect', id], { encoding: 'utf8' }))[0]
  assert.equal(c.Config.Labels['im.app.environment'], 'oss-test')
  assert.ok(c.Config.Env.includes('POSTGRES_DB=imapp_oss_test'))
  assert.ok(c.Config.Env.includes('POSTGRES_USER=oss_test_admin'))
  execFileSync('docker', [...args, 'exec', '-i', id, 'sh', '-c',
    'PGPASSWORD="$TEST_PG_APP_PASSWORD" psql -h 127.0.0.1 -U im_oss_test -d imapp_oss_test -v ON_ERROR_STOP=1 -q'],
  { input: sharedSQL(), stdio: ['pipe', 'pipe', 'pipe'] })
  console.log('Verified local test database; shared config schema bootstrapped without changing existing rows.')
}
module.exports = { sharedSQL, bootstrapSharedConfig }
