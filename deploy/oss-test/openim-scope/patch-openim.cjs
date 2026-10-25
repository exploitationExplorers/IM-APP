#!/usr/bin/env node
'use strict'

// Patch only an explicitly supplied writable test checkout, never the live
// OpenIM checkout, a running container, or Go's immutable module cache.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const pinnedHash = 'fe90471531db01cafe42f33ba9b7c2ec4eb21de3ddb2cf110c2daeba35386422'
const toolsModule = 'github.com/openimsdk/tools'
const toolsVersion = 'v0.0.50-alpha.106'
const ossHash = '95fd2594e55b2e09b382f344561dc6c5c6da56c1a59f7c1395aca4962f013f0a'

function transformOSS(source) {
  if (crypto.createHash('sha256').update(source).digest('hex') !== ossHash) {
    throw new Error('Requires unmodified pinned tools OSS source; refusing unknown/already patched source')
  }
  // NewOSS has no CNAME option in this pinned upstream. Patch a private COPY of
  // that module, not the Go cache. Setting bucketURL alone leaves GET/PUT/HEAD
  // using the regional endpoint (or an invalid bucket.custom-domain host).
  return source.toString('utf8')
    .replace('func NewOSS(conf Config) (*OSS, error) {', `func NewOSS(conf Config) (*OSS, error) {
\tif conf.Endpoint != "https://oss-chat-test.xn--jprz53bj9s.com" || conf.Bucket != "yikeliao-188-hk-test" || strings.TrimSuffix(conf.BucketURL, "/") != conf.Endpoint || conf.PublicRead || conf.SessionToken != "" {
\t\treturn nil, errors.New("test OSS requires the fixed private Hong Kong test bucket and CNAME")
\t}`)
    .replace('oss.New(conf.Endpoint, conf.AccessKeyID, conf.AccessKeySecret)', 'oss.New(conf.Endpoint, conf.AccessKeyID, conf.AccessKeySecret, oss.UseCname(true))')
    // OSS V1 signs Content-Type. H5 infers a file MIME when this header is
    // missing, invalidating the signature. Send the signed header to ALL clients.
    .replace('\t\tnow := time.Now().UTC().Format(http.TimeFormat)', '\t\trequest.Header.Set(oss.HTTPHeaderContentType, "application/octet-stream")\n\t\tnow := time.Now().UTC().Format(http.TimeFormat)')
    .replace('func (o *OSS) PresignedPutObject(ctx context.Context, name string, expire time.Duration, opt *s3.PutOption) (*s3.PresignedPutResult, error) {', `func (o *OSS) PresignedPutObject(ctx context.Context, name string, expire time.Duration, opt *s3.PutOption) (*s3.PresignedPutResult, error) {
\tif opt == nil {
\t\topt = &s3.PutOption{ContentType: "application/octet-stream"}
\t} else if opt.ContentType == "" {
\t\tcopy := *opt
\t\tcopy.ContentType = "application/octet-stream"
\t\topt = &copy
\t}`)
}

function upstreamTools() {
  const result = JSON.parse(execFileSync('go', ['mod', 'download', '-json', `${toolsModule}@${toolsVersion}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  if (result.Version !== toolsVersion || !result.Dir) throw new Error('Pinned tools source unavailable')
  return result.Dir
}

function transform(source) {
  if (crypto.createHash('sha256').update(source).digest('hex') !== pinnedHash) {
    throw new Error('Requires unmodified OpenIM v3.8.3-patch.15 third.go; refusing unknown/already patched source')
  }
  let text = source.toString('utf8')
  text = text.replace('"fmt"', '"fmt"\n\t"os"\n\n\tscopedoss "im-app-openim-oss-scope"')
  text = text.replace('\tmgocli, err :=', `\t// TEST BUILD ONLY: reject production data targets before the first DB call.
\tif config.RpcConfig.Object.Enable == "oss" {
\t\tif os.Getenv("IM_APP_ENV") != "oss-test" || os.Getenv("IM_APP_OSS_TEST_PREFIX") != scopedoss.TestPrefix {
\t\t\treturn fmt.Errorf("scoped OSS requires explicit oss-test environment and prefix")
\t\t}
\t\tm := config.MongodbConfig
\t\tif m.URI != "" || m.Database != "openim_oss_test" || m.AuthSource != "openim_oss_test" || m.Username != "im_oss_test" || len(m.Address) != 1 || (m.Address[0] != "openim-mongodb:27017" && m.Address[0] != "127.0.0.1:27027") {
\t\t\treturn fmt.Errorf("scoped OSS requires isolated test Mongo configuration")
\t\t}
\t\tr := config.RedisConfig
\t\tif len(r.Address) != 1 || (r.Address[0] != "openim-redis:6379" && r.Address[0] != "127.0.0.1:16380") || r.Password == "" {
\t\t\treturn fmt.Errorf("scoped OSS requires isolated test Redis configuration")
\t\t}
\t}
\tmgocli, err :=`)
  text = text.replace('\tuserConn, err :=', `\tif enable == "oss" {
\t\to, err = scopedoss.New(o, os.Getenv("IM_APP_OSS_TEST_PREFIX"), os.Getenv("IM_APP_OSS_TEST_DELETE_ENABLED") == "true")
\t\tif err != nil { return err }
\t}
\tuserConn, err :=`)
  return text
}

function main(args) {
  if (args.length < 1 || args.length > 2 || (args[1] && !['--check', '--apply'].includes(args[1]))) {
    throw new Error('Usage: node patch-openim.cjs <isolated-test-checkout> [--check|--apply]')
  }
  const root = fs.realpathSync(args[0])
  const target = path.join(root, 'internal/rpc/third/third.go')
  const result = transform(fs.readFileSync(target))
  const toolsRoot = upstreamTools()
  const patchedOSS = transformOSS(fs.readFileSync(path.join(toolsRoot, 's3/oss/oss.go')))
  if (args[1] !== '--apply') {
    console.log('Pinned OpenIM and OSS sources compatible; no files changed')
    return
  }
  if (/\/pkg\/mod\//i.test(root.replaceAll('\\', '/'))) throw new Error('Refusing to modify Go module cache')
  const toolsCopy = path.join(root, 'oss-test-tools')
  if (fs.existsSync(toolsCopy)) throw new Error('Preserve existing tools copy; use a fresh isolated checkout')
  fs.cpSync(toolsRoot, toolsCopy, { recursive: true, errorOnExist: true, force: false })
  const ossFile = path.join(toolsCopy, 's3/oss/oss.go')
  fs.chmodSync(path.dirname(ossFile), 0o755)
  fs.chmodSync(ossFile, 0o644)
  fs.writeFileSync(ossFile, patchedOSS)
  fs.copyFileSync(path.join(__dirname, 'contracts/oss_test.go.in'), path.join(toolsCopy, 's3/oss/oss_cname_test.go'))
  execFileSync('go', ['mod', 'edit', `-replace=${toolsModule}=${toolsCopy.replaceAll('\\', '/')}`], { cwd: root, stdio: 'pipe' })
  execFileSync('go', ['mod', 'edit', '-require=im-app-openim-oss-scope@v0.0.0', `-replace=im-app-openim-oss-scope=${__dirname.replaceAll('\\', '/')}`], { cwd: root, stdio: 'pipe' })
  fs.writeFileSync(target, result)
  execFileSync('gofmt', ['-w', target], { stdio: 'pipe' })
  console.log('Patched isolated source only; no build, deployment, DB or OSS access performed')
}

if (require.main === module) {
  try { main(process.argv.slice(2)) } catch (e) { console.error(e.message); process.exitCode = 1 }
}
module.exports = { transform, transformOSS, upstreamTools }
