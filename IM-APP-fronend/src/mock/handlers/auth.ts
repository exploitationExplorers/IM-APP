import { APP_CONFIG } from '@/config'
import type { LoginResult, UserInfo } from '@/types'
import {
  delay,
  findUserByPhone,
  genId,
  genPublicId,
  getMockState,
  mutateMockState,
  resolveCurrentUserId,
  toPublicUser,
} from '../store'

function makeLoginResult(user: UserInfo): LoginResult {
  mutateMockState((s) => {
    s.currentUserId = user.id
  })
  return {
    token: `mock_token_${user.phone}`,
    user: toPublicUser(user),
  }
}

function createUser(phone: string, countryCode: string, password?: string): UserInfo {
  let created!: UserInfo
  mutateMockState((s) => {
    const id = genId('u')
    const publicId = genPublicId(s.nextPublicId++)
    created = {
      id,
      phone,
      countryCode: countryCode || '+86',
      publicId,
      nickname: `用户${phone.slice(-4)}`,
      avatar: '',
      bio: '',
      status: 'active',
    }
    s.users.push(created)
    if (password) s.passwords[phone] = password
  })
  return created!
}

export async function mockLoginByPassword(
  phone: string,
  password: string,
): Promise<LoginResult> {
  await delay()
  if (!phone || !password) throw new Error('请输入手机号和密码')
  const user = findUserByPhone(phone)
  const s = getMockState()
  if (!user || s.passwords[phone] !== password) {
    throw new Error('账号或密码错误')
  }
  return makeLoginResult(user)
}

export async function mockLoginBySms(phone: string, code: string): Promise<LoginResult> {
  await delay()
  if (code !== APP_CONFIG.mockSmsCode) throw new Error('验证码错误')
  let user = findUserByPhone(phone)
  if (!user) {
    user = createUser(phone, APP_CONFIG.defaultCountryCode)
  }
  return makeLoginResult(user)
}

export async function mockRegisterBySms(
  phone: string,
  code: string,
  countryCode: string,
): Promise<LoginResult> {
  await delay()
  if (code !== APP_CONFIG.mockSmsCode) throw new Error('验证码错误')
  if (findUserByPhone(phone)) throw new Error('手机号已注册')
  const user = createUser(phone, countryCode, '123456')
  return makeLoginResult(user)
}

export async function mockSendSmsCode(phone: string) {
  await delay(200)
  if (!phone) throw new Error('请输入手机号')
  return { ok: true, tip: `开发环境验证码：${APP_CONFIG.mockSmsCode}` }
}

export async function mockResetPassword(phone: string, code: string, password: string) {
  await delay()
  if (code !== APP_CONFIG.mockSmsCode) throw new Error('验证码错误')
  if (password.length < 6) throw new Error('密码至少 6 位')
  const user = findUserByPhone(phone)
  if (!user) throw new Error('用户不存在')
  mutateMockState((s) => {
    s.passwords[phone] = password
  })
  return { ok: true }
}

export async function mockFetchProfile(): Promise<UserInfo> {
  await delay(100)
  const s = getMockState()
  const uid = s.currentUserId || 'u_me'
  const user = s.users.find((u) => u.id === uid)
  if (!user) throw new Error('未登录')
  return toPublicUser(user)
}
