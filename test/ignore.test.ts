import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureClaudeignore,
  ensureClaudeSettings,
  ensureCursorignore,
  ensureGitignore,
  initConfigStub,
  renderCatalog,
  upsertAgentsSection,
} from '../src/ignore.ts'
import { formatAdded, formatPulled } from '../src/time.ts'

const temps: string[] = []

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('ignore helpers', () => {
  it('appends .kiwi/ to gitignore once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kiwi-ignore-'))
    temps.push(dir)
    await ensureGitignore(dir)
    await ensureGitignore(dir)
    const text = readFileSync(join(dir, '.gitignore'), 'utf8')
    expect(text.match(/^\.kiwi\/$/gm)?.length).toBe(1)
  })

  it('un-ignores .kiwi in .cursorignore', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kiwi-cursor-'))
    temps.push(dir)
    await ensureCursorignore(dir)
    const text = readFileSync(join(dir, '.cursorignore'), 'utf8')
    expect(text).toContain('!.kiwi/')
    expect(text).toContain('!.kiwi/**')
  })

  it('un-ignores .kiwi in .claudeignore and allows Read in Claude settings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kiwi-claude-'))
    temps.push(dir)
    await ensureClaudeignore(dir)
    await ensureClaudeSettings(dir)
    const ignore = readFileSync(join(dir, '.claudeignore'), 'utf8')
    expect(ignore).toContain('!.kiwi/')
    expect(ignore).toContain('!.kiwi/**')
    const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8')) as {
      permissions: { allow: string[] }
    }
    expect(settings.permissions.allow).toContain('Read(.kiwi/**)')
    await ensureClaudeSettings(dir)
    const again = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8')) as {
      permissions: { allow: string[] }
    }
    expect(again.permissions.allow.filter((rule) => rule === 'Read(.kiwi/**)')).toHaveLength(1)
  })

  it('upserts a bounded AGENTS.md section', () => {
    const catalog = renderCatalog([
      {
        name: 'app',
        description: 'Production app source under test.',
        repo: 'acme/my-app',
        destDir: '.kiwi/app',
        exclude: [],
        include: [],
        ref: 'main',
        paths: ['src'],
      },
    ])
    const once = upsertAgentsSection('# Tests\n', catalog)
    expect(once).toContain('<!-- kiwi-fetch:start -->')
    expect(once).toContain('**<<app>>** (`.kiwi/app`)')
    expect(once).toContain('`<<name>>` is the source `name` in kiwi.config.ts')
    const twice = upsertAgentsSection(once, catalog)
    expect(twice.match(/<!-- kiwi-fetch:start -->/g)?.length).toBe(1)
  })

  it('includes whole-repo, include, folder, and nested-file examples in the init stub', () => {
    const stub = initConfigStub()
    expect(stub).toContain('Whole repo, no include')
    expect(stub).toContain('Whole repo, with include')
    expect(stub).toContain("include: ['package.json']")
    expect(stub).toContain("paths: ['src']")
    expect(stub).toContain("paths: ['src/app/routes.ts']")
  })
})

describe('list time labels', () => {
  it('uses last pulled and added wording', () => {
    const iso = '2026-09-04T00:43:00.000Z'
    const now = Date.parse('2026-09-04T02:43:00.000Z')
    expect(formatPulled(iso, now)).toContain('last pulled')
    expect(formatPulled(iso, now)).toContain('2 hours ago')
    expect(formatAdded(iso, now)).toContain('added')
    expect(formatAdded(iso, now)).toContain('2 hours ago')
  })
})
