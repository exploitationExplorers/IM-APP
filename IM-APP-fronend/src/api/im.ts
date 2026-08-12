import { request } from '@/utils/request'

export interface IMTokenResult {
  token: string
  expireSec: number
  platform: number
  userId: string
  devMode?: boolean
}

export async function fetchIMToken(platformId = 5): Promise<IMTokenResult> {
  return request<IMTokenResult>({
    url: '/im/token',
    method: 'POST',
    data: { platformId },
  })
}
