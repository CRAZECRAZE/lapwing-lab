import { Marked } from 'marked'
import { tryParseStroke } from '../../src/core/steno.ts'
import { makeSlugger } from './slug.ts'

export type Heading = { id: string; title: string; level: number }
export type PracticeLink = { headingId: string; listId: string }
export type RenderedPage = {
  html: string
  headings: Heading[]
  practiceLinks: PracticeLink[]
  strokeCount: number
  outlineTagCount: number
}

const STROKE_TEXT = /^[#A-Z*\-/]+$/
const PRACTICE_HREF = /^practice\/([^/]+)\.txt$/
const PAGE_HREF = /^([^/#]+\.md)(#.*)?$/
const OUTLINE_TAG = /<steno-outline\b([^>]*)>\s*<\/steno-outline>/g
const IFRAME = /<iframe\b([^>]*)>\s*<\/iframe>/g
const MEDIA_SRC = /\b(src|poster|href)="img\//g

function escapeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function attr(attributes: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attributes)
  return match?.[1]
}

function isOutline(text: string): boolean {
  return STROKE_TEXT.test(text) && text.split('/').every((stroke) => tryParseStroke(stroke) !== null)
}

function plainText(inlineHtml: string): string {
  return inlineHtml
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

export function renderPage(markdown: string, pageIds: Record<string, string>): RenderedPage {
  const slug = makeSlugger()
  const headings: Heading[] = []
  const practiceLinks: PracticeLink[] = []
  let currentHeadingId = ''
  let codeStrokes = 0

  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const inline = this.parser.parseInline(tokens)
        const title = plainText(inline)
        const id = slug(title)
        currentHeadingId = id
        headings.push({ id, title, level: depth })
        return `<h${depth} id="${escapeAttr(id)}">${inline}</h${depth}>\n`
      },
      codespan({ text }) {
        if (!isOutline(text)) return false
        codeStrokes++
        return `<code class="stroke" data-stroke="${text}" tabindex="0">${text}</code>`
      },
      link({ href, title, tokens }) {
        const inline = this.parser.parseInline(tokens)
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : ''
        const practice = PRACTICE_HREF.exec(href)
        if (practice) {
          practiceLinks.push({ headingId: currentHeadingId, listId: practice[1] })
          return `<a class="practice-link" data-list="${escapeAttr(practice[1])}"${titleAttr}>${inline}</a>`
        }
        const page = PAGE_HREF.exec(href)
        if (page && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
          const pageId = pageIds[page[1]]
          if (pageId === undefined) throw new Error(`Link to unknown page ${JSON.stringify(href)}`)
          return `<a href="/page/${escapeAttr(pageId)}${escapeAttr(page[2] ?? '')}"${titleAttr}>${inline}</a>`
        }
        if (href.startsWith('img/')) {
          return `<a href="/media/${escapeAttr(href.slice('img/'.length))}"${titleAttr}>${inline}</a>`
        }
        const external = /^https?:/i.test(href) ? ' target="_blank" rel="noreferrer"' : ''
        return `<a href="${escapeAttr(href)}"${titleAttr}${external}>${inline}</a>`
      },
    },
  })

  let outlineTagCount = 0
  const html = (marked.parse(markdown, { async: false }) as string)
    .replace(OUTLINE_TAG, (_tag, attributes: string) => {
      const stroke = attr(attributes, 'stroke')
      if (stroke === undefined || !isOutline(stroke)) {
        throw new Error(`Bad <steno-outline> stroke ${JSON.stringify(stroke)}`)
      }
      outlineTagCount++
      return `<span class="stroke stroke-tag" data-stroke="${stroke}" tabindex="0">${stroke}</span>`
    })
    .replace(IFRAME, (_tag, attributes: string) => {
      const src = attr(attributes, 'src')
      if (src === undefined) throw new Error('<iframe> without src')
      return `<a class="needs-network" href="${src}" target="_blank" rel="noreferrer">Watch online (needs network)</a>`
    })
    .replace(MEDIA_SRC, '$1="/media/')
  if (html.includes('<steno-outline')) throw new Error('Unconverted <steno-outline> tag left in page')

  return { html, headings, practiceLinks, strokeCount: codeStrokes + outlineTagCount, outlineTagCount }
}
