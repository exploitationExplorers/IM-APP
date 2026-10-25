'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const upstream = require('../../oss-test/openim-scope/patch-openim.cjs')
const thirdHash = 'fe90471531db01cafe42f33ba9b7c2ec4eb21de3ddb2cf110c2daeba35386422'
const s3Hash = '251ede021211dd4ada70bd63d61517bd803bb64a4fac095c35adb4778d0db7ae'
const hash = b => crypto.createHash('sha256').update(b).digest('hex')

// 单独导出，供 patch-openim.test.cjs 做跨文件契约校验：
// openim-retention/patch-object-gc.cjs 用 `once(s, '\to, err = scopedoss.New(', ...)`
// 锚定这段文本，改这里必须同步改那边，否则 GC 补丁会直接抛"锚点变了"。
const SCOPED_NEW = `\to, err = scopedoss.New(o, os.Getenv("IM_APP_OSS_PREFIX"), os.Getenv("IM_APP_CHAT_CDN_BASE"), false)
\tif err != nil { return err }
\tuserConn, err :=`

function transformThird(source) {
  if (hash(source) !== thirdHash) throw new Error('Requires unmodified pinned third.go')
  return source.toString('utf8')
    .replace('"fmt"', '"fmt"\n\t"os"\n\tscopedoss "im-app-openim-oss-production-scope"')
    .replace('\tmgocli, err :=', `\tif os.Getenv("IM_APP_ENV") != "oss-production" || config.RpcConfig.Object.Enable != "oss" || os.Getenv("IM_APP_OSS_PREFIX") != scopedoss.ProductionPrefix {
\t\treturn fmt.Errorf("production OSS build requires explicit environment, engine and prefix")
\t}
\tmgocli, err :=`)
    // 第 3 个参数是聊天桶的 CDN 基址，来自环境变量 IM_APP_CHAT_CDN_BASE。
    // 留空即走 scopedoss 的回退分支（签名直连 OSS），行为与不打这个补丁时一致，
    // 所以不配该变量也不会让 openim-rpc-third 起不来。
    .replace('\tuserConn, err :=', SCOPED_NEW)
}
function transformS3(source) {
  if (hash(source) !== s3Hash) throw new Error('Requires unmodified pinned third/s3.go')
  return source.toString('utf8').replace('"path"', '"path"\n\t"os"')
    .replace('engine := t.config.RpcConfig.Object.Enable', `if os.Getenv("IM_APP_ENV") == "oss-production" {
\t\treturn nil, errs.ErrNoPermission.WrapMsg("object cleanup disabled during OSS cutover")
\t}
\tengine := t.config.RpcConfig.Object.Enable`)
}
function apply(root) {
  root = fs.realpathSync(root)
  if (/\/pkg\/mod\//i.test(root.replaceAll('\\', '/'))) throw new Error('Refusing module cache')
  const third = path.join(root, 'internal/rpc/third/third.go')
  const s3 = path.join(root, 'internal/rpc/third/s3.go')
  const a = transformThird(fs.readFileSync(third)), b = transformS3(fs.readFileSync(s3))
  const tools = upstream.upstreamTools()
  const oss = upstream.transformOSS(fs.readFileSync(path.join(tools, 's3/oss/oss.go')))
    .replace('test OSS requires the fixed private Hong Kong test bucket and CNAME', 'production OSS requires the fixed private Hong Kong bucket and CNAME')
  const copy = path.join(root, 'production-tools')
  if (fs.existsSync(copy)) throw new Error('Requires a fresh checkout')
  fs.cpSync(tools, copy, { recursive: true, force: false, errorOnExist: true })
  const target = path.join(copy, 's3/oss/oss.go')
  fs.chmodSync(path.dirname(target), 0o755); fs.chmodSync(target, 0o644)
  fs.writeFileSync(target, oss)
  fs.copyFileSync(path.join(__dirname, '../../oss-test/openim-scope/contracts/oss_test.go.in'), path.join(copy, 's3/oss/oss_cname_test.go'))
  execFileSync('go', ['mod', 'edit', `-replace=github.com/openimsdk/tools=${copy.replaceAll('\\', '/')}`], { cwd: root })
  execFileSync('go', ['mod', 'edit', '-require=im-app-openim-oss-production-scope@v0.0.0', `-replace=im-app-openim-oss-production-scope=${__dirname.replaceAll('\\', '/')}`], { cwd: root })
  fs.writeFileSync(third, a); fs.writeFileSync(s3, b)
  execFileSync('gofmt', ['-w', third, s3])
}
module.exports = { apply, transformThird, transformS3, SCOPED_NEW }
if (require.main === module) apply(process.argv[2])
