"""仅交付已与设备验证结果匹配的开发 APK；不安装、签发凭据或发布。"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / '.native-cache/verification/full-parity'
OUTPUT = ROOT / '.native-cache/deliverables'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    build = json.loads((EVIDENCE / 'android-build.json').read_text(encoding='utf-8-sig'))
    device = json.loads((EVIDENCE / 'android-device.json').read_text(encoding='utf-8-sig'))
    login = json.loads((EVIDENCE / 'android-login-ui.json').read_text(encoding='utf-8-sig'))
    assert build['status'] == device['status'] == login['status'] == 'passed'
    source = ROOT / 'IM-APP-android/app/build/outputs/apk/debug/app-debug.apk'
    actual = digest(source)
    assert actual == device['apk_sha256'] == device['installed_apk_sha256']
    assert device['test_apk_sha256'] == device['installed_test_apk_sha256']
    assert actual == login['apk_sha256'], 'Login UI evidence belongs to another APK'
    OUTPUT.mkdir(parents=True, exist_ok=True)
    target = OUTPUT / 'IM-Android-0.3.0-parity.apk'
    shutil.copyfile(source, target)
    assert digest(target) == actual
    native = ROOT / 'IM-APP-android'
    inputs = sorted(p for p in (native / 'app/src').rglob('*') if p.is_file())
    inputs += sorted(native.glob('*.kts')) + sorted((native / 'app').glob('*.kts'))
    manifest = [{'path': p.relative_to(ROOT).as_posix(), 'sha256': digest(p)} for p in inputs]
    result = {'version': '0.3.0-parity', 'versionCode': 4, 'file': target.name,
              'sha256': actual, 'bytes': target.stat().st_size,
              'created_at': datetime.now(timezone.utc).isoformat(),
              'scope': 'Staging Debug APK; local tests and synthetic UI only, not production acceptance',
              'build': build, 'device': device, 'login_UI': login, 'source_files': manifest,
              'real_account_acceptance': 'not_run', 'published': False}
    (OUTPUT / 'IM-Android-0.3.0-parity-evidence.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'output': str(target), 'sha256': actual, 'bytes': target.stat().st_size}, ensure_ascii=False))


if __name__ == '__main__':
    main()
