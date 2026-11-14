#!/bin/bash
# 在 Mac 上执行真实核心测试与模拟器编译，失败即停并保留日志；不提交账号或部署。
set -euo pipefail
task_ios_root="$(cd "$(dirname "$0")/.." && pwd)"
task_repo_root="$(cd "$task_ios_root/.." && pwd)"
task_evidence="$task_repo_root/verification/mac"
mkdir -p "$task_evidence"
task_step=environment
task_result=failed
finish_report() {
  TASK_RESULT="$task_result" TASK_STEP="$task_step" python3 - "$task_evidence/result.json" <<'PY'
import json, os, pathlib, platform, sys
pathlib.Path(sys.argv[1]).write_text(json.dumps({
    'status': os.environ['TASK_RESULT'], 'last_step': os.environ['TASK_STEP'],
    'machine': platform.machine(), 'macOS': platform.mac_ver()[0],
    'scope': 'Swift core tests and unsigned iOS Simulator Debug build only',
    'real_account_interoperability': 'not_run', 'iPhone_database_sync': 'not_run',
    'release_or_deployment': 'not_run'
}, ensure_ascii=False, indent=2) + '\n')
PY
}
trap finish_report EXIT
if [[ "$(uname -s)" != Darwin ]]; then
  echo "请在安装完整 Xcode 的 Mac 上运行本脚本。" >&2
  exit 1
fi
{
  xcode-select -p
  xcodebuild -version
  swift --version
  ruby --version
  bundle --version
  python3 --version
} 2>&1 | tee "$task_evidence/environment.log"
cd "$task_repo_root"
task_step=static
python3 IM-APP-ios/scripts/verify_project.py 2>&1 | tee "$task_evidence/project-check.log"
task_step=core_tests
swift test --package-path IM-APP-ios/Packages/IMCore 2>&1 | tee "$task_evidence/core-tests.log"
cd "$task_ios_root"
task_step=bundle_install
bundle config set --local path vendor/bundle
bundle install 2>&1 | tee "$task_evidence/bundle-install.log"
task_step=pod_install
bundle exec pod install --repo-update 2>&1 | tee "$task_evidence/pod-install.log"
cp Podfile.lock "$task_evidence/Podfile.lock"
if [[ -f Gemfile.lock ]]; then cp Gemfile.lock "$task_evidence/Gemfile.lock"; fi
task_step=simulator_build
xcodebuild -workspace IMNative.xcworkspace -scheme IMNative \
  -sdk iphonesimulator -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$task_repo_root/.native-cache/DerivedData" \
  CODE_SIGNING_ALLOWED=NO build 2>&1 | tee "$task_evidence/simulator-build.log"
task_step=complete
task_result=passed
echo "核心测试和模拟器构建成功。用 Xcode 打开 IM-APP-ios/IMNative.xcworkspace 运行，再按 README-Mac.md 完成真机验证。"
echo "日志：$task_evidence"
