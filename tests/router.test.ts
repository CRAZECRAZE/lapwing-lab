import { describe, expect, it } from 'vitest'
import { isRunRoute, parseRoute, tabOf } from '../src/router.ts'
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

  it('parses the fix-up page and its run routes', () => {
    expect(parseRoute('/practice/fixup')).toEqual({ name: 'fixup', tab: 'words' })
    expect(parseRoute('/practice/fixup/')).toEqual({ name: 'fixup', tab: 'words' })
    expect(parseRoute('/practice/fixup/patterns')).toEqual({ name: 'fixup', tab: 'patterns' })
    expect(parseRoute('/practice/fixup/run/words')).toEqual({ name: 'fixup-run', kind: 'words' })
    expect(parseRoute('/practice/fixup/run/patterns')).toEqual({ name: 'fixup-run', kind: 'patterns' })
    expect(parseRoute('/practice/fixup/run/other')).toEqual({ name: 'notfound' })
    expect(parseRoute('/practice/fixup/other')).toEqual({ name: 'notfound' })
  })

  it('parses the real-text page and its run routes', () => {
    expect(parseRoute('/practice/text')).toEqual({ name: 'text' })
    expect(parseRoute('/practice/text/')).toEqual({ name: 'text' })
    expect(parseRoute('/practice/text/run/pasted/1')).toEqual({ name: 'text-run', id: 'pasted', part: 1 })
    expect(parseRoute('/practice/text/run/my-text/12/')).toEqual({ name: 'text-run', id: 'my-text', part: 12 })
    expect(parseRoute('/practice/text/run/x/0')).toEqual({ name: 'notfound' })
    expect(parseRoute('/practice/text/run/x/abc')).toEqual({ name: 'notfound' })
    expect(parseRoute('/practice/text/run/x/-1')).toEqual({ name: 'notfound' })
    expect(parseRoute('/practice/text/run/x/')).toEqual({ name: 'notfound' })
    expect(parseRoute('/practice/text/run/x')).toEqual({ name: 'notfound' })
    expect(parseRoute('/practice/text/run//1')).toEqual({ name: 'notfound' })
    expect(parseRoute('/practice/text/other')).toEqual({ name: 'notfound' })
  })

  it('parses the routine page', () => {
    expect(parseRoute('/practice/routine')).toEqual({ name: 'routine' })
    expect(parseRoute('/practice/routine/')).toEqual({ name: 'routine' })
    expect(parseRoute('/practice/routine/other')).toEqual({ name: 'notfound' })
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

describe('progress route', () => {
  it('parses /progress with or without a trailing slash', () => {
    expect(parseRoute('/progress')).toEqual({ name: 'progress' })
    expect(parseRoute('/progress/')).toEqual({ name: 'progress' })
    expect(parseRoute('/progress/oops')).toEqual({ name: 'notfound' })
    expect(parseRoute('/progressive')).toEqual({ name: 'notfound' })
  })
})

describe('reports routes', () => {
  it('parses the month list and a month, with or without a trailing slash', () => {
    expect(parseRoute('/progress/reports')).toEqual({ name: 'reports' })
    expect(parseRoute('/progress/reports/')).toEqual({ name: 'reports' })
    expect(parseRoute('/progress/reports/2026-10')).toEqual({ name: 'report', month: '2026-10' })
    expect(parseRoute('/progress/reports/2026-10/')).toEqual({ name: 'report', month: '2026-10' })
  })

  it('returns the report route for any single segment, so the Report page can say there is no such month', () => {
    for (const month of ['2026-13', '2026-00', '2026-1', 'abc', '2026-10-01']) {
      expect(parseRoute(`/progress/reports/${month}`)).toEqual({ name: 'report', month })
      expect(parseRoute(`/progress/reports/${month}/`)).toEqual({ name: 'report', month })
    }
  })

  it('decodes the segment, and sends a malformed escape or more segments to notfound', () => {
    expect(parseRoute('/progress/reports/2026%2D10')).toEqual({ name: 'report', month: '2026-10' })
    expect(parseRoute('/progress/reports/a%20b')).toEqual({ name: 'report', month: 'a b' })
    for (const path of ['/progress/reports/%zz', '/progress/reports/2026-10/x', '/progress/reports//']) {
      expect(parseRoute(path)).toEqual({ name: 'notfound' })
    }
  })
})

describe('tabOf', () => {
  const cases: Array<[Route, string]> = [
    [{ name: 'page', id: 'home' }, 'book'],
    [{ name: 'drill', id: 'stage0/x' }, 'book'],
    [{ name: 'notfound' }, 'book'],
    [{ name: 'practice' }, 'practice'],
    [{ name: 'free', source: 'a', mode: 'b' }, 'practice'],
    [{ name: 'fixup', tab: 'words' }, 'practice'],
    [{ name: 'fixup', tab: 'patterns' }, 'practice'],
    [{ name: 'fixup-run', kind: 'words' }, 'practice'],
    [{ name: 'text' }, 'practice'],
    [{ name: 'text-run', id: 'pasted', part: 1 }, 'practice'],
    [{ name: 'routine' }, 'practice'],
    [{ name: 'history' }, 'history'],
    [{ name: 'test', id: 1 }, 'history'],
    [{ name: 'days' }, 'days'],
    [{ name: 'days', date: '2026-10-27' }, 'days'],
    [{ name: 'progress' }, 'progress'],
    [{ name: 'reports' }, 'progress'],
    [{ name: 'report', month: '2026-10' }, 'progress'],
    [{ name: 'report', month: '2026-13' }, 'progress'],
    [{ name: 'journal' }, 'journal'],
    [{ name: 'journal', date: '2026-10-27' }, 'journal'],
  ]
  it.each(cases)('maps %j to %s', (route, tab) => {
    expect(tabOf(route)).toBe(tab)
  })
})

describe('isRunRoute', () => {
  it('is true for the routes that run a drill, free type, a fix-up or a text', () => {
    for (const route of [
      { name: 'drill', id: 'stage0/x' },
      { name: 'free', source: 'a', mode: 'b' },
      { name: 'fixup-run', kind: 'words' },
      { name: 'text-run', id: 'pasted', part: 1 },
    ] satisfies Route[]) {
      expect(isRunRoute(route), route.name).toBe(true)
    }
  })

  it('is false for every page that is not a run', () => {
    for (const route of [
      { name: 'page', id: 'home' },
      { name: 'practice' },
      { name: 'fixup', tab: 'words' },
      { name: 'text' },
      { name: 'routine' },
      { name: 'history' },
      { name: 'test', id: 1 },
      { name: 'days' },
      { name: 'progress' },
      { name: 'reports' },
      { name: 'report', month: '2026-10' },
      { name: 'journal' },
      { name: 'notfound' },
    ] satisfies Route[]) {
      expect(isRunRoute(route), route.name).toBe(false)
    }
  })
})
