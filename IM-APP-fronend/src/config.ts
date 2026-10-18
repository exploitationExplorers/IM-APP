const env = import.meta.env
const ossTest = env.MODE === 'oss-test'
if (ossTest && env.VITE_API_BASE_URL !== 'https://localhost:18443/api/v1') {
  throw new Error('OSS test build requires the isolated local API; production fallback is forbidden')
}

/**
 * 分平台取值，两边都要能走通：
 *  - H5：一律用同源相对路径。dev 由 vite.config.ts 的 server.proxy 转发，线上由前端服务器
 *        nginx 反代到后端。H5 线上是 https://www.易可聊.com，绝不能写 http://8.154.44.197 ——
 *        浏览器会判为混合内容直接拦掉（改 CORS 也救不了）。
 *  - App 原生：没有 origin 概念，相对路径无意义，必须用 .env 里的绝对地址。
 */
let apiBaseUrl = env.VITE_API_BASE_URL || 'http://8.154.44.197/api/v1'
// #ifdef H5
apiBaseUrl = '/api/v1'
// #endif

function resolveUpdateChannel(raw: string | undefined): 'canary' | 'test' | 'prod' {
  if (raw === 'canary' || raw === 'prod') return raw
  return 'test'
}

export const APP_CONFIG = {
  ossTest,
  appName: 'Chat',
  displayName: '易可聊',
  version: 'v1.0.0',
  apiBaseUrl,
  /**
   * 热更新渠道会编译进 App 资源，后续 WGT 也可替换；每次构建都须核对。
   * 不写或写错时保持 test，避免误打出来的客户壳去拉 canary。
   * 内部壳必须显式 VITE_UPDATE_CHANNEL=canary。
   */
  updateChannel: resolveUpdateChannel(env.VITE_UPDATE_CHANNEL),
  /** 聊天图片落本地。/object/ 每次 302 到新的 OSS 签名地址，HTTP 缓存永远命中不了，只能自己存。 */
  mediaCacheEnabled: env.VITE_MEDIA_CACHE !== 'off',
  defaultCountryCode: '+86',
  /** 参考站默认头像 */
  defaultAvatarUrl:
    env.VITE_DEFAULT_AVATAR_URL || 'https://nxbf.yuntsy.com/contents/headimg.jpg',
  /** 群未设头像时的占位，形状与参考站一致（蓝底双气泡） */
  defaultGroupAvatarUrl: '/static/group-default.svg',
}

export const THEME = {
  primary: '#0A2FC2',
  primaryDark: '#0C1B54',
  authGradient: 'linear-gradient(326deg, #2F9DE2 6.61%, #1C41C7 35.26%, #0C1B54 93.13%)',
  headerGradient: 'linear-gradient(180deg, #3B7BFF 0%, #6AA0FF 100%)',
  danger: '#E54D42',
  text: '#212121',
  textSecondary: '#636E86',
  bg: '#F3F4F7',
  border: '#E1E3EA',
}
