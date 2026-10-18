import { afterEach, describe, expect, it, vi } from 'vitest'
import { h5PublicMediaUrl } from '@/utils/chatMedia'
import { isOSSStorageUrl } from '@/utils/storage-url'
import { postStorageBytes, postStorageLocalFile } from '@/utils/storage-upload'

afterEach(() => vi.unstubAllGlobals())

describe('storage URL compatibility', () => {
  it('preserves OSS host, encoded key and signature query verbatim', () => {
    vi.stubGlobal('location', { protocol: 'https:', origin: 'https://test.example' })
    const urls = [
      'https://bucket.oss-cn-hangzhou.aliyuncs.com/a%20b.jpg?x-oss-signature=a%2Bb%2F&x-oss-date=20261017T000000Z',
      'http://bucket.oss-cn-hangzhou.aliyuncs.com/object/a.jpg?OSSAccessKeyId=fake&Signature=a%2Bb%3D',
      'http://upload.example/minio/a.jpg?x-oss-credential=a%2Fb&x-oss-signature=c%2Bd',
    ]
    for (const url of urls) {
      expect(isOSSStorageUrl(url)).toBe(true)
      expect(h5PublicMediaUrl(url)).toBe(url)
    }
  })

  it('keeps the existing HTTP MinIO same-origin rewrite', () => {
    vi.stubGlobal('location', { protocol: 'https:', origin: 'https://test.example' })
    const url = 'http://127.0.0.1:9000/minio/im-uploads/a.jpg?X-Amz-Signature=a%2Fb'
    expect(isOSSStorageUrl(url)).toBe(false)
    expect(h5PublicMediaUrl(url)).toBe('https://test.example/minio/im-uploads/a.jpg?X-Amz-Signature=a%2Fb')
  })

  it('preserves non-network App paths', () => {
    for (const path of ['_doc/images/a.jpg', 'content://media/1', 'file:///storage/a.jpg']) {
      expect(isOSSStorageUrl(path)).toBe(false)
      expect(h5PublicMediaUrl(path)).toBe(path)
    }
  })
})

describe('H5 storage POST', () => {
  it.each([
    { key: 'oss-test/business/uploads/a.jpg', policy: 'fake-policy', 'x-oss-signature': 'a+/=', 'x-oss-security-token': 'token+/=', success_action_status: '204' },
    { key: 'uploads/a.jpg', policy: 'fake-policy', 'x-amz-signature': 'fake-minio-signature' },
  ])('passes every policy field unchanged and appends file last', async (fields) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)
    const url = 'https://bucket.oss-cn-hangzhou.aliyuncs.com'
    await postStorageBytes(url, fields, { bytes: new Uint8Array([1, 2, 3]).buffer, fileName: 'a.jpg', contentType: 'image/jpeg' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [target, options] = fetchMock.mock.calls[0]
    expect(target).toBe(url)
    expect(options.method).toBe('POST')
    expect(options.headers).toBeUndefined()
    const entries = Array.from((options.body as FormData).entries())
    expect(entries.at(-1)?.[0]).toBe('file')
    for (const [key, value] of Object.entries(fields)) expect((options.body as FormData).get(key)).toBe(value)
    expect(((options.body as FormData).get('file') as File).size).toBe(3)
  })

  it('rejects storage failure without retrying a different provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 })
    vi.stubGlobal('fetch', fetchMock)
    await expect(postStorageBytes('https://upload.example', {}, { bytes: new ArrayBuffer(1), fileName: 'a.jpg', contentType: 'image/jpeg' })).rejects.toThrow('403')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('native App storage POST', () => {
  it.each([200, 201, 204])('uses uni.uploadFile and accepts HTTP %i', async (statusCode) => {
    const fields = { key: 'oss-test/business/uploads/a.jpg', policy: 'fake', 'x-oss-signature': 'a+/=' }
    const uploadFile = vi.fn((options) => options.success({ statusCode }))
    vi.stubGlobal('uni', { uploadFile })
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('native must not use fetch') }))
    await postStorageLocalFile('https://upload.example', '_doc/image.jpg', fields)
    expect(uploadFile).toHaveBeenCalledTimes(1)
    expect(uploadFile.mock.calls[0][0]).toMatchObject({ url: 'https://upload.example', filePath: '_doc/image.jpg', name: 'file', formData: fields })
    expect(uploadFile.mock.calls[0][0].header).toBeUndefined()
  })

  it('propagates native HTTP failures', async () => {
    vi.stubGlobal('uni', { uploadFile: (options: { success: (result: { statusCode: number }) => void }) => options.success({ statusCode: 403 }) })
    await expect(postStorageLocalFile('https://upload.example', '_doc/image.jpg', {})).rejects.toThrow('403')
  })
})
