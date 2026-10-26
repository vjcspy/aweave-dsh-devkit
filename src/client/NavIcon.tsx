/** The left sidebar row's icon; the sidebar owns the button, label and selected state around it. */
import type { ReactNode } from 'react'
import { IconGoalOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Render the goal glyph at the size the sidebar asks for.
 * @param props.size - the requested edge in px.
 * @returns the icon element.
 */
export function NavIcon(props: { readonly size?: number }): ReactNode {
  return <IconGoalOutlineRegular size={props.size ?? 16} />
}
