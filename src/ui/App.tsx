import type { JSX } from 'preact'
import { localDate } from '../core/days.ts'
import { tabOf, useRoute } from '../router.ts'
import { DockProvider } from '../state/dock.tsx'
import { ProgressProvider } from '../state/progress.tsx'
import { UniProvider } from '../state/uni-context.tsx'
import { ChapterTestRoute } from './ChapterTestRoute.tsx'
import { Days } from './Days.tsx'
import { DockHost } from './DockHost.tsx'
import { Fixup } from './Fixup.tsx'
import { FixupRun } from './FixupRun.tsx'
import { FreeRoute } from './FreeRoute.tsx'
import { History } from './History.tsx'
import { Journal } from './Journal.tsx'
import { ListDrillRoute } from './ListDrillRoute.tsx'
import { Nav } from './Nav.tsx'
import { Practice } from './Practice.tsx'
import { Progress } from './Progress.tsx'
import { Reader } from './Reader.tsx'
import { Report } from './Report.tsx'
import { Reports } from './Reports.tsx'
import { RoutinePage } from './Routine.tsx'
import { StatusLine } from './StatusLine.tsx'
import { Stage0Route } from './Stage0Route.tsx'
import { TestDetail } from './TestDetail.tsx'
import { Text } from './Text.tsx'
import { TextRun } from './TextRun.tsx'
import { TopBar } from './TopBar.tsx'
import './reader.css'

export function App(): JSX.Element {
  const route = useRoute()
  const tab = tabOf(route)
  return (
    <UniProvider>
      <ProgressProvider>
        <DockProvider>
          <TopBar current={tab} />
          <div class={tab === 'book' ? 'app' : 'app app--wide'}>
            {tab === 'book' && <Nav currentId={route.name === 'page' ? route.id : null} />}
            <main class="main">
              {route.name === 'practice' && <Practice />}
              {route.name === 'free' && (
                <FreeRoute key={`${route.source}/${route.mode}`} source={route.source} mode={route.mode} />
              )}
              {route.name === 'fixup' && <Fixup tab={route.tab} />}
              {route.name === 'fixup-run' && <FixupRun key={`${route.kind}${location.search}`} kind={route.kind} />}
              {route.name === 'text' && <Text />}
              {route.name === 'text-run' && <TextRun key={`${route.id}/${route.part}`} id={route.id} part={route.part} />}
              {route.name === 'routine' && <RoutinePage />}
              {route.name === 'history' && <History />}
              {route.name === 'test' && <TestDetail id={route.id} key={route.id} />}
              {route.name === 'days' && <Days key={route.date ?? 'month'} date={route.date} />}
              {route.name === 'progress' && <Progress />}
              {route.name === 'reports' && <Reports />}
              {route.name === 'report' && <Report key={route.month} month={route.month} />}
              {route.name === 'journal' && <Journal key={route.date ?? localDate(Date.now())} date={route.date} />}
              {route.name === 'page' && <Reader id={route.id} />}
              {route.name === 'drill' &&
                (route.id.startsWith('stage0/') ? (
                  <Stage0Route key={route.id} id={route.id.slice('stage0/'.length)} />
                ) : route.id.startsWith('list/') ? (
                  <ListDrillRoute key={route.id} listId={route.id.slice('list/'.length)} />
                ) : route.id.startsWith('test/') ? (
                  <ChapterTestRoute key={route.id} chapter={route.id.slice('test/'.length)} />
                ) : (
                  <p class="page__status">No such drill. Pick a chapter from the list.</p>
                ))}
              {route.name === 'notfound' && <p class="page__status">No such page. Pick a chapter from the list.</p>}
            </main>
            <DockHost />
            <StatusLine refreshKey={location.pathname} />
          </div>
        </DockProvider>
      </ProgressProvider>
    </UniProvider>
  )
}
