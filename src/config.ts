import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'
import { CONFIG_FILES, DEFAULT_DEST, NAME_PATTERN } from './constants.ts'
import type { KiwiConfig, KiwiSource, ResolvedSource } from './types.ts'

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

function defineConfigModule(): string {
  const dir = dirname(fileURLToPath(import.meta.url))
  const ts = join(dir, 'index.ts')
  const js = join(dir, 'index.js')
  return existsSync(ts) ? ts : js
}

export function findConfigPath(cwd: string): string | undefined {
  for (const file of CONFIG_FILES) {
    const full = join(cwd, file)
    if (existsSync(full)) {
      return full
    }
  }
  return undefined
}

export function findProjectRoot(start = process.cwd()): string {
  let dir = start
  while (true) {
    if (findConfigPath(dir)) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) {
      return start
    }
    dir = parent
  }
}

function validateSource(source: KiwiSource, index: number, seen: Set<string>): void {
  const label = `sources[${index}]`
  if (!source || typeof source !== 'object') {
    throw new ConfigError(`${label} must be an object`)
  }
  if (!source.name || typeof source.name !== 'string') {
    throw new ConfigError(`${label}.name is required`)
  }
  if (!NAME_PATTERN.test(source.name)) {
    throw new ConfigError(
      `${label}.name ${JSON.stringify(source.name)} must match ${NAME_PATTERN}`
    )
  }
  if (seen.has(source.name)) {
    throw new ConfigError(`duplicate source name ${JSON.stringify(source.name)}`)
  }
  seen.add(source.name)
  if (!source.description || typeof source.description !== 'string' || !source.description.trim()) {
    throw new ConfigError(`${label} (${source.name}).description is required`)
  }
  if (!source.repo || typeof source.repo !== 'string') {
    throw new ConfigError(`${label} (${source.name}).repo is required`)
  }
  if (source.paths && !Array.isArray(source.paths)) {
    throw new ConfigError(`${label} (${source.name}).paths must be an array of strings`)
  }
  if (source.exclude && !Array.isArray(source.exclude)) {
    throw new ConfigError(`${label} (${source.name}).exclude must be an array of strings`)
  }
  if (source.include && !Array.isArray(source.include)) {
    throw new ConfigError(`${label} (${source.name}).include must be an array of strings`)
  }
}

export function validateConfig(raw: unknown): KiwiConfig {
  if (!raw || typeof raw !== 'object') {
    throw new ConfigError('config must export an object')
  }
  const config = raw as KiwiConfig
  if (!Array.isArray(config.sources)) {
    throw new ConfigError('config.sources must be an array')
  }
  const seen = new Set<string>()
  config.sources.forEach((source, index) => validateSource(source, index, seen))
  return {
    dest: config.dest ?? DEFAULT_DEST,
    sources: config.sources,
  }
}

export async function loadConfig(cwd: string): Promise<{ path: string; config: KiwiConfig }> {
  const path = findConfigPath(cwd)
  if (!path) {
    throw new ConfigError(
      `No kiwi.config.ts found in ${cwd}. Run kiwi-fetch init, then edit the config file.`
    )
  }
  const jiti = createJiti(import.meta.url, {
    alias: {
      'kiwi-fetch': defineConfigModule(),
    },
  })
  const loaded = await jiti.import(path)
  const raw =
    loaded && typeof loaded === 'object' && 'default' in loaded
      ? (loaded as { default: unknown }).default
      : loaded
  return { path, config: validateConfig(raw) }
}

export function resolveSource(source: KiwiSource, configDest: string): ResolvedSource {
  return {
    ...source,
    ref: source.ref,
    paths: source.paths,
    exclude: source.exclude ?? [],
    include: source.include ?? [],
    destDir: source.dest ?? join(configDest, source.name),
  }
}

export function serializeConfig(config: KiwiConfig): string {
  const dest = config.dest ?? DEFAULT_DEST
  const sources = config.sources
    .map((source) => {
      const lines = [
        '    {',
        `      name: ${JSON.stringify(source.name)},`,
        '      description:',
        `        ${JSON.stringify(source.description)},`,
        `      repo: ${JSON.stringify(source.repo)},`,
      ]
      if (source.ref) {
        lines.push(`      ref: ${JSON.stringify(source.ref)},`)
      }
      if (source.paths) {
        lines.push(`      paths: ${JSON.stringify(source.paths)},`)
      }
      if (source.exclude && source.exclude.length > 0) {
        lines.push(`      exclude: ${JSON.stringify(source.exclude)},`)
      }
      if (source.include && source.include.length > 0) {
        lines.push(`      include: ${JSON.stringify(source.include)},`)
      }
      if (source.dest) {
        lines.push(`      dest: ${JSON.stringify(source.dest)},`)
      }
      lines.push('    }')
      return lines.join('\n')
    })
    .join(',\n')

  return `import { defineConfig } from 'kiwi-fetch'

export default defineConfig({
  dest: ${JSON.stringify(dest)},
  sources: [
${sources}
  ],
})
`
}
