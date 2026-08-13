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

export async function fetchQrcode(): Promise<UserQrcodeResult> {
  return request<UserQrcodeResult>({ url: '/me/qrcode', method: 'GET' })
}

export async function fetchUserProfile(userId: string): Promise<UserInfo> {
  return request<UserInfo>({ url: `/users/${userId}`, method: 'GET' })
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
