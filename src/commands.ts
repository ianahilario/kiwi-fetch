import { existsSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { destDirFor, loadConfig, resolveSource, serializeConfig, validateConfig } from './config.ts'
import { configDest, maybeAddPrepareScript, writeAgentsCatalog, writeInitFiles } from './ignore.ts'
import { pruneEmptyParents } from './copy.ts'
import { removeLockEntry, stampAddedAt } from './lock.ts'
import { listSources } from './list.ts'
import { syncSources, type SyncListener, type SyncResult } from './sync.ts'
import type { KiwiSource } from './types.ts'

function absDest(cwd: string, destDir: string): string {
  return isAbsolute(destDir) ? destDir : join(cwd, destDir)
}

export function defaultNameFromRepo(repo: string): string {
  const trimmed = repo.replace(/\/$/, '').replace(/\.git$/, '')
  const part = trimmed.split(/[/:]/).filter(Boolean).pop() ?? 'source'
  return part.replace(/[^a-zA-Z0-9._-]/g, '-')
}

export async function runInit(cwd: string, prepare = false): Promise<string[]> {
  const hadConfig = existsSync(join(cwd, 'kiwi.config.ts'))
  await writeInitFiles(cwd)
  const messages = [
    hadConfig ? 'kept existing kiwi.config.ts' : 'wrote kiwi.config.ts',
    'wrote kiwi.lock.json, .gitignore, .cursorignore, .claudeignore, CLAUDE.md, and AGENTS.md',
    'edit kiwi.config.ts, then run kiwi-fetch sync',
  ]
  if (prepare) {
    const added = await maybeAddPrepareScript(cwd)
    messages.push(added ? 'added prepare script: kiwi-fetch sync' : 'prepare script already present or no package.json')
  }
  return messages
}

export async function runAdd(
  cwd: string,
  opts: { repo: string; name?: string; description?: string; ref?: string; path?: string }
): Promise<string[]> {
  if (!opts.description?.trim()) {
    throw new Error('description is required. Pass --description <<text>> or add the source in kiwi.config.ts.')
  }
  const { path, config } = await loadConfig(cwd)
  const name = opts.name ?? defaultNameFromRepo(opts.repo)
  if (config.sources.some((source) => source.name === name)) {
    throw new Error(`source ${JSON.stringify(name)} already exists in kiwi.config.ts`)
  }
  const source: KiwiSource = {
    name,
    description: opts.description.trim(),
    repo: opts.repo,
  }
  if (opts.ref) {
    source.ref = opts.ref
  }
  if (opts.path) {
    source.paths = opts.path.split(',').map((item) => item.trim()).filter(Boolean)
  }
  config.sources.push(source)
  validateConfig(config)
  await writeFile(path, serializeConfig(config), 'utf8')
  const destDir = destDirFor(source, configDest(config))
  await stampAddedAt(cwd, [{ name, destDir }])
  const results = await syncSources(cwd, name)
  const failed = results.find((result) => result.status === 'failed')
  if (failed) {
    throw new Error(failed.message)
  }
  return [`added ${name} to kiwi.config.ts`, ...results.map((result) => result.message)]
}

export async function runRemove(cwd: string, name: string): Promise<string[]> {
  const { path, config } = await loadConfig(cwd)
  const source = config.sources.find((item) => item.name === name)
  if (!source) {
    throw new Error(`No source named ${JSON.stringify(name)} in kiwi.config.ts`)
  }
  const destRoot = join(cwd, configDest(config))
  const resolved = resolveSource(source, configDest(config))
  config.sources = config.sources.filter((item) => item.name !== name)
  await writeFile(path, serializeConfig(config), 'utf8')
  const dir = absDest(cwd, resolved.destDir)
  await rm(dir, { recursive: true, force: true })
  await pruneEmptyParents(dir, destRoot)
  await removeLockEntry(cwd, name)
  const remaining = config.sources.map((item) => resolveSource(item, configDest(config)))
  await writeAgentsCatalog(cwd, remaining)
  return [`removed ${name} from kiwi.config.ts and ${resolved.destDir}`]
}

export async function runSync(
  cwd: string,
  name?: string,
  onEvent?: SyncListener
): Promise<SyncResult[]> {
  return syncSources(cwd, name, onEvent)
}

export async function runList(cwd: string): Promise<string[]> {
  return listSources(cwd)
}
