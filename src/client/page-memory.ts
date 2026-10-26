/**
 * The Missions page's reading position, kept for the lifetime of one plugin
 * activation.
 *
 * The page unmounts when the Human returns to the Conversation, so its React
 * state is lost. This object lives in `apply` and is handed to the page through
 * the `main` entry's inject face; the page writes it as the Human navigates and
 * restores from it when it mounts again. It is deliberately in memory only: a
 * persisted id could outlive the mission it names.
 */

/** The open mission, the open file inside it, and the Back history. */
export interface PageMemory {
  /** Open mission folder id, or `null` when the board alone is showing. */
  missionId: string | null
  /** Open file's project-root-relative path, or `null` to open the mission's `INDEX.md`. */
  filePath: string | null
  /** Previously open files, oldest first. */
  history: string[]
}

/**
 * Create an empty memory.
 * @returns a memory with nothing open.
 */
export function createPageMemory(): PageMemory {
  return { missionId: null, filePath: null, history: [] }
}
