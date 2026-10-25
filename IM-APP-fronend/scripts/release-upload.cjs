// Pure helpers: importing this module never builds or publishes a release.
function canFallbackToMinio(upload) {
  if (upload.storageProvider && upload.storageProvider !== 'minio') return false
  try {
    const url = new URL(upload.uploadUrl)
    if (/(^|\.)oss[-.][a-z0-9.-]+\.aliyuncs\.com$/i.test(url.hostname)) return false
    if ([...url.searchParams.keys()].some(key => /^(x-oss-|OSSAccessKeyId$)/i.test(key))) return false
  } catch {
    return false
  }
  // Older MinIO servers omit storageProvider. Preserve their existing behavior.
  return true
}

function releaseUploadHeaders(upload, length) {
  return { ...(upload.headers || {}), 'Content-Length': String(length) }
}

module.exports = { canFallbackToMinio, releaseUploadHeaders }
