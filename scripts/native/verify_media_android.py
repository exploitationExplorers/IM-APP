"""验证冻结源码对应的媒体优化 APK，并固定本地交付；不登录真实账号或发布。"""
import hashlib
import argparse
import json
import re
from pathlib import Path
import shutil
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / '.workflow/scratch/20261113-media-implementation'
OUT = ROOT / '.native-cache/verification/media-20261113'
APK = ROOT / 'IM-APP-android/app/build/outputs/apk/debug/app-debug.apk'
TEST = ROOT / 'IM-APP-android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'
ADB = ['D:/Android/SDK/platform-tools/adb.exe', '-P', '5038', '-s', '127.0.0.1:5581']
PACKAGE = 'com.im.nativebootstrap.staging'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def call(*parts, timeout=180, binary=False):
    data = subprocess.check_output(ADB + list(parts), timeout=timeout)
    return data if binary else data.decode('utf-8', errors='replace')


def main():
    global WORK,OUT
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work',default=str(WORK))
    parser.add_argument('--output',default=str(OUT))
    parser.add_argument('--version',default='0.3.1-media')
    parser.add_argument('--version-code',type=int,default=5)
    parser.add_argument('--min-tests',type=int,default=134)
    parser.add_argument('--ui-interaction',action='store_true')
    parser.add_argument('--instant-media',action='store_true')
    parser.add_argument('--chat-media-regression',action='store_true')
    args=parser.parse_args()
    WORK,OUT=Path(args.work).resolve(),Path(args.output).resolve()
    if ROOT not in WORK.parents or ROOT not in OUT.parents:
        raise ValueError('Evidence must stay inside workspace')
    if not all(c.isalnum() or c in '.-' for c in args.version):
        raise ValueError('Invalid artifact version')
    OUT.mkdir(parents=True, exist_ok=True)
    report = {'status': 'failed', 'version': args.version, 'versionCode': args.version_code,
              'scope': 'Staging Debug; localhost HTTPS media behavior, SDK unauthenticated smoke and synthetic UI',
              'production_media_performance': 'not_run', 'production_deployed': False,
              'ios_xcode_build': 'requires_Mac', 'source_files': []}
    try:
        log = (WORK / 'final-build.log').read_text(encoding='utf-8', errors='replace')
        assert 'BUILD SUCCESSFUL' in log and 'BUILD FAILED' not in log
        for task in ('testDebugUnitTest', 'assembleDebug', 'lintDebug', 'assembleDebugAndroidTest'):
            assert '> Task :app:' + task in log
        rows = [ET.parse(path).getroot() for path in (ROOT / 'IM-APP-android/app/build/test-results/testDebugUnitTest').glob('TEST-*.xml')]
        tests = {key: sum(int(row.get(key, 0)) for row in rows) for key in ('tests', 'failures', 'errors', 'skipped')}
        assert tests['tests'] >= args.min_tests and tests['failures'] == tests['errors'] == tests['skipped'] == 0
        lint = ET.parse(ROOT / 'IM-APP-android/app/build/reports/lint-results-debug.xml').getroot()
        assert not any(row.get('severity') in ('Error', 'Fatal') for row in lint.findall('issue'))
        report['build'] = {'tests': tests, 'lint_errors': 0, 'lint_warnings': sum(row.get('severity') == 'Warning' for row in lint.findall('issue'))}
        report['source_files'] = json.loads((WORK / 'frozen-source.json').read_text(encoding='utf-8'))
        assert all(digest(ROOT / row['path']) == row['sha256'] for row in report['source_files']), 'Android changed after source freeze'
        report['apk_sha256'], report['test_apk_sha256'] = digest(APK), digest(TEST)
        for path in (APK, TEST):
            assert 'Success' in call('install', '-r', str(path))
        print('Installed exact frozen APK and test APK', flush=True)
        for package, key in ((PACKAGE, 'installed_apk_sha256'), (PACKAGE + '.test', 'installed_test_apk_sha256')):
            paths = call('shell', 'pm', 'path', package).splitlines()
            remote = next(row[len('package:'):] for row in paths if row.endswith('/base.apk'))
            report[key] = call('shell', 'sha256sum', remote).split()[0].lower()
        assert report['apk_sha256'] == report['installed_apk_sha256']
        assert report['test_apk_sha256'] == report['installed_test_apk_sha256']
        package_info=call('shell','dumpsys','package',PACKAGE)
        assert 'versionName='+args.version in package_info
        assert int(re.search(r'\bversionCode=(\d+)\b',package_info).group(1))==args.version_code
        for name, extra in (('media', []), ('restart', ['-e', 'restart', 'true'])):
            if name == 'restart':
                call('shell', 'am', 'force-stop', PACKAGE)
            output = call('shell', 'am', 'instrument', '-w', *extra, PACKAGE + '.test/com.im.nativebootstrap.media.MediaPipelineInstrumentation')
            (OUT / (name + '.txt')).write_text(output, encoding='utf-8')
            assert 'mediaPipeline=passed:' in output and 'INSTRUMENTATION_CODE: -1' in output, output
            report[name] = output.strip().splitlines()
            print(name + ' verified', flush=True)
        (OUT / 'media-metrics.txt').write_text(call('shell', 'run-as', PACKAGE, 'cat', 'cache/media-pipeline-result.txt'), encoding='utf-8')
        verification = subprocess.run([sys.executable, '-X', 'utf8', '-B', str(ROOT / 'scripts/native/verify_android_local.py'),
                                       '--serial', '127.0.0.1:5581', '--output', str(OUT)], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=240)
        (OUT / 'device-run.log').write_text(verification.stdout + verification.stderr, encoding='utf-8')
        assert verification.returncode == 0, verification.stdout + verification.stderr
        report['device'] = json.loads((OUT / 'android-device.json').read_text(encoding='utf-8'))
        assert report['device']['status'] == 'passed' and report['device']['apk_sha256'] == report['apk_sha256']
        print('SDK, Keystore, GIF and 14 synthetic pages verified', flush=True)
        if args.ui_interaction:
            output=call('shell','am','instrument','-w',PACKAGE+'.test/com.im.nativebootstrap.UiParityInteractionInstrumentation')
            (OUT/'ui-interaction.txt').write_text(output,encoding='utf-8')
            assert all(marker in output for marker in ('directory=passed:','messageMenu=passed:','INSTRUMENTATION_CODE: -1')),output
            report['ui_interaction']=output.strip().splitlines()
            for name in ('contacts-scrolled','message-menu','message-multi'):
                data=call('exec-out','run-as',PACKAGE,'cat','cache/ui-interaction-'+name+'.png',binary=True)
                assert data.startswith(b'\x89PNG\r\n\x1a\n')
                (OUT/('ui-'+name+'.png')).write_bytes(data)
            print('Directory scrolling and message menu interactions verified',flush=True)
        if args.instant_media:
            output=call('shell','am','instrument','-w',PACKAGE+'.test/com.im.nativebootstrap.InstantMediaInstrumentation')
            (OUT/'instant-media.txt').write_text(output,encoding='utf-8')
            assert 'instantMedia=passed:' in output and 'INSTRUMENTATION_CODE: -1' in output,output
            report['instant_media']=output.strip().splitlines()
            for name in ('uploading','complete'):
                data=call('exec-out','run-as',PACKAGE,'cat','cache/instant-media-'+name+'.png',binary=True)
                assert data.startswith(b'\x89PNG\r\n\x1a\n')
                (OUT/('instant-media-'+name+'.png')).write_bytes(data)
            print('Instant local image rendering and SDK handoff verified',flush=True)
        if args.chat_media_regression:
            output=call('shell','am','instrument','-w',PACKAGE+'.test/com.im.nativebootstrap.ChatMediaRegressionInstrumentation')
            (OUT/'chat-media-regression.txt').write_text(output,encoding='utf-8')
            assert all(marker in output for marker in ('chatMediaRegression=passed:','emojiInteraction=passed:','videoPlayback=passed:','INSTRUMENTATION_CODE: -1')),output
            report['chat_media_regression']=output.strip().splitlines()
            for name in ('emoji-panel','portrait-bubble','playing','landscape-bubble'):
                data=call('exec-out','run-as',PACKAGE,'cat','cache/chat-media-'+name+'.png',binary=True)
                assert data.startswith(b'\x89PNG\r\n\x1a\n')
                (OUT/('chat-media-'+name+'.png')).write_bytes(data)
            print('Emoji keyboard interaction and actual local video playback verified',flush=True)
        call('shell', 'am', 'force-stop', PACKAGE)
        call('shell', 'am', 'start', '-n', PACKAGE + '/com.im.nativebootstrap.MainActivity')
        xml = ''
        for _ in range(8):
            time.sleep(1)
            try:
                dumped = call('shell', 'uiautomator', 'dump', '/sdcard/native-media-login.xml', timeout=30)
                if 'dumped to:' not in dumped:
                    continue
                xml = call('shell', 'cat', '/sdcard/native-media-login.xml')
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                continue
            if '登录' in xml:
                break
        assert '登录' in xml and '密码' in xml, 'Real login entry not visible'
        (OUT / 'login.xml').write_text(xml, encoding='utf-8')
        (OUT / 'login.png').write_bytes(call('exec-out', 'screencap', '-p', binary=True))
        report['login_entry'] = 'passed_no_credentials'
        assert all(digest(ROOT / row['path']) == row['sha256'] for row in report['source_files'])
        assert digest(APK) == report['apk_sha256'] and digest(TEST) == report['test_apk_sha256']
        target = ROOT / '.native-cache/deliverables' / ('IM-Android-'+args.version+'.apk')
        shutil.copyfile(APK, target)
        assert digest(target) == report['apk_sha256']
        report.update(status='passed', delivered_file=str(target), bytes=target.stat().st_size)
    except Exception as error:
        report['error'] = str(error)
    (OUT / 'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if report['status'] == 'passed':
        target = ROOT / '.native-cache/deliverables' / ('IM-Android-'+args.version+'-evidence.json')
        target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: report[key] for key in ('status', 'apk_sha256', 'error', 'delivered_file', 'bytes') if key in report}, ensure_ascii=False), flush=True)
    return report['status'] != 'passed'


if __name__ == '__main__':
    raise SystemExit(main())
