export interface QrcodeCardOptions {
  nickname: string
  nicknameInitial: string
  avatarUrl?: string
  qrDataUrl: string
  brandLogoUrl?: string
  caption?: string
}

const CARD_WIDTH = 750
const PADDING = 40
const AVATAR_SIZE = 88
const LOGO_SIZE = 72
const ROW_GAP = 20
const QR_SIZE = 560
const SECTION_GAP = 48

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`图片加载失败: ${src}`))
    img.src = src
  })
}

function drawAvatarFallback(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  initial: string,
) {
  ctx.fillStyle = '#0a2fc2'
  ctx.beginPath()
  ctx.arc(x + AVATAR_SIZE / 2, y + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#ffffff'
  ctx.font = '600 36px PingFang SC, Microsoft YaHei, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(initial || '?', x + AVATAR_SIZE / 2, y + AVATAR_SIZE / 2)
}

async function drawAvatar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  avatarUrl: string | undefined,
  initial: string,
) {
  if (!avatarUrl) {
    drawAvatarFallback(ctx, x, y, initial)
    return
  }

  try {
    const avatar = await loadImage(avatarUrl)
    ctx.save()
    ctx.beginPath()
    ctx.arc(x + AVATAR_SIZE / 2, y + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(avatar, x, y, AVATAR_SIZE, AVATAR_SIZE)
    ctx.restore()
  } catch {
    drawAvatarFallback(ctx, x, y, initial)
  }
}

function drawNickname(ctx: CanvasRenderingContext2D, nickname: string, x: number, y: number, maxWidth: number) {
  ctx.fillStyle = '#212121'
  ctx.font = '600 34px PingFang SC, Microsoft YaHei, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  let text = nickname
  while (text.length > 1 && ctx.measureText(`${text}…`).width > maxWidth) {
    text = text.slice(0, -1)
  }
  if (text !== nickname) text = `${text}…`
  ctx.fillText(text, x, y)
}

/** 合成头像 + 昵称 + 品牌 logo + 二维码的分享图 */
export async function buildQrcodeCardDataUrl(options: QrcodeCardOptions): Promise<string> {
  if (typeof document === 'undefined') {
    throw new Error('当前环境不支持生成分享图')
  }

  const captionH = options.caption ? 64 : 0
  const height = PADDING + AVATAR_SIZE + SECTION_GAP + QR_SIZE + captionH + PADDING
  const canvas = document.createElement('canvas')
  canvas.width = CARD_WIDTH
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CARD_WIDTH, height)

  const rowY = PADDING
  await drawAvatar(ctx, PADDING, rowY, options.avatarUrl, options.nicknameInitial)

  const nicknameX = PADDING + AVATAR_SIZE + ROW_GAP
  const nicknameMaxWidth = CARD_WIDTH - nicknameX - LOGO_SIZE - ROW_GAP - PADDING
  drawNickname(ctx, options.nickname, nicknameX, rowY + AVATAR_SIZE / 2, nicknameMaxWidth)

  const brandLogoUrl = options.brandLogoUrl || '/static/auth/logo-full.png'
  try {
    const logo = await loadImage(brandLogoUrl)
    const logoX = CARD_WIDTH - PADDING - LOGO_SIZE
    const logoY = rowY + (AVATAR_SIZE - LOGO_SIZE) / 2
    ctx.drawImage(logo, logoX, logoY, LOGO_SIZE, LOGO_SIZE)
  } catch {
    // logo 缺失时不阻断保存
  }

  const qr = await loadImage(options.qrDataUrl)
  const qrX = (CARD_WIDTH - QR_SIZE) / 2
  const qrY = rowY + AVATAR_SIZE + SECTION_GAP
  ctx.drawImage(qr, qrX, qrY, QR_SIZE, QR_SIZE)

  if (options.caption) {
    ctx.fillStyle = '#9aa3b5'
    ctx.font = '400 28px PingFang SC, Microsoft YaHei, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(options.caption, CARD_WIDTH / 2, qrY + QR_SIZE + 24)
  }

  return canvas.toDataURL('image/png')
}

/** APP 端将 base64 图片保存到相册 */
export function saveBase64ImageToAlbum(dataUrl: string): Promise<void> {
  const BitmapCtor = plus?.nativeObj?.Bitmap
  if (!BitmapCtor) {
    return Promise.reject(new Error('当前环境不支持保存图片'))
  }

  return new Promise((resolve, reject) => {
    const bitmap = new BitmapCtor('qrcode_card_save')
    bitmap.loadBase64Data(
      dataUrl,
      () => {
        const path = `_doc/qrcode_${Date.now()}.png`
        bitmap.save(
          path,
          {},
          () => {
            bitmap.clear()
            uni.saveImageToPhotosAlbum({
              filePath: path,
              success: () => resolve(),
              fail: reject,
            })
          },
          reject,
        )
      },
      reject,
    )
  })
}
