"""打包本次 iOS 源码快照与验证说明，不收集账号、证书、Pods 或构建缓存。"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parents[2]
NAME = 'IM-iOS-0.3.0-mac-check'
OUTPUT = ROOT / '.native-cache/deliverables' / (NAME + '.zip')
SKIP = {'.git', '.build', '.swiftpm', 'DerivedData', 'build', 'Pods', 'vendor', '.bundle', 'xcuserdata', 'Config', 'IMNative.xcworkspace', '__pycache__'}
ALLOWED = {'.swift', '.m', '.h', '.plist', '.pbxproj', '.xcscheme', '.xcworkspacedata', '.json', '.png', '.html', '.md', '.py', '.sh', '.entitlements', '.resolved', '.lock'}
SPECIAL = {'Podfile', 'Gemfile', '.gitignore'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--name', default=NAME)
    args = parser.parse_args()
    if not re.fullmatch(r'IM-iOS-[a-zA-Z0-9.-]+', args.name):
        raise ValueError('Invalid handoff name')
    name = args.name
    output = OUTPUT.with_name(name + '.zip')
    output.parent.mkdir(parents=True, exist_ok=True)
    files = {}
    for path in (ROOT / 'IM-APP-ios').rglob('*'):
        relative = path.relative_to(ROOT)
        if not path.is_file() or any(part in SKIP for part in relative.parts):
            continue
        if path.suffix in ALLOWED or path.name in SPECIAL:
            files[relative.as_posix()] = path.read_bytes()
    for folder in ['contracts/native-bootstrap/v1', 'contracts/ui-parity/v1']:
        for path in (ROOT / folder).rglob('*'):
            if path.is_file() and path.suffix in {'.json', '.py', '.md'}:
                files[path.relative_to(ROOT).as_posix()] = path.read_bytes()
    for path in [ROOT / 'docs/iOS-Mac验证步骤.md', ROOT / 'docs/原生功能与UI对齐-20261113/功能与UI对齐记录.md',
                 ROOT / 'docs/原生功能与UI对齐-20261113/问题修复与验证-20261114.md',
                 ROOT / 'docs/原生分发与更新操作.md']:
        files[path.relative_to(ROOT).as_posix()] = path.read_bytes()
    files['README-Mac.md'] = (ROOT / 'docs/iOS-Mac验证步骤.md').read_bytes()
    for path in (ROOT / 'docs/历史图片性能优化方案-20261113').glob('*'):
        if path.is_file() and path.suffix in {'.md', '.html'}:
            files[path.relative_to(ROOT).as_posix()] = path.read_bytes()
    project = files['IM-APP-ios/IMNative.xcodeproj/project.pbxproj'].decode('utf-8')
    assert project.count('MARKETING_VERSION = 0.3.0;') == 2
    assert project.count('CURRENT_PROJECT_VERSION = 4;') == 2
    manifest = {'version': '0.3.0', 'build': 4, 'scope': 'iOS source snapshot; Xcode build and iPhone validation not performed on Windows',
                'files': [{'path': name, 'sha256': hashlib.sha256(value).hexdigest(), 'bytes': len(value)} for name, value in sorted(files.items())]}
    files['HANDOFF-MANIFEST.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for entry_name, value in sorted(files.items()):
            archive.writestr(name + '/' + entry_name, value)
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist()) == {name + '/' + entry_name for entry_name in files}
        assert not any(re.search(r'\.(p12|p8|pem|key|mobileprovision|env)$', entry_name, re.I) for entry_name in archive.namelist())
        for entry in manifest['files']:
            assert hashlib.sha256(archive.read(name + '/' + entry['path'])).hexdigest() == entry['sha256']
    print(json.dumps({'output': str(output), 'files': len(files), 'bytes': output.stat().st_size, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
