import React from "react"
import ReactMarkdown from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import type { Components } from "react-markdown"
import "katex/dist/katex.min.css"
import { normalizeMarkdownContent } from "./normalizeMarkdownContent"

interface MarkdownMessageProps {
  content: string
  className?: string
}

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    "annotation",
    "del",
    "div",
    "math",
    "menclose",
    "mfrac",
    "mi",
    "mn",
    "mo",
    "mover",
    "mpadded",
    "mroot",
    "mrow",
    "mspace",
    "msqrt",
    "mstyle",
    "msub",
    "msubsup",
    "msup",
    "mtable",
    "mtd",
    "mtext",
    "mtr",
    "munder",
    "munderover",
    "semantics",
    "span",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ],
  attributes: {
    ...(defaultSchema.attributes || {}),
    annotation: [...(defaultSchema.attributes?.annotation || []), ["encoding"]],
    code: [...(defaultSchema.attributes?.code || []), ["className"]],
    div: [...(defaultSchema.attributes?.div || []), ["className"]],
    math: [...(defaultSchema.attributes?.math || []), ["className"], ["display"], ["xmlns"]],
    mi: [...(defaultSchema.attributes?.mi || []), ["mathvariant"]],
    mo: [...(defaultSchema.attributes?.mo || []), ["stretchy"]],
    mspace: [...(defaultSchema.attributes?.mspace || []), ["width"]],
    mstyle: [...(defaultSchema.attributes?.mstyle || []), ["scriptlevel"]],
    span: [...(defaultSchema.attributes?.span || []), ["ariaHidden"], ["className"]],
    th: [...(defaultSchema.attributes?.th || []), ["align"]],
    td: [...(defaultSchema.attributes?.td || []), ["align"]],
  },
}

const components: Components = {
  a: ({ children }: { children?: React.ReactNode }) => <span className="text-inherit">{children}</span>,
}

type RenderMode = "math" | "markdown" | "plain"

class MarkdownRenderBoundary extends React.Component<{
  children: React.ReactNode
  onError: () => void
  resetKey: string
}, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode; onError: () => void; resetKey: string }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }

  componentDidCatch(): void {
    this.props.onError()
  }

  componentDidUpdate(prevProps: Readonly<{ children: React.ReactNode; onError: () => void; resetKey: string }>): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false })
    }
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return null
    }
    return this.props.children
  }
}

function MarkdownRenderer({ content, mode }: { content: string; mode: Exclude<RenderMode, "plain"> }): React.ReactElement {
  const remarkPlugins: any = mode === "math"
    ? [remarkGfm, remarkBreaks, remarkMath]
    : [remarkGfm, remarkBreaks]

  const rehypePlugins: any = mode === "math"
    ? [[rehypeSanitize, sanitizeSchema], rehypeKatex]
    : [[rehypeSanitize, sanitizeSchema]]

  return (
    <ReactMarkdown
      // Keep assistant formatting, but never render raw HTML from model output.
      skipHtml
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {content}
    </ReactMarkdown>
  )
}

const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content, className }) => {
  const normalizedContent = normalizeMarkdownContent(content)
  const [mode, setMode] = React.useState<RenderMode>("math")

  React.useEffect(() => {
    setMode("math")
  }, [normalizedContent])

  const handleRenderError = () => {
    setMode((current) => {
      if (current === "math") return "markdown"
      if (current === "markdown") return "plain"
      return "plain"
    })
  }

  return (
    <div className={`markdown-message ${mode === "plain" ? "markdown-message--plain" : ""} ${className || ""}`.trim()}>
      {mode === "plain" ? (
        <pre className="markdown-message__plain-text">{normalizedContent}</pre>
      ) : (
        <MarkdownRenderBoundary onError={handleRenderError} resetKey={`${mode}:${normalizedContent}`}>
          <MarkdownRenderer content={normalizedContent} mode={mode} />
        </MarkdownRenderBoundary>
      )}
    </div>
  )
}

export default MarkdownMessage
