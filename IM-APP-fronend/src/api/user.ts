import { request } from '@/utils/request'
import { parseQrcodePayload } from '@/utils/qrcode'
import type {
  UserQrcodeResult,
  UpdateProfileInput,
  UserInfo,
  UserQrcodeResolveResult,
  PrivacySettings,
} from '@/types'

export async function searchUserByPublicId(publicId: string): Promise<UserInfo | null> {
  return request<UserInfo | null>({
    url: '/users/search',
    method: 'GET',
    data: { publicId },
  })
}

export async function resolveUserQRCode(tokenOrPayload: string): Promise<UserQrcodeResolveResult> {
  const parsed = parseQrcodePayload(tokenOrPayload)
  const token = parsed.token || tokenOrPayload
  return request<UserQrcodeResolveResult>({
    url: '/users/qrcode/resolve',
    method: 'POST',
    data: {
      token,
      payload: tokenOrPayload,
      qrcode: tokenOrPayload.startsWith('http') ? tokenOrPayload : undefined,
    },
  })
}

/** PATCH /me：nickname、avatarFileId、bio 均需传入 */
export async function updateProfile(input: UpdateProfileInput): Promise<UserInfo> {
  return request<UserInfo>({
    url: '/me',
    method: 'PATCH',
    data: {
      nickname: input.nickname,
      avatarFileId: input.avatarFileId ?? '',
      bio: input.bio ?? '',
    },
  })
}

/**
 * PUT /me/public-id：设置自己的聊天号。
 * 一个账号只能改一次；格式（6-20 位、首位字母、只能字母数字）与唯一性都由服务端校验，
 * 前端只做即时提示，别把规则在这边写死。
 */
export async function updateMyPublicId(publicId: string): Promise<UserInfo> {
  return request<UserInfo>({
    url: '/me/public-id',
    method: 'PUT',
    data: { publicId },
  })
}

export async function fetchQrcode(): Promise<UserQrcodeResult> {
  return request<UserQrcodeResult>({ url: '/me/qrcode', method: 'GET' })
}

/** 他人资料；从群成员进入时传 groupId，服务端对非群主脱敏 publicId */
export async function fetchUserProfile(userId: string, groupId?: string): Promise<UserInfo> {
  const data: Record<string, string> = {}
  if (groupId) data.groupId = groupId
  return request<UserInfo>({
    url: `/users/${userId}`,
    method: 'GET',
    data: Object.keys(data).length ? data : undefined,
  })
}

/** POST /me/password/verify：安全页校验旧密码 */
export async function verifyPassword(oldPassword: string): Promise<void> {
  await request<{ ok: boolean }>({
    url: '/me/password/verify',
    method: 'POST',
    data: { oldPassword },
  })
}

/** PUT /me/password：登录态下设置/修改密码 */
export async function changePassword(password: string, oldPassword?: string): Promise<void> {
  const data: Record<string, string> = { password }
  if (oldPassword) data.oldPassword = oldPassword

  await request<null>({
    url: '/me/password',
    method: 'PUT',
    data,
  })
}

export async function fetchPrivacySettings(): Promise<PrivacySettings> {
  return request<PrivacySettings>({ url: '/me/privacy-settings', method: 'GET' })
}

export async function updatePrivacySettings(settings: PrivacySettings): Promise<PrivacySettings> {
  return request<PrivacySettings>({
    url: '/me/privacy-settings',
    method: 'PUT',
    data: settings,
  })
}
