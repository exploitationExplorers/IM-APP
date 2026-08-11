const env = (import.meta as ImportMeta & { env: Record<string, string> }).env

export const APP_CONFIG = {
  appName: 'Chat',
  /** 仅当显式 VITE_USE_MOCK=true 时走本地 mock；默认直连后端 */
  useMock: env.VITE_USE_MOCK === 'true',
  apiBaseUrl: env.VITE_API_BASE_URL || 'http://127.0.0.1:8080/api/v1',
  wsBaseUrl: env.VITE_WS_BASE_URL || 'ws://127.0.0.1:8080/ws',
  defaultCountryCode: '+86',
  /** 开发环境固定验证码，对接真实短信后由后端校验 */
  mockSmsCode: '123456',
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
