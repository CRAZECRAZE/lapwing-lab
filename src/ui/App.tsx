import type { JSX } from 'preact'
import { useRoute } from '../router.ts'
import { Nav } from './Nav.tsx'
import { Reader } from './Reader.tsx'
import './reader.css'

export function App(): JSX.Element {
  const route = useRoute()
  return (
    <div class="app">
      <Nav currentId={route.name === 'page' ? route.id : null} />
      <main class="main">
        {route.name === 'page' && <Reader id={route.id} />}
        {route.name === 'drill' && <p class="page__status">Drill — coming in a later task.</p>}
        {route.name === 'notfound' && <p class="page__status">No such page. Pick a chapter from the list.</p>}
      </main>
    </div>
  )
}
