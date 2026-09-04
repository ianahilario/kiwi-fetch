import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copySourceFiles } from '../src/copy.ts'
import type { ResolvedSource } from '../src/types.ts'

const temps: string[] = []

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function sourceFor(destDir: string): ResolvedSource {
  return {
    name: 'app',
    description: 'Copy test.',
    repo: 'local',
    ref: 'main',
    paths: undefined,
    exclude: [],
    include: [],
    destDir,
  }
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

describe('copySourceFiles', () => {
  it.skipIf(process.platform === 'win32')('skips broken symlinks and still copies the rest', async () => {
    const from = mkdtempSync(join(tmpdir(), 'kiwi-copy-src-'))
    const dest = mkdtempSync(join(tmpdir(), 'kiwi-copy-dest-'))
    temps.push(from, dest)

    mkdirSync(join(from, 'src'), { recursive: true })
    writeFileSync(join(from, 'src', 'index.ts'), 'export const app = true\n')
    symlinkSync('index.ts', join(from, 'src', 'alias.ts'))
    symlinkSync('./does-not-exist', join(from, 'src', 'broken.ts'))
    symlinkSync('../missing-dir', join(from, 'dangling-dir'))

    await copySourceFiles(from, dest, sourceFor(dest))

    expect(existsSync(join(dest, 'src', 'index.ts'))).toBe(true)
    expect(isSymlink(join(dest, 'src', 'alias.ts'))).toBe(true)
    expect(readlinkSync(join(dest, 'src', 'alias.ts'))).toBe('index.ts')
    expect(isSymlink(join(dest, 'src', 'broken.ts'))).toBe(false)
    expect(existsSync(join(dest, 'src', 'broken.ts'))).toBe(false)
    expect(isSymlink(join(dest, 'dangling-dir'))).toBe(false)
  })
})
