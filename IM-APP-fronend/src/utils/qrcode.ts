import QRCode from 'qrcode'
import jsQR from 'jsqr'

export interface ParsedQrcodePayload {
  type?: string
  token?: string
  publicId?: string
}

/** 解析二维码原始文本（JSON / 66chats URL / 裸 token） */
export function parseQrcodePayload(raw: string): ParsedQrcodePayload {
  const text = raw.trim()
  if (!text) return {}

  if (text.startsWith('http://') || text.startsWith('https://')) {
    try {
      const u = new URL(text)
      const qrcode = u.searchParams.get('qrcode')
      const qrcodetype = u.searchParams.get('qrcodetype')
      if (qrcode) {
        return {
          token: qrcode,
          type: qrcodetype === 'u' ? 'user' : qrcodetype === 'g' ? 'group' : qrcodetype || undefined,
        }
      }
    } catch {
      // fall through
    }
  }

  try {
    const obj = JSON.parse(text) as Record<string, string>
    return {
      type: obj.type,
      token: obj.token,
      publicId: obj.publicId,
    }
  } catch {
    return { token: text }
  }
}

/** H5：从本地图片路径解码二维码内容 */
export async function decodeQrcodeFromImage(path: string): Promise<string> {
  // #ifdef H5
  const img = await loadImage(path)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth || img.width
  canvas.height = img.naturalHeight || img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法读取图片')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const code = jsQR(imageData.data, canvas.width, canvas.height)
  if (!code?.data) throw new Error('未识别到二维码')
  return code.data
  // #endif
  // #ifndef H5
  throw new Error('请使用扫码功能识别二维码')
  // #endif
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

/** 将 payload 渲染为可展示的二维码 data URL */
export async function buildQrcodeDataUrl(text: string, size = 560): Promise<string> {
  if (!text) throw new Error('二维码内容为空')
  return QRCode.toDataURL(text, {
    width: size,
    margin: 1,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  })
}
