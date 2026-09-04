import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AGENTS_END, AGENTS_START, DEFAULT_DEST } from './constants.ts'
import type { KiwiConfig, ResolvedSource } from './types.ts'

function ensureLine(content: string, line: string): string {
  const lines = content.split(/\r?\n/)
  if (lines.some((existing) => existing.trim() === line)) {
    return content.endsWith('\n') ? content : `${content}\n`
  }
  const trimmed = content.replace(/\s*$/, '')
  return `${trimmed}${trimmed ? '\n' : ''}${line}\n`
}

export async function ensureGitignore(cwd: string, dest = DEFAULT_DEST): Promise<void> {
  const file = join(cwd, '.gitignore')
  const existing = existsSync(file) ? await readFile(file, 'utf8') : ''
  await writeFile(file, ensureLine(existing, dest.endsWith('/') ? dest : `${dest}/`), 'utf8')
}

async function ensureUnignoreFile(cwd: string, filename: string, dest = DEFAULT_DEST): Promise<void> {
  const file = join(cwd, filename)
  const existing = existsSync(file) ? await readFile(file, 'utf8') : ''
  const folder = dest.replace(/\/$/, '')
  let next = ensureLine(existing, `!${folder}/`)
  next = ensureLine(next, `!${folder}/**`)
  await writeFile(file, next, 'utf8')
}

export async function ensureCursorignore(cwd: string, dest = DEFAULT_DEST): Promise<void> {
  await ensureUnignoreFile(cwd, '.cursorignore', dest)
}

export async function ensureClaudeignore(cwd: string, dest = DEFAULT_DEST): Promise<void> {
  await ensureUnignoreFile(cwd, '.claudeignore', dest)
}

export async function ensureClaudeSettings(cwd: string, dest = DEFAULT_DEST): Promise<void> {
  const dir = join(cwd, '.claude')
  const file = join(dir, 'settings.json')
  const folder = dest.replace(/\/$/, '')
  const rule = `Read(${folder}/**)`
  let settings: { permissions?: { allow?: string[] } } = {}
  if (existsSync(file)) {
    try {
      settings = JSON.parse(await readFile(file, 'utf8')) as { permissions?: { allow?: string[] } }
    } catch {
      return
    }
  }
  settings.permissions ??= {}
  settings.permissions.allow ??= []
  if (!settings.permissions.allow.includes(rule)) {
    settings.permissions.allow.push(rule)
  }
  await mkdir(dir, { recursive: true })
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}

export function renderCatalog(sources: ResolvedSource[]): string {
  if (sources.length === 0) {
    return 'No kiwi-fetch sources are configured. Edit kiwi.config.ts and run `kiwi-fetch sync`.'
  }
  const items = sources
    .map(
      (source) =>
        `- **<<${source.name}>>** (\`${source.destDir}\`): ${source.description.trim()}`
    )
    .join('\n')
  return [
    'External source copies live under the paths below. `<<name>>` is the source `name` in kiwi.config.ts (not a literal folder named app). Read a copy only if its description matches the current task.',
    '',
    items,
  ].join('\n')
}

export function upsertAgentsSection(existing: string, catalog: string): string {
  const body = [
    '## Kiwi-fetch context',
    '',
    catalog,
    '',
  ].join('\n')
  const block = `${AGENTS_START}\n${body}${AGENTS_END}`
  if (existing.includes(AGENTS_START) && existing.includes(AGENTS_END)) {
    return existing.replace(
      new RegExp(`${AGENTS_START}[\\s\\S]*?${AGENTS_END}`),
      block
    )
  }
  const trimmed = existing.replace(/\s*$/, '')
  return `${trimmed}${trimmed ? '\n\n' : ''}${block}\n`
}

const MEMORY_FILES = ['AGENTS.md', 'CLAUDE.md'] as const

export async function writeAgentsCatalog(cwd: string, sources: ResolvedSource[]): Promise<void> {
  const catalog = renderCatalog(sources)
  for (const name of MEMORY_FILES) {
    const file = join(cwd, name)
    const existing = existsSync(file) ? await readFile(file, 'utf8') : ''
    await writeFile(file, upsertAgentsSection(existing, catalog), 'utf8')
  }
}

export async function writeKiwiReadme(cwd: string, dest: string, sources: ResolvedSource[]): Promise<void> {
  const dir = join(cwd, dest)
  await mkdir(dir, { recursive: true })
  const content = `# Kiwi-fetch context\n\n${renderCatalog(sources)}\n`
  await writeFile(join(dir, 'README.md'), content, 'utf8')
}

export function initConfigStub(): string {
  return `import { defineConfig } from 'kiwi-fetch'

export default defineConfig({
  dest: '.kiwi',
  sources: [
    // Whole repo, no include. Default excludes drop node_modules, dist, package.json, .env, .git, etc.
    // {
    //   name: 'app',
    //   description:
    //     'Production app source under test. Read when writing or debugging e2e tests that depend on UI, routes, or API behavior.',
    //   repo: 'acme/my-app',
    //   ref: 'main',
    // },

    // Whole repo, with include — copy default-excluded files too:
    // {
    //   name: 'app-with-manifest',
    //   description:
    //     'Same whole-repo copy as \`app\`, plus package.json so tests can read dependency versions.',
    //   repo: 'acme/my-app',
    //   ref: 'main',
    //   include: ['package.json'],
    // },

    // One folder (and everything under it):
    // {
    //   name: 'app-src',
    //   description:
    //     'App src/ tree only. Prefer this over \`app\` when you only need application code, not the rest of the repo.',
    //   repo: 'acme/my-app',
    //   ref: 'main',
    //   paths: ['src'],
    // },

    // One file inside a subfolder:
    // {
    //   name: 'app-routes',
    //   description:
    //     'App route table (src/app/routes.ts). Read when a test needs the list of URLs or route names.',
    //   repo: 'acme/my-app',
    //   ref: 'main',
    //   paths: ['src/app/routes.ts'],
    // },
  ],
})
`
}

export async function writeInitFiles(cwd: string, dest = DEFAULT_DEST): Promise<void> {
  const configPath = join(cwd, 'kiwi.config.ts')
  if (!existsSync(configPath)) {
    await writeFile(configPath, initConfigStub(), 'utf8')
  }
  const lockFile = join(cwd, 'kiwi.lock.json')
  if (!existsSync(lockFile)) {
    await writeFile(lockFile, `${JSON.stringify({ sources: {} }, null, 2)}\n`, 'utf8')
  }
  await ensureGitignore(cwd, dest)
  await ensureCursorignore(cwd, dest)
  await ensureClaudeignore(cwd, dest)
  await ensureClaudeSettings(cwd, dest)
  const missingMemory = MEMORY_FILES.some((name) => !existsSync(join(cwd, name)))
  if (missingMemory) {
    await writeAgentsCatalog(cwd, [])
  }
}

export async function maybeAddPrepareScript(cwd: string): Promise<boolean> {
  const file = join(cwd, 'package.json')
  if (!existsSync(file)) {
    return false
  }
  const pkg = JSON.parse(await readFile(file, 'utf8')) as {
    scripts?: Record<string, string>
  }
  pkg.scripts ??= {}
  const current = pkg.scripts.prepare ?? ''
  if (current.includes('kiwi-fetch sync')) {
    return false
  }
  pkg.scripts.prepare = current ? `${current} && kiwi-fetch sync` : 'kiwi-fetch sync'
  await writeFile(file, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  return true
}

export function configDest(config: KiwiConfig): string {
  return config.dest ?? DEFAULT_DEST
}
