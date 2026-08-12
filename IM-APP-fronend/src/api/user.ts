import { request } from '@/utils/request'
import type { UserQrcodeResult, UpdateProfileInput, UserInfo } from '@/types'

export async function searchUserByPublicId(publicId: string): Promise<UserInfo | null> {
  return request<UserInfo | null>({
    url: '/users/search',
    method: 'GET',
    data: { publicId },
  })
}

export async function updateProfile(input: UpdateProfileInput): Promise<UserInfo> {
  return request<UserInfo>({
    url: '/me',
    method: 'PUT',
    data: input,
  })
}

export async function fetchQrcode(): Promise<UserQrcodeResult> {
  return request<UserQrcodeResult>({ url: '/me/qrcode', method: 'GET' })
}

export async function fetchUserProfile(userId: string): Promise<UserInfo> {
  return request<UserInfo>({ url: `/users/${userId}`, method: 'GET' })
}
