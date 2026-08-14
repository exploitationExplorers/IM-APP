import type { UserInfo } from '@/types'

const LOGIN_PHONE_KEY = 'im_login_phone'

export type LoginPhone = {
  countryCode: string
  phone: string
}

/** 登录/注册时记下用户输入的本地号，接口不返回明文，安全页用这份展示 */
export function saveLoginPhone(countryCode: string, phone: string) {
  const local = phone.trim()
  if (!local) return
  uni.setStorageSync(
    LOGIN_PHONE_KEY,
    JSON.stringify({ countryCode: countryCode || '+86', phone: local }),
  )
}

export function readLoginPhone(): LoginPhone | null {
  const raw = uni.getStorageSync(LOGIN_PHONE_KEY)
  if (!raw) return null
  try {
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as LoginPhone
    if (!parsed?.phone) return null
    return {
      countryCode: parsed.countryCode || '+86',
      phone: parsed.phone,
    }
  } catch {
    return null
  }
}

export function clearLoginPhone() {
  uni.removeStorageSync(LOGIN_PHONE_KEY)
}

export function applyLoginPhone(user: UserInfo): UserInfo {
  if (user.phone) {
    saveLoginPhone(user.countryCode || '+86', user.phone)
    return user
  }
  const local = readLoginPhone()
  if (!local) return user
  return {
    ...user,
    phone: local.phone,
    countryCode: user.countryCode || local.countryCode,
  }
}
