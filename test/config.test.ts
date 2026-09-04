import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConfigError, loadConfig, serializeConfig, validateConfig } from '../src/config.ts'
import { defineConfig } from '../src/index.ts'

const temps: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kiwi-config-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('validateConfig', () => {
  it('requires description, name, and repo', () => {
    expect(() => validateConfig({ sources: [{ name: 'app', repo: 'acme/app' }] })).toThrow(ConfigError)
    expect(() =>
      validateConfig({
        sources: [{ name: 'app', description: 'App source', repo: 'acme/app' }],
      })
    ).not.toThrow()
  })

  it('rejects duplicate names', () => {
    expect(() =>
      validateConfig({
        sources: [
          { name: 'app', description: 'one', repo: 'acme/a' },
          { name: 'app', description: 'two', repo: 'acme/b' },
        ],
      })
    ).toThrow(/duplicate/)
  })

  it('rejects unsafe names', () => {
    expect(() =>
      validateConfig({
        sources: [{ name: '../x', description: 'bad', repo: 'acme/a' }],
      })
    ).toThrow(ConfigError)
  })
})

describe('defineConfig', () => {
  it('returns the same object', () => {
    const config = { dest: '.kiwi', sources: [] }
    expect(defineConfig(config)).toBe(config)
  })
})

describe('loadConfig', () => {
  it('loads kiwi.config.ts via jiti', async () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, 'kiwi.config.ts'),
      `import { defineConfig } from 'kiwi-fetch'
export default defineConfig({
  dest: '.kiwi',
  sources: [
    {
      name: 'app',
      description: 'Production app',
      repo: 'acme/my-app',
      paths: ['src'],
    },
  ],
})
`
    )
    const { config } = await loadConfig(dir)
    expect(config.dest).toBe('.kiwi')
    expect(config.sources[0]?.name).toBe('app')
    expect(config.sources[0]?.paths).toEqual(['src'])
  })

  it('loads a default export without defineConfig', async () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, 'kiwi.config.js'),
      `export default { sources: [{ name: 'web', description: 'Web app', repo: 'acme/web' }] }\n`
    )
    const { config } = await loadConfig(dir)
    expect(config.sources[0]?.name).toBe('web')
  })
})

describe('serializeConfig', () => {
  it('round-trips sources', () => {
    const printed = serializeConfig({
      dest: '.kiwi',
      sources: [
        {
          name: 'app-routes',
          description: 'Route table',
          repo: 'acme/my-app',
          ref: 'main',
          paths: ['src/app/routes.ts'],
        },
      ],
    })
    expect(printed).toContain('app-routes')
    expect(printed).toContain('src/app/routes.ts')
    expect(printed).toContain("import { defineConfig } from 'kiwi-fetch'")
  })
})
