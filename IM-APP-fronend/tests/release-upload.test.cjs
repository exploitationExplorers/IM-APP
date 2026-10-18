const assert = require('node:assert/strict')
const test = require('node:test')
const { canFallbackToMinio, releaseUploadHeaders } = require('../scripts/release-upload.cjs')

test('OSS and unknown explicit providers never fall back to production MinIO', () => {
  for (const storageProvider of ['oss', 'other']) {
    assert.equal(canFallbackToMinio({ storageProvider, uploadUrl: 'https://upload.example/a.wgt' }), false)
  }
})

test('OSS URL detection also protects older responses without provider metadata', () => {
  for (const uploadUrl of [
    'https://bucket.oss-cn-hangzhou.aliyuncs.com/a.wgt',
    'https://custom.example/a.wgt?x-oss-signature=signature',
    'https://custom.example/a.wgt?OSSAccessKeyId=fake&Signature=signature',
  ]) assert.equal(canFallbackToMinio({ uploadUrl }), false)
})

test('preserves legacy MinIO fallback and fails closed for malformed URLs', () => {
  assert.equal(canFallbackToMinio({ uploadUrl: 'https://test.example/minio/im-uploads/a.wgt' }), true)
  assert.equal(canFallbackToMinio({ storageProvider: 'minio', uploadUrl: 'https://test.example/minio/im-uploads/a.wgt' }), true)
  assert.equal(canFallbackToMinio({ uploadUrl: 'invalid' }), false)
})

test('release PUT carries exact storage signature headers and actual byte length', () => {
  const upload = { headers: { 'X-Oss-Forbid-Overwrite': 'true', 'Content-Length': 'wrong' } }
  assert.deepEqual(releaseUploadHeaders(upload, 9), { 'X-Oss-Forbid-Overwrite': 'true', 'Content-Length': '9' })
})
