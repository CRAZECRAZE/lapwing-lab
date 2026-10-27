import type { JSX } from 'preact'
import { useRoute } from '../router.ts'
import { UniProvider } from '../state/uni-context.tsx'
import { Nav } from './Nav.tsx'
import { Reader } from './Reader.tsx'
import { StatusLine } from './StatusLine.tsx'
import './reader.css'

export function App(): JSX.Element {
  const route = useRoute()
  return (
    <UniProvider>
      <div class="app">
        <Nav currentId={route.name === 'page' ? route.id : null} />
        <main class="main">
          {route.name === 'page' && <Reader id={route.id} />}
          {route.name === 'drill' && <p class="page__status">Drill — coming in a later task.</p>}
          {route.name === 'notfound' && <p class="page__status">No such page. Pick a chapter from the list.</p>}
        </main>
        <StatusLine />
      </div>
    </UniProvider>
  )
}
