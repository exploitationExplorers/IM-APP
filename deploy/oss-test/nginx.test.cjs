'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const config = fs.readFileSync(path.join(__dirname, 'nginx.conf'), 'utf8')

test('OpenIM test upstream is initialized before rewrite break can skip set', () => {
  const block = config.match(/location \/openim-api\/ \{([\s\S]*?)\n    \}/)?.[1]
  assert.ok(block)
  const set = block.indexOf('set $openim_api http://openim-api:10002;')
  const rewrite = block.indexOf('rewrite ^/openim-api/(.*)$ /$1 break;')
  assert.ok(set >= 0 && rewrite > set, 'break must not skip upstream initialization')
  assert.match(block, /proxy_pass \$openim_api\$uri\$is_args\$args;/)
  assert.match(block, /proxy_set_header X-Request-Api https:\/\/localhost:18443\/openim-api;/)
  assert.match(block, /proxy_set_header Host \$http_host;/)
})

test('test gateway keeps local Docker upstreams, TLS and no sensitive access logs', () => {
  assert.match(config, /resolver 127\.0\.0\.11 valid=5s;/)
  assert.match(config, /access_log off;/)
  assert.match(config, /ssl_protocols TLSv1\.2 TLSv1\.3;/)
  const upstreams = [...config.matchAll(/set \$\w+ (https?:\/\/[^;]+);/g)].map(m => m[1])
  assert.deepEqual([...new Set(upstreams)].sort(), [
    'http://admin:8090', 'http://api:8080', 'http://openim-api:10002', 'http://openim-msggateway:10001',
  ].sort())
  assert.ok(!/proxy_ssl_verify\s+off|access_log\s+\/|https?:\/\/(?:[0-9]{1,3}\.){3}/.test(config))
})
