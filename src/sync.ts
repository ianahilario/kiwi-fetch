import { existsSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { loadConfig, resolveSource } from './config.ts'
import { META_FILE } from './constants.ts'
import { cleanupTemp, cloneRepo, GitError, lsRemoteSha, readToken, resolveRepoUrl, resolveShaWithAuth } from './git.ts'
import { copySourceFiles, metaMatches, pruneEmptyParents, readMeta, writeMeta } from './copy.ts'
import { configDest, ensureClaudeignore, ensureClaudeSettings, ensureCursorignore, ensureGitignore, writeAgentsCatalog, writeKiwiReadme } from './ignore.ts'
import { pruneLock, readLock, stampAddedAt } from './lock.ts'
import { formatPulled, shortSha } from './time.ts'
import type { KiwiConfig, KiwiMeta, ResolvedSource } from './types.ts'

export interface SyncResult {
  name: string
  status: 'synced' | 'up-to-date' | 'removed'
  sha?: string
  message: string
}

function absDest(cwd: string, destDir: string): string {
  return isAbsolute(destDir) ? destDir : join(cwd, destDir)
}

function resolveRemoteSha(repo: string, ref: string | undefined): { sha: string; cloneSpec: string } {
  const url = resolveRepoUrl(repo)
  if (url.startsWith('file://') || existsSync(url) || url.startsWith('git@') || url.startsWith('ssh://')) {
    return { sha: lsRemoteSha(url, ref), cloneSpec: url }
  }
  try {
    const resolved = resolveShaWithAuth(url)
    return { sha: resolved.shaFn(ref), cloneSpec: resolved.cloneUrl }
  } catch (error) {
    if (error instanceof GitError && error.authFailed) {
      throw error
    }
    const token = readToken()
    return { sha: lsRemoteSha(url, ref, token), cloneSpec: url }
  }
}

async function syncOne(
  cwd: string,
  source: ResolvedSource,
  now: Date
): Promise<SyncResult> {
  const destDir = absDest(cwd, source.destDir)
  const meta = await readMeta(destDir)
  const { sha } = resolveRemoteSha(source.repo, source.ref)

  if (metaMatches(meta, source, sha)) {
    if (meta && meta.description !== source.description) {
      await writeMeta(destDir, { ...meta, description: source.description })
    }
    const when = meta?.syncedAt ? formatPulled(meta.syncedAt, now.getTime()) : 'last pulled just now'
    return {
      name: source.name,
      status: 'up-to-date',
      sha,
      message: `${source.name} already up to date (${when})`,
    }
  }

  const cloneDir = cloneRepo(source.repo, source.ref, source.paths)
  try {
    await copySourceFiles(cloneDir, destDir, source)
    const next: KiwiMeta = {
      name: source.name,
      description: source.description,
      repo: source.repo,
      ref: source.ref,
      sha,
      paths: source.paths,
      exclude: source.exclude,
      include: source.include,
      dest: source.destDir,
      syncedAt: now.toISOString(),
    }
    await writeMeta(destDir, next)
  } finally {
    cleanupTemp(cloneDir)
  }

  return {
    name: source.name,
    status: 'synced',
    sha,
    message: `synced ${source.name} @ ${shortSha(sha)}`,
  }
}

async function collectMetaDirs(root: string): Promise<string[]> {
  const found: string[] = []
  if (!existsSync(root)) {
    return found
  }

  async function walk(dir: string): Promise<void> {
    if (existsSync(join(dir, META_FILE))) {
      found.push(dir)
      return
    }
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name))
      }
    }
  }

  await walk(root)
  return found
}

async function removeOrphans(
  cwd: string,
  config: KiwiConfig,
  sources: { name: string; destDir: string }[]
): Promise<SyncResult[]> {
  const removed: SyncResult[] = []
  const keepNames = new Set(sources.map((source) => source.name))
  const keepDests = new Set(sources.map((source) => resolve(absDest(cwd, source.destDir))))
  const destRoot = join(cwd, configDest(config))
  const lock = await readLock(cwd)

  for (const [name, entry] of Object.entries(lock.sources)) {
    if (keepNames.has(name) || !entry.dest) {
      continue
    }
    const dir = absDest(cwd, entry.dest)
    await rm(dir, { recursive: true, force: true })
    await pruneEmptyParents(dir, destRoot)
    removed.push({
      name,
      status: 'removed',
      message: `removed ${name} (no longer in kiwi.config.ts)`,
    })
  }

  for (const dir of await collectMetaDirs(destRoot)) {
    if (keepDests.has(resolve(dir))) {
      continue
    }
    const name = relative(destRoot, dir).replaceAll('\\', '/') || dir
    await rm(dir, { recursive: true, force: true })
    await pruneEmptyParents(dir, destRoot)
    if (!removed.some((item) => item.name === name)) {
      removed.push({
        name,
        status: 'removed',
        message: `removed ${name} (no longer in kiwi.config.ts)`,
      })
    }
  }

  await pruneLock(cwd, keepNames)
  return removed
}

export async function syncSources(cwd: string, onlyName?: string): Promise<SyncResult[]> {
  const { config } = await loadConfig(cwd)
  const all = config.sources.map((source) => resolveSource(source, configDest(config)))
  const selected = onlyName ? all.filter((source) => source.name === onlyName) : all

  if (onlyName && selected.length === 0) {
    throw new Error(`No source named ${JSON.stringify(onlyName)} in kiwi.config.ts`)
  }

  await stampAddedAt(
    cwd,
    all.map((source) => ({ name: source.name, destDir: source.destDir }))
  )

  const results: SyncResult[] = []
  if (!onlyName) {
    results.push(...(await removeOrphans(cwd, config, all)))
  }
  for (const source of selected) {
    results.push(await syncOne(cwd, source, new Date()))
  }

  const dest = configDest(config)
  await ensureGitignore(cwd, dest)
  await ensureCursorignore(cwd, dest)
  await ensureClaudeignore(cwd, dest)
  await ensureClaudeSettings(cwd, dest)
  await writeAgentsCatalog(cwd, all)
  await writeKiwiReadme(cwd, dest, all)
  return results
}
