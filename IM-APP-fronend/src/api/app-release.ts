import { request } from '@/utils/request'
import type { AppReleaseCheckResult } from '@/types'

export async function checkAppRelease(query: {
  platform: 'android' | 'ios'
  channel: string
  nativeVersion: number
  wgtVersion: number
}): Promise<AppReleaseCheckResult> {
  return request<AppReleaseCheckResult>({
    url: '/public/app-release',
    method: 'GET',
    auth: false,
    data: {
      platform: query.platform,
      channel: query.channel,
      nativeVersion: query.nativeVersion,
      wgtVersion: query.wgtVersion,
    },
  })
}
