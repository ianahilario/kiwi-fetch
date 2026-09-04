import { cp, mkdir, readdir, readFile, rmdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { META_FILE } from './constants.ts'
import { includeForSource, shouldCopyPath } from './filter.ts'
import type { KiwiMeta, ResolvedSource } from './types.ts'

export async function readMeta(destDir: string): Promise<KiwiMeta | undefined> {
  try {
    const raw = await readFile(join(destDir, META_FILE), 'utf8')
    return JSON.parse(raw) as KiwiMeta
  } catch {
    return undefined
  }
}

export async function writeMeta(destDir: string, meta: KiwiMeta): Promise<void> {
  await mkdir(destDir, { recursive: true })
  await writeFile(join(destDir, META_FILE), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
}

export async function pruneEmptyParents(dir: string, stopAt: string): Promise<void> {
  const root = resolve(stopAt)
  let current = dirname(resolve(dir))
  while (current.startsWith(root + sep)) {
    try {
      const entries = await readdir(current)
      if (entries.length > 0) {
        break
      }
      await rmdir(current)
    } catch {
      break
    }
    current = dirname(current)
  }
}

async function copyFiltered(
  from: string,
  to: string,
  extraExclude: string[],
  include: string[],
  root: string
): Promise<void> {
  const rel = relative(root, from).replaceAll('\\', '/')
  if (rel && !shouldCopyPath(rel, extraExclude, include)) {
    return
  }
  const info = await stat(from)
  if (info.isDirectory()) {
    await mkdir(to, { recursive: true })
    const entries = await readdir(from)
    for (const entry of entries) {
      await copyFiltered(join(from, entry), join(to, entry), extraExclude, include, root)
    }
    return
  }
  await mkdir(dirname(to), { recursive: true })
  await cp(from, to)
}

export async function copySourceFiles(
  cloneDir: string,
  destDir: string,
  source: ResolvedSource
): Promise<void> {
  await rm(destDir, { recursive: true, force: true })
  await mkdir(destDir, { recursive: true })

  const include = includeForSource(source.include, source.paths)
  const paths = source.paths && source.paths.length > 0 ? source.paths : ['.']
  for (const path of paths) {
    const from = path === '.' ? cloneDir : join(cloneDir, path)
    const to = path === '.' ? destDir : join(destDir, path)
    try {
      await stat(from)
    } catch {
      throw new Error(`Path ${JSON.stringify(path)} not found in ${source.repo}`)
    }
    await copyFiltered(from, to, source.exclude, include, cloneDir)
  }
}

export function metaMatches(
  meta: KiwiMeta | undefined,
  source: ResolvedSource,
  sha: string
): boolean {
  if (!meta) {
    return false
  }
  const paths = source.paths ?? null
  const metaPaths = meta.paths ?? null
  return (
    meta.sha === sha &&
    meta.ref === source.ref &&
    JSON.stringify(paths) === JSON.stringify(metaPaths) &&
    JSON.stringify(meta.exclude ?? []) === JSON.stringify(source.exclude) &&
    JSON.stringify(meta.include ?? []) === JSON.stringify(source.include) &&
    resolve(meta.dest) === resolve(source.destDir)
  )
}
