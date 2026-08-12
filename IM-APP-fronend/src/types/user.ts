/** 用户相关类型 */

export interface UserInfo {
  id: string
  /** 完整手机号仅 Mock / 本人安全页使用；真实接口通常不返回 */
  phone?: string
  /** 脱敏手机号，如 138****8000 */
  phoneMasked?: string
  countryCode: string
  publicId: string
  nickname: string
  avatar: string
  bio?: string
  hasPassword?: boolean
  status?: 'active' | 'blocked' | 'banned'
  createdAt?: string
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

/** 登录 / 注册成功响应（对齐 AuthResult） */
export interface AuthResult extends TokenPair {
  user: UserInfo
}

/** @deprecated 使用 AuthResult */
export type LoginResult = AuthResult

export type SmsScene = 'login' | 'register' | 'reset'

export interface SendSMSResult {
  retryAfterSec: number
  expiresIn: number
  /** 仅开发环境返回 */
  devCode?: string
}

export interface UserSummary {
  id: string
  publicId: string
  nickname: string
  avatar: string
}

/** GET /me/qrcode 响应 */
export interface UserQrcodeResult {
  payload: string
  expiresAt?: string
  user: UserSummary
}

/** POST /users/qrcode/resolve 响应 */
export interface UserQrcodeResolveResult {
  user: UserInfo & { relation?: string }
  relation: string
}

/** @deprecated 使用 UserQrcodeResult */
export type QrcodePayload = UserQrcodeResult

export interface UpdateProfileInput {
  nickname: string
  /** 不修改头像时传空字符串 */
  avatarFileId?: string
  bio?: string
}
