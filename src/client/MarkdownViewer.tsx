/**
 * The mission file viewer: fetches one markdown file through `missions/file` and
 * renders it with the platform's own `MarkdownText`.
 *
 * `MarkdownText` loads no front-matter extension and renders raw HTML literally,
 * so before rendering the viewer strips a leading YAML front-matter block into a
 * compact metadata strip and drops whole-line HTML comments (the mission ledger
 * markers) outside code fences; otherwise `---` rules, YAML and
 * `<!-- mission-ledger:start -->` would show as text.
 *
 * Navigation never opens a Session file: a backticked `resources/**.md` token
 * and an ordinary local link both resolve to a validated path and hand it to the
 * page's `onNavigate`.
 * @module
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  IconChevronLeftOutlineRegular,
  MarkdownDelegateProvider,
  MarkdownText,
  PathLabel,
  Tag,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'

import { MAX_FILE_BYTES, type InjectedConfig } from '../config.ts'
import { isResourcesMarkdownPath } from '../mission-path.ts'
import { fetchMissionFile, type MissionFileDto } from './lib/mission-files.ts'
import { MissionApiError } from './lib/mission-transport.ts'
import type { MissionBoardTranslate } from './locale.ts'

/** Front-matter keys the metadata strip shows inline; every other key sits behind the "more" toggle. */
const PRIMARY_KEYS: readonly string[] = ['name', 'status', 'created', 'tags']

/** One parsed front-matter field. */
export interface FrontMatterField {
  readonly key: string
  readonly value: string | readonly string[]
}

/** A document split into its front matter and the markdown to render. */
export interface SplitDocument {
  readonly fields: readonly FrontMatterField[]
  readonly body: string
}

/**
 * Remove surrounding quotes from a YAML scalar.
 * @param value - raw scalar text.
 * @returns the unquoted text.
 */
function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    if ((first === '"' || first === '\'') && trimmed.endsWith(first)) return trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * Parse the small YAML subset mission files use: `key: value`, `key: [a, b]`
 * and `key:` followed by `- item` lines. Anything else (nested maps, block
 * scalars, wrapped continuation lines) is ignored rather than guessed at.
 * @param block - the text between the `---` fences.
 * @returns the fields, in document order.
 */
function parseFrontMatter(block: string): FrontMatterField[] {
  const fields: FrontMatterField[] = []
  let listKey: string | undefined
  let list: string[] = []
  const flush = (): void => {
    if (listKey !== undefined) fields.push({ key: listKey, value: list })
    listKey = undefined
    list = []
  }
  for (const line of block.split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line)
    if (item !== null && listKey !== undefined) {
      list.push(unquote(item[1] ?? ''))
      continue
    }
    const pair = /^([A-Za-z0-9_][\w-]*):(?:\s+(.*))?$/.exec(line)
    if (pair === null) continue
    flush()
    const key = pair[1] ?? ''
    const raw = (pair[2] ?? '').trim()
    if (raw === '') {
      listKey = key
    } else if (raw.startsWith('[') && raw.endsWith(']')) {
      fields.push({ key, value: raw.slice(1, -1).split(',').map(unquote).filter(entry => entry !== '') })
    } else if (raw !== '|' && raw !== '>') {
      fields.push({ key, value: unquote(raw) })
    }
  }
  flush()
  return fields.filter(field => field.value.length > 0)
}

/**
 * Drop whole-line HTML comments outside code fences.
 * @param text - markdown.
 * @returns the markdown without those lines.
 */
function dropCommentLines(text: string): string {
  let fence: string | undefined
  const kept: string[] = []
  for (const line of text.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker !== undefined) {
      if (fence === undefined) fence = marker[0]
      else if (marker[0] === fence) fence = undefined
    }
    if (fence === undefined && /^\s*<!--.*-->\s*$/.test(line)) continue
    kept.push(line)
  }
  return kept.join('\n')
}

/**
 * Split a leading front-matter block off a document and drop ledger comments.
 * @param content - the file's text.
 * @returns the parsed fields and the markdown body to render.
 */
export function splitDocument(content: string): SplitDocument {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content)
  if (match === null) return { fields: [], body: dropCommentLines(content) }
  return { fields: parseFrontMatter(match[1] ?? ''), body: dropCommentLines(content.slice(match[0].length)) }
}

/**
 * Decide which `resources/**.md` file a link destination names.
 *
 * A destination that already passes the path check is used as is (the
 * repository's project-root-relative convention). A relative destination is
 * normalized against the open file's directory, collapsing `.` and `..`.
 * Absolute paths, drive letters and anything that fails validation resolve to
 * nothing.
 * @param currentPath - the open file's project-root-relative path.
 * @param dest - the link destination, already decoded and stripped of any `#Ln` fragment.
 * @returns the validated target, or `null` when the destination opens nothing.
 */
export function resolveLinkTarget(currentPath: string, dest: string): string | null {
  // A plain boolean, not the type guard: a failed guard would narrow `dest` to `never`.
  const valid = (value: string): boolean => isResourcesMarkdownPath(value)
  if (valid(dest)) return dest
  if (dest.startsWith('/') || /^[a-zA-Z]:/.test(dest)) return null
  const parts = currentPath.split('/').slice(0, -1)
  for (const segment of dest.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else {
      parts.push(segment)
    }
  }
  const resolved = parts.join('/')
  return isResourcesMarkdownPath(resolved) ? resolved : null
}

/** What the viewer shows for one file. */
type ViewState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly file: MissionFileDto }
  | { readonly phase: 'error'; readonly error: unknown }

/**
 * Turn a load failure into the sentence the Human reads.
 * @param error - the thrown value.
 * @param t - the locale seat.
 * @returns the copy.
 */
function errorCopy(error: unknown, t: MissionBoardTranslate): string {
  if (error instanceof MissionApiError) {
    if (error.code === 'NOT_FOUND') return t('viewer.errors.notFound')
    if (error.code === 'FILE_TOO_LARGE') {
      const size = error.size === undefined ? '?' : String(Math.ceil(error.size / 1024))
      return t('viewer.errors.tooLarge', { size, limit: MAX_FILE_BYTES / 1024 })
    }
    if (error.code === 'AWEAVE_ROOT_UNRESOLVED' || error.code === 'AWEAVE_RESOURCES_UNAVAILABLE') {
      return t('viewer.errors.root')
    }
    if (error.kind === 'unreachable') return t('viewer.errors.unreachable', { message: error.message })
    return t('viewer.errors.generic', { message: error.message })
  }
  return t('viewer.errors.generic', { message: error instanceof Error ? error.message : String(error) })
}

/** Props of {@link MarkdownViewer}. */
export interface MarkdownViewerProps {
  readonly config: InjectedConfig
  readonly t: MissionBoardTranslate
  /** Open file's project-root-relative path. */
  readonly path: string
  /** Bumped to reload the open file. */
  readonly reloadKey: number
  /** Whether a previous file exists to go back to. */
  readonly canBack: boolean
  /** Open another file; must be referentially stable. */
  readonly onNavigate: (path: string) => void
  /** Go back one file; must be referentially stable. */
  readonly onBack: () => void
  /** Report whether a load is running; must be referentially stable. */
  readonly onBusy: (busy: boolean) => void
}

/**
 * Render the file viewer.
 * @param props - see {@link MarkdownViewerProps}.
 * @returns the viewer.
 */
export const MarkdownViewer = memo(function MarkdownViewer(props: MarkdownViewerProps): ReactNode {
  const { config, t, path, reloadKey, canBack, onNavigate, onBack, onBusy } = props
  const [view, setView] = useState<ViewState>({ phase: 'loading' })
  const [showMore, setShowMore] = useState(false)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setView({ phase: 'loading' })
    setNotice(undefined)
    onBusy(true)
    fetchMissionFile(config, path, controller.signal).then((file) => {
      if (controller.signal.aborted) return
      setView({ phase: 'ready', file })
      onBusy(false)
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setView({ phase: 'error', error })
      onBusy(false)
    })
    return () => {
      controller.abort()
      onBusy(false)
    }
  }, [config, path, reloadKey, onBusy])

  useEffect(() => {
    if (scrollRef.current !== null) scrollRef.current.scrollTop = 0
  }, [path])

  const labels = useMemo(() => ({
    code: { copyLabel: t('viewer.code.copy'), copiedLabel: t('viewer.code.copied') },
    footnotes: t('viewer.footnotes'),
  }), [t])

  const fileMentions = useMemo(() => ({
    resolve: (value: string) => {
      const target = value.trim()
      if (!isResourcesMarkdownPath(target)) return undefined
      return { open: () => { onNavigate(target) }, label: target, title: target }
    },
  }), [onNavigate])

  const openFile = useCallback((dest: string): void => {
    const target = resolveLinkTarget(path, dest)
    if (target === null) {
      setNotice(t('viewer.badLink', { dest }))
      return
    }
    setNotice(undefined)
    onNavigate(target)
  }, [path, onNavigate, t])

  const parsed = useMemo(() => (view.phase === 'ready' ? splitDocument(view.file.content) : undefined), [view])

  return (
    <div className="awe-mp-viewer" data-aweave-devkit="viewer">
      <div className="awe-mp-viewerBar">
        {canBack ? (
          <Tooltip label={t('viewer.back.tip')} delayMs={500} portal side="bottom">
            <Button variant="ghost" size="sm" icon={<IconChevronLeftOutlineRegular size={14} />} onClick={onBack}>
              {t('viewer.back')}
            </Button>
          </Tooltip>
        ) : null}
        <PathLabel path={path} className="awe-mp-viewerPath" />
      </div>
      <div className="awe-mp-viewerScroll" ref={scrollRef}>
        {notice === undefined ? null : <p className="awe-mp-inlineNotice" role="status">{notice}</p>}
        {view.phase === 'loading' ? (
          <div className="awe-mp-skel" role="status" aria-label={t('viewer.loading')}>
            <span /><span /><span /><span />
          </div>
        ) : null}
        {view.phase === 'error' ? (
          <p className="awe-mp-state awe-mp-state--error" role="alert">{errorCopy(view.error, t)}</p>
        ) : null}
        {parsed === undefined ? null : (
          <>
            <FrontMatterStrip fields={parsed.fields} showMore={showMore} onToggle={() => { setShowMore(value => !value) }} t={t} />
            {parsed.body.trim() === '' ? (
              <p className="awe-mp-state">{t('viewer.empty')}</p>
            ) : (
              <MarkdownDelegateProvider openFile={openFile}>
                <MarkdownText text={parsed.body} labels={labels} fileMentions={fileMentions} variant="body" />
              </MarkdownDelegateProvider>
            )}
          </>
        )}
      </div>
    </div>
  )
})

/**
 * The compact metadata strip over the rendered document.
 * @param props.fields - parsed front-matter fields.
 * @param props.showMore - whether the secondary fields are expanded.
 * @param props.onToggle - flips `showMore`.
 * @param props.t - the locale seat.
 * @returns the strip, or nothing when the document has no front matter.
 */
function FrontMatterStrip(props: {
  readonly fields: readonly FrontMatterField[]
  readonly showMore: boolean
  readonly onToggle: () => void
  readonly t: MissionBoardTranslate
}): ReactNode {
  const { fields, showMore, onToggle, t } = props
  if (fields.length === 0) return null
  const field = (key: string): FrontMatterField | undefined => fields.find(candidate => candidate.key === key)
  const name = field('name')
  const status = field('status')
  const created = field('created')
  const tags = field('tags')
  const extra = fields.filter(candidate => !PRIMARY_KEYS.includes(candidate.key))
  const text = (value: FrontMatterField | undefined): string => (value === undefined ? '' : [value.value].flat().join(', '))
  return (
    <section className="awe-mp-meta" data-aweave-devkit="front-matter">
      {name === undefined ? null : <p className="awe-mp-metaName">{text(name)}</p>}
      <div className="awe-mp-metaRow">
        {status === undefined ? null : <Tag tone="info">{text(status)}</Tag>}
        {created === undefined ? null : <span className="awe-mp-dim awe-mp-mono">{text(created)}</span>}
        {tags === undefined ? null : [tags.value].flat().map(tag => <Tag key={tag} tone="outline">{tag}</Tag>)}
        <span className="awe-mp-grow" />
        {extra.length === 0 ? null : (
          <Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={showMore}>
            {t(showMore ? 'viewer.frontMatter.less' : 'viewer.frontMatter.more')}
          </Button>
        )}
      </div>
      {showMore ? (
        <dl className="awe-mp-metaMore">
          {extra.map(entry => (
            <div key={entry.key} className="awe-mp-metaItem">
              <dt>{entry.key}</dt>
              <dd>{text(entry)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  )
}
