import { h5PublicMediaUrl } from '@/utils/chatMedia'

/** Pass storage-supplied policy fields verbatim; never attach business auth or
 * manually set multipart Content-Type (the runtime must generate its boundary).
 */
export async function postStorageBytes(
  formUrl: string,
  fields: Record<string, string>,
  file: { bytes: ArrayBuffer; fileName: string; contentType: string },
): Promise<void> {
  if (typeof fetch !== 'function' || typeof FormData === 'undefined' || typeof Blob === 'undefined') {
    throw new Error('当前环境不支持文件上传')
  }
  const body = new FormData()
  Object.entries(fields).forEach(([key, value]) => body.append(key, value))
  // OSS requires file to be the last multipart field. Also valid for MinIO.
  body.append('file', new Blob([file.bytes], { type: file.contentType }), file.fileName)
  const result = await fetch(h5PublicMediaUrl(formUrl), { method: 'POST', body })
  if (!result.ok) throw new Error(`上传失败(${result.status})`)
}

/** Native App uses uni.uploadFile, not H5 fetch/File APIs. */
export function postStorageLocalFile(formUrl: string, filePath: string, fields: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: formUrl,
      filePath,
      name: 'file',
      formData: fields,
      success: (result) => {
        if (result.statusCode >= 200 && result.statusCode < 300) resolve()
        else reject(new Error(`上传失败(${result.statusCode})`))
      },
      fail: (error) => reject(new Error(error.errMsg || '上传失败')),
    })
  })
}
