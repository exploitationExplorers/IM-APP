"""提取旧页面的入口、交互与 API 依赖，供原生逐页核对；不据此判定已完成。"""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONT = ROOT / 'IM-APP-fronend/src'


def audit():
    routing = (FRONT / 'pages.json').read_text(encoding='utf-8-sig')
    records = []
    for match in re.finditer(r'"path"\s*:\s*"(pages/[^\"]+)"', routing):
        route = match.group(1)
        path = FRONT / (route + '.vue')
        source = path.read_text(encoding='utf-8-sig') if path.is_file() else ''
        block_end = routing.find('"path"', match.end())
        block = routing[match.end():block_end if block_end != -1 else len(routing)]
        title = re.search(r'"navigationBarTitleText"\s*:\s*"([^\"]*)"', block)
        imports = re.findall(r"(?:from\s*|import\s*)['\"](@/[^'\"]+)['\"]", source)
        api_functions = {}
        for module in imports:
            if not module.startswith('@/api/'): continue
            api_path = FRONT / (module[2:] + '.ts')
            if api_path.is_file():
                api = api_path.read_text(encoding='utf-8-sig')
                api_functions[module] = sorted(set(re.findall(r'export\s+(?:async\s+)?function\s+(\w+)', api)))
        records.append({
            'route': route, 'title': title.group(1) if title else '',
            'source': path.relative_to(ROOT).as_posix(),
            'source_sha256': hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None,
            'interactions': sorted(set(re.findall(r'@(?:click|change|confirm|submit|longpress|input|refresherrefresh|scrolltolower)\s*=\s*"([^\"]+)"', source))),
            'navigation_targets': sorted(set(re.findall(r'/pages/[A-Za-z0-9_/-]+', source))),
            'imports': sorted(set(imports)), 'available_imported_api_functions': api_functions,
            'native_applicability': 'h5_only' if route == 'pages/download/index' else 'review_source_platform_branches',
            'implementation_status': 'not_assessed_by_this_audit',
        })
    return {'source': 'IM-APP-fronend/src/pages.json', 'route_count': len(records),
            'purpose': 'Original implementation requirements only; static presence is not functional or visual parity.', 'pages': records}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = audit()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f"Recorded {report['route_count']} original routes and their actions: {args.output}")
