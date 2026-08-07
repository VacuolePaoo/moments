const URL_PATTERN = /https?:\/\/[^\s]+/giu
const TRAILING_PUNCTUATION = /[.,!?;:，。！？；：)\]}]+$/u

export function TextContent({ content }: { content: string }) {
  const nodes: React.ReactNode[] = []
  let cursor = 0

  for (const match of content.matchAll(URL_PATTERN)) {
    const index = match.index
    const matched = match[0]
    if (index > cursor) nodes.push(content.slice(cursor, index))

    const trailing = matched.match(TRAILING_PUNCTUATION)?.[0] ?? ""
    const url = trailing ? matched.slice(0, -trailing.length) : matched
    nodes.push(
      <a
        key={`${index}-${url}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-4 hover:opacity-70"
      >
        {url}
      </a>
    )
    if (trailing) nodes.push(trailing)
    cursor = index + matched.length
  }

  if (cursor < content.length) nodes.push(content.slice(cursor))

  return (
    <p className="whitespace-pre-wrap break-words text-base leading-6 [overflow-wrap:anywhere]">
      {nodes}
    </p>
  )
}
