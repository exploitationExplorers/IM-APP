import { delay } from '@/mock/store'

export async function mockPresignFile(filename: string, contentType?: string) {
  await delay(200)
  const objectKey = `mock/${Date.now()}_${filename}`
  const fileUrl = `/static/${filename}`
  return {
    uploadUrl: fileUrl,
    fileUrl,
    objectKey,
    expiresIn: 900,
    devMode: true,
    contentType,
  }
}
