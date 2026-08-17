const URL_PATTERN = /https?:\/\/[^\s]+/giu;
const TRAILING_PUNCTUATION = /[.,!?;:，。！？；：)\]}]+$/u;

export interface RichTextParagraph {
  segments: Array<{ text: string; bold: boolean }>;
}

function linkify(content: string, paragraphIndex: number) {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  for (const match of content.matchAll(URL_PATTERN)) {
    const index = match.index;
    const matched = match[0];
    if (index > cursor) nodes.push(content.slice(cursor, index));

    const trailing = matched.match(TRAILING_PUNCTUATION)?.[0] ?? "";
    const url = trailing ? matched.slice(0, -trailing.length) : matched;
    nodes.push(
      <a
        key={`${paragraphIndex}-${index}-${url}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-4 hover:opacity-70"
      >
        {url}
      </a>,
    );
    if (trailing) nodes.push(trailing);
    cursor = index + matched.length;
  }

  if (cursor < content.length) nodes.push(content.slice(cursor));

  return nodes;
}

export function TextContent({
  content,
  paragraphs: richParagraphs,
  lineHeight = "normal",
}: {
  content?: string;
  paragraphs?: RichTextParagraph[];
  lineHeight?: "normal" | "relaxed";
}) {
  const paragraphs =
    richParagraphs ??
    (content ?? "").split(/\r\n|\r|\n/u).map((text) => ({
      segments: [{ text, bold: false }],
    }));

  return (
    <div className="flex flex-col gap-[0.4em]">
      {paragraphs.map((paragraph, index) => (
        <p
          key={index}
          className={`break-words whitespace-pre-wrap text-base ${
            lineHeight === "relaxed" ? "leading-[2]" : "leading-[1.6]"
          }`}
        >
          {paragraph.segments.length > 0
            ? paragraph.segments.map((segment, segmentIndex) => {
                const value = segment.text
                  ? linkify(segment.text, index * 1000 + segmentIndex)
                  : "\u00a0";
                return segment.bold ? (
                  <strong key={segmentIndex}>{value}</strong>
                ) : (
                  <span key={segmentIndex}>{value}</span>
                );
              })
            : "\u00a0"}
        </p>
      ))}
    </div>
  );
}
