export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, '&#96;')
}

function renderInlineMarkdown(text: string) {
  let html = escapeHtml(text)

  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>')
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, label, url) => `<a href="${escapeAttribute(url)}" target="_blank" rel="noreferrer">${label}</a>`
  )

  return html
}

function renderList(block: string, ordered: boolean) {
  const items = block
    .split(/\n/)
    .map(line => line.replace(ordered ? /^\d+\.\s+/ : /^[-*+]\s+/, '').trim())
    .filter(Boolean)
    .map(item => `<li>${renderInlineMarkdown(item)}</li>`)
    .join('')

  return ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`
}

function renderParagraph(block: string) {
  return `<p>${renderInlineMarkdown(block).replace(/\n/g, '<br />')}</p>`
}

function renderBlock(block: string) {
  const trimmed = block.trim()
  if (!trimmed) return ''

  const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)
  if (headingMatch) {
    const level = headingMatch[1].length
    return `<h${level}>${renderInlineMarkdown(headingMatch[2].trim())}</h${level}>`
  }

  if (trimmed.startsWith('>')) {
    const lines = trimmed
      .split(/\n/)
      .map(line => line.replace(/^>\s?/, ''))
      .join('<br />')
    return `<blockquote>${renderInlineMarkdown(lines)}</blockquote>`
  }

  if (trimmed.split(/\n/).every(line => /^[-*+]\s+/.test(line.trim()))) {
    return renderList(trimmed, false)
  }

  if (trimmed.split(/\n/).every(line => /^\d+\.\s+/.test(line.trim()))) {
    return renderList(trimmed, true)
  }

  return renderParagraph(trimmed)
}

export function renderMarkdown(value?: string | null) {
  const source = String(value || '').replace(/\r\n/g, '\n').trim()
  if (!source) return ''

  const blocks: string[] = []
  let cursor = 0
  const codeBlockPattern = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g

  for (const match of source.matchAll(codeBlockPattern)) {
    const index = match.index ?? 0
    const before = source.slice(cursor, index).trim()
    if (before) {
      blocks.push(...before.split(/\n\s*\n/).map(renderBlock).filter(Boolean))
    }

    const language = String(match[1] || '').trim()
    const code = escapeHtml(String(match[2] || '').replace(/\n$/, ''))
    const className = language ? ` class="language-${escapeAttribute(language)}"` : ''
    blocks.push(`<pre><code${className}>${code}</code></pre>`)
    cursor = index + match[0].length
  }

  const trailing = source.slice(cursor).trim()
  if (trailing) {
    blocks.push(...trailing.split(/\n\s*\n/).map(renderBlock).filter(Boolean))
  }

  return blocks.join('')
}
