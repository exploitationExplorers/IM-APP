"""生成历史图片性能方案的离线 HTML，不访问业务服务。"""
import html
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT / "docs/历史图片性能优化方案-20261113/历史图片性能优化方案.md"


def main():
    spec = importlib.util.spec_from_file_location("native_report", Path(__file__).with_name("render_native_report.py"))
    renderer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(renderer)
    body, toc = renderer.markdown(DOC.read_text(encoding="utf-8"))
    nav = "".join(f'<a href="#{key}">{html.escape(title)}</a>' for key, title in toc)
    document = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>历史聊天图片性能与流量优化方案</title>
<style>
:root{--ink:#17263a;--muted:#52677b;--line:#dce5ed;--blue:#1658ac;--teal:#08796e}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f3f6f9;color:var(--ink);font:15px/1.85 system-ui,"Microsoft YaHei",sans-serif}header{background:#122c46;color:white;padding:34px max(24px,calc((100vw - 1280px)/2))}header strong{font-size:28px;line-height:1.4;display:block}header p{color:#d1e0ee;margin:9px 0}.badge{display:inline-block;margin-top:12px;padding:4px 12px;border:1px solid #7799b8;border-radius:5px;font-size:12px}.layout{max-width:1340px;margin:26px auto;display:grid;grid-template-columns:245px minmax(0,1fr);gap:22px;padding:0 22px}nav{position:sticky;top:16px;align-self:start;background:#fff;border:1px solid var(--line);border-radius:8px;padding:12px}nav a{display:block;text-decoration:none;color:#3c5268;font-size:12px;padding:7px 8px;border-radius:4px}nav a:hover,nav a:focus{background:#edf4fb;color:var(--blue)}main{min-width:0;background:#fff;border:1px solid var(--line);border-radius:8px;padding:28px 34px}h1{font-size:27px;line-height:1.45;margin-top:0}h2{font-size:21px;line-height:1.5;margin:32px 0 16px;padding-top:24px;border-top:1px solid var(--line);scroll-margin-top:18px}p{margin:12px 0;overflow-wrap:anywhere}a{color:var(--blue)}code{font:12px/1.8 ui-monospace,Consolas,monospace;background:#eff3f7;border-radius:3px;padding:2px 4px;overflow-wrap:anywhere}pre{padding:20px;background:#14283e;color:#edf5ff;border-radius:7px;overflow:auto}pre code{background:none;padding:0;white-space:pre;color:inherit}.table-scroll{overflow-x:auto;margin:18px 0}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid var(--line);padding:11px 12px;vertical-align:top;text-align:left;min-width:110px}th{background:#edf3f9;color:#243f59}.decision{background:#edf8f5;border-left:4px solid var(--teal);padding:16px 20px;margin-bottom:24px}.decision strong{font-size:18px;color:#0a6259}.decision p{margin:6px 0}.flow{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:0;list-style:none;margin:18px 0}.flow li{border:1px solid var(--line);padding:16px;background:#f7f9fc;border-radius:6px;font-size:13px}.flow b{display:block;margin-bottom:7px;color:#164d80;font-size:15px}.flow small{color:var(--muted)}.note{font-size:12px;color:var(--muted)}footer{margin-top:28px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}@media(max-width:920px){.layout{display:block;padding:0 14px}nav{position:static;margin-bottom:18px;display:flex;flex-wrap:wrap}nav a{max-width:100%}main{padding:22px 18px}.flow{grid-template-columns:1fr}header strong{font-size:24px}}@media print{body{background:white}.layout{display:block;padding:0;margin:0}nav{display:none}main{padding:0;border:none}header{background:white;color:var(--ink);padding:15px 0}header p{color:var(--muted)}h2{break-after:avoid}tr{break-inside:avoid}.decision,.flow{break-inside:avoid}}
</style></head><body>
<header><strong>历史图片：先做到再次打开不重复传图</strong><p>保留现有 UI 与 OpenIM 内核，完善原生媒体缓存、请求调度和图片交付。</p><span class="badge">2026-11-13 · 源码 + REA 静态证据 · 性能指标待实测</span></header>
<div class="layout"><nav aria-label="方案目录">""" + nav + """</nav><main>
<section class="decision"><strong>建议：先建设自有 IMKit／媒体层</strong><p>当前证据支持优先修缓存身份、离屏取消、可见图片优先与真实缩略图；暂不支持从零重写整套消息 SDK。</p></section>
<section aria-label="缓存层级示意"><p class="note">机制示意，不代表参考软件运行数据；本地缓存未命中时才进入后续层级。</p><ol class="flow"><li><b>① 手机本地</b>内存 → 磁盘<br><small>有效且授权允许：直接显示，避免图像响应体下载。</small></li><li><b>② CDN 边缘</b>本地未命中 → 就近取图<br><small>仍有用户下行流量；命中减少回源，不能替代手机缓存。</small></li><li><b>③ 对象存储</b>CDN 未命中 → 回源<br><small>用真实缩略图减少字节，按权限与规格控制缓存。</small></li></ol></section>
""" + body + """<footer>本文可离线打开，无外部字体、脚本、资源或业务请求。拟定性能阈值不是实测结果；完整边界与证据链接见正文。配套 Markdown 是同内容的可编辑版本。</footer></main></div></body></html>"""
    target = DOC.with_suffix(".html")
    target.write_text(document, encoding="utf-8")
    print(f"Generated {target.relative_to(ROOT).as_posix()} ({target.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
