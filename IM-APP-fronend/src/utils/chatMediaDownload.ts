/** 远程文件落到本地临时路径，保存相册 / 语音 / 打开文件共用。 */
export function downloadRemoteFile(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    uni.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
          resolve(res.tempFilePath)
          return
        }
        reject(new Error('文件下载失败'))
      },
      fail: (err) => reject(new Error(err.errMsg || '文件下载失败')),
    })
  })
}
