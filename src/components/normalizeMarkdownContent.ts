const CODE_FENCE_RE = /^\s*```/
const INLINE_DOLLAR_MATH_RE = /(^|[^\\$])\$([^$\n]+?)\$(?!\$)/g
const DISPLAY_BRACKET_MATH_RE = /\\\[([\s\S]*?)\\\]/g
const INLINE_BRACKET_MATH_RE = /\\\(([\s\S]*?)\\\)/g
const MONEY_RE = /\$(\d[\d,.]*(?:[kKmMbB])?)(?=\b)/g
const TEX_COMMAND_RE = /\\(?:frac|sqrt|sum|int|prod|lim|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|phi|psi|omega|pm|times|cdot|leq|geq|neq|approx|to|infty|left|right|begin|end|hat|bar|vec|partial|nabla|sin|cos|tan|log|ln|exp)\b/
const NATURAL_WORD_RE = /[A-Za-z]{3,}/g
const MATH_OPERATOR_RE = /[=^_<>+\-*/]/

type Segment = {
  kind: "text" | "code"
  value: string
}

function splitFencedSegments(content: string): Segment[] {
  const lines = content.split("\n")
  const segments: Segment[] = []
  let buffer: string[] = []
  let inFence = false

  const pushBuffer = (kind: Segment["kind"]) => {
    if (buffer.length === 0) return
    segments.push({ kind, value: buffer.join("\n") })
    buffer = []
  }

  for (const line of lines) {
    if (!inFence && CODE_FENCE_RE.test(line)) {
      pushBuffer("text")
      buffer.push(line)
      inFence = true
      continue
    }

    if (inFence) {
      buffer.push(line)
      if (CODE_FENCE_RE.test(line)) {
        pushBuffer("code")
        inFence = false
      }
      continue
    }

    buffer.push(line)
  }

  pushBuffer(inFence ? "code" : "text")
  return segments
}

function looksLikeSentence(text: string): boolean {
  const words = text.match(NATURAL_WORD_RE) || []
  return words.length >= 3 || /[.!?]/.test(text)
}

function isLikelyInlineMath(candidate: string): boolean {
  const trimmed = candidate.trim()
  if (!trimmed || trimmed.length > 120) return false
  if (trimmed.includes("`")) return false
  if (looksLikeSentence(trimmed)) return false

  const commandScore = TEX_COMMAND_RE.test(trimmed)
  const operatorScore = MATH_OPERATOR_RE.test(trimmed)
  const variableScore = /[A-Za-z]\d|\d[A-Za-z]|[A-Za-z]\^[A-Za-z0-9]|\{|\}/.test(trimmed)

  return commandScore || operatorScore || variableScore
}

function isLikelyCurrencyLine(line: string): boolean {
  if (!MONEY_RE.test(line)) return false
  MONEY_RE.lastIndex = 0

  if (TEX_COMMAND_RE.test(line) || MATH_OPERATOR_RE.test(line)) {
    return false
  }

  return looksLikeSentence(line)
}

function normalizeInlineDollarMath(text: string): string {
  return text.replace(INLINE_DOLLAR_MATH_RE, (match, prefix: string, candidate: string) => {
    if (!isLikelyInlineMath(candidate)) {
      return match
    }
    return `${prefix}$${candidate.trim()}$`
  })
}

function normalizeBracketMath(text: string): string {
  return text
    .replace(DISPLAY_BRACKET_MATH_RE, (_match, inner: string) => {
      const trimmed = inner.trim()
      return trimmed ? `$$\n${trimmed}\n$$` : _match
    })
    .replace(INLINE_BRACKET_MATH_RE, (_match, inner: string) => {
      const trimmed = inner.trim()
      if (!trimmed) return _match
      if (trimmed.includes("\n")) {
        return `$$\n${trimmed}\n$$`
      }
      return `$${trimmed}$`
    })
}

function wrapStandaloneMathLines(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed) return line
      if (trimmed.includes("$")) return line
      if (CODE_FENCE_RE.test(trimmed)) return line
      if (!TEX_COMMAND_RE.test(trimmed)) return line
      if (looksLikeSentence(trimmed)) return line

      const stripped = trimmed
        .replace(/\\[A-Za-z]+/g, " ")
        .replace(/[{}[\]()^_=<>+\-*/.,:;|]/g, " ")
      const naturalWords = stripped.match(NATURAL_WORD_RE) || []
      if (naturalWords.length > 0) return line

      return `$$\n${trimmed}\n$$`
    })
    .join("\n")
}

function normalizeTextSegment(segment: string): string {
  const withoutTrailingNoise = segment
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .map((line) => (isLikelyCurrencyLine(line) ? line.replace(MONEY_RE, "\\$$1") : line))
    .join("\n")

  return wrapStandaloneMathLines(normalizeBracketMath(normalizeInlineDollarMath(withoutTrailingNoise)))
}

function closeUnmatchedCodeFence(content: string): string {
  const fenceCount = content
    .split("\n")
    .filter((line) => CODE_FENCE_RE.test(line))
    .length

  return fenceCount % 2 === 0 ? content : `${content}\n\`\`\``
}

export function normalizeMarkdownContent(content: string): string {
  try {
    const normalized = content.replace(/\r\n?/g, "\n")
    const segments = splitFencedSegments(normalized)
    const repaired = segments
      .map((segment) => (segment.kind === "code" ? segment.value : normalizeTextSegment(segment.value)))
      .join("\n")

    return closeUnmatchedCodeFence(repaired).trimEnd()
  } catch {
    return content
  }
}
