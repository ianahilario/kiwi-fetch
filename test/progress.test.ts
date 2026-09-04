import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createSyncReporter, formatPullLine, formatSummary, lineDetail } from '../src/progress.ts'
import type { SyncResult } from '../src/sync.ts'

describe('sync progress formatting', () => {
  it('marks succeeded pulls with a check and failed pulls with an x', () => {
    expect(formatPullLine('app', 'synced', 'synced @ abc1234', 8)).toContain('✓')
    expect(formatPullLine('app', 'failed', 'clone failed', 8)).toContain('✗')
    expect(formatPullLine('app', 'pending', 'pending', 8)).toContain('○')
  })

  it('summarizes which sources succeeded and which failed', () => {
    const results: SyncResult[] = [
      { name: 'app', status: 'synced', sha: 'abc1234def', message: 'synced app @ abc1234' },
      { name: 'docs', status: 'up-to-date', sha: 'abc1234def', message: 'docs already up to date' },
      { name: 'missing', status: 'failed', message: 'Authentication failed for https://example.com/missing.git' },
    ]
    const lines = formatSummary(results)
    expect(lines[0]).toBe('Summary')
    expect(lines.some((line) => line.includes('✓') && line.includes('app'))).toBe(true)
    expect(lines.some((line) => line.includes('✓') && line.includes('docs'))).toBe(true)
    expect(lines.some((line) => line.includes('✗') && line.includes('missing'))).toBe(true)
    expect(lines.some((line) => line.includes('Authentication failed'))).toBe(true)
  })

  it('uses the short sha for a synced line', () => {
    expect(lineDetail({ name: 'app', status: 'synced', sha: 'abcdef123456', message: 'synced app @ abcdef1' })).toBe(
      'synced @ abcdef1'
    )
  })

  it('lists sources then prints check and x as each result arrives', () => {
    let output = ''
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        output += String(chunk)
        callback()
      },
    })
    const reporter = createSyncReporter({ stdout, color: false, tty: false, columns: 80 })
    reporter.onEvent({ type: 'start', names: ['app', 'missing'] })
    reporter.onEvent({
      type: 'result',
      result: { name: 'app', status: 'synced', sha: 'abc1234ffff', message: 'synced app @ abc1234' },
    })
    reporter.onEvent({
      type: 'result',
      result: { name: 'missing', status: 'failed', message: 'repository not found' },
    })
    reporter.finish([
      { name: 'app', status: 'synced', sha: 'abc1234ffff', message: 'synced app @ abc1234' },
      { name: 'missing', status: 'failed', message: 'repository not found' },
    ])

    expect(output).toContain('Pulling 2 sources: app, missing')
    expect(output).toMatch(/✓\s+app\s+synced @ abc1234/)
    expect(output).toMatch(/✗\s+missing\s+repository not found/)
    expect(output).toMatch(/Summary[\s\S]*✓\s+app/)
    expect(output).toMatch(/Summary[\s\S]*✗\s+missing/)
  })
})
