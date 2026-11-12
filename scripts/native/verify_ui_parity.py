"""只校验原生资源来源与副本，不将静态检查等同视觉验收。"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify():
    manifest = json.loads((ROOT / 'contracts/ui-parity/v1/asset-source-manifest.json').read_text(encoding='utf-8'))
    errors = []
    checked = 0
    for record in manifest['records']:
        source = ROOT / record['source']
        if not source.is_file() or digest(source) != record['source_sha256']:
            errors.append('Original source changed: ' + record['source'])
        for relative in record['destinations']:
            path = ROOT / relative
            if not path.is_file() or digest(path) != record['output_sha256']:
                errors.append('Native asset drift: ' + relative)
                continue
            if record['transformation'] == 'byte-copy' and digest(path) != record['source_sha256']:
                errors.append('Byte copy mismatch: ' + relative)
            if 'imageset' in relative:
                contents = json.loads((path.parent / 'Contents.json').read_text(encoding='utf-8'))
                if not any(i.get('filename') == path.name for i in contents.get('images', [])):
                    errors.append('Missing image catalog wiring: ' + relative)
            if relative.endswith('.png'):
                data = path.read_bytes()
                if data[:8] != b'\x89PNG\r\n\x1a\n':
                    errors.append('Invalid PNG: ' + relative)
                elif record['name'] == 'uni_logo' and struct.unpack('>II', data[16:24]) != (168, 168):
                    errors.append('Logo was not downsampled: ' + relative)
            checked += 1
    project = (ROOT / 'IM-APP-ios/IMNative.xcodeproj/project.pbxproj').read_text(encoding='utf-8')
    for marker in ['Assets.xcassets in Resources', 'Legal in Resources']:
        if marker not in project:
            errors.append('Missing Xcode resource wiring: ' + marker)
    return {'status': 'passed' if not errors else 'failed', 'scope': 'asset provenance and static resource wiring only',
            'assets': len(manifest['records']), 'native_copies_checked': checked, 'errors': errors,
            'visual_equivalence': 'not_verified', 'ios_runtime': 'not_run', 'device_performance': 'not_run'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = verify()
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding='utf-8')
    print(rendered)
    raise SystemExit(int(bool(result['errors'])))
