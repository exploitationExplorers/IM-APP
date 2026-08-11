import { APP_CONFIG } from '@/config'
import { request } from '@/utils/request'
import { fetchOpenIMToken as mockFetchOpenIMToken } from '@/utils/openim'

export interface IMTokenResult {
  token: string
  expireSec: number
  platform: number
  userId: string
  devMode?: boolean
}

export async function fetchIMToken(platformId = 5): Promise<IMTokenResult> {
  if (APP_CONFIG.useMock) return mockFetchOpenIMToken(platformId)
  return request<IMTokenResult>({
    url: '/im/token',
    method: 'POST',
    data: { platformId },
  })
}
