import QRCode from 'qrcode'

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
