# 自维护 OpenIMSDKCore podspec —— 内存修复版（tag v3.8.3-yike.1）
#
# 背景：官方 core 全量对账不分批，大账号在 iOS 上爆内存触发 jetsam。
# 修复分支：liveknife/openim-sdk-core @ yike/3.8.3-patch.15-memfix（ee4469a）
# 基线：官方 v3.8.3-patch.15，与 OpenIMSDK 3.8.3-hotfix.15 完全兼容。
#
# 用法：Podfile 中覆盖官方 pod（版本号保持不变，满足 OpenIMSDK 的精确依赖）：
#   pod 'OpenIMSDKCore', '3.8.3-hotfix.15', :podspec => 'https://<发布地址>/OpenIMSDKCore.podspec'
#
# 回滚：删掉 :podspec => 参数即回到官方产物。
#
# 发布地址：https://www.xn--jprz53bj9s.com/sdks/openim/3.8.3-yike.1/
# sha256 由服务器 .sha256 文件核实（与 CI 产物一致）。
Pod::Spec.new do |s|
  s.name         = 'OpenIMSDKCore'
  s.version      = '3.8.3-hotfix.15'
  s.summary      = 'OpenIM core SDK (yike memfix: batched full-sync reconcile, fixed iOS jetsam crash)'
  s.description  = '基于官方 openim-sdk-core v3.8.3-patch.15 的修复构建：非空库全量对账分批化（100/批），避免大账号同步在 iOS 上内存超限被系统杀进程。'
  s.homepage     = 'https://github.com/liveknife/openim-sdk-core'
  s.license      = { :type => 'MIT', :file => 'LICENSE' }
  s.author       = { 'liveknife' => 'https://github.com/liveknife' }
  s.source       = { :http => 'https://www.xn--jprz53bj9s.com/sdks/openim/3.8.3-yike.1/OpenIMCore_v3.8.3-yike.1.xcframework.zip',
                     :sha256 => '2ecc003e189f295c4f85cc617190f7a9f7c0aa8d697c1b6307ebc3f9a4cf994e' }
  s.platform     = :ios, '11.0'
  s.xcconfig     = { 'VALID_ARCHS' => 'armv7s arm64 x86_64' }
  s.pod_target_xcconfig = { 'ARCHS[sdk=iphonesimulator*]' => '$(ARCHS_STANDARD_64_BIT)' }
  s.libraries    = 'resolv'
  s.vendored_frameworks = 'OpenIMCore.xcframework'
end
