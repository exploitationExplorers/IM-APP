const { readFileSync, existsSync } = require('node:fs')
const { resolve } = require('node:path')
const assert = require('node:assert/strict')
const { checkStoreStartup } = require('./check-ios-store-startup.cjs')

const output = resolve('dist/build/ios-store')
const service = readFileSync(resolve(output, 'app-service.js'), 'utf8')
const config = readFileSync(resolve(output, 'app-config-service.js'), 'utf8')
const manifest = JSON.parse(readFileSync(resolve(output, 'manifest.json'), 'utf8'))

for (const pattern of [/runtime\.install\b/, /itms-services:/, /\.wgt\b/, /正在下载更新/, /正在安装/, /占位隐私政策/, /占位协议文本/, /pages\/mine\/debug/, /http:\/\/8\.154\.44\.197\/api\/v1/]) {
  assert(!pattern.test(service + config), `App Store 产物包含禁止路径：${pattern}`)
}
assert(config.includes('"entryPagePath":"pages/auth/consent"'), '首次启动入口必须为隐私授权页面')
assert(!existsSync(resolve(output, 'pages/mine/debug')), '调试页面仍在包内')
assert(!existsSync(resolve(output, 'pages/mine/debug.js')), '调试页面仍在包内')
const privacyPath = 'nativeResources/ios/PrivacyInfo.xcprivacy'
const atsPath = 'nativeResources/ios/Info.plist'
for (const file of [privacyPath, atsPath]) {
  assert.equal(readFileSync(resolve(output, file), 'utf8'), readFileSync(resolve('src', file), 'utf8'), `原生资源缺失或不一致：${file}`)
}
assert(!JSON.stringify(manifest).includes('UIBackgroundModes":"audio'), '后台音频配置未移除')
assert(JSON.stringify(manifest).includes('NSPhotoLibraryAddUsageDescription'), '缺少保存相册权限说明')
checkStoreStartup(service)
console.log('App Store 资源检查通过；原生云打包后仍须检查最终 IPA 的 ATS、隐私清单及插件。')
