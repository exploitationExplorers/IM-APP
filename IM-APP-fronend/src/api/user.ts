import { APP_CONFIG } from '@/config'
import { request } from '@/utils/request'
import type { QrcodePayload, UpdateProfileInput, UserInfo } from '@/types'
import {
  mockFetchQrcode,
  mockFetchUserProfile,
  mockSearchUserByPublicId,
  mockUpdateProfile,
} from '@/mock/handlers/user'

export async function searchUserByPublicId(publicId: string): Promise<UserInfo | null> {
  if (APP_CONFIG.useMock) {
    return mockSearchUserByPublicId(publicId)
  }
  return request<UserInfo | null>({
    url: '/users/search',
    method: 'GET',
    data: { publicId },
  })
}

export async function updateProfile(input: UpdateProfileInput): Promise<UserInfo> {
  if (APP_CONFIG.useMock) {
    return mockUpdateProfile(input)
  }
  return request<UserInfo>({
    url: '/me',
    method: 'PUT',
    data: input,
  })
}

export async function fetchQrcode(): Promise<QrcodePayload> {
  if (APP_CONFIG.useMock) {
    return mockFetchQrcode()
  }
  return request<QrcodePayload>({ url: '/me/qrcode', method: 'GET' })
}

export async function fetchUserProfile(userId: string): Promise<UserInfo> {
  if (APP_CONFIG.useMock) {
    return mockFetchUserProfile(userId)
  }
  return request<UserInfo>({ url: `/users/${userId}`, method: 'GET' })
}
