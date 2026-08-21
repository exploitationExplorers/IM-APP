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
const fs = require('fs')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const manifestPath = path.join(root, 'src', 'manifest.json')
const distDir = path.join(root, 'dist', 'build', 'app-plus')
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
  const tar = spawnSync('tar', ['-a', '-c', '-f', zipFile, '-C', srcDir, '.'], { stdio: 'inherit' })
  if (tar.status !== 0) {
    throw new Error('打包 wgt 失败：本机需要 tar（Windows 10+ 自带）')
  }
  fs.renameSync(zipFile, destFile)
}

function originFromApiBase(apiBaseUrl) {
  return String(apiBaseUrl || '').replace(/\/api\/v1\/?$/, '').replace(/\/$/, '')
}

async function apiJson(origin, key, method, pathname, body) {
  const res = await fetch(`${origin}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-API-Key': key,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
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
  const origin =
    args.api ||
    process.env.IM_APP_API_ORIGIN ||
    originFromApiBase(frontendEnv.VITE_API_BASE_URL) ||
    originFromApiBase(serverEnv.PUBLIC_API_BASE_URL)
  const key = args.key || process.env.IM_INTERNAL_API_KEY || serverEnv.IM_INTERNAL_API_KEY
  if (!origin) throw new Error('发布需要 --api=https://你的域名 或配置 VITE_API_BASE_URL')
  if (!key) throw new Error('发布需要 --key 或 IM-APP-server/.env 中的 IM_INTERNAL_API_KEY')

  const fileName = path.basename(filePath)
  const upload = await apiJson(origin, key, 'POST', '/internal/admin/app-releases/uploads', {
    platform: args.platform,
    packageType: args.packageType,
    fileName,
  })
  const buf = fs.readFileSync(filePath)
  const putRes = await fetch(upload.uploadUrl, { method: 'PUT', body: buf })
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
  const published = await apiJson(origin, key, 'POST', '/internal/admin/app-releases', payload)
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

  let filePath = args.file ? path.resolve(root, args.file) : ''
  if (args.packageType === 'wgt' && !filePath) {
    if (!fs.existsSync(path.join(distDir, 'manifest.json'))) {
      throw new Error(`未找到 ${distDir}，请先加 --build 或使用 HBuilderX 打自定义基座资源`)
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
