import { APP_CONFIG } from '@/config'
import { getDeviceId } from '@/utils/device'
import { getRefreshToken, request } from '@/utils/request'
import type { AuthResult, SendSMSResult, SmsScene, TokenPair, UserInfo } from '@/types'

export async function loginByPassword(
  phone: string,
  password: string,
  countryCode = APP_CONFIG.defaultCountryCode,
): Promise<AuthResult> {
  return request<AuthResult>({
    url: '/auth/login',
    method: 'POST',
    auth: false,
    data: {
      phone,
      password,
      countryCode,
      deviceId: getDeviceId(),
    },
  })
}

export async function loginBySms(
  phone: string,
  code: string,
  countryCode = APP_CONFIG.defaultCountryCode,
): Promise<AuthResult> {
  return request<AuthResult>({
    url: '/auth/login/sms',
    method: 'POST',
    auth: false,
    data: {
      phone,
      code,
      countryCode,
      deviceId: getDeviceId(),
    },
  })
}

export async function registerBySms(
  phone: string,
  code: string,
  password: string,
  countryCode = APP_CONFIG.defaultCountryCode,
): Promise<AuthResult> {
  return request<AuthResult>({
    url: '/auth/register',
    method: 'POST',
    auth: false,
    data: {
      phone,
      code,
      password,
      countryCode,
      deviceId: getDeviceId(),
    },
  })
}

export async function sendSmsCode(
  phone: string,
  scene: SmsScene,
  countryCode = APP_CONFIG.defaultCountryCode,
): Promise<SendSMSResult> {
  return request<SendSMSResult>({
    url: '/auth/sms/send',
    method: 'POST',
    auth: false,
    data: {
      phone,
      scene,
      countryCode,
      deviceId: getDeviceId(),
    },
  })
}

export async function resetPassword(
  phone: string,
  code: string,
  password: string,
  countryCode = APP_CONFIG.defaultCountryCode,
): Promise<{ ok?: boolean } | null> {
  return request<{ ok?: boolean } | null>({
    url: '/auth/password/reset',
    method: 'POST',
    auth: false,
    data: {
      phone,
      code,
      password,
      countryCode,
    },
  })
}

export async function refreshAuthToken(): Promise<TokenPair> {
  return request<TokenPair>({
    url: '/auth/token/refresh',
    method: 'POST',
    auth: false,
    data: {
      refreshToken: getRefreshToken(),
      deviceId: getDeviceId(),
    },
  })
}

export async function logoutCurrentDevice(): Promise<void> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return
  await request<null>({
    url: '/auth/logout',
    method: 'POST',
    auth: false,
    data: { refreshToken },
  })
}

export async function logoutAllDevices(): Promise<void> {
  await request<null>({
    url: '/auth/logout-all',
    method: 'POST',
    data: {},
  })
}

export async function fetchProfile(): Promise<UserInfo> {
  return request<UserInfo>({ url: '/me', method: 'GET' })
}
