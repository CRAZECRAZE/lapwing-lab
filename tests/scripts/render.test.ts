import { describe, expect, it } from 'vitest'
import { renderPage } from '../../scripts/lib/render.ts'

const ids = { 'Chapter-22.md': 'ch22' }

describe('renderPage', () => {
  it('turns steno-outline tags into stroke elements and counts them', () => {
    const page = renderPage('<steno-outline stroke="SAP" width="100%" alt="x"></steno-outline>', ids)
    expect(page.html).toContain('data-stroke="SAP"')
    expect(page.html).not.toContain('<steno-outline')
    expect(page.outlineTagCount).toBe(1)
    expect(page.strokeCount).toBe(1)
  })

  it('converts steno-outline tags inside table cells', () => {
    const md = '| A | B |\n|---|---|\n| x | <steno-outline stroke="TP-PL" width="100%" alt="y"></steno-outline> |\n'
    const page = renderPage(md, ids)
    expect(page.html).toContain('data-stroke="TP-PL"')
    expect(page.outlineTagCount).toBe(1)
  })

  it('makes stroke code spans addressable', () => {
    const page = renderPage('Write `TKAD` now', ids)
    expect(page.html).toContain('<code class="stroke" data-stroke="TKAD" tabindex="0">TKAD</code>')
    expect(page.strokeCount).toBe(1)
    expect(page.outlineTagCount).toBe(0)
  })

  it('accepts slash-joined outlines and unusual strokes in code spans', () => {
    const page = renderPage('`SPR*EUPBG/HRER/-Z` `-T` `#-R` `HO*P`', ids)
    expect(page.strokeCount).toBe(4)
  })

  it('leaves non-stroke code spans plain', () => {
    const page = renderPage('Press `Ctrl` then `a`', ids)
    expect(page.html).toContain('<code>Ctrl</code>')
    expect(page.html).not.toContain('class="stroke"')
    expect(page.strokeCount).toBe(0)
  })

  it('leaves fenced code untouched', () => {
    const page = renderPage('```\nTKAD <steno-outline stroke="SAP"></steno-outline>\n```\n', ids)
    expect(page.html).toContain('<pre><code>')
    expect(page.html).not.toContain('class="stroke')
    expect(page.html).not.toContain('data-stroke')
    expect(page.strokeCount).toBe(0)
    expect(page.outlineTagCount).toBe(0)
  })

  it('gives headings mdBook ids, de-duplicated, and lists them', () => {
    const page = renderPage('# Chapter 5\n\n## `AE` for `AEU`\n\n## Same\n\n## Same\n', ids)
    expect(page.headings).toEqual([
      { id: 'chapter-5', title: 'Chapter 5', level: 1 },
      { id: 'ae-for-aeu', title: 'AE for AEU', level: 2 },
      { id: 'same', title: 'Same', level: 2 },
      { id: 'same-1', title: 'Same', level: 2 },
    ])
    expect(page.html).toContain('<h2 id="ae-for-aeu">')
  })

  it('keeps stroke code in headings live while the title stays plain text', () => {
    const page = renderPage('## `TP*`\n', ids)
    expect(page.headings[0]).toEqual({ id: 'tp', title: 'TP*', level: 2 })
    expect(page.html).toContain('data-stroke="TP*"')
  })

  it('rewrites image and video paths to /media', () => {
    const md = '![](img/5-order.png)\n\n<video controls><source src="img/5-pronunciations-short-a.mp4" type="video/mp4"></video>\n'
    const page = renderPage(md, ids)
    expect(page.html).toContain('src="/media/5-order.png"')
    expect(page.html).toContain('src="/media/5-pronunciations-short-a.mp4"')
    expect(page.html).not.toContain('img/')
  })

  it('turns practice links into practice-link anchors tied to the heading above', () => {
    const page = renderPage('## Short a\n\nSome text [x](practice/5-cvc.txt) more\n\n## Other\n', ids)
    expect(page.html).toContain('<a class="practice-link" data-list="5-cvc">x</a>')
    expect(page.practiceLinks).toEqual([{ headingId: 'short-a', listId: '5-cvc' }])
  })

  it('maps practice links before any heading to an empty heading id', () => {
    const page = renderPage('[x](practice/5-cvc.txt)', ids)
    expect(page.practiceLinks).toEqual([{ headingId: '', listId: '5-cvc' }])
  })

  it('rewrites internal chapter links', () => {
    const page = renderPage('[x](Chapter-22.md#problematic-words) and [y](Chapter-22.md)', ids)
    expect(page.html).toContain('href="/page/ch22#problematic-words"')
    expect(page.html).toContain('href="/page/ch22"')
  })

  it('replaces iframes with a needs-network link to the src', () => {
    const md = '<iframe width="640" height="360"\nsrc="https://www.youtube.com/embed/qu4zyRqILYM">\n</iframe> \n'
    const page = renderPage(md, ids)
    expect(page.html).not.toContain('<iframe')
    expect(page.html).toContain('<a class="needs-network" href="https://www.youtube.com/embed/qu4zyRqILYM"')
  })

  it('opens external links in a new tab', () => {
    const page = renderPage('[w](https://plover.wiki/)', ids)
    expect(page.html).toContain('href="https://plover.wiki/" target="_blank" rel="noreferrer"')
  })

  it('rewrites img/ links to /media/ for markdown and raw HTML', () => {
    const page = renderPage('[g](img/18-numbers.png) <a href="img/x.png">x</a>', ids)
    expect(page.html).toContain('href="/media/18-numbers.png"')
    expect(page.html).toContain('href="/media/x.png"')
    expect(page.html).not.toContain('href="img/')
  })

  it('throws when a steno-outline tag survives conversion', () => {
    expect(() => renderPage('<steno-outline stroke="SAP" />', ids)).toThrow(/steno-outline/)
    expect(() => renderPage("<steno-outline stroke='SAP'></steno-outline>", ids)).toThrow(/steno-outline/)
  })
})
