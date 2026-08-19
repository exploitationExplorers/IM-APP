// 修复 @openim/protocol 发布缺 lib/pb/sdkws/sdkws.js 的问题：
// @openim/client-sdk 深路径 require 该模块取 PullOrder，但包内仅发布 .d.ts 类型声明，
// uni 工具链在 node 层解析时（dev/build 启动阶段）会 "Cannot find module"。
// vite.config.ts 已用 alias 覆盖打包路径，此处补 node 层可解析的 sdkws.js，幂等。
const fs = require('fs')
const path = require('path')

const target = path.join(
  __dirname, '..', 'node_modules', '@openim', 'protocol', 'lib', 'pb', 'sdkws', 'sdkws.js',
)

const content = [
  '// 修复 @openim/protocol 发布缺 lib/pb/sdkws/sdkws.js 的问题：',
  '// @openim/client-sdk 深路径 require 此模块取 PullOrder，但包内仅发布 .d.ts 类型声明，',
  '// 导致 uni 工具链在 node 层解析时 "Cannot find module"。此处从包根 re-export 同一枚举。',
  "var proto = require('../../index.js')",
  'module.exports = { PullOrder: proto.SdkWsProto.PullOrder }',
  '',
].join('\n')

if (fs.existsSync(target)) {
  console.log('[fix-openim-protocol] sdkws.js 已存在，跳过')
} else {
  fs.writeFileSync(target, content)
  console.log('[fix-openim-protocol] 已创建 sdkws.js:', target)
}
