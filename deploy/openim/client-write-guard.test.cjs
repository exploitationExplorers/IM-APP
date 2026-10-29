'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const configs = ['nginx/yikeliao.com.conf', 'deploy/baota/im-app.conf', 'deploy/oss-test/nginx.conf']
const blocked = [
  '/openim-api/friend/add_friend', '/openim-api/friend/add_friend_response', '/openim-api/friend/import_friend',
  '/openim-api/group/create_group', '/openim-api/group/invite_user_to_group', '/openim-api/group/join_group',
]
const allowed = [
  '/openim-api/friend/get_friend_list', '/openim-api/group/get_group_info', '/openim-api/group/get_group_members',
  '/openim-api/msg/send_msg', '/openim-api/msg/pull_msg_by_seq', '/openim-api/auth/user_token',
  '/openim-api/object/access_url', '/openim-api/conversation/get_conversations',
  '/api/v1/friend-requests', '/api/v1/groups', '/openim-ws',
  '/friend/import_friend', '/group/create_group', '/group/invite_user_to_group', '/group/join_group',
]

for (const filename of configs) {
  test(`${filename}: exact public relationship writes are rejected before forwarding`, () => {
    const config = fs.readFileSync(path.join(root, filename), 'utf8')
    const locationAt = config.search(/location (?:\^~ )?\/openim-api\/ \{/)
    assert.ok(locationAt >= 0, 'missing existing OpenIM proxy location')
    const location = config.slice(locationAt)
    const guard = location.match(/if \(\$uri ~\* "([^"]+)"\) \{\s*return 403;\s*\}/)
    assert.ok(guard, 'guard must inspect normalized $uri and only return 403')
    const forwardAt = location.search(/(?:rewrite |proxy_pass )/)
    assert.ok(guard.index < forwardAt, 'guard must run before rewrite break or proxying')
    const pattern = new RegExp(guard[1], 'i')
    for (const route of blocked) {
      assert.ok(pattern.test(route), `${route} must be denied`)
      assert.ok(pattern.test(`${route}/`), `${route}/ must be denied`)
      assert.ok(pattern.test(route.toUpperCase()), `${route} case variants must be denied`)
    }
    for (const route of allowed) assert.equal(pattern.test(route), false, `${route} must stay available`)
    assert.equal(pattern.test('/openim-api/group/join_group_status'), false, 'unrelated path prefix must not match')
  })
}

test('legacy Docker template does not expose the raw OpenIM API publicly', () => {
  const config = fs.readFileSync(path.join(root, 'IM-APP-server/deploy/openim/docker-compose.yml'), 'utf8')
  assert.match(config, /"127\.0\.0\.1:10002:10002"/)
  assert.doesNotMatch(config, /"(?:0\.0\.0\.0:)?10002:10002"/)
})
