/**
 * The 2 px indeterminate bar on the page header's bottom edge.
 *
 * Shown while the board's first load or a detail load runs, never for the
 * board's background 5 s poll. Under `prefers-reduced-motion` the stylesheet
 * swaps the sweep for a static 40 % bar.
 */
import type { ReactNode } from 'react'

import type { MissionBoardTranslate } from './locale.ts'

/**
 * Render the bar.
 * @param props.active - whether anything is loading.
 * @param props.t - the locale seat.
 * @returns the bar, always mounted so the header height never jumps.
 */
export function ProcessingBar(props: { readonly active: boolean, readonly t: MissionBoardTranslate }): ReactNode {
  return (
    <div
      className="awe-mp-bar"
      data-active={props.active}
      role="progressbar"
      aria-label={props.t('page.health.loading')}
      aria-busy={props.active}
      aria-hidden={!props.active}
    >
      <span className="awe-mp-barFill" />
    </div>
  )
}
