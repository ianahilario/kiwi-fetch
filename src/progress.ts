import type { SyncEvent, SyncResult, SyncStatus } from './sync.ts'
import { shortSha } from './time.ts'

const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const CYAN = '\x1b[36m'
const HIDE_CURSOR = '\x1b[?25l'
const SHOW_CURSOR = '\x1b[?25h'

type LineState = 'pending' | 'pulling' | SyncStatus

export interface ReporterOptions {
  stdout?: NodeJS.WritableStream
  color?: boolean
  tty?: boolean
  columns?: number
}

function useColor(stdout: NodeJS.WritableStream, explicit?: boolean): boolean {
  if (explicit !== undefined) {
    return explicit
  }
  if (process.env.NO_COLOR) {
    return false
  }
  if (process.env.FORCE_COLOR === '0') {
    return false
  }
  if (process.env.FORCE_COLOR) {
    return true
  }
  return Boolean((stdout as NodeJS.WriteStream).isTTY)
}

function paint(enabled: boolean, code: string, text: string): string {
  return enabled ? `${code}${text}${RESET}` : text
}

function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() || text
}

export function lineDetail(result: SyncResult): string {
  if (result.status === 'synced' && result.sha) {
    return `synced @ ${shortSha(result.sha)}`
  }
  if (result.status === 'up-to-date') {
    return 'already up to date'
  }
  if (result.status === 'failed') {
    return firstLine(result.message)
  }
  if (result.status === 'removed') {
    return 'removed (no longer in kiwi.config.ts)'
  }
  return result.message
}

function iconFor(state: LineState): string {
  if (state === 'synced' || state === 'up-to-date') {
    return '✓'
  }
  if (state === 'failed') {
    return '✗'
  }
  if (state === 'pulling') {
    return '…'
  }
  if (state === 'removed') {
    return '–'
  }
  return '○'
}

function colorFor(state: LineState): string | undefined {
  if (state === 'synced' || state === 'up-to-date') {
    return GREEN
  }
  if (state === 'failed') {
    return RED
  }
  if (state === 'pulling') {
    return CYAN
  }
  return DIM
}

function truncate(text: string, width: number): string {
  if (width <= 0 || text.length <= width) {
    return text
  }
  if (width === 1) {
    return '…'
  }
  return `${text.slice(0, width - 1)}…`
}

export function formatPullLine(
  name: string,
  state: LineState,
  detail: string,
  nameWidth: number,
  options: { color?: boolean; width?: number } = {}
): string {
  const icon = iconFor(state)
  const padded = name.padEnd(nameWidth)
  const raw = `  ${icon} ${padded}  ${detail}`
  const clipped = options.width ? truncate(raw, options.width) : raw
  const code = colorFor(state)
  if (!options.color || !code) {
    return clipped
  }
  return paint(true, code, clipped)
}

export function formatSummary(results: SyncResult[]): string[] {
  const pulled = results.filter((result) => result.status !== 'removed')
  const removed = results.filter((result) => result.status === 'removed')
  const nameWidth = Math.max(1, ...results.map((result) => result.name.length))
  const lines = ['Summary']

  for (const result of pulled) {
    const detail = result.status === 'failed' ? firstLine(result.message) : lineDetail(result)
    lines.push(formatPullLine(result.name, result.status, detail, nameWidth))
    if (result.status === 'failed') {
      const rest = result.message.trim().split('\n').slice(1)
      for (const line of rest) {
        if (line.trim()) {
          lines.push(`    ${line}`)
        }
      }
    }
  }

  for (const result of removed) {
    lines.push(formatPullLine(result.name, 'removed', lineDetail(result), nameWidth))
  }

  return lines
}

export function createSyncReporter(options: ReporterOptions = {}) {
  const stdout = options.stdout ?? process.stdout
  const tty = options.tty ?? Boolean((stdout as NodeJS.WriteStream).isTTY)
  const color = useColor(stdout, options.color)
  const names: string[] = []
  const states = new Map<string, { state: LineState; detail: string }>()
  let listLineCount = 0
  let started = false
  let cursorHidden = false

  function columns(): number {
    return options.columns ?? (stdout as NodeJS.WriteStream).columns ?? 80
  }

  function write(text: string): void {
    stdout.write(text)
  }

  function hideCursor(): void {
    if (tty && !cursorHidden) {
      write(HIDE_CURSOR)
      cursorHidden = true
    }
  }

  function showCursor(): void {
    if (cursorHidden) {
      write(SHOW_CURSOR)
      cursorHidden = false
    }
  }

  function nameWidth(): number {
    return Math.max(1, ...names.map((name) => name.length))
  }

  function renderLine(name: string): string {
    const current = states.get(name) ?? { state: 'pending' as const, detail: 'pending' }
    return formatPullLine(name, current.state, current.detail, nameWidth(), {
      color,
      width: columns(),
    })
  }

  function drawList(initial: boolean): void {
    if (names.length === 0) {
      return
    }
    if (!initial && listLineCount > 0) {
      write(`\x1b[${listLineCount}A`)
    }
    for (const name of names) {
      write(`\x1b[2K${renderLine(name)}\n`)
    }
    listLineCount = names.length
  }

  function onEvent(event: SyncEvent): void {
    if (event.type === 'result' && event.result.status === 'removed') {
      const line = formatPullLine(
        event.result.name,
        'removed',
        lineDetail(event.result),
        Math.max(event.result.name.length, nameWidth()),
        { color, width: columns() }
      )
      write(`${line}\n`)
      return
    }

    if (event.type === 'start') {
      names.push(...event.names)
      for (const name of event.names) {
        states.set(name, { state: 'pending', detail: 'pending' })
      }
      if (names.length === 0) {
        return
      }
      const noun = names.length === 1 ? 'source' : 'sources'
      started = true
      if (tty) {
        write(`\nPulling ${names.length} ${noun}\n`)
        hideCursor()
        write('\n')
        drawList(true)
      } else {
        write(`\nPulling ${names.length} ${noun}: ${names.join(', ')}\n`)
      }
      return
    }

    if (event.type === 'pulling') {
      states.set(event.name, { state: 'pulling', detail: 'pulling' })
      if (tty && started) {
        drawList(false)
      }
      return
    }

    if (event.type === 'result') {
      const { result } = event
      states.set(result.name, { state: result.status, detail: lineDetail(result) })
      if (tty && started) {
        drawList(false)
      } else {
        write(`${renderLine(result.name)}\n`)
      }
    }
  }

  function finish(results: SyncResult[]): void {
    showCursor()
    write('\n')
    for (const line of formatSummary(results)) {
      if (line === 'Summary') {
        write(`${paint(color, DIM, line)}\n`)
        continue
      }
      if (line.includes('✓')) {
        write(`${paint(color, GREEN, line)}\n`)
        continue
      }
      if (line.includes('✗') || line.startsWith('    ')) {
        write(`${paint(color, RED, line)}\n`)
        continue
      }
      if (line.includes('–')) {
        write(`${paint(color, DIM, line)}\n`)
        continue
      }
      write(`${line}\n`)
    }
  }

  return { onEvent, finish, restore: showCursor }
}
