import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runInit, runList, runRemove, runSync } from '../src/commands.ts'
import { loadConfig } from '../src/config.ts'

const temps: string[] = []

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`)
  }
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kiwi-upstream-'))
  temps.push(dir)
  mkdirSync(join(dir, 'src', 'app'), { recursive: true })
  mkdirSync(join(dir, 'docs'), { recursive: true })
  mkdirSync(join(dir, '.claude'), { recursive: true })
  writeFileSync(join(dir, 'src', 'index.ts'), 'export const app = true\n')
  writeFileSync(join(dir, 'src', 'app', 'routes.ts'), 'export const routes = ["/"]\n')
  writeFileSync(join(dir, 'docs', 'readme.md'), '# docs\n')
  writeFileSync(join(dir, 'package.json'), '{"name":"app"}\n')
  writeFileSync(join(dir, '.env'), 'SECRET=1\n')
  writeFileSync(join(dir, '.claude', 'settings.json'), '{}\n')
  git(dir, ['init', '-b', 'main'])
  git(dir, ['config', 'user.email', 'kiwi@example.com'])
  git(dir, ['config', 'user.name', 'Kiwi'])
  git(dir, ['add', '.'])
  git(dir, ['add', '-f', '.claude'])
  git(dir, ['commit', '-m', 'init'])
  return dir
}

describe('sync from a local git fixture', () => {
  it('copies a folder and a nested file, skipping secrets and unselected paths', async () => {
    const upstream = makeRepo()
    const project = mkdtempSync(join(tmpdir(), 'kiwi-project-'))
    temps.push(project)

    writeFileSync(
      join(project, 'kiwi.config.ts'),
      `import { defineConfig } from 'kiwi-fetch'
export default defineConfig({
  dest: '.kiwi',
  sources: [
    {
      name: 'app-src',
      description: 'App src tree only.',
      repo: ${JSON.stringify(upstream)},
      ref: 'main',
      paths: ['src'],
    },
    {
      name: 'app-routes',
      description: 'App route table.',
      repo: ${JSON.stringify(upstream)},
      ref: 'main',
      paths: ['src/app/routes.ts'],
    },
  ],
})
`
    )

    const messages = await runSync(project)
    expect(messages.some((line) => line.startsWith('synced app-src'))).toBe(true)
    expect(existsSync(join(project, '.kiwi', 'app-src', 'src', 'index.ts'))).toBe(true)
    expect(existsSync(join(project, '.kiwi', 'app-src', 'docs', 'readme.md'))).toBe(false)
    expect(existsSync(join(project, '.kiwi', 'app-src', '.env'))).toBe(false)
    expect(readFileSync(join(project, '.kiwi', 'app-routes', 'src', 'app', 'routes.ts'), 'utf8')).toContain(
      'export const routes'
    )
    expect(existsSync(join(project, '.kiwi', 'app-routes', 'src', 'index.ts'))).toBe(false)

    const again = await runSync(project)
    expect(again.every((line) => line.includes('already up to date'))).toBe(true)

    const listed = await runList(project)
    expect(listed[0]).toMatch(/app-src\s+/)
    expect(listed[0]).toContain('last pulled')
    expect(listed[0]).toMatch(/[0-9a-f]{7}/)
  })

  it('init writes a stub config that loads', async () => {
    const project = mkdtempSync(join(tmpdir(), 'kiwi-init-'))
    temps.push(project)
    await runInit(project)
    const { config } = await loadConfig(project)
    expect(config.sources).toEqual([])
    expect(existsSync(join(project, 'kiwi.lock.json'))).toBe(true)
    expect(readFileSync(join(project, '.gitignore'), 'utf8')).toContain('.kiwi/')
    expect(readFileSync(join(project, 'AGENTS.md'), 'utf8')).toContain('kiwi-fetch:start')
    expect(readFileSync(join(project, 'CLAUDE.md'), 'utf8')).toContain('kiwi-fetch:start')
    expect(readFileSync(join(project, '.claudeignore'), 'utf8')).toContain('!.kiwi/')
    expect(readFileSync(join(project, '.claude', 'settings.json'), 'utf8')).toContain('Read(.kiwi/**)')
  })

  it('list shows added when a source has never been synced', async () => {
    const project = mkdtempSync(join(tmpdir(), 'kiwi-list-'))
    temps.push(project)
    writeFileSync(
      join(project, 'kiwi.config.ts'),
      `import { defineConfig } from 'kiwi-fetch'
export default defineConfig({
  sources: [
    {
      name: 'app',
      description: 'Not synced yet.',
      repo: 'acme/my-app',
      ref: 'main',
    },
  ],
})
`
    )
    const listed = await runList(project)
    expect(listed[0]).toContain('app')
    expect(listed[0]).toContain('—')
    expect(listed[0]).toContain('added')
    expect(listed[0]).not.toContain('last pulled')
  })

  it('creates nested folders when name includes slashes, then prunes them on remove', async () => {
    const upstream = makeRepo()
    const project = mkdtempSync(join(tmpdir(), 'kiwi-nested-'))
    temps.push(project)

    writeFileSync(
      join(project, 'kiwi.config.ts'),
      `import { defineConfig } from 'kiwi-fetch'
export default defineConfig({
  dest: '.kiwi',
  sources: [
    {
      name: 'acme/app',
      description: 'Nested dest folder.',
      repo: ${JSON.stringify(upstream)},
      ref: 'main',
      exclude: ['.claude'],
    },
  ],
})
`
    )

    await runSync(project)
    expect(existsSync(join(project, '.kiwi', 'acme', 'app', 'src', 'index.ts'))).toBe(true)
    expect(existsSync(join(project, '.kiwi', 'acme', 'app', 'docs', 'readme.md'))).toBe(true)
    expect(existsSync(join(project, '.kiwi', 'acme', 'app', '.claude'))).toBe(false)

    await runRemove(project, 'acme/app')
    expect(existsSync(join(project, '.kiwi', 'acme', 'app'))).toBe(false)
    expect(existsSync(join(project, '.kiwi', 'acme'))).toBe(false)
  })
})
