"""汇总真实本地证据；不把源码存在、合成截图或测试方法数当生产验收。"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
TASK = ROOT / '.workflow/scratch/20261113-native-full-parity'
EVIDENCE = ROOT / '.native-cache/verification/full-parity'


def load(name):
    path = EVIDENCE / name
    return json.loads(path.read_text(encoding='utf-8-sig')) if path.is_file() else {'status': 'not_run'}


def main():
    tests = {'tests': 0, 'failures': 0, 'errors': 0, 'skipped': 0}
    reports = list((ROOT / 'IM-APP-android/app/build/test-results/testDebugUnitTest').glob('TEST-*.xml'))
    for path in reports:
        suite = ET.parse(path).getroot()
        for key in tests:
            tests[key] += int(suite.get(key, '0'))
    tests['status'] = 'passed' if reports and not tests['failures'] and not tests['errors'] and not tests['skipped'] else 'failed' if reports else 'not_run'
    tests['scope'] = 'Latest local JUnit XML; build evidence must also match the delivered APK and final source snapshot'
    apk = ROOT / 'IM-APP-android/app/build/outputs/apk/debug/app-debug.apk'
    apk_data = {'sha256': hashlib.sha256(apk.read_bytes()).hexdigest(), 'bytes': apk.stat().st_size} if apk.is_file() else {'status': 'not_built'}
    source_count = sum(path.read_text(encoding='utf-8-sig').count('func test') for path in (ROOT / 'IM-APP-ios/Packages/IMCore/Tests').rglob('*.swift'))
    result = {
        'status': 'in_progress_pending_real_account_and_Mac_acceptance',
        'collected_at': datetime.now(timezone.utc).isoformat(),
        'version': {'Android': '0.3.0-parity (4)', 'iOS': '0.3.0 (4)'},
        'scope': 'Local development evidence, not full feature/UI equivalence or production readiness',
        'android': {'apk': apk_data, 'unit_tests': tests, 'build': load('android-build.json'),
                    'device': load('android-device.json'), 'login_UI': load('android-login-ui.json')},
        'ios': {'project_static': load('ios-project-static.json'), 'syntax': load('ios-syntax.json'),
                'core_test_methods_in_source': source_count, 'core_tests': 'not_run_no_Mac',
                'Xcode_build': 'not_run_no_Mac', 'iPhone_database_and_sync': 'not_run'},
        'assets': load('assets.json'), 'protected_source': load('protected-source.json'),
        'report_browser': load('parity-report-browser.json'),
        'not_verified': ['Real account authentication and legacy/native interoperability', 'All routes and full UI equivalence on physical devices',
                         'APNs/vendor push delivery and real-time calls', 'Signed upgrade and old local database migration',
                         'Large real history performance and iOS sync recovery'],
        'backend_modified': False, 'backend_deployed': False, 'client_published': False,
    }
    TASK.mkdir(parents=True, exist_ok=True)
    (TASK / 'verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': result['status'], 'android_tests': tests, 'apk': apk_data, 'ios_tests': 'not_run'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
