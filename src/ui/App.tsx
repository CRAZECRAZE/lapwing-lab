import type { JSX } from 'preact'
import { tabOf, useRoute } from '../router.ts'
import { UniProvider } from '../state/uni-context.tsx'
import { FreeRoute } from './FreeRoute.tsx'
import { History } from './History.tsx'
import { Journal } from './Journal.tsx'
import { Nav } from './Nav.tsx'
import { Practice } from './Practice.tsx'
import { Reader } from './Reader.tsx'
import { StatusLine } from './StatusLine.tsx'
import { Stage0Route } from './Stage0Route.tsx'
import { TestDetail } from './TestDetail.tsx'
import { TopBar } from './TopBar.tsx'
import './reader.css'

/** Stand-in for a tab whose view is not built yet. Replaced by: Days (Task 13). */
function Soon({ name }: { name: string }): JSX.Element {
  return <p class="page__status">The {name} tab is coming in this milestone.</p>
}

export function App(): JSX.Element {
  const route = useRoute()
  const tab = tabOf(route)
  return (
    <UniProvider>
      <TopBar current={tab} />
      <div class={tab === 'book' ? 'app' : 'app app--wide'}>
        {tab === 'book' && <Nav currentId={route.name === 'page' ? route.id : null} />}
        <main class="main">
          {route.name === 'practice' && <Practice />}
          {route.name === 'free' && (
            <FreeRoute key={`${route.source}/${route.mode}`} source={route.source} mode={route.mode} />
          )}
          {route.name === 'history' && <History />}
          {route.name === 'test' && <TestDetail id={route.id} key={route.id} />}
          {route.name === 'days' && <Soon name="Days" />}
          {route.name === 'journal' && <Journal key={route.date ?? 'today'} date={route.date} />}
          {route.name === 'page' && <Reader id={route.id} />}
          {route.name === 'drill' &&
            (route.id.startsWith('stage0/') ? (
              <Stage0Route key={route.id} id={route.id.slice('stage0/'.length)} />
            ) : (
              <p class="page__status">No such drill. Pick a chapter from the list.</p>
            ))}
          {route.name === 'notfound' && <p class="page__status">No such page. Pick a chapter from the list.</p>}
        </main>
        <StatusLine />
      </div>
    </UniProvider>
  )
}
