import React from "react"
import ReactMarkdown from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import type { Components } from "react-markdown"

interface MarkdownMessageProps {
  content: string
  className?: string
}

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    "del",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ],
  attributes: {
    ...(defaultSchema.attributes || {}),
    code: [...(defaultSchema.attributes?.code || []), ["className"]],
    th: [...(defaultSchema.attributes?.th || []), ["align"]],
    td: [...(defaultSchema.attributes?.td || []), ["align"]],
  },
}

const components: Components = {
  a: ({ children }: { children?: React.ReactNode }) => <span className="text-inherit">{children}</span>,
}

const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content, className }) => {
  return (
    <div className={`markdown-message ${className || ""}`.trim()}>
      <ReactMarkdown
        // Keep assistant formatting, but never render raw HTML from model output.
        skipHtml
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export default MarkdownMessage
