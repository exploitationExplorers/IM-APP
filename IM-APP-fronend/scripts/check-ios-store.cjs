const { loadEnv } = require('vite')

function validateStoreEnv(env) {
  const errors = []
  for (const key of ['VITE_API_BASE_URL', 'VITE_IM_API_URL', 'VITE_IM_WS_URL', 'VITE_PRIVACY_POLICY_URL', 'VITE_USER_AGREEMENT_URL']) {
    try {
      const url = new URL(env[key] || '')
      const protocol = key === 'VITE_IM_WS_URL' ? 'wss:' : 'https:'
      if (url.protocol !== protocol || url.username || url.password || !url.hostname.includes('.') || /^\d+(\.\d+){3}$/.test(url.hostname)) throw new Error('invalid')
    } catch {
      errors.push(`${key} 必须配置有效的 ${key === 'VITE_IM_WS_URL' ? 'WSS' : 'HTTPS'} 域名地址`)
    }
  }
  if (!/^\d+$/.test(env.VITE_APP_STORE_ID || '')) errors.push('VITE_APP_STORE_ID 必须是 App Store Connect 中的数字 Apple ID')
  if (env.VITE_DISTRIBUTION !== 'app-store') errors.push('VITE_DISTRIBUTION 必须为 app-store')
  return errors
}

if (require.main === module) {
  const errors = validateStoreEnv({ ...loadEnv('ios-store', process.cwd()), ...process.env })
  if (errors.length) {
    console.error('App Store 配置尚未完成，请在 .env.ios-store.local 配置：\n' + errors.join('\n'))
    process.exitCode = 1
  }
}

module.exports = { validateStoreEnv }
