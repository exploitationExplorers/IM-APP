const env = (import.meta as ImportMeta & { env: Record<string, string> }).env

export const APP_CONFIG = {
  appName: 'Chat',
  displayName: '66快捷版',
  version: 'v0.1.0',
  apiBaseUrl: env.VITE_API_BASE_URL || 'https://www.ke58.com/api/v1',
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
