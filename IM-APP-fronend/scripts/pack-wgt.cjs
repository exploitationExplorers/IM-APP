#!/usr/bin/env node
/**
 * 打 uni-app 资源包 (.wgt)，可选发布到业务后端供客户热更新。
 *
 *   node scripts/pack-wgt.cjs
 *   node scripts/pack-wgt.cjs --build
 *   node scripts/pack-wgt.cjs --build --publish --min-native=100
 *   node scripts/pack-wgt.cjs --publish --file=unpackage/release/im-101.wgt --changelog=修复气泡错位
 *
 * --min-native 必须等于客户当前安装的 APK versionCode。
 */
const crypto = require('crypto')
const dns = require('dns')
const fs = require('fs')
const http = require('http')
const https = require('https')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')
const { URL } = require('url')

/** 本机 DNS 常把 www.ke58.com 指到 CDN（证书不匹配）；发布必须打源站。可用 IM_APP_ORIGIN_IP 覆盖。 */
const ORIGIN_PIN_IP = process.env.IM_APP_ORIGIN_IP || '8.210.72.157'
const ORIGIN_PIN_HOSTS = new Set(['www.ke58.com', 'ke58.com'])

const root = path.resolve(__dirname, '..')
const manifestPath = path.join(root, 'src', 'manifest.json')
/** uni-cli（Vite）产物在 dist/build/app；旧 HBuilderX / 部分版本写在 app-plus */
function resolveDistDir() {
  const candidates = [
    path.join(root, 'dist', 'build', 'app'),
    path.join(root, 'dist', 'build', 'app-plus'),
  ]
  const existing = candidates.filter((dir) => fs.existsSync(path.join(dir, 'manifest.json')))
  if (!existing.length) return candidates[0]
  existing.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return existing[0]
}
const releaseDir = path.join(root, 'unpackage', 'release')

function parseArgs(argv) {
  const args = {
    build: false,
    bump: true,
    publish: false,
    force: false,
    minNative: '',
    changelog: '',
    channel: 'test',
    platform: 'android',
    file: '',
    api: '',
    key: '',
    packageType: 'wgt',
  }
  for (const raw of argv.slice(2)) {
    if (raw === '--build') args.build = true
    else if (raw === '--no-bump') args.bump = false
    else if (raw === '--publish') args.publish = true
    else if (raw === '--force') args.force = true
    else if (raw.startsWith('--min-native=')) args.minNative = raw.slice('--min-native='.length)
    else if (raw.startsWith('--changelog=')) args.changelog = raw.slice('--changelog='.length)
    else if (raw.startsWith('--channel=')) args.channel = raw.slice('--channel='.length)
    else if (raw.startsWith('--platform=')) args.platform = raw.slice('--platform='.length)
    else if (raw.startsWith('--file=')) args.file = raw.slice('--file='.length)
    else if (raw.startsWith('--api=')) args.api = raw.slice('--api='.length)
    else if (raw.startsWith('--key=')) args.key = raw.slice('--key='.length)
    else if (raw.startsWith('--type=')) args.packageType = raw.slice('--type='.length)
    else {
      throw new Error(`未知参数: ${raw}`)
    }
  }
  return args
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const out = {}
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const cut = line.indexOf('=')
    if (cut <= 0) continue
    const key = line.slice(0, cut).trim().replace(/^\uFEFF/, '')
    const value = line.slice(cut + 1).trim().replace(/^['"]|['"]$/g, '')
    out[key] = value
  }
  return out
}

function readManifestVersion(source) {
  const codeMatch = source.match(/"versionCode"\s*:\s*"(\d+)"/)
  const nameMatch = source.match(/"versionName"\s*:\s*"([^"]+)"/)
  if (!codeMatch || !nameMatch) {
    throw new Error('无法从 src/manifest.json 读取 versionName / versionCode')
  }
  return { versionCode: Number.parseInt(codeMatch[1], 10), versionName: nameMatch[1] }
}

function bumpPatch(versionName) {
  const parts = versionName.split('.')
  const last = Number.parseInt(parts[parts.length - 1] || '0', 10)
  parts[parts.length - 1] = String(Number.isFinite(last) ? last + 1 : 1)
  return parts.join('.')
}

function zipDir(srcDir, destFile) {
  fs.mkdirSync(path.dirname(destFile), { recursive: true })
  const zipFile = destFile.replace(/\.wgt$/i, '.zip')
  if (fs.existsSync(zipFile)) fs.unlinkSync(zipFile)
  if (fs.existsSync(destFile)) fs.unlinkSync(destFile)
  const script =
    'import os, sys, zipfile\nsrc, dst = sys.argv[1], sys.argv[2]\nwith zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:\n    for root, _, files in os.walk(src):\n        for name in files:\n            full = os.path.join(root, name)\n            rel = os.path.relpath(full, src).replace(os.sep, "/")\n            z.write(full, rel)\n'
  const pyCmds = process.platform === 'win32' ? [['py', '-3'], ['python'], ['python3']] : [['python3'], ['python']]
  let packed = false
  for (const [cmd, ...prefix] of pyCmds) {
    const result = spawnSync(cmd, [...prefix, '-c', script, srcDir, zipFile], { stdio: 'inherit' })
    if (result.status === 0 && fs.existsSync(zipFile)) {
      packed = true
      break
    }
  }
  if (!packed) {
    throw new Error('打包 wgt 失败：需要 Python 把资源打成根目录含 manifest.json 的 zip')
  }
  fs.renameSync(zipFile, destFile)
}

function syncDistWidgetVersion(distDir, versionName, versionCode) {
  const distManifestPath = path.join(distDir, 'manifest.json')
  const json = JSON.parse(fs.readFileSync(distManifestPath, 'utf8'))
  json.version = { ...(json.version || {}), name: versionName, code: String(versionCode) }
  fs.writeFileSync(distManifestPath, `${JSON.stringify(json, null, 2)}\n`)
}

function readPackedWidgetVersion(wgtPath) {
  for (const entry of ['manifest.json', './manifest.json']) {
    const extracted = spawnSync('tar', ['-xOf', wgtPath, entry], { encoding: 'utf8' })
    if (extracted.status !== 0 || !extracted.stdout) continue
    const json = JSON.parse(extracted.stdout)
    const versionCode = Number.parseInt(String(json.version?.code || ''), 10)
    const versionName = String(json.version?.name || '')
    if (!versionName || !Number.isFinite(versionCode) || versionCode <= 0) {
      throw new Error(`wgt 内 manifest.json 版本无效: ${entry}`)
    }
    return { versionName, versionCode, appid: String(json.id || '') }
  }
  throw new Error('wgt 根目录没有 manifest.json，热更新会安装成功但不会生效')
}

function resolveApiBase(raw) {
  const value = String(raw || '').trim().replace(/\/$/, '')
  if (!value) return ''
  if (/\/api\/v1$/i.test(value)) return value
  return `${value}/api/v1`
}

function pinnedLookup(hostname, options, callback) {
  if (ORIGIN_PIN_HOSTS.has(hostname)) {
    const record = { address: ORIGIN_PIN_IP, family: 4 }
    if (options && options.all) callback(null, [record])
    else callback(null, ORIGIN_PIN_IP, 4)
    return
  }
  dns.lookup(hostname, options, callback)
}

function requestBuffer(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const lib = target.protocol === 'https:' ? https : http
    const req = lib.request(
      {
        method,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        headers,
        lookup: pinnedLookup,
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            body: Buffer.concat(chunks),
          })
        })
      },
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest()
}

async function putObjectMinio({ endpoint, accessKey, secretKey, bucket, objectKey, body, region = 'us-east-1' }) {
  const target = new URL(endpoint)
  const host = target.host
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = sha256Hex(body)
  const canonicalUri = `/${bucket}/${objectKey.split('/').map(encodeURIComponent).join('/')}`
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = ['PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n')
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), 's3'), 'aws4_request')
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')
  return requestBuffer(`${target.origin}${canonicalUri}`, {
    method: 'PUT',
    headers: {
      Host: host,
      'Content-Length': String(body.length),
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  })
}

async function apiJson(origin, key, method, pathname, body) {
  const url = `${origin}${pathname}`
  let res
  try {
    const payload = body ? Buffer.from(JSON.stringify(body)) : undefined
    res = await requestBuffer(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-API-Key': key,
        ...(payload ? { 'Content-Length': String(payload.length) } : {}),
      },
      body: payload,
    })
  } catch (err) {
    throw new Error(`请求 ${url} 失败: ${err instanceof Error ? err.message : err}`)
  }
  const text = res.body.toString('utf8')
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`接口返回非 JSON (${res.status}): ${text.slice(0, 200)}`)
  }
  if (!res.ok || parsed.code !== 0) {
    throw new Error(parsed.message || `接口失败 (${res.status})`)
  }
  return parsed.data
}

async function publishRelease(args, filePath, versionName, versionCode) {
  const frontendEnv = loadDotEnv(path.join(root, '.env'))
  const serverEnv = loadDotEnv(path.join(root, '..', 'IM-APP-server', '.env'))
  const origin = resolveApiBase(
    args.api ||
      process.env.IM_APP_API_ORIGIN ||
      frontendEnv.VITE_API_BASE_URL ||
      serverEnv.PUBLIC_API_BASE_URL,
  )
  const key = args.key || process.env.IM_INTERNAL_API_KEY || serverEnv.IM_INTERNAL_API_KEY
  if (!origin) throw new Error('发布需要 --api=https://你的域名 或配置 VITE_API_BASE_URL')
  if (!key) throw new Error('发布需要 --key 或 IM-APP-server/.env 中的 IM_INTERNAL_API_KEY')
  if (args.packageType === 'wgt') {
    const packed = readPackedWidgetVersion(filePath)
    if (packed.versionCode !== versionCode || packed.versionName !== versionName) {
      throw new Error(
        `wgt 内是 ${packed.versionName} (${packed.versionCode})，不能按 ${versionName} (${versionCode}) 发布`,
      )
    }
    console.log(`wgt 校验通过: ${packed.appid} ${packed.versionName} (${packed.versionCode})`)
  }
  console.log(`正在发布到 ${origin}`)

  const fileName = path.basename(filePath)
  const upload = await apiJson(origin, key, 'POST', '/admin/app-releases/uploads', {
    platform: args.platform,
    packageType: args.packageType,
    fileName,
  })
  const buf = fs.readFileSync(filePath)
  let putRes
  try {
    putRes = await requestBuffer(upload.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Length': String(buf.length) },
      body: buf,
    })
  } catch (err) {
    putRes = { ok: false, status: 0, error: err }
  }
  if (!putRes.ok) {
    const minioEndpoint =
      process.env.IM_APP_MINIO_ENDPOINT || `http://${ORIGIN_PIN_IP}:9000`
    const accessKey = serverEnv.MINIO_ACCESS_KEY
    const secretKey = serverEnv.MINIO_SECRET_KEY
    const bucket = serverEnv.MINIO_BUCKET || 'im-uploads'
    if (!accessKey || !secretKey) {
      throw new Error(`上传 MinIO 失败 (${putRes.status})，且未配置 MINIO_ACCESS_KEY`)
    }
    console.log(`预签名 PUT 不可用 (${putRes.status})，改走源站 MinIO ${minioEndpoint}`)
    putRes = await putObjectMinio({
      endpoint: minioEndpoint,
      accessKey,
      secretKey,
      bucket,
      objectKey: upload.objectKey,
      body: buf,
    })
  }
  if (!putRes.ok) {
    throw new Error(`上传 MinIO 失败 (${putRes.status})`)
  }

  const payload = {
    platform: args.platform,
    channel: args.channel,
    versionName,
    versionCode,
    packageType: args.packageType,
    objectKey: upload.objectKey,
    changelog: args.changelog,
    forceUpdate: args.force,
  }
  if (args.minNative !== '') {
    payload.minNativeVersion = Number.parseInt(args.minNative, 10)
    if (!Number.isFinite(payload.minNativeVersion) || payload.minNativeVersion < 0) {
      throw new Error('--min-native 必须是 >= 0 的整数')
    }
  }
  const published = await apiJson(origin, key, 'POST', '/admin/app-releases', payload)
  console.log(`已发布 ${published.packageType} ${published.versionName} (${published.versionCode})`)
  console.log(published.downloadUrl)
}

async function main() {
  const args = parseArgs(process.argv)
  let manifest = fs.readFileSync(manifestPath, 'utf8')
  let { versionCode, versionName } = readManifestVersion(manifest)

  if (args.build) {
    if (args.bump) {
      versionCode += 1
      versionName = bumpPatch(versionName)
      manifest = manifest
        .replace(/"versionName"\s*:\s*"[^"]+"/, `"versionName" : "${versionName}"`)
        .replace(/"versionCode"\s*:\s*"\d+"/, `"versionCode" : "${versionCode}"`)
      fs.writeFileSync(manifestPath, manifest)
      console.log(`已提升版本: ${versionName} (${versionCode})`)
    }
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    execFileSync(npmCmd, ['run', 'build:app'], { cwd: root, stdio: 'inherit', shell: true })
  }

  const distDir = resolveDistDir()
  console.log(`使用构建产物目录: ${distDir}`)

  let filePath = args.file ? path.resolve(root, args.file) : ''
  if (args.packageType === 'wgt' && !filePath) {
    if (!fs.existsSync(path.join(distDir, 'manifest.json'))) {
      throw new Error(`未找到 ${distDir}，请先加 --build 或使用 HBuilderX 打自定义基座资源`)
    }
    syncDistWidgetVersion(distDir, versionName, versionCode)
    const serviceJs = path.join(distDir, 'app-service.js')
    if (fs.existsSync(serviceJs)) {
      const bundled = fs.readFileSync(serviceJs, 'utf8')
      if (bundled.includes('video-thumb-video')) {
        throw new Error(
          `构建产物仍含旧版视频黑块组件(video-thumb-video)：${distDir}。请确认已重新 --build，且脚本选中了最新的 dist/build/app`,
        )
      }
    }
    filePath = path.join(releaseDir, `im-${versionCode}.wgt`)
    zipDir(distDir, filePath)
    console.log(`wgt 已生成: ${filePath}`)
  }
  if (args.publish) {
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error('发布需要已生成的安装包，请加 --build 或 --file')
    }
    await publishRelease(args, filePath, versionName, versionCode)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
