import { describe, expect, it } from 'vitest'
import { DEFAULT_EXCLUDES } from '../src/constants.ts'
import { includeForSource, isExcluded, matchesExclude, shouldCopyPath } from '../src/filter.ts'

describe('default excludes', () => {
  it('skips node_modules, build artifacts, git, and secrets', () => {
    expect(isExcluded('node_modules/left-pad/index.js')).toBe(true)
    expect(isExcluded('src/node_modules/x.js')).toBe(true)
    expect(isExcluded('dist/index.js')).toBe(true)
    expect(isExcluded('build/out.js')).toBe(true)
    expect(isExcluded('coverage/lcov.info')).toBe(true)
    expect(isExcluded('.git/config')).toBe(true)
    expect(isExcluded('.env')).toBe(true)
    expect(isExcluded('.env.local')).toBe(true)
    expect(isExcluded('certs/prod.pem')).toBe(true)
    expect(isExcluded('id_rsa')).toBe(true)
    expect(isExcluded('package.json')).toBe(true)
    expect(isExcluded('package-lock.json')).toBe(true)
  })

  it('keeps source files', () => {
    expect(isExcluded('src/index.ts')).toBe(false)
    expect(isExcluded('pnpm-lock.yaml')).toBe(false)
    expect(shouldCopyPath('src/app/routes.ts')).toBe(true)
  })

  it('lets include and explicit paths opt back into default excludes', () => {
    expect(isExcluded('package.json', [], ['package.json'])).toBe(false)
    expect(isExcluded('package.json', ['package.json'], ['package.json'])).toBe(true)
    expect(includeForSource(['package.json'], ['src'])).toEqual(['package.json'])
    expect(includeForSource(undefined, ['src', 'package.json'])).toEqual(['package.json'])
  })

  it('applies extra exclude globs', () => {
    expect(isExcluded('src/secret.ts', ['src/secret.ts'])).toBe(true)
    expect(matchesExclude('docs/internal.md', ['docs/**'])).toBe(true)
    expect(isExcluded('.claude/settings.json', ['.claude'])).toBe(true)
    expect(isExcluded('.claude', ['.claude'])).toBe(true)
    expect(isExcluded('src/index.ts', ['.claude'])).toBe(false)
  })

  it('includes the documented default list', () => {
    expect(DEFAULT_EXCLUDES).toContain('node_modules')
    expect(DEFAULT_EXCLUDES).toContain('.env')
    expect(DEFAULT_EXCLUDES).toContain('package.json')
    expect(DEFAULT_EXCLUDES).toContain('package-lock.json')
  })
})
