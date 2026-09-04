import type { SyncEvent, SyncResult, SyncStatus } from './sync.ts'
import { shortSha } from './time.ts'

const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const CYAN = '\x1b[36m'

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
  const succeeded = results.filter((result) => result.status === 'synced' || result.status === 'up-to-date')
  const failed = results.filter((result) => result.status === 'failed')
  const removed = results.filter((result) => result.status === 'removed')
  const parts: string[] = []
  if (succeeded.length > 0) {
    parts.push(`${succeeded.length} succeeded`)
  }
  if (failed.length > 0) {
    parts.push(`${failed.length} failed`)
  }
  if (removed.length > 0) {
    parts.push(`${removed.length} removed`)
  }

  const lines: string[] = []
  if (parts.length > 0) {
    lines.push(parts.join(', '))
  }

  for (const result of failed) {
    lines.push(`  ✗ ${result.name}`)
    for (const line of result.message.trim().split('\n')) {
      if (line.trim()) {
        lines.push(`    ${line}`)
      }
    }
  }

  return lines
}

export function createSyncReporter(options: ReporterOptions = {}) {
  const stdout = options.stdout ?? process.stdout
  const color = useColor(stdout, options.color)
  const names: string[] = []

  function columns(): number {
    return options.columns ?? (stdout as NodeJS.WriteStream).columns ?? 80
  }

  function write(text: string): void {
    stdout.write(text)
  }

  function nameWidth(): number {
    return Math.max(1, ...names.map((name) => name.length))
  }

  function renderResult(result: SyncResult): string {
    return formatPullLine(result.name, result.status, lineDetail(result), nameWidth(), {
      color,
      width: columns(),
    })
  }

  function onEvent(event: SyncEvent): void {
    if (event.type === 'result' && event.result.status === 'removed') {
      write(`${renderResult(event.result)}\n`)
      return
    }

    if (event.type === 'start') {
      names.push(...event.names)
      if (names.length === 0) {
        return
      }
      const noun = names.length === 1 ? 'source' : 'sources'
      write(`\nPulling ${names.length} ${noun}: ${names.join(', ')}\n`)
      return
    }

    if (event.type === 'pulling') {
      return
    }

    if (event.type === 'result') {
      write(`${renderResult(event.result)}\n`)
    }
  }

  function finish(results: SyncResult[]): void {
    const lines = formatSummary(results)
    if (lines.length === 0) {
      return
    }
    write('\n')
    for (const line of lines) {
      if (line.startsWith('  ✗') || line.startsWith('    ')) {
        write(`${paint(color, RED, line)}\n`)
        continue
      }
      write(`${paint(color, DIM, line)}\n`)
    }
  }

  return { onEvent, finish, restore: () => undefined }
}
