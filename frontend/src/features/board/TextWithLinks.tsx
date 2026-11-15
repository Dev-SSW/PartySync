import type { ReactNode } from 'react'

/** 일반 텍스트를 그대로 이스케이프하고 HTTP(S) 주소만 링크로 만듭니다. */
export function TextWithLinks({ content }: { content: string }) {
  const parts: ReactNode[] = []
  const matcher = /https?:\/\/[^\s<>"'`]+/gi
  let offset = 0
  for (const match of content.matchAll(matcher)) {
    const start = match.index!
    const text = match[0].replace(/[.,!;]+$/, '')
    parts.push(content.slice(offset, start))
    try {
      const url = new URL(text)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported URL')
      parts.push(<a key={start} href={url.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{text}</a>)
    } catch { parts.push(text) }
    offset = start + text.length
  }
  parts.push(content.slice(offset))
  return <div className="post-content">{parts}</div>
}
