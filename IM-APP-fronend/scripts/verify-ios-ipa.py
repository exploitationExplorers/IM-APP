import argparse
import plistlib
import re
import sys
from pathlib import PurePosixPath
from zipfile import BadZipFile, ZipFile


FORBIDDEN = {
    '自建更新接口': rb'/public/app-release',
    '热更新安装': (
        rb'\bruntime\s*(?:\?\.|\.)\s*install\b|\bruntime\s*\[\s*[\x22\x27]install'
        rb'|\.install\s*\([^;]{0,160}\bforce\s*:|\.wgtu?\b|useLegacyAppUpdate'
    ),
    '应用内下载安装提示': '正在下载更新|正在安装'.encode(),
    '企业分发链接': rb'itms-services:',
    '调试页': rb'pages/mine/debug',
    '旧的明文业务接口': rb'http://8\.154\.44\.197/api/v1',
}


def verify(ipa):
    with ZipFile(ipa) as archive:
        names = archive.namelist()
        info_files = [name for name in names if re.fullmatch(r'Payload/[^/]+\.app/Info\.plist', name)]
        if len(info_files) != 1:
            raise ValueError('无法定位 IPA 主应用 Info.plist')
        app = info_files[0].removesuffix('Info.plist')
        info = plistlib.loads(archive.read(info_files[0]))
        files = [name for name in names if name.startswith(app) and not name.endswith('/')]
        services = [name for name in files if name.endswith('/app-service.js')]
        if len(services) != 1:
            raise ValueError('无法唯一定位 uni-app 的 app-service.js')
        web_root = services[0].removesuffix('app-service.js')
        findings = []
        config = web_root + 'app-config-service.js'
        if config not in files or not re.search(rb'"entryPagePath"\s*:\s*"pages/auth/consent"', archive.read(config)):
            findings.append('IPA 缺少 App Store 构建的首次启动隐私授权入口')
        for name in files:
            suffix = PurePosixPath(name).suffix.lower()
            if suffix in {'.wgt', '.wgtu', '.ipa', '.apk'}:
                findings.append(f'嵌入的更新包 {name}')
            if not name.startswith(web_root) or suffix not in {'.js', '.mjs', '.html', '.json'}:
                continue
            content = archive.read(name)
            for label, pattern in FORBIDDEN.items():
                if re.search(pattern, content):
                    findings.append(f'{label} {name}')
        privacy = app + 'PrivacyInfo.xcprivacy'
        if privacy not in files or not isinstance(plistlib.loads(archive.read(privacy)), dict):
            findings.append('IPA 主应用缺少有效的 PrivacyInfo.xcprivacy')
        ats = info.get('NSAppTransportSecurity', {})
        if any(ats.get(key) for key in ('NSAllowsArbitraryLoads', 'NSAllowsArbitraryLoadsInWebContent', 'NSAllowsArbitraryLoadsForMedia')):
            findings.append('IPA 主应用启用了全局 ATS 例外')
        return info, findings


def main():
    parser = argparse.ArgumentParser(description='核对 HBuilderX 云打包或 Xcode 导出的 iOS 商店 IPA。')
    parser.add_argument('ipa')
    args = parser.parse_args()
    try:
        info, findings = verify(args.ipa)
    except (BadZipFile, OSError, ValueError) as error:
        print(f'IPA 检查失败\n{error}', file=sys.stderr)
        return 1
    build = f'{info.get("CFBundleIdentifier")} {info.get("CFBundleShortVersionString")} ({info.get("CFBundleVersion")})'
    if findings:
        print(f'IPA 检查失败 {build}\n' + '\n'.join(findings), file=sys.stderr)
        return 1
    print(f'IPA 资源检查通过 {build}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
