import type { JSX } from 'preact'
import type { ReportTile, ReportTiles } from '../core/report.ts'
import { Tile } from './progress/Tiles.tsx'

const ORDER = ['time', 'strokes', 'wpm', 'accuracy', 'steadiness', 'chapters'] as const

/** A figure on too few runs is a dash with its reason under it; otherwise the line under it is the change or the detail. */
function ReportTileView({ id, tile }: { id: string; tile: ReportTile }): JSX.Element {
  return tile.value === null ? (
    <Tile id={`report-${id}`} label={tile.label} value="—" note={tile.subline ?? undefined} />
  ) : (
    <Tile id={`report-${id}`} label={tile.label} value={tile.value} change={tile.subline} />
  )
}

/** The six tiles of a month report, in reading order. */
export function ReportTilesView({ tiles }: { tiles: ReportTiles }): JSX.Element {
  return (
    <ul class="progress__tiles" aria-label="Month at a glance">
      {ORDER.map((id) => (
        <ReportTileView key={id} id={id} tile={tiles[id]} />
      ))}
    </ul>
  )
}
