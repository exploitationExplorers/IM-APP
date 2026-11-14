"""验证已安装原生测试包并保存合成页面证据；不提交账号、不请求生产接口。"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SCREENS = ['mine', 'contacts', 'notifications', 'chat-settings', 'privacy', 'security',
           'general', 'profile', 'about', 'qrcode', 'announcements', 'friend', 'group', 'chat-image']
PACKAGE = 'com.im.nativebootstrap.staging'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--adb', default='D:/Android/SDK/platform-tools/adb.exe')
    parser.add_argument('--port', default='5038')
    parser.add_argument('--serial', required=True, help='仅使用指定的专用测试设备')
    parser.add_argument('--output', default='.native-cache/verification/full-parity', help='本轮证据目录，不覆盖之前交付记录')
    args = parser.parse_args()
    adb = [args.adb, '-P', args.port, '-s', args.serial]
    out = (ROOT / args.output).resolve()
    if ROOT not in out.parents:
        raise ValueError('Evidence output must stay inside workspace')
    out.mkdir(parents=True, exist_ok=True)
    report = {'status': 'failed', 'scope': 'Installed staging APK, no credentials; SDK unauthenticated smoke, Keystore, bounded images/GIF and synthetic UI only',
              'serial': args.serial, 'real_account_interoperability': 'not_run', 'pixel_equivalence': 'not_verified', 'screens': []}

    def call(*parts, binary=False, timeout=180):
        value = subprocess.check_output(adb + list(parts), timeout=timeout)
        return value if binary else value.decode('utf-8', errors='replace')

    try:
        apk = ROOT / 'IM-APP-android/app/build/outputs/apk/debug/app-debug.apk'
        test = ROOT / 'IM-APP-android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'
        report['apk_sha256'] = hashlib.sha256(apk.read_bytes()).hexdigest()
        report['test_apk_sha256'] = hashlib.sha256(test.read_bytes()).hexdigest()
        installed = call('shell', 'pm', 'path', PACKAGE).strip().splitlines()
        path = next(line[len('package:'):] for line in installed if line.endswith('/base.apk'))
        digest = call('shell', 'sha256sum', path).split()[0].lower()
        assert digest == report['apk_sha256'], 'Installed package differs from current build'
        report['installed_apk_sha256'] = digest
        installed_test = call('shell', 'pm', 'path', PACKAGE + '.test').strip().splitlines()
        test_path = next(line[len('package:'):] for line in installed_test if line.endswith('/base.apk'))
        test_digest = call('shell', 'sha256sum', test_path).split()[0].lower()
        assert test_digest == report['test_apk_sha256'], 'Installed instrumentation differs from current build'
        report['installed_test_apk_sha256'] = test_digest
        for runner, markers in [
            ('SDKSmokeInstrumentation', ['smoke=passed:', 'INSTRUMENTATION_CODE: -1']),
            ('FullParityInstrumentation', ['secureSession=passed:', 'animatedMedia=passed:', 'fullParity=passed:', 'INSTRUMENTATION_CODE: -1']),
        ]:
            output = call('shell', 'am', 'instrument', '-w', PACKAGE + '.test/com.im.nativebootstrap.' + runner)
            (out / (runner + '.txt')).write_text(output, encoding='utf-8')
            assert all(marker in output for marker in markers), runner + ' failed: ' + output
            report[runner] = output.strip().splitlines()
        for name in SCREENS:
            data = call('exec-out', 'run-as', PACKAGE, 'cat', 'cache/full-parity-' + name + '.png', binary=True, timeout=30)
            assert data.startswith(b'\x89PNG\r\n\x1a\n'), 'Missing screenshot: ' + name
            (out / ('android-' + name + '.png')).write_bytes(data)
            report['screens'].append({'name': name, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
        report['status'] = 'passed'
    except Exception as error:
        report['error'] = str(error)
    (out / 'android-device.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return report['status'] != 'passed'


if __name__ == '__main__':
    raise SystemExit(main())
