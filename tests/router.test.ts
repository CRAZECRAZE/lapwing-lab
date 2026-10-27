import { describe, expect, it } from 'vitest'
import { parseRoute, tabOf } from '../src/router.ts'
import type { Route } from '../src/router.ts'

describe('parseRoute', () => {
  it('keeps the existing book routes', () => {
    expect(parseRoute('/')).toEqual({ name: 'page', id: 'home' })
    expect(parseRoute('/page/ch-8')).toEqual({ name: 'page', id: 'ch-8' })
    expect(parseRoute('/drill/stage0/a%20b')).toEqual({ name: 'drill', id: 'stage0/a b' })
    expect(parseRoute('/drill/%zz')).toEqual({ name: 'notfound' })
    expect(parseRoute('/nope')).toEqual({ name: 'notfound' })
  })

  it('parses practice and free type', () => {
    expect(parseRoute('/practice')).toEqual({ name: 'practice' })
    expect(parseRoute('/practice/')).toEqual({ name: 'practice' })
    expect(parseRoute('/practice/free/ch-8/time-60')).toEqual({ name: 'free', source: 'ch-8', mode: 'time-60' })
    expect(parseRoute('/practice/free/ch-8/time-60/')).toEqual({ name: 'free', source: 'ch-8', mode: 'time-60' })
    expect(parseRoute('/practice/free/ch-8')).toEqual({ name: 'notfound' })
    expect(parseRoute('/practice/free/ch_8/time-60')).toEqual({ name: 'notfound' })
    expect(parseRoute('/practice/free/ch-8/time-60/extra')).toEqual({ name: 'notfound' })
    expect(parseRoute('/practice/other')).toEqual({ name: 'notfound' })
  })

  it('parses history and a single test', () => {
    expect(parseRoute('/history')).toEqual({ name: 'history' })
    expect(parseRoute('/history/')).toEqual({ name: 'history' })
    expect(parseRoute('/history/12')).toEqual({ name: 'test', id: 12 })
    expect(parseRoute('/history/12/')).toEqual({ name: 'test', id: 12 })
    expect(parseRoute('/history/abc')).toEqual({ name: 'notfound' })
    expect(parseRoute('/history/1.5')).toEqual({ name: 'notfound' })
    expect(parseRoute('/history/-3')).toEqual({ name: 'notfound' })
    expect(parseRoute('/history/99999999999999999999')).toEqual({ name: 'notfound' })
  })

  it('parses days and journal with an optional date', () => {
    expect(parseRoute('/days')).toEqual({ name: 'days' })
    expect(parseRoute('/days/2026-10-27')).toEqual({ name: 'days', date: '2026-10-27' })
    expect(parseRoute('/days/2026-10-27/')).toEqual({ name: 'days', date: '2026-10-27' })
    expect(parseRoute('/days/oops')).toEqual({ name: 'notfound' })
    expect(parseRoute('/days/2026-1-2')).toEqual({ name: 'notfound' })
    expect(parseRoute('/journal')).toEqual({ name: 'journal' })
    expect(parseRoute('/journal/2026-10-27')).toEqual({ name: 'journal', date: '2026-10-27' })
    expect(parseRoute('/journal/oops')).toEqual({ name: 'notfound' })
  })

  it('leaves calendar validity to the view', () => {
    expect(parseRoute('/days/2026-13-45')).toEqual({ name: 'days', date: '2026-13-45' })
  })
})

describe('tabOf', () => {
  const cases: Array<[Route, string]> = [
    [{ name: 'page', id: 'home' }, 'book'],
    [{ name: 'drill', id: 'stage0/x' }, 'book'],
    [{ name: 'notfound' }, 'book'],
    [{ name: 'practice' }, 'practice'],
    [{ name: 'free', source: 'a', mode: 'b' }, 'practice'],
    [{ name: 'history' }, 'history'],
    [{ name: 'test', id: 1 }, 'history'],
    [{ name: 'days' }, 'days'],
    [{ name: 'days', date: '2026-10-27' }, 'days'],
    [{ name: 'journal' }, 'journal'],
    [{ name: 'journal', date: '2026-10-27' }, 'journal'],
  ]
  it.each(cases)('maps %j to %s', (route, tab) => {
    expect(tabOf(route)).toBe(tab)
  })
})
