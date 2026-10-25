const path = require('path')
const fs = require('fs')
const http = require('http')
const https = require('https')

function loadDotEnv(p) {
  const o = {}
  if (!fs.existsSync(p)) return o
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (!m) continue
    o[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '')
  }
  return o
}

function req(url, opts, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? https : http
    const r = lib.request(
      {
        method: opts.method || 'GET',
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers: opts.headers || {},
        timeout: 60000,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        )
      },
    )
    r.on('error', reject)
    r.on('timeout', () => r.destroy(new Error('timeout')))
    if (body) r.write(body)
    r.end()
  })
}

async function main() {
  const root = path.join(__dirname, '..')
  const fe = loadDotEnv(path.join(root, '.env'))
  const se = loadDotEnv(path.join(root, '..', 'IM-APP-server', '.env'))
  const origin = String(fe.VITE_API_BASE_URL || '').replace(/\/$/, '')
  const key = se.IM_INTERNAL_API_KEY || process.env.IM_INTERNAL_API_KEY
  console.log('origin', origin)
  console.log('key?', Boolean(key), 'len', key ? key.length : 0)
  console.log('OSS_BUCKET?', Boolean(se.OSS_BUCKET), 'OSS_ENDPOINT', se.OSS_ENDPOINT || '(none)')

  const create = await req(
    `${origin}/admin/app-releases/uploads`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Api-Key': key },
    },
    JSON.stringify({ platform: 'android', packageType: 'wgt', fileName: 'im-250.wgt' }),
  )
  console.log('create status', create.status)
  console.log('create body', create.body.slice(0, 1000))
  const upload = JSON.parse(create.body)
  let host = '?'
  try {
    host = new URL(upload.uploadUrl).host
  } catch {
    /* ignore */
  }
  console.log('uploadUrl host', host)
  console.log('storageProvider', upload.storageProvider)

  const buf = fs.readFileSync(path.join(root, 'unpackage/release/im-250.wgt'))
  const headers = { ...(upload.headers || {}), 'Content-Length': String(buf.length) }
  console.log('put header keys', Object.keys(headers))
  try {
    const put = await req(upload.uploadUrl, { method: 'PUT', headers }, buf)
    console.log('put status', put.status)
    console.log('put body', put.body.slice(0, 500))
  } catch (e) {
    console.error('put error message:', e && e.message)
    console.error('put error code:', e && e.code)
    console.error('put error cause:', e && e.cause)
  }
}

main().catch((e) => {
  console.error('top', e)
  process.exit(1)
})
