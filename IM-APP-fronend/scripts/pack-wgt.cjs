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
const zlib = require('zlib')
const { execFileSync, spawnSync } = require('child_process')
const { URL } = require('url')

/**
 * 源站 IP 固定。当前线上是 8.154.44.197，纯 IP、无域名 —— 请求本来就直连 IP，
 * 所以 pin 逻辑默认空转（见 pinnedLookup），只在 IM_APP_ORIGIN_PIN_HOSTS 非空时生效。
 *
 * 留着这套机制，是为了哪天给源站前面挂 CDN / 域名时，能继续绕过「域名解析到 CDN
 * 但证书在源站」的问题：把域名填进 IM_APP_ORIGIN_PIN_HOSTS（逗号分隔）即可，
 * 例：IM_APP_ORIGIN_PIN_HOSTS=im.example.com
 *
 * 可用 IM_APP_ORIGIN_IP 覆盖源站 IP。
 */
const ORIGIN_PIN_IP = process.env.IM_APP_ORIGIN_IP || '8.154.44.197'
const ORIGIN_PIN_HOSTS = new Set(
  String(process.env.IM_APP_ORIGIN_PIN_HOSTS || '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean),
)

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

// ── 最小 ZIP 写入器 ────────────────────────────────────────────────────────
//
// 为什么自己写、不再调外部命令：
//   · Python：本机很可能只有微软商店的 python.exe 占位符（命令存在、跑起来没输出、
//     什么也不做），脚本会以「打包失败」告终，而且看不出是环境问题。
//   · Windows 自带的 tar(bsdtar)：打出来的条目名带 "./" 前缀，wgt 能装上但版本不生效。
//   自己写条目名完全可控：正斜杠、无前缀、压缩包根目录就是 manifest.json。
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** 递归收集文件，条目名用正斜杠、不带 ./ 前缀 */
function collectFiles(dir, prefix = '') {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...collectFiles(abs, name))
    else if (entry.isFile()) out.push({ name, abs })
  }
  return out
}

function buildZip(srcDir) {
  const parts = []
  const centralParts = []
  let offset = 0
  let count = 0
  for (const file of collectFiles(srcDir)) {
    const raw = fs.readFileSync(file.abs)
    const crc = crc32(raw)
    const deflated = zlib.deflateRawSync(raw, { level: 9 })
    // 压不小的（图片等已压缩的）原样存，免得白花 CPU 还变大
    const useDeflate = deflated.length < raw.length
    const body = useDeflate ? deflated : raw
    const method = useDeflate ? 8 : 0
    const nameBuf = Buffer.from(file.name, 'utf8')

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // 通用标志位：文件名是 UTF-8
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10) // 修改时间
    local.writeUInt16LE(0x21, 12) // 修改日期（1980-01-01，固定值保证可复现）
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra
    parts.push(local, nameBuf, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk number
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBuf)

    offset += local.length + nameBuf.length + body.length
    count += 1
  }
  const centralBuf = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(count, 8)
  end.writeUInt16LE(count, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20) // 注释长度
  return Buffer.concat([...parts, centralBuf, end])
}

/** 把 srcDir 打成 .wgt（zip）：条目在根目录、无 ./ 前缀，manifest.json 直接可读 */
function zipDir(srcDir, destFile) {
  fs.mkdirSync(path.dirname(destFile), { recursive: true })
  if (fs.existsSync(destFile)) fs.unlinkSync(destFile)
  fs.writeFileSync(destFile, buildZip(srcDir))
}

/**
 * 从 zip 里取出某个条目的内容，找不到返回 null。
 *
 * 纯 Node 实现，不用 tar/unzip：从 Node 调 spawnSync('tar') 时，PATH 里排在前面的
 * 可能是 Git Bash 自带的 GNU tar（不认 zip），而 Windows 的 System32\tar.exe（bsdtar）
 * 才认 —— 同一段代码在不同终端里行为不同，很难查。自己读中央目录就没这问题。
 */
function readZipEntry(zipPath, entryName) {
  const buf = fs.readFileSync(zipPath)
  // 1) 从尾部向前找 EOCD（PK\x05\x06），后面最多跟 65535 字节注释
  let eocd = -1
  const lowest = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= lowest; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16) // 中央目录起始偏移
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    if (name === entryName) {
      // 2) 本地头里的 name/extra 长度可能与中央目录不同，必须按本地头算数据起点
      if (buf.readUInt32LE(localOffset) !== 0x04034b50) return null
      const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28)
      const data = buf.subarray(start, start + compSize)
      return method === 8 ? zlib.inflateRawSync(data) : data
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return null
}

function syncDistWidgetVersion(distDir, versionName, versionCode) {
  const distManifestPath = path.join(distDir, 'manifest.json')
  const json = JSON.parse(fs.readFileSync(distManifestPath, 'utf8'))
  json.version = { ...(json.version || {}), name: versionName, code: String(versionCode) }
  fs.writeFileSync(distManifestPath, `${JSON.stringify(json, null, 2)}\n`)
}

function readPackedWidgetVersion(wgtPath) {
  // ★ 必须读包内的 manifest.json，不能拿 src/manifest.json 顶替：
  //   这个校验就是为了拦住「发布记录写了新版本、包里面还是旧版本」那个历史坑。
  const raw = readZipEntry(wgtPath, 'manifest.json')
  if (!raw) {
    throw new Error('wgt 根目录没有 manifest.json，热更新会安装成功但不会生效')
  }
  const json = JSON.parse(raw.toString('utf8'))
  const versionCode = Number.parseInt(String(json.version?.code || ''), 10)
  const versionName = String(json.version?.name || '')
  if (!versionName || !Number.isFinite(versionCode) || versionCode <= 0) {
    throw new Error('wgt 内 manifest.json 版本无效')
  }
  return { versionName, versionCode, appid: String(json.id || '') }
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
  // endpoint 可以挂在子路径上（线上是 http://8.154.44.197/minio，由宝塔 nginx 剥掉前缀）。
  // 子路径只用于路由，不进签名 —— 签名算的是 nginx 剥前缀后 MinIO 实际收到的路径。
  // nginx 侧必须 proxy_set_header Host $host，否则这里签的 host 和 MinIO 收到的对不上。
  const basePath = target.pathname.replace(/\/+$/, '')
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
  return requestBuffer(`${target.origin}${basePath}${canonicalUri}`, {
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
    // 必须走 nginx 的 /minio 前缀：deploy/docker-compose.yml 把 MinIO 绑在 127.0.0.1:9000，
    // 只回环，外网直连 :9000 连不上（改了会静默失败，只在预签名 PUT 失败时才暴露）。
    const minioEndpoint =
      process.env.IM_APP_MINIO_ENDPOINT || `http://${ORIGIN_PIN_IP}/minio`
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
