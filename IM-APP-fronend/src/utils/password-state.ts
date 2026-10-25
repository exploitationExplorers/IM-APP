import type { UserInfo } from '@/types'

const HAS_PASSWORD_KEY = 'user_has_password'
const OLD_PASSWORD_KEY = 'password_change_old'
let pendingOldPassword = ''

/** 是否已设置过登录密码（优先读接口字段，其次本地标记） */
export function userHasPassword(profile?: UserInfo | null): boolean {
  if (profile?.hasPassword !== undefined) return profile.hasPassword
  return uni.getStorageSync(HAS_PASSWORD_KEY) === '1'
}

export function markUserHasPassword() {
  uni.setStorageSync(HAS_PASSWORD_KEY, '1')
}

export function stashOldPassword(password: string) {
  uni.removeStorageSync(OLD_PASSWORD_KEY)
  pendingOldPassword = password
}

export function consumeOldPassword(): string {
  const value = pendingOldPassword
  clearOldPassword()
  return value
}

export function clearOldPassword() {
  pendingOldPassword = ''
  uni.removeStorageSync(OLD_PASSWORD_KEY)
}
