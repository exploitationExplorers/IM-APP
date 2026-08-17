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

/** 从本地图片解码二维码。H5 走 canvas，App 走原生 Barcode */
export async function decodeQrcodeFromImage(path: string): Promise<string> {
  if (isAppPlatform()) return scanAppImage(path)
  const img = await loadImage(path)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth || img.width
  canvas.height = img.naturalHeight || img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法读取图片')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const code = tryDecodeQrcode(imageData.data, canvas.width, canvas.height)
  if (!code) throw new Error('未识别到二维码')
  return code
}

export function tryDecodeQrcode(data: Uint8ClampedArray, width: number, height: number): string {
  return jsQR(data, width, height)?.data || ''
}

function scanAppImage(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const barcode = plus?.barcode
    if (!barcode?.scan) {
      reject(new Error('当前环境不支持识别相册二维码'))
      return
    }
    barcode.scan(
      path,
      (_type, code) => {
        if (code) {
          resolve(code)
          return
        }
        reject(new Error('未识别到二维码'))
      },
      () => reject(new Error('未识别到二维码')),
    )
  })
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

function isAppPlatform(): boolean {
  try {
    return uni.getSystemInfoSync().uniPlatform === 'app'
  } catch {
    return false
  }
}

function canUseDomCanvas(): boolean {
  try {
    if (typeof document === 'undefined') return false
    const el = document.createElement('canvas')
    return Boolean(el.getContext && el.getContext('2d'))
  } catch {
    return false
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const uniBtoa = (uni as UniNamespace.Uni & { arrayBufferToBase64?: (b: ArrayBuffer) => string })
    .arrayBufferToBase64
  if (uniBtoa) return uniBtoa(buffer)
  const bytes = new Uint8Array(buffer)
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  if (typeof btoa === 'function') return btoa(binary)
  throw new Error('当前环境无法编码图片')
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function adler32(buf: Uint8Array): number {
  let a = 1
  let b = 0
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

function zlibStore(data: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [new Uint8Array([0x78, 0x01])]
  let offset = 0
  while (offset < data.length) {
    const size = Math.min(0xffff, data.length - offset)
    const isLast = offset + size >= data.length
    const block = new Uint8Array(5 + size)
    block[0] = isLast ? 0x01 : 0x00
    block[1] = size & 0xff
    block[2] = (size >> 8) & 0xff
    block[3] = ~size & 0xff
    block[4] = (~size >> 8) & 0xff
    block.set(data.subarray(offset, offset + size), 5)
    chunks.push(block)
    offset += size
  }
  const checksum = adler32(data)
  const tail = new Uint8Array(4)
  new DataView(tail.buffer).setUint32(0, checksum)
  chunks.push(tail)
  return concatBytes(chunks)
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(4)
  for (let i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i)
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, data.length)
  const crcInput = concatBytes([typeBytes, data])
  const crc = new Uint8Array(4)
  new DataView(crc.buffer).setUint32(0, crc32(crcInput))
  return concatBytes([len, typeBytes, data, crc])
}

function rgbToPngDataUrl(rgb: Uint8Array, width: number, height: number): string {
  const raw = new Uint8Array((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1)
    raw[rowStart] = 0
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), rowStart + 1)
  }

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, width)
  ihdrView.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = 2
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const png = concatBytes([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlibStore(raw)),
    pngChunk('IEND', new Uint8Array(0)),
  ])
  return `data:image/png;base64,${arrayBufferToBase64(
    png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
  )}`
}

function qrModulesToPngDataUrl(
  modules: { size: number; get: (row: number, col: number) => number | boolean },
  targetSize: number,
  margin: number,
): string {
  const n = modules.size
  const cells = n + margin * 2
  const scale = Math.max(1, Math.floor(targetSize / cells))
  const imgSize = cells * scale
  const rgb = new Uint8Array(imgSize * imgSize * 3)
  rgb.fill(255)

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (!modules.get(row, col)) continue
      const startX = (col + margin) * scale
      const startY = (row + margin) * scale
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = ((startY + dy) * imgSize + (startX + dx)) * 3
          rgb[i] = 0
          rgb[i + 1] = 0
          rgb[i + 2] = 0
        }
      }
    }
  }

  return rgbToPngDataUrl(rgb, imgSize, imgSize)
}

function buildQrcodeWithoutCanvas(text: string, size: number): string {
  const create = QRCode.create
  if (typeof create !== 'function') throw new Error('当前环境无法生成二维码')
  const qr = create(text, { errorCorrectionLevel: 'M' })
  return qrModulesToPngDataUrl(qr.modules, size, 1)
}

/** 将 payload 渲染为可展示的二维码 data URL */
export async function buildQrcodeDataUrl(text: string, size = 560): Promise<string> {
  if (!text) throw new Error('二维码内容为空')

  if (!isAppPlatform() && canUseDomCanvas()) {
    try {
      return await QRCode.toDataURL(text, {
        width: size,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      })
    } catch {
      return buildQrcodeWithoutCanvas(text, size)
    }
  }

  return buildQrcodeWithoutCanvas(text, size)
}
