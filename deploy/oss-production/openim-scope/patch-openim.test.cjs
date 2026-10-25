// 跨文件契约测试：锁定「补丁脚本 ↔ scope.go ↔ GC 补丁锚点 ↔ 部署脚本」四处不会脱钩。
// 背景：2026-10-21 曾因为 scope.go 的 New() 改成 4 参、而 patch-openim.cjs 仍是 3 参，
// 导致 openim 镜像编译不过。这类问题 go 编译器发现不了（它发生在 patch 阶段之后），
// 只能靠这类契约测试提前拦住。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { SCOPED_NEW } = require('./patch-openim.cjs')

const root = __dirname
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8')

test('scopedoss.New is called with the CDN base environment variable', () => {
  assert.match(SCOPED_NEW, /scopedoss\.New\(/)
  // 贪婪匹配到「本行最后一个 )」：参数里有 os.Getenv("...")，非贪婪会在第一个 ) 就截断。
  const args = SCOPED_NEW.match(/scopedoss\.New\((.*)\)\n/)[1].split(',').map(s => s.trim())
  assert.deepEqual(args, [
    'o',
    'os.Getenv("IM_APP_OSS_PREFIX")',
    'os.Getenv("IM_APP_CHAT_CDN_BASE")',
    'false',
  ], 'scopedoss.New 的参数必须是 4 个，第 3 个是聊天桶 CDN 基址')
})

test('GC patch anchor still matches the emitted snippet', () => {
  // openim-retention/patch-object-gc.cjs 用 once() 锚定这段文本；
  // 改 SCOPED_NEW 的开头就必须同步改那边，否则 GC 补丁会抛"锚点变了"。
  const anchor = '\to, err = scopedoss.New('
  assert.ok(SCOPED_NEW.startsWith(anchor), 'SCOPED_NEW 必须以 GC 补丁的锚点开头')
  const gc = read('..', '..', 'openim-retention', 'patch-object-gc.cjs')
  // 注意：比对的是「文件里的字面文本」，那里的 \t 是反斜杠+t 两个字符，
  // 不能用真实制表符去 includes。
  const literal = anchor.replace('\t', '\\t')
  assert.ok(gc.includes(`once(s,'${literal}',`), 'patch-object-gc.cjs 的锚点已漂移')
})

test('scope.go New signature has the same arity as the patch call', () => {
  const source = read('scope.go')
  const signature = source.match(/\nfunc New\(([^)]*)\)/)
  assert.ok(signature, 'scope.go 里找不到 func New')
  const params = signature[1].split(',').map(s => s.trim()).filter(Boolean)
  assert.equal(params.length, 4, `scope.go 的 New 应为 4 参，实际 ${params.length}: ${params.join(' | ')}`)
  assert.match(params[2], /^cdnBase\s+string$/, '第 3 参必须是 cdnBase string')
  assert.ok(/allowDelete bool/.test(params[3]), '第 4 参必须是 allowDelete bool')
})

test('CDN base stays optional: empty value must fall back, never fail startup', () => {
  const source = read('scope.go')
  // 空基址必须被放行（回退到上游签名直链），否则少配一个环境变量 openim 就起不来。
  assert.match(source, /if raw == "" \{[\s\S]*?return "", nil/)
  // AccessURL 里必须有对应的回退分支。
  assert.match(source, /if s\.cdnBase == "" \{[\s\S]*?s\.delegate\.AccessURL\(ctx, key, expire, opt\)/)
})

test('deployment scripts inject and verify the CDN base', () => {
  const deploy = read('..', 'deploy-production-oss.py')
  const verify = read('..', 'verify-production-oss.py')
  assert.match(deploy, /IM_APP_CHAT_CDN_BASE=CHAT_CDN_BASE/, 'deploy-production-oss.py 必须注入该变量')
  assert.match(deploy, /CHAT_CDN_BASE = os\.environ\.get\("IM_APP_CHAT_CDN_BASE", ""\)/, '默认必须为空（保持不上线）')
  assert.match(verify, /IM_APP_CHAT_CDN_BASE/, 'verify-production-oss.py 必须校验该变量')
  // 默认值必须是空字符串：不显式开启就等于没改，行为与今天逐字节一致。
  assert.match(deploy, /# .*留空 = 关闭|留空 = 关闭/)
})

test('every retention .go.in template calls scopedoss.New with 4 args', () => {
  // 2026-10-21 踩坑：New() 从 3 参改成 4 参时，只同步了 patch-openim.cjs 和
  // scope_test.go，漏了 GC 的测试模板 object_gc_store_test.go.in，构建直接挂在编译期。
  // 逐个模板扫一遍，杜绝「改签名漏文件」—— 这是 go 编译器在 patch 阶段之后才发现、
  // 平时 CI 看不见的死角。
  const dir = path.join(root, '..', '..', 'openim-retention')
  const templates = fs.readdirSync(dir).filter(name => name.endsWith('.go.in') || name.endsWith('.go'))
  assert.ok(templates.length > 0, 'openim-retention 里应能扫到 .go.in 模板')
  let checked = 0
  for (const name of templates) {
    const source = fs.readFileSync(path.join(dir, name), 'utf8')
    for (const call of source.match(/scopedoss\.New\([^\n]*\)/g) || []) {
      const args = call.match(/scopedoss\.New\((.*)\)/)[1].split(',').map(s => s.trim())
      checked++
      assert.equal(args.length, 4, `${name} 的 scopedoss.New 应为 4 参，实际 ${args.length}: ${call}`)
    }
  }
  assert.ok(checked > 0, '至少要扫到一处 scopedoss.New 调用，否则这条测试形同虚设')
})

test('the live openim compose overlay declares the CDN base with an empty default', () => {
  // 生产 openim-api 走 retention 的 compose 栈，光在 .env 里写值不会传给容器，
  // 必须在 environment 里显式声明；`${VAR:-}` 保证未配置时解析为空 → 回退到签名直链。
  const bridge = JSON.parse(read('..', '..', 'openim-retention', 'openim.bridge.compose.json'))
  const env = bridge?.services?.['openim-api']?.environment
  assert.ok(env, 'openim.bridge.compose.json 缺少 openim-api.environment')
  assert.equal(env.IM_APP_CHAT_CDN_BASE, '${IM_APP_CHAT_CDN_BASE:-}',
    '必须在 environment 声明 IM_APP_CHAT_CDN_BASE，且默认值为空（不留空会让容器拿到字面量而误上线）')
  // 这个键必须在 release 包里，否则 build-release 打出来的包不含它。
  const release = read('..', '..', 'openim-retention', 'build-release.cjs')
  assert.match(release, /productionFiles = \[[^\]]*'openim\.bridge\.compose\.json'/,
    'openim.bridge.compose.json 必须在 productionFiles 清单里才会被打进 release 包')
})
