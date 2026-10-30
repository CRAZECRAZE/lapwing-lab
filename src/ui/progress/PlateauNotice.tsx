import type { JSX } from 'preact'
import type { Plateau } from '../../core/plateau.ts'
import { isPlainClick, navigate } from '../../router.ts'

type Props = { plateau: Plateau; onSnooze: () => void; variant: 'panel' | 'line' }

const whole = (n: number): string => String(Math.round(n))

/** `41 this week, 42 and 40 the weeks before`; with one other week, `41 this week, 42 the week before`. */
function numbersText(plateau: Plateau): string {
  const [first, second] = plateau.others
  const now = `${whole(plateau.thisWeek)} this week`
  if (first === undefined) return now
  if (second === undefined) return `${now}, ${whole(first)} the week before`
  return `${now}, ${whole(first)} and ${whole(second)} the weeks before`
}

/** `Meanwhile your steadiness rose from 44 to 53 and your accuracy from 91% to 94%.`, or null when nothing rose. */
function meanwhileText({ steadiness, accuracy }: Plateau['meanwhile']): string | null {
  const steady = steadiness ? `from ${whole(steadiness.from)} to ${whole(steadiness.to)}` : null
  const accurate = accuracy ? `from ${whole(accuracy.from)}% to ${whole(accuracy.to)}%` : null
  if (steady && accurate) return `Meanwhile your steadiness rose ${steady} and your accuracy ${accurate}.`
  if (steady) return `Meanwhile your steadiness rose ${steady}.`
  if (accurate) return `Meanwhile your accuracy rose ${accurate}.`
  return null
}

/** A link to a panel further down the Progress page: scrolls there, leaves the address alone. */
function JumpLink({ target, children }: { target: string; children: string }): JSX.Element {
  return (
    <a
      class="plateau__link"
      href={`#${target}`}
      onClick={(e) => {
        e.preventDefault()
        document.getElementById(target)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
      }}
    >
      {children}
    </a>
  )
}

/** The plateau notice: a panel above the Progress tiles, or one gold line in the chapter panel. Facts only. */
export function PlateauNotice({ plateau, onSnooze, variant }: Props): JSX.Element {
  if (variant === 'line') {
    return (
      <p class="plateau-line">
        {`Speed flat for ${plateau.weeks} weeks, `}
        <a
          href="/progress"
          onClick={(e) => {
            if (!isPlainClick(e)) return
            e.preventDefault()
            navigate('/progress')
          }}
        >
          see Progress
        </a>
      </p>
    )
  }
  const meanwhile = meanwhileText(plateau.meanwhile)
  return (
    <section class="plateau" aria-labelledby="progress-plateau">
      <h2 id="progress-plateau" class="plateau__title">{`Your speed has been flat for ${plateau.weeks} weeks`}</h2>
      <p class="plateau__text">{`Free-type wpm: ${numbersText(plateau)}. Plateaus like this are common while learning steno.`}</p>
      {meanwhile !== null && <p class="plateau__text">{meanwhile}</p>}
      <div class="plateau__actions">
        <JumpLink target="progress-weak">Weakest keys</JumpLink>
        <JumpLink target="progress-mixups">Mix-ups</JumpLink>
        <button type="button" class="plateau__snooze" onClick={onSnooze}>
          Not now (14 days)
        </button>
      </div>
    </section>
  )
}
