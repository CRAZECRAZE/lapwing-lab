import type { JSX } from 'preact'
import { useRoute } from '../router.ts'
import { UniProvider } from '../state/uni-context.tsx'
import { Nav } from './Nav.tsx'
import { Reader } from './Reader.tsx'
import { StatusLine } from './StatusLine.tsx'
import { Stage0Route } from './Stage0Route.tsx'
import './reader.css'

export function App(): JSX.Element {
  const route = useRoute()
  return (
    <UniProvider>
      <div class="app">
        <Nav currentId={route.name === 'page' ? route.id : null} />
        <main class="main">
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
