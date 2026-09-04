import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { LOCK_FILE } from './constants.ts'
import type { LockFile } from './types.ts'

export function lockPath(cwd: string): string {
  return join(cwd, LOCK_FILE)
}

export async function readLock(cwd: string): Promise<LockFile> {
  const file = lockPath(cwd)
  if (!existsSync(file)) {
    return { sources: {} }
  }
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as LockFile
    return { sources: raw.sources ?? {} }
  } catch {
    return { sources: {} }
  }
}

export async function writeLock(cwd: string, lock: LockFile): Promise<void> {
  const file = lockPath(cwd)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(lock, null, 2)}\n`, 'utf8')
}

export async function stampAddedAt(
  cwd: string,
  names: { name: string; destDir: string }[],
  now = new Date()
): Promise<LockFile> {
  const lock = await readLock(cwd)
  let changed = false
  const iso = now.toISOString()

  for (const entry of names) {
    const existing = lock.sources[entry.name]
    if (!existing) {
      lock.sources[entry.name] = { addedAt: iso, dest: entry.destDir }
      changed = true
    } else if (existing.dest !== entry.destDir) {
      existing.dest = entry.destDir
      changed = true
    }
  }

  if (changed) {
    await writeLock(cwd, lock)
  }
  return lock
}

export async function pruneLock(cwd: string, keepNames: Set<string>): Promise<LockFile> {
  const lock = await readLock(cwd)
  let changed = false
  for (const name of Object.keys(lock.sources)) {
    if (!keepNames.has(name)) {
      delete lock.sources[name]
      changed = true
    }
  }
  if (changed) {
    await writeLock(cwd, lock)
  }
  return lock
}

export async function removeLockEntry(cwd: string, name: string): Promise<void> {
  const lock = await readLock(cwd)
  if (!(name in lock.sources)) {
    return
  }
  delete lock.sources[name]
  await writeLock(cwd, lock)
}
