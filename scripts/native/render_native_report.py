"""将项目原生方案 Markdown 渲染为可离线打开的 HTML，无第三方依赖。"""
import base64
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT / 'docs/原生重构方案-20261112/原生重构方案.md'


def inline(text):
    parts = re.split(r'(`[^`]+`)', text)
    return ''.join('<code>' + html.escape(part[1:-1]) + '</code>' if part.startswith('`') else html.escape(part) for part in parts)


def markdown(source):
    rows = source.splitlines()
    result, toc = [], []
    index = 0
    while index < len(rows):
        row = rows[index]
        if not row.strip():
            index += 1
            continue
        if row.startswith('```'):
            body = []
            index += 1
            while index < len(rows) and not rows[index].startswith('```'):
                body.append(rows[index])
                index += 1
            result.append('<pre><code>' + html.escape('\n'.join(body)) + '</code></pre>')
        elif row.startswith('#'):
            level = len(row) - len(row.lstrip('#'))
            title = row[level:].strip()
            key = 'section-' + str(len(toc)) if level == 2 else 'document-title'
            if level == 2:
                toc.append((key, title))
            result.append(f'<h{level} id="{key}">{inline(title)}</h{level}>')
        elif row.startswith('|'):
            table = []
            while index < len(rows) and rows[index].startswith('|'):
                table.append([part.strip() for part in rows[index].strip('|').split('|')])
                index += 1
            result.append('<div class="table-scroll"><table><thead><tr>' + ''.join('<th>' + inline(c) + '</th>' for c in table[0]) + '</tr></thead><tbody>')
            for cells in table[2:]:
                result.append('<tr>' + ''.join('<td>' + inline(c) + '</td>' for c in cells) + '</tr>')
            result.append('</tbody></table></div>')
            continue
        else:
            result.append('<p>' + inline(row) + '</p>')
        index += 1
    return '\n'.join(result), toc


def embedded_image(relative, caption):
    path = ROOT / relative
    if not path.is_file():
        return '<p>截图未随本地环境生成：' + html.escape(relative) + '</p>'
    data = base64.b64encode(path.read_bytes()).decode('ascii')
    return f'<figure><img src="data:image/png;base64,{data}" alt="{html.escape(caption)}"><figcaption>{html.escape(caption)}</figcaption></figure>'


def main():
    body, toc = markdown(DOC.read_text(encoding='utf-8'))
    nav = ''.join(f'<a href="#{key}">{html.escape(title)}</a>' for key, title in toc)
    gallery = ''.join(embedded_image(path, title) for path, title in [
        ('.native-cache/verification/uniapp-login-baseline.png', '旧 uni-app 本地 H5 基准：注入状态栏占位'),
        ('.native-cache/verification/android-parity-login-final.png', 'Android 原生：同逻辑宽度登录页'),
        ('.native-cache/verification/android-parity-conversations.png', 'Android 原生：原图标与本地样例列表'),
        ('.native-cache/verification/android-parity-chat-final.png', 'Android 原生：原样式文本聊天，仅内存样例'),
    ])
    inventory = json.loads((ROOT / 'contracts/ui-parity/v1/page-inventory.json').read_text(encoding='utf-8'))
    states = {'native_implemented_local_validation': '登录已接业务 API，真实账号待验', 'sample_ui_implemented': '样例列表 UI，真实会话待接入', 'sample_text_ui_implemented': '样例文本 UI', 'tab_only_body_not_implemented': '导航 / 部分正文，完整页面待还原', 'not_implemented': '待实现 / 判断原生适用性'}
    page_rows = ''.join('<tr><td><code>' + html.escape(row['page']) + '</code></td><td>' + states[row['status']] + '</td></tr>' for row in inventory['pages'])
    document = '''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>易可聊 · 双端原生重构方案</title>
<style>
:root{color-scheme:light;--ink:#18233b;--blue:#0a2fc2;--line:#e1e6ef}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f4f6fa;color:var(--ink);font:15px/1.85 system-ui,"Microsoft YaHei",sans-serif}header{padding:36px max(24px,calc((100vw - 1280px)/2));background:#0c1b54;color:#fff}header strong{font-size:26px}header p{color:#d9e3fb;margin:6px 0}header span{display:inline-block;margin-top:12px;padding:4px 12px;background:#fff;color:#1233b2;border-radius:5px;font-size:13px}.layout{max-width:1336px;margin:24px auto;display:grid;grid-template-columns:240px minmax(0,1fr);gap:24px;padding:0 24px}nav{position:sticky;top:16px;align-self:start;padding:14px;background:#fff;border:1px solid var(--line);border-radius:8px}nav a{display:block;padding:6px 8px;color:#304260;text-decoration:none;font-size:13px;border-radius:4px}nav a:hover{background:#edf2ff;color:var(--blue)}main{padding:28px 36px;background:#fff;border:1px solid var(--line);border-radius:8px;min-width:0}h1{font-size:27px;line-height:1.4;margin-top:0}h2{font-size:21px;padding-top:24px;border-top:1px solid var(--line);margin-top:30px;scroll-margin-top:16px}p{margin:12px 0;overflow-wrap:anywhere}code{font:13px/1.7 ui-monospace,Consolas,monospace;background:#eff2f7;padding:2px 4px;border-radius:3px;overflow-wrap:anywhere}pre{background:#101c37;color:#e1eaff;padding:18px;overflow:auto;border-radius:6px}pre code{background:none;color:inherit;padding:0;white-space:pre}.table-scroll{overflow:auto;margin:16px 0}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:11px 12px;border:1px solid var(--line);text-align:left;vertical-align:top}th{background:#f1f5fc;color:#243a61}details{padding:18px;background:#f6f8fc;border:1px solid var(--line);border-radius:6px;margin:24px 0}summary{cursor:pointer;font-weight:650;color:var(--blue)}.gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-top:20px}figure{margin:0;text-align:center}figure img{display:block;max-width:100%;max-height:550px;width:auto;margin:auto;border:1px solid #d8deea;border-radius:8px}figcaption{font-size:12px;margin-top:8px;color:#566780}input{width:100%;padding:10px 12px;margin:16px 0;border:1px solid #b7c4dc;border-radius:5px;font:inherit}.note{padding:14px 18px;border-left:3px solid var(--blue);background:#eef3ff;color:#31486d}footer{padding:20px 0;color:#66758d;font-size:12px}@media(max-width:900px){.layout{display:block;padding:0 14px}nav{position:static;margin-bottom:16px;display:flex;flex-wrap:wrap}nav a{max-width:100%}main{padding:22px 18px}.gallery{grid-template-columns:1fr}}@media print{body{background:#fff}.layout{display:block;margin:0;padding:0}nav{display:none}main{border:0;padding:0}header{padding:16px;background:#fff;color:#18233b}header p{color:#333}details{break-inside:avoid}h2{break-after:avoid}.gallery img{max-height:400px}}
</style></head><body><header><strong>易可聊 · 双端原生重构</strong><p>保留现有 uni-app UI，改善性能与消息可靠性。</p><span>本地阶段 · 2026-11-12 · iOS 运行待 Mac 验证</span></header>
<div class="layout"><nav aria-label="方案目录">''' + nav + '''<a href="#screenshots">首轮界面对照</a><a href="#page-inventory">旧路由覆盖表</a></nav><main>''' + body + '''
<section id="screenshots"><h2>首轮界面对照</h2><p class="note">以下为实际本地截图。旧 H5 登录基准使用 360 × 616 逻辑视口，注入 24 状态栏占位；Android 窗口为 360 × 640，含系统栏。系统字体与平台绘制存在差异。本轮未对全部页面做像素一致验收，iOS 尚无运行截图。</p><details open><summary>查看旧版与 Android 原生界面</summary><div class="gallery">''' + gallery + '''</div></details></section>
<section id="page-inventory"><h2>旧路由覆盖表</h2><p>73 条为旧 pages.json 中路由的静态清单，包含条件编译页面。待实现项没有计为完成，H5 专属页需另判断原生适用性。</p><details><summary>展开页面清单，可按名称过滤</summary><label for="route-filter">页面名称</label><input id="route-filter" type="search" placeholder="例如 chat、contacts、auth"><div class="table-scroll"><table><thead><tr><th>旧页面</th><th>当前范围</th></tr></thead><tbody id="routes">''' + page_rows + '''</tbody></table></div></details></section>
<footer>本文由仓库 Markdown 与本地截图生成，可离线查看，无外部脚本或业务请求。实际实现边界以测试证据和平台运行结果为准。</footer></main></div>
<script>document.getElementById('route-filter').addEventListener('input',event=>{const value=event.target.value.toLowerCase().trim();for(const row of document.querySelectorAll('#routes tr'))row.hidden=!row.textContent.toLowerCase().includes(value)});</script></body></html>'''
    target = DOC.with_suffix('.html')
    target.write_text(document, encoding='utf-8')
    print(f'Generated {target.relative_to(ROOT).as_posix()} ({target.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
