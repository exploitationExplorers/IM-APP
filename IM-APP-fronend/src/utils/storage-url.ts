import { isKnownStorageCDNHost } from '@/utils/storage-hosts'

/** OSS signed URLs must retain host, path encoding and query bytes unchanged. */
export function isOSSStorageUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    let signed = false
    url.searchParams.forEach((_value, key) => {
      if (/^(x-oss-(signature|credential|signature-version)|OSSAccessKeyId)$/i.test(key)) signed = true
    })
    return /(^|\.)oss[-.][a-z0-9.-]+\.aliyuncs\.com$/i.test(url.hostname)
      || isKnownStorageCDNHost(url.hostname)
      || signed
  } catch {
    return false
  }
}
