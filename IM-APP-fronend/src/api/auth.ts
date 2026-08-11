import { APP_CONFIG } from '@/config'
import { request } from '@/utils/request'
import type { LoginResult, UserInfo } from '@/types'
import {
  mockFetchProfile,
  mockLoginByPassword,
  mockLoginBySms,
  mockRegisterBySms,
  mockResetPassword,
  mockSendSmsCode,
} from '@/mock/handlers/auth'

export async function loginByPassword(phone: string, password: string): Promise<LoginResult> {
  if (APP_CONFIG.useMock) {
    return mockLoginByPassword(phone, password)
  }
  return request<LoginResult>({
    url: '/auth/login',
    method: 'POST',
    auth: false,
    data: { phone, password, countryCode: APP_CONFIG.defaultCountryCode },
  })
}

export async function loginBySms(phone: string, code: string): Promise<LoginResult> {
  if (APP_CONFIG.useMock) {
    return mockLoginBySms(phone, code)
  }
  return request<LoginResult>({
    url: '/auth/login/sms',
    method: 'POST',
    auth: false,
    data: { phone, code, countryCode: APP_CONFIG.defaultCountryCode },
  })
}

export async function registerBySms(
  phone: string,
  code: string,
  countryCode?: string,
): Promise<LoginResult> {
  if (APP_CONFIG.useMock) {
    return mockRegisterBySms(phone, code, countryCode || APP_CONFIG.defaultCountryCode)
  }
  return request<LoginResult>({
    url: '/auth/register',
    method: 'POST',
    auth: false,
    data: { phone, code, countryCode: countryCode || APP_CONFIG.defaultCountryCode },
  })
}

export async function sendSmsCode(phone: string, scene: 'login' | 'register' | 'reset') {
  if (APP_CONFIG.useMock) {
    return mockSendSmsCode(phone)
  }
  return request<{ ok: boolean; tip?: string }>({
    url: '/auth/sms/send',
    method: 'POST',
    auth: false,
    data: { phone, scene, countryCode: APP_CONFIG.defaultCountryCode },
  })
}

export async function resetPassword(phone: string, code: string, password: string) {
  if (APP_CONFIG.useMock) {
    return mockResetPassword(phone, code, password)
  }
  return request<{ ok: boolean }>({
    url: '/auth/password/reset',
    method: 'POST',
    auth: false,
    data: { phone, code, password, countryCode: APP_CONFIG.defaultCountryCode },
  })
}

export async function fetchProfile(): Promise<UserInfo> {
  if (APP_CONFIG.useMock) {
    return mockFetchProfile()
  }
  return request<UserInfo>({ url: '/me', method: 'GET' })
}
