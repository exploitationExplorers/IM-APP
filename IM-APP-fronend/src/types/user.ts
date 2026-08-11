/** 用户相关类型 */

export interface UserInfo {
  id: string
  phone: string
  countryCode: string
  publicId: string
  nickname: string
  avatar: string
  bio?: string
  status?: 'active' | 'blocked' | 'banned'
}

export interface LoginResult {
  token: string
  user: UserInfo
}

export interface QrcodePayload {
  publicId: string
  nickname: string
  avatar: string
  /** 二维码内容，扫描后可解析 */
  payload: string
}

export interface UpdateProfileInput {
  nickname?: string
  avatar?: string
  bio?: string
}
