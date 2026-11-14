# -*- coding: utf-8 -*-
"""生成逐页对齐清单与离线 HTML；仅报告已有证据，不将静态实现标为真机通过。"""
from pathlib import Path
import base64
import collections
import html
import json

ROOT = Path(__file__).resolve().parents[2]
TASK = ROOT / '.workflow/scratch/20261113-native-full-parity'
OUT = ROOT / 'docs/原生功能与UI对齐-20261113'


def esc(value):
    return html.escape(str(value), quote=True)


def figure(name, caption):
    path = ROOT / '.native-cache/verification/full-parity' / name
    if not path.is_file():
        return '<p>' + esc(caption) + '：尚未生成截图。</p>'
    data = base64.b64encode(path.read_bytes()).decode('ascii')
    return '<figure><img src="data:image/png;base64,' + data + '" alt="' + esc(caption) + '"><figcaption>' + esc(caption) + '</figcaption></figure>'


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    docs = []
    for platform in ['android', 'ios']:
        path = TASK / (platform + '-page-map.json')
        if not path.is_file():
            continue
        data = json.loads(path.read_text(encoding='utf-8-sig'))
        data['platform'] = {'android': 'Android', 'ios': 'iOS'}[platform]
        assert len(data['pages']) == 73
        assert len({p['route'] for p in data['pages']}) == 73
        original = json.loads((TASK / 'original-pages.json').read_text(encoding='utf-8-sig'))
        pages = original if isinstance(original, list) else original.get('pages', original.get('routes', []))
        original_routes = {p.get('route', p.get('path')) for p in pages}
        if original_routes:
            assert {p['route'] for p in data['pages']} == original_routes, platform
        target = ROOT / 'contracts/ui-parity/v1' / (platform + '-page-map.json')
        target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        docs.append(data)
    verification_file = TASK / 'verification.json'
    verification = json.loads(verification_file.read_text(encoding='utf-8')) if verification_file.is_file() else {'status': 'in_progress', 'note': '集成核验仍在进行；本文不代表全量完成。'}
    md = [
        '# 原生功能与 UI 对齐记录', '',
        '版本：Android 0.3.0-parity / code 4；iOS 0.3.0 / build 4。目标是全部功能与 UI 对齐现有 uni-app。当前仍处于开发与分层验证阶段，不是生产替换完成声明。', '',
        '本次针对用户截图中图片不显示、通讯录占位和个人中心不一致继续开发。旧 uni-app 源码是功能与视觉基准；Android 使用 Compose、iOS 使用 UIKit；核心聊天没有套 WebView。', '',
        '后端与旧前端保持保护基线，不部署、不修改线上数据库。使用现有接口会遵守既有登录互踢和业务权限规则，真实操作仍会写现有服务；没有专用账号时不自动提交登录或业务变更。', '',
        '## 状态含义', '',
        '| 状态 | 含义 |', '| --- | --- |',
        '| implemented_pending_runtime | 已有实际代码与接口接线；待真实账号、设备与逐页验收 |',
        '| partial | 仍有明确功能或 UI 差异，详见逐页条目 |',
        '| h5_only | 旧版条件编译为 H5 下载站，不属于原生 App 页面 |', '',
        'runtimeVerified 为 false 的页面不能因为编译、单测或合成截图通过改成 true。合成图片验证单列证据，不替代旧账号历史媒体、真实互通或像素一致性。', '',
        '## 已实施范围与验证边界', '',
        '双端补接通讯录、好友申请与标签、群资料与管理、个人资料与二维码、收藏、通知/聊天/隐私/安全/通用设置、反馈举报及认证相关页面；具体入口和差异以逐页映射为准。', '',
        '图片链路包含异步加载、缓存、有界解码、远程头像和聊天图片预览；兼容旧消息字段和已知媒体稳定入口，未知签名地址保持原样。图/视频/语音/文件发送使用真实 SDK 与持久 Outbox；不确定发送结果先核对，接受不冒充送达。', '',
        'Android 使用 AndroidKeyStore 加密保存登录信息，iOS 使用不可云同步的 Keychain；不保存密码，不以删库恢复登录。SDK 独占消息库，按账号和环境隔离；群可见水位保持单调。', '',
        '旧素材共 65 项、双端 130 份副本，保留来源与 SHA-256。个人中心背景按原 CSS 的 luminosity 与 #0a2fc2 预合成，避免双端各自近似混色。', '',
        '现有服务的 LoggingPushService 是日志实现，注册 push-token 不等于 APNs/厂商推送真正下发。实时音视频、后台推送、现网定制协议及旧库覆盖升级必须独立验收，不能通过页面占位声明已支持。', '',
        '## 实际验证记录', '', '```json', json.dumps(verification, ensure_ascii=False, indent=2), '```', '',
        '## 逐页映射', '',
    ]
    table_rows = []
    stats = []
    for data in docs:
        platform = data['platform']
        counts = collections.Counter(p['status'] for p in data['pages'])
        stats.append(platform + '：' + '，'.join(f'{key} {value}' for key, value in sorted(counts.items())))
        md.extend(['### ' + platform, '', '| 旧路由 | 当前实现与行为 | 差异 | 真实运行验收 |', '| --- | --- | --- | --- |'])
        for p in data['pages']:
            difference = '；'.join(p.get('differences', [])) or '代码中未登记额外差异；仍需运行验收'
            behavior = p.get('behavior', '')
            implementation = p.get('implementation', '')
            runtime = '通过' if p.get('runtimeVerified') else '待验收'
            values = [p['route'], implementation + '；' + behavior, difference, runtime]
            md.append('| ' + ' | '.join(str(v).replace('|', '\\|').replace('\n', ' ') for v in values) + ' |')
            table_rows.append('<tr data-platform="' + esc(platform) + '" data-status="' + esc(p['status']) + '"><td>' + esc(platform) + '</td><td><code>' + esc(p['route']) + '</code><br><span>' + esc(p['status']) + '</span></td><td>' + esc(implementation) + '<p>' + esc(behavior) + '</p></td><td>' + esc(difference) + '</td><td>' + esc(runtime) + '</td></tr>')
        md.append('')
    md.extend(['## Mac 验证和打包', '',
        '使用配套 IM-iOS-0.3.0-mac-check.zip，在 Mac 解压后运行 bash IM-APP-ios/scripts/verify_on_mac.sh。它执行 Swift 核心测试、固定依赖安装与无分发签名的模拟器 Debug 编译，不发布。通过后用 Xcode 打开 workspace，再连接 iPhone 验证数据库、同步、媒体权限和前后台恢复。详见 docs/iOS-Mac验证步骤.md。', '',
        '正式 Android APK/AAB 使用 Gradle 与团队正式签名；iOS 使用 Mac Xcode Archive → TestFlight/App Store。此阶段 staging 身份与 Debug 包独立于生产应用，不能拿它证明原地升级与旧本地库迁移成功。具体签名、分发、后端兼容发布和回滚顺序保留在原生重构方案中。', '',
        '不再使用 uni-app 云打包来构建这两套原生工程。前后端已有服务可继续复用，客户端安装包不需要“部署到后端”才能运行。', '',
        '## 截图证据', '',
        'HTML 内嵌旧 H5 真实页面基准与原生合成数据截图。旧 H5 页面在本地拦截接口、阻断外网后渲染，原生用测试 APK 注入本地资料；这些均不是生产账号截图。测试横幅、状态栏、导航栏及头像测试图不参与像素一致结论。', '',
        '尚未获得真实受控账号结果与 Mac/Xcode 结果时，不得标注全部功能完成、iOS 同步故障已解决或性能达标。', '',
    ])
    (OUT / '功能与UI对齐记录.md').write_text('\n'.join(md), encoding='utf-8')
    gallery = ''.join(figure(name, caption) for name, caption in [
        ('uniapp-mine-baseline.png', '原 uni-app H5：个人中心，本地接口 fixture'),
        ('android-mine.png', 'Android：个人中心，本地合成资料'),
        ('uniapp-contacts-baseline.png', '原 uni-app H5：通讯录，本地接口 fixture'),
        ('android-contacts.png', 'Android：通讯录，本地合成资料'),
        ('uniapp-notifications-baseline.png', '原 uni-app H5：新消息通知'),
        ('android-notifications.png', 'Android：新消息通知，本地设置'),
        ('uniapp-chat-settings-baseline.png', '原 uni-app H5：聊天设置'),
        ('android-chat-settings.png', 'Android：聊天设置，本地设置'),
        ('uniapp-privacy-baseline.png', '原 uni-app H5：隐私设置'),
        ('android-privacy.png', 'Android：隐私设置，本地合成资料'),
        ('uniapp-security-baseline.png', '原 uni-app H5：账号安全'),
        ('android-security.png', 'Android：账号安全，本地合成资料'),
        ('uniapp-general-baseline.png', '原 uni-app H5：通用设置'),
        ('android-general.png', 'Android：通用设置，本地设置'),
        ('uniapp-profile-baseline.png', '原 uni-app H5：个人资料'),
        ('android-profile.png', 'Android：个人资料，本地合成资料'),
        ('android-chat-image.png', 'Android：聊天图片，合成缓存 fixture'),
        ('android-about.png', 'Android：关于与检查更新入口，未发起更新请求'),
        ('android-qrcode.png', 'Android：二维码，合成 payload'),
        ('android-announcements.png', 'Android：公告图片，本地合成资料'),
        ('android-friend.png', 'Android：好友资料，本地合成资料；未登录的 SDK 设置不可用'),
        ('android-group.png', 'Android：群资料与成员预览，本地合成资料；未登录的 SDK 设置不可用'),
    ])
    body = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>原生功能与 UI 对齐记录</title>
<style>body{font:16px/1.65 system-ui,sans-serif;color:#182238;background:#f5f6f8;margin:0}main{max-width:1440px;margin:auto;padding:28px}h1{font-size:30px}p{max-width:1000px}aside{background:#fff4dc;border-left:4px solid #cc8b0a;padding:16px}nav{display:flex;gap:12px;flex-wrap:wrap;position:sticky;top:0;background:#f5f6f8;padding:12px 0}input,select{font:inherit;padding:10px;border:1px solid #bcc5d4;border-radius:6px}input{min-width:280px}.scroll{overflow:auto;background:white}table{border-collapse:collapse;width:100%;min-width:950px;font-size:14px}th,td{text-align:left;vertical-align:top;padding:12px;border:1px solid #e1e6ef}th{background:#eaf0fc}td:nth-child(2){width:20%}td:nth-child(3){width:38%}td:nth-child(4){width:30%}td span{color:#637088}code{word-break:break-all}pre{white-space:pre-wrap;background:#fff;padding:20px;overflow:auto}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}figure{margin:0;background:white;padding:12px}figure img{display:block;width:100%;max-height:670px;object-fit:contain}figcaption{font-size:14px;margin-top:12px}a{color:#0a2fc2}</style>
<main><h1>原生功能与 UI 对齐记录</h1><aside>开发版本 0.3.0，仍需真实账号与 iOS 真机验收。逐页有代码 ≠ 功能全部通过，合成截图 ≠ 真实账号互通或全量像素一致。</aside>
<p>以现有 uni-app 为唯一功能和视觉基准，继续修复图片、通讯录、个人中心及业务流程。未修改旧前后端和线上部署。Android 为 Compose，iOS 为 UIKit；不使用 WebView 套核心聊天。</p>
<p>资源共 65 项，双端 130 份副本。个人中心背景按原 CSS 预合成；消息和媒体通过真实 SDK 与持久 Outbox。服务器推送下发、音视频、覆盖升级与大规模性能另行验收。</p>
<p><a href="功能与UI对齐记录.md">对应 Markdown 与打包说明</a> · <a href="../iOS-Mac验证步骤.md">Mac / iPhone 验证步骤</a></p>
<h2>验证结果</h2><pre>''' + esc(json.dumps(verification, ensure_ascii=False, indent=2)) + '</pre><h2>本地页面截图</h2><p>左侧旧 H5 使用本地拦截 fixture；Android 使用测试 APK 本地合成数据。系统栏、测试横幅与不同头像素材不作为像素一致结论。</p><div class="gallery">' + gallery + '</div><h2>73 条旧路由逐平台对照</h2><p>' + esc('；'.join(stats)) + '''</p><nav><label>平台 <select id="platform"><option value="">全部</option><option>Android</option><option>iOS</option></select></label><label>状态 <select id="status"><option value="">全部</option><option>partial</option><option>implemented_pending_runtime</option><option>h5_only</option></select></label><input id="query" placeholder="搜索路由、功能或差异" aria-label="搜索路由、功能或差异"><output id="count"></output></nav><div class="scroll"><table><thead><tr><th>平台</th><th>旧路由 / 状态</th><th>当前实现与行为</th><th>差异与未验项</th><th>真实运行验收</th></tr></thead><tbody>''' + ''.join(table_rows) + '''</tbody></table></div><p>Mac 解压交接包后执行 <code>bash IM-APP-ios/scripts/verify_on_mac.sh</code>；模拟器构建成功后仍需连接 iPhone，重点验证本地库、同步、前后台、强杀恢复和媒体权限。</p></main><script>
const rows=[...document.querySelectorAll('tbody tr')];function filter(){const p=document.getElementById('platform').value,s=document.getElementById('status').value,q=document.getElementById('query').value.toLowerCase();let n=0;for(const r of rows){r.hidden=!!((p&&r.dataset.platform!==p)||(s&&r.dataset.status!==s)||!r.textContent.toLowerCase().includes(q));if(!r.hidden)n++}document.getElementById('count').textContent=n+' 条'}for(const id of ['platform','status','query'])document.getElementById(id).addEventListener('input',filter);filter();
</script></html>'''
    (OUT / '功能与UI对齐记录.html').write_text(body, encoding='utf-8')
    print(json.dumps({'platforms': len(docs), 'rows': len(table_rows), 'output': str(OUT)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
