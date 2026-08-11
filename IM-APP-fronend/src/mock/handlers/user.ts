import type { QrcodePayload, UpdateProfileInput, UserInfo } from '@/types'
import {
  delay,
  findUserByPublicId,
  getMockState,
  mutateMockState,
  resolveCurrentUserId,
  toPublicUser,
} from '../store'

export async function mockSearchUserByPublicId(publicId: string): Promise<UserInfo | null> {
  await delay()
  if (!publicId.trim()) throw new Error('请输入公开 ID')
  const user = findUserByPublicId(publicId.trim())
  if (!user) return null
  const uid = resolveCurrentUserId()
  if (user.id === uid) throw new Error('不能添加自己为好友')
  return toPublicUser(user)
}

export async function mockUpdateProfile(input: UpdateProfileInput): Promise<UserInfo> {
  await delay(200)
  const uid = resolveCurrentUserId()
  let updated!: UserInfo
  mutateMockState((s) => {
    const idx = s.users.findIndex((u) => u.id === uid)
    if (idx < 0) throw new Error('用户不存在')
    const u = s.users[idx]
    if (input.nickname !== undefined) {
      if (input.nickname.length < 1 || input.nickname.length > 32) {
        throw new Error('昵称长度 1-32 字符')
      }
      u.nickname = input.nickname
    }
    if (input.avatar !== undefined) u.avatar = input.avatar
    if (input.bio !== undefined) u.bio = input.bio
    updated = toPublicUser(u)
  })
  return updated!
}

export async function mockFetchQrcode(): Promise<QrcodePayload> {
  await delay(100)
  const s = getMockState()
  const uid = resolveCurrentUserId()
  const user = s.users.find((u) => u.id === uid)
  if (!user) throw new Error('未登录')
  const payload = JSON.stringify({ type: 'user', publicId: user.publicId })
  return {
    publicId: user.publicId,
    nickname: user.nickname,
    avatar: user.avatar,
    payload,
  }
}

export async function mockFetchUserProfile(userId: string): Promise<UserInfo> {
  await delay()
  const s = getMockState()
  const user = s.users.find((u) => u.id === userId)
  if (!user) throw new Error('用户不存在')
  return toPublicUser(user)
}
