import type { UserInfo } from '@/types'

const HAS_PASSWORD_KEY = 'user_has_password'
const OLD_PASSWORD_KEY = 'password_change_old'

/** 是否已设置过登录密码（优先读接口字段，其次本地标记） */
export function userHasPassword(profile?: UserInfo | null): boolean {
  if (profile?.hasPassword !== undefined) return profile.hasPassword
  return uni.getStorageSync(HAS_PASSWORD_KEY) === '1'
}

export function markUserHasPassword() {
  uni.setStorageSync(HAS_PASSWORD_KEY, '1')
}

export function stashOldPassword(password: string) {
  uni.setStorageSync(OLD_PASSWORD_KEY, password)
}

export function consumeOldPassword(): string {
  const value = uni.getStorageSync(OLD_PASSWORD_KEY) as string
  if (value) uni.removeStorageSync(OLD_PASSWORD_KEY)
  return value || ''
}

export function clearOldPassword() {
  uni.removeStorageSync(OLD_PASSWORD_KEY)
}
