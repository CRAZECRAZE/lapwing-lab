import { describe, expect, it, vi } from 'vitest'
import { fingerspell, looksLikeSteno, searchDictionary, visibleText } from '../../src/core/dictsearch.ts'
import { compareOutlines } from '../../src/core/outline.ts'
import type { DictCard } from '../../scripts/lib/dictionary.ts'

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

function card(t: string, ...outlines: string[]): DictCard {
  return { t, r: outlines.map((o) => ({ o })) }
}

function named(t: string, ...outlines: string[]): DictCard {
  return { t, r: outlines.map((o) => ({ o })), n: true }
}

// Deliberately not in the order the build writes them: search must not depend on the input order.
const WORDS: readonly DictCard[] = deepFreeze([
  card('scat', 'SKAT'),
  card('catch', 'KAFP'),
  card('Cat', 'KAT'),
  card('cat', 'KAT', 'KA*T'),
  card('cab', 'KAB'),
  card('add', 'AD', 'SKWRAD'),
  card('dad', 'TKAD'),
  card('dog', 'TKOG'),
  card('how ever', 'HOU/AEFR'),
  card('however', 'HOUFR'),
  card('cats', 'KATS'),
  card('catalog', 'KAT/A*LG'),
  named('Enter or Return', 'R-R'),
  card('{^}.sh', 'TK-PL'),
  card('ab\ncd', 'AB'),
])

const texts = (results: { card: DictCard }[]): string[] => results.map((r) => r.card.t)
const hits = (result: { hit?: ReadonlySet<string> }): string[] => [...(result.hit ?? [])].sort()

describe('looksLikeSteno', () => {
  it('accepts upper-case stroke text', () => {
    for (const q of ['SAP', '-RBGSZ', 'KAT/PHREU', '#E', 'A', 'SAT', 'TKAD', 'ADD', '/', '//', '*']) {
      expect(looksLikeSteno(q), q).toBe(true)
    }
  })

  it('rejects words, empty text and anything with other characters', () => {
    for (const q of ['cat', '', '   ', 'Sap', 'S ap', 'hello1', 'CAT', 'I', 'tkad']) {
      expect(looksLikeSteno(q), JSON.stringify(q)).toBe(false)
    }
  })

  it('ignores surrounding whitespace', () => {
    expect(looksLikeSteno('  SAP ')).toBe(true)
  })
})

describe('searchDictionary word search', () => {
  it('lists the exact group, then the prefix group, then the contains group', () => {
    const results = searchDictionary(WORDS, 'cat')
    expect(results.map((r) => [r.card.t, r.match])).toEqual([
      ['cat', 'exact'],
      ['Cat', 'exact'],
      ['cats', 'prefix'],
      ['catch', 'prefix'],
      ['catalog', 'prefix'],
      ['scat', 'contains'],
    ])
    expect(results.every((r) => r.hit === undefined)).toBe(true)
  })

  it('puts the card whose text equals the query exactly (same case) first, whatever the case', () => {
    expect(texts(searchDictionary(WORDS, 'cat')).slice(0, 2)).toEqual(['cat', 'Cat'])
    expect(texts(searchDictionary(WORDS, 'Cat')).slice(0, 2)).toEqual(['Cat', 'cat'])
    // No exact-case card: then the plain order, upper case before lower case.
    expect(texts(searchDictionary(WORDS, 'CAT')).slice(0, 2)).toEqual(['Cat', 'cat'])
  })

  it('puts the exact-case card first even when its lower-cased text sorts later', () => {
    const cards = [card('A', 'A'), card('a', 'AEU')]
    expect(texts(searchDictionary(cards, 'a'))).toEqual(['a', 'A'])
    expect(texts(searchDictionary(cards, 'A'))).toEqual(['A', 'a'])
  })

  it('orders a group by shorter text first, then lower-cased text, then exact text', () => {
    expect(texts(searchDictionary(WORDS, 'ca')).slice(0, 4)).toEqual(['cab', 'Cat', 'cat', 'cats'])
    const cards = [card('zzzz'), card('yyyy'), card('xxxxx'), card('bb'), card('bB'), card('Bb'), card('Aa'), card('zz')]
    // The same lower-cased text: the exact text decides, upper case before lower case.
    expect(texts(searchDictionary(cards, 'z'))).toEqual(['zz', 'zzzz'])
    expect(texts(searchDictionary(cards, 'b'))).toEqual(['Bb', 'bB', 'bb'])
    expect(texts(searchDictionary(cards, 'xx'))).toEqual(['xxxxx'])
    expect(texts(searchDictionary(cards, ''))).toEqual([])
  })

  it('puts a shorter text before a longer one even when the longer sorts first alphabetically', () => {
    const cards = [card('abcdef'), card('ab'), card('abcd'), card('abc')]
    expect(texts(searchDictionary(cards, 'a'))).toEqual(['ab', 'abc', 'abcd', 'abcdef'])
    expect(texts(searchDictionary([card('xab'), card('b-a'), card('zzab'), card('a')], 'a')).slice(0, 4)).toEqual([
      'a', 'b-a', 'xab', 'zzab',
    ])
  })

  it('puts a dictionary card before a named card of the same text', () => {
    const cards = [named('a', 'A'), card('a', 'AEU')]
    expect(searchDictionary(cards, 'a').map((r) => r.card.n)).toEqual([undefined, true])
  })

  it('matches without regard to case and keeps the card text as stored', () => {
    expect(texts(searchDictionary(WORDS, 'DOG'))).toEqual(['dog'])
    expect(texts(searchDictionary(WORDS, 'cAB'))).toEqual(['cab'])
    expect(texts(searchDictionary(WORDS, 'HOW EV'))).toEqual(['how ever'])
  })

  it('finds a phrase with an inner space as a substring', () => {
    const results = searchDictionary(WORDS, 'w ev')
    expect(results.map((r) => [r.card.t, r.match])).toEqual([['how ever', 'contains']])
  })

  it('finds a named card by its text', () => {
    const results = searchDictionary(WORDS, 'enter or')
    expect(results.map((r) => [r.card.t, r.match])).toEqual([['Enter or Return', 'prefix']])
    expect(results[0].card.n).toBe(true)
  })

  it('finds Plover syntax and texts with a real newline', () => {
    expect(texts(searchDictionary(WORDS, '{^}'))).toEqual(['{^}.sh'])
    expect(texts(searchDictionary(WORDS, 'ab\ncd'))).toEqual(['ab\ncd'])
  })

  it('trims the query and returns nothing for an empty or blank one', () => {
    expect(texts(searchDictionary(WORDS, '  dog '))).toEqual(['dog'])
    expect(searchDictionary(WORDS, '')).toEqual([])
    expect(searchDictionary(WORDS, '   ')).toEqual([])
    expect(searchDictionary(WORDS, ' \t\n ')).toEqual([])
  })

  it('lists each card once and does not change the cards', () => {
    const results = searchDictionary(WORDS, 'a')
    expect(new Set(results.map((r) => r.card)).size).toBe(results.length)
    expect(results.length).toBeGreaterThan(5)
  })

  it('returns the very card objects it was given', () => {
    expect(searchDictionary(WORDS, 'dog')[0].card).toBe(WORDS.find((c) => c.t === 'dog'))
  })

  it('does not search outlines for a lower-case query', () => {
    expect(texts(searchDictionary(WORDS, 'tkad'))).toEqual([])
    expect(texts(searchDictionary(WORDS, 'kat'))).toEqual([])
  })
})

describe('searchDictionary outline search', () => {
  it('finds dad for TKAD', () => {
    const results = searchDictionary(WORDS, 'TKAD')
    expect(results.map((r) => [r.card.t, r.match])).toEqual([['dad', 'outline-exact']])
    expect(hits(results[0])).toEqual(['TKAD'])
  })

  const TK: readonly DictCard[] = deepFreeze([
    card('prefix-late', '-T/TKAT'),
    card('mid-stroke', '-T/KAT'),
    card('prefix', 'TKAT'),
    card('exact', 'TK'),
    card('inside', 'STKAT'),
  ])

  it('matches TK against TKAT and -T/TKAT, not -T/KAT and not a match inside a stroke', () => {
    expect(searchDictionary(TK, 'TK').map((r) => [r.card.t, r.match])).toEqual([
      ['exact', 'outline-exact'],
      ['prefix', 'outline-prefix'],
      ['prefix-late', 'outline-contains'],
    ])
  })

  it('does not count a match that starts inside a stroke after a boundary', () => {
    const cards = [card('x', '-T/SKAT'), card('y', 'A/BKAT')]
    expect(searchDictionary(cards, 'KAT')).toEqual([])
    expect(searchDictionary(cards, 'SKAT').map((r) => r.card.t)).toEqual(['x'])
  })

  it('lists exact, prefix and contains groups in that order, whatever the input order', () => {
    const cards = [
      card('contains', 'X/TK/Y'),
      card('prefix', 'TKA'),
      card('exact', 'TK'),
      card('contains2', 'STPH/TK'),
      card('prefix2', 'TKOG'),
    ]
    expect(searchDictionary(cards, 'TK').map((r) => [r.card.t, r.match])).toEqual([
      ['exact', 'outline-exact'],
      ['prefix', 'outline-prefix'],
      ['prefix2', 'outline-prefix'],
      ['contains2', 'outline-contains'],
      ['contains', 'outline-contains'],
    ])
  })

  it('gives each card its best group, and hit holds only the rows of that group', () => {
    const cards = [
      card('all-three', 'TKAT', 'X/TKAB', 'TK'),
      card('prefix-contains', 'X/TK', 'TKAT', 'TKAB/Y', 'A/TKAT'),
      card('contains-only', 'A/TKAT', 'B/TK', 'KAT'),
      card('exact-two', 'TK', 'TK'),
    ]
    const byText = new Map(searchDictionary(cards, 'TK').map((r) => [r.card.t, r]))
    expect(byText.get('all-three')?.match).toBe('outline-exact')
    expect(hits(byText.get('all-three')!)).toEqual(['TK'])
    expect(byText.get('prefix-contains')?.match).toBe('outline-prefix')
    expect(hits(byText.get('prefix-contains')!)).toEqual(['TKAB/Y', 'TKAT'])
    expect(byText.get('contains-only')?.match).toBe('outline-contains')
    expect(hits(byText.get('contains-only')!)).toEqual(['A/TKAT', 'B/TK'])
    expect(hits(byText.get('exact-two')!)).toEqual(['TK'])
  })

  it('matches a query with a slash against stroke-boundary suffixes', () => {
    const cards = [card('hit', 'X/A/BC'), card('pre', 'A/BC'), card('eq', 'A/B'), card('miss', 'XA/BC'), card('miss2', 'A/XB')]
    const results = searchDictionary(cards, 'A/B')
    expect(results.map((r) => [r.card.t, r.match])).toEqual([
      ['eq', 'outline-exact'],
      ['pre', 'outline-prefix'],
      ['hit', 'outline-contains'],
    ])
    expect(hits(results[2])).toEqual(['X/A/BC'])
  })

  it('does not match a suffix that starts mid-stroke even if it contains the slash query', () => {
    expect(searchDictionary([card('x', 'XA/BC')], 'A/B')).toEqual([])
  })

  it('orders a group by the best matching row: fewer strokes, then fewer keys, then alphabetical', () => {
    const cards = [
      card('three strokes', 'TKA/B/C'),
      card('many keys', 'TKAOEUPBLG'),
      card('b-late', 'TKAO'),
      card('two strokes', 'TKA/B'),
      card('a-early', 'TKAE'),
      card('few keys', 'TKA'),
      card('star', 'TK*A'),
    ]
    const order = searchDictionary(cards, 'TK').map((r) => r.card.t)
    expect(order).toEqual(['few keys', 'star', 'a-early', 'b-late', 'many keys', 'two strokes', 'three strokes'])
    // The same order the shared outline comparison gives for the winning outlines.
    const outlines = ['TKA', 'TK*A', 'TKAE', 'TKAO', 'TKAOEUPBLG', 'TKA/B', 'TKA/B/C']
    expect([...outlines].sort(compareOutlines)).toEqual(outlines)
  })

  it('uses the best of a card\'s matching rows to place it, not the first row', () => {
    const cards = [card('one', 'TKA/B', 'TKAB'), card('two', 'TKAOEU')]
    expect(texts(searchDictionary(cards, 'TK'))).toEqual(['one', 'two'])
  })

  it('breaks outline ties by shorter text, then lower-cased text, then exact text', () => {
    const cards = [card('longer', 'TKAT'), card('Bb', 'TKAT'), card('bB', 'TKAT'), card('aa', 'TKAT'), card('zz', 'TKAT')]
    expect(texts(searchDictionary(cards, 'TKAT'))).toEqual(['aa', 'Bb', 'bB', 'zz', 'longer'])
  })

  it('does not put the exact-case text first among outline results', () => {
    const cards = [card('TKAT', 'TKAT'), card('ab', 'TKAT')]
    expect(texts(searchDictionary(cards, 'TKAT'))).toEqual(['ab', 'TKAT'])
  })

  it('lists outline results before word results and no card twice', () => {
    const cards = [
      card('KAT', 'XX'),
      card('zzz', 'KAT'),
      card('kat', 'KATS'),
      card('a kat', 'Q'),
      card('dog', 'KAT/Z'),
      card('katz', 'W'),
    ]
    const results = searchDictionary(cards, 'KAT')
    expect(results.map((r) => [r.card.t, r.match])).toEqual([
      ['zzz', 'outline-exact'],
      ['kat', 'outline-prefix'],
      ['dog', 'outline-prefix'],
      ['KAT', 'exact'],
      ['katz', 'prefix'],
      ['a kat', 'contains'],
    ])
    expect(new Set(results.map((r) => r.card)).size).toBe(results.length)
  })

  it('does not list a card twice when its text and its outline both match', () => {
    const cards = [card('KAT', 'KAT'), card('KATS', 'XX')]
    expect(searchDictionary(cards, 'KAT').map((r) => [r.card.t, r.match])).toEqual([
      ['KAT', 'outline-exact'],
      ['KATS', 'prefix'],
    ])
  })

  it('matches a named card by its rows', () => {
    const results = searchDictionary(WORDS, 'R-R')
    expect(results.map((r) => [r.card.t, r.match])).toEqual([['Enter or Return', 'outline-exact']])
  })

  it('does not lower-case a steno query for outline matching', () => {
    expect(searchDictionary([card('x', 'KAT')], 'kat')).toEqual([])
    expect(searchDictionary([card('x', 'KAT')], ' KAT ').map((r) => r.match)).toEqual(['outline-exact'])
  })

  it('also runs the word search for a steno-looking query', () => {
    const cards = [card('add', 'AD'), card('ADD', 'XX'), card('Dad', 'TKAD')]
    expect(searchDictionary(cards, 'AD').map((r) => [r.card.t, r.match])).toEqual([
      ['add', 'outline-exact'],
      ['ADD', 'prefix'],
      ['Dad', 'contains'],
    ])
  })
})

describe('searchDictionary odd queries', () => {
  const odd = [card('a/b', 'A/B'), card('x', '/'), card('y', 'A//B'), card('z', '/A'), card('w', 'A/')]

  it('handles a lone slash, double slash and a leading slash', () => {
    expect(searchDictionary(odd, '/').map((r) => [r.card.t, r.match])).toEqual([
      ['x', 'outline-exact'],
      ['z', 'outline-prefix'],
      ['y', 'outline-contains'],
      ['a/b', 'contains'],
    ])
    expect(searchDictionary(odd, '//').map((r) => r.card.t)).toEqual([])
    expect(searchDictionary(odd, '/A').map((r) => [r.card.t, r.match])).toEqual([['z', 'outline-exact']])
    expect(searchDictionary(odd, '/B').map((r) => [r.card.t, r.match])).toEqual([
      ['y', 'outline-contains'],
      ['a/b', 'contains'],
    ])
  })

  it('accepts a very long query and finds nothing', () => {
    expect(searchDictionary(WORDS, 'A'.repeat(5000))).toEqual([])
    expect(searchDictionary(WORDS, 'a/'.repeat(2500))).toEqual([])
  })

  it('works on an empty list of cards', () => {
    expect(searchDictionary([], 'cat')).toEqual([])
    expect(searchDictionary([], 'CAT')).toEqual([])
  })
})

describe('searchDictionary cache', () => {
  it('lower-cases the card texts once per cards array', () => {
    const cards = Array.from({ length: 50 }, (_, i) => card(`Word${i}`, 'A'))
    const spy = vi.spyOn(String.prototype, 'toLowerCase')
    let first = 0
    let repeated = 0
    let other = 0
    try {
      searchDictionary(cards, 'word')
      first = spy.mock.calls.length
      searchDictionary(cards, 'word1')
      searchDictionary(cards, 'word2')
      repeated = spy.mock.calls.length - first
      // A different array gets its own cache, so its texts are lower-cased afresh.
      searchDictionary([...cards], 'word')
      other = spy.mock.calls.length - first - repeated
    } finally {
      spy.mockRestore()
    }
    expect(first).toBeGreaterThanOrEqual(50)
    expect(repeated).toBeLessThan(10)
    expect(other).toBeGreaterThanOrEqual(50)
  })

  it('gives the same results on a repeated search', () => {
    const first = searchDictionary(WORDS, 'ca')
    expect(searchDictionary(WORDS, 'ca')).toEqual(first)
  })
})

describe('visibleText', () => {
  it('shows a newline, carriage return and tab as visible escapes', () => {
    expect(visibleText('{^\n^}')).toBe('{^\\n^}')
    expect(visibleText('{^\n^}')).toHaveLength(6)
    expect(visibleText('a\rb\tc')).toBe('a\\rb\\tc')
    expect(visibleText('\n\n')).toBe('\\n\\n')
  })

  it('leaves everything else as it is', () => {
    for (const text of ['', 'cat', '{^}.sh', 'a b', '\\n', 'é', '{#Shift_l(Home)}']) {
      expect(visibleText(text), text).toBe(text)
    }
    // Other control characters are not rewritten.
    expect(visibleText('a\u0007b')).toBe('a\u0007b')
  })
})

describe('fingerspell', () => {
  const LETTERS = { a: 'A', c: 'KR', t: 'T', d: 'TK', o: 'O', A: 'A*', C: 'KR*', T: 'T*' } as const

  it('gives the outline of each letter in order', () => {
    expect(fingerspell('cat', LETTERS)).toEqual(['KR', 'A', 'T'])
    expect(fingerspell('  tact ', LETTERS)).toEqual(['T', 'A', 'KR', 'T'])
    expect(fingerspell('a', LETTERS)).toEqual(['A'])
  })

  it('is null for anything but one run of lower-case letters', () => {
    for (const q of ['Cat', 'cAt', 'ca t', 'c4', '', '   ', 'c-a', 'ca\nt', 'é', 'CAT']) {
      expect(fingerspell(q, LETTERS), JSON.stringify(q)).toBeNull()
    }
  })

  it('is null when a letter is missing from the table', () => {
    expect(fingerspell('catz', LETTERS)).toBeNull()
    expect(fingerspell('x', {})).toBeNull()
    expect(fingerspell('constructor', {})).toBeNull()
  })
})

describe('searchDictionary speed', () => {
  // Valid strokes (a left bank subset, the vowel A, a right bank subset chosen by the bits of a number), because
  // the shared key count is slow on text it cannot parse and a real dictionary holds only strokes.
  function stroke(n: number): string {
    const left = 'STKPWHR'
    const right = 'FRPBLGTSDZ'
    let s = ''
    for (let b = 0; b < left.length; b++) if (n & (1 << b)) s += left[b]
    s += 'A'
    for (let b = 0; b < right.length; b++) if (Math.floor(n / 128) & (1 << b)) s += right[b]
    return s
  }

  function synthetic(count: number): DictCard[] {
    // A deterministic scramble of the indexes so the input is far from sorted.
    const cards: DictCard[] = []
    for (let i = 0; i < count; i++) {
      const k = (i * 7919) % count
      let word = ''
      for (let n = k + 11; n > 0; n = Math.floor(n / 8)) word += String.fromCharCode(97 + (n % 8))
      const o = (shift: number): string => stroke((k * 31 + shift * 977) % (1 << 17))
      cards.push({ t: word, r: [{ o: o(1) }, { o: `${o(2)}/${o(3)}` }, { o: `${o(4)}/${o(5)}/${o(6)}` }] })
    }
    return cards
  }

  // The best of a few runs, so a garbage-collection pause or a busy machine does not decide it.
  function best(cards: readonly DictCard[], query: string, runs = 5): number {
    let fastest = Infinity
    for (let i = 0; i < runs; i++) {
      const start = performance.now()
      searchDictionary(cards, query)
      fastest = Math.min(fastest, performance.now() - start)
    }
    return fastest
  }

  it('answers the worst query over 60,000 cards in under 150 ms', () => {
    const cards = synthetic(60000)
    searchDictionary(cards, 'a')
    expect(searchDictionary(cards, 'a').length).toBeGreaterThan(20000)
    for (const query of ['a', 'e', 'ab', 'cat']) {
      expect(best(cards, query), query).toBeLessThan(150)
    }
    // Every card matches these outline queries and is sorted by its best outline: slower, and given more room.
    for (const query of ['T', 'S', 'TK', 'A/T']) {
      expect(best(cards, query), query).toBeLessThan(500)
    }
  })

  it('does not grow worse than linearly with the number of cards', () => {
    const small = synthetic(30000)
    const large = synthetic(60000)
    // Queries that match most cards, so the times are tens of milliseconds and not lost in noise.
    for (const query of ['T', 'TK']) {
      searchDictionary(small, query)
      searchDictionary(large, query)
      const ratio = best(large, query, 7) / Math.max(best(small, query, 7), 1)
      expect(ratio, query).toBeLessThan(3)
    }
  })
})
