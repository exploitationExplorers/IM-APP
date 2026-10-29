const fs = require('node:fs')
const path = require('node:path')

const source = require('../src/content/legal.json')
const target = path.resolve(__dirname, '../src/static/legal')

function escapeHTML(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char])
}

fs.mkdirSync(target, { recursive: true })
for (const [kind, document] of Object.entries(source.documents)) {
  const paragraphs = (items, important = false) => items.map((text) =>
    `<p${important ? ' class="important"' : ''}>${escapeHTML(text)}</p>`).join('\n')
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHTML(document.title)}</title>
  <style>
    body { margin: 0; background: #fff; color: #333; font: 16px/1.9 system-ui, sans-serif; }
    main { max-width: 820px; margin: auto; padding: 32px 20px 64px; overflow-wrap: anywhere; }
    h1 { margin: 0 0 12px; font-size: 28px; line-height: 1.5; }
    h2 { margin: 32px 0 16px; font-size: 20px; line-height: 1.6; }
    p { margin: 0 0 16px; }
    .date { font-size: 14px; color: #636e86; }
    .important { font-weight: 600; }
  </style>
</head>
<body>
<main>
  <h1>${escapeHTML(document.title)}</h1>
  <p class="date">更新日期：${escapeHTML(source.updatedAt)}　生效日期：${escapeHTML(source.effectiveAt)}</p>
  ${paragraphs(document.introduction)}
  ${document.sections.map((section) => `<section><h2>${escapeHTML(section.title)}</h2>\n${paragraphs(section.paragraphs, section.important)}</section>`).join('\n')}
</main>
</body>
</html>
`
  fs.writeFileSync(path.join(target, `${kind}.html`), html)
}
console.log('Generated src/static/legal/agreement.html and privacy.html')
