"""检查新增原生工程的接线和现有源码基线；不访问任何服务。"""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BASELINE = ROOT / ".workflow/scratch/20261112-native-bootstrap/existing-source-baseline.json"


def verify(baseline, protected_prefixes):
    errors = []
    required = [
        "IM-APP-android/settings.gradle.kts",
        "IM-APP-android/app/build.gradle.kts",
        "IM-APP-android/app/src/main/AndroidManifest.xml",
        "IM-APP-ios/Packages/IMCore/Package.swift",
        "IM-APP-ios/IMNative.xcodeproj/project.pbxproj",
        "IM-APP-ios/IMNative.xcodeproj/xcshareddata/xcschemes/IMNative.xcscheme",
        ".github/workflows/native-checks.yml",
    ]
    for rel in required:
        if not (ROOT / rel).is_file():
            errors.append("Missing: " + rel)

    parsed_xml = []
    for folder in [ROOT / "IM-APP-android/app/src", ROOT / "IM-APP-ios"]:
        if not folder.exists():
            continue
        for pattern in ["*.xml", "*.plist", "*.xcscheme"]:
            for path in folder.rglob(pattern):
                if any(p in {"build", ".build", "DerivedData"} for p in path.parts):
                    continue
                try:
                    ET.parse(path)
                    parsed_xml.append(path.relative_to(ROOT).as_posix())
                except ET.ParseError as exc:
                    errors.append(str(path.relative_to(ROOT)) + ": " + str(exc))

    project = ROOT / "IM-APP-ios/IMNative.xcodeproj/project.pbxproj"
    if project.is_file():
        source = project.read_text(encoding="utf-8-sig")
        for marker in ["IMCore", "XCLocalSwiftPackageReference", "XCSwiftPackageProductDependency", "PBXSourcesBuildPhase"]:
            if marker not in source:
                errors.append("iOS project wiring is missing " + marker)

    fixture_source = ROOT / "contracts/native-bootstrap/v1/fixtures"
    shared_fixtures = {p.name: p.read_bytes() for p in fixture_source.glob("*.json")}
    checked_copies = []
    for folder in [ROOT / "IM-APP-android/app/src/test", ROOT / "IM-APP-ios/Packages/IMCore/Tests"]:
        if not folder.exists():
            continue
        for path in folder.rglob("*.json"):
            if path.name in shared_fixtures:
                if path.read_bytes() != shared_fixtures[path.name]:
                    errors.append("Fixture drift: " + path.relative_to(ROOT).as_posix())
                checked_copies.append(path.relative_to(ROOT).as_posix())

    checked_source_files = 0
    baseline_state = "not_available"
    other_workspace_changes = []
    if baseline.is_file():
        expected = json.loads(baseline.read_text(encoding="utf-8-sig"))
        for rel, digest in expected.items():
            path = ROOT / rel
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                if any(rel.startswith(prefix) for prefix in protected_prefixes):
                    errors.append("Protected source changed since task start: " + rel)
                else:
                    other_workspace_changes.append(rel)
            checked_source_files += 1
        baseline_state = "protected_paths_matched" if not any(e.startswith("Protected source") for e in errors) else "changed"

    return {
        "status": "passed" if not errors else "failed",
        "scope": "static wiring and local source baseline; not a platform build or runtime test",
        "required_files": len(required),
        "parsed_xml": parsed_xml,
        "fixture_copies_checked": checked_copies,
        "source_baseline": {"status": baseline_state, "files_checked": checked_source_files, "protected_prefixes": protected_prefixes},
        "other_workspace_changes": other_workspace_changes,
        "errors": errors,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument("--require-baseline", action="store_true")
    parser.add_argument("--protected-prefix", action="append", help="Fail on changes under these baseline prefixes; default is the backend. Other concurrent workspace changes are reported separately.")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    check = subprocess.run([sys.executable, "-X", "utf8", str(ROOT / "scripts/native/verify_contracts.py")], cwd=ROOT, check=False)
    result = verify(args.baseline, args.protected_prefix or ["IM-APP-server/"])
    if check.returncode:
        result["errors"].append("Contract verifier failed")
    if args.require_baseline and not args.baseline.is_file():
        result["errors"].append("Required local source baseline is absent")
    result["status"] = "failed" if result["errors"] else "passed"
    output = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output + "\n", encoding="utf-8")
    print(output)
    return int(bool(result["errors"]))


if __name__ == "__main__":
    sys.exit(main())
