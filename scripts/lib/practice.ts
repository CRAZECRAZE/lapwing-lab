import { parseOutline, StenoParseError } from '../../src/core/steno.ts'

export type PracticeItem = { prompt: string; outlines: string[] }
export type PracticeList = { id: string; items: PracticeItem[] }

export function parsePracticeFile(id: string, text: string): PracticeList {
  const byPrompt = new Map<string, PracticeItem>()
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '') return
    const where = `${id}, line ${index + 1}`
    const tab = line.indexOf('\t')
    if (tab < 0) throw new Error(`Practice list ${where}: expected "prompt<TAB>outline", got ${JSON.stringify(line)}`)
    const prompt = line.slice(0, tab)
    const outline = line.slice(tab + 1).trim()
    try {
      parseOutline(outline)
    } catch (e) {
      if (e instanceof StenoParseError) throw new Error(`Practice list ${where}: bad outline ${JSON.stringify(outline)} (${e.message})`)
      throw e
    }
    let item = byPrompt.get(prompt)
    if (!item) {
      item = { prompt, outlines: [] }
      byPrompt.set(prompt, item)
    }
    if (!item.outlines.includes(outline)) item.outlines.push(outline)
  })
  return { id, items: [...byPrompt.values()] }
}
