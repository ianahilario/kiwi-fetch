import { loadConfig, resolveSource } from './config.ts'
import { configDest } from './ignore.ts'
import { stampAddedAt } from './lock.ts'
import { readMeta } from './copy.ts'
import { formatAdded, formatPulled, shortSha } from './time.ts'
import { isAbsolute, join } from 'node:path'

function absDest(cwd: string, destDir: string): string {
  return isAbsolute(destDir) ? destDir : join(cwd, destDir)
}

export async function listSources(cwd: string, now = Date.now()): Promise<string[]> {
  const { config } = await loadConfig(cwd)
  const sources = config.sources.map((source) => resolveSource(source, configDest(config)))
  const lock = await stampAddedAt(
    cwd,
    sources.map((source) => ({ name: source.name, destDir: source.destDir }))
  )

  if (sources.length === 0) {
    return ['No sources in kiwi.config.ts']
  }

  const lines: string[] = []
  for (const source of sources) {
    const meta = await readMeta(absDest(cwd, source.destDir))
    const repoRef = `${source.repo}@${source.ref ?? 'HEAD'}`
    const sha = meta?.sha ? shortSha(meta.sha) : '—'
    const addedAt = lock.sources[source.name]?.addedAt
    const trailing = meta?.syncedAt
      ? formatPulled(meta.syncedAt, now)
      : addedAt
        ? formatAdded(addedAt, now)
        : 'added just now'
    lines.push(`${source.name}   ${repoRef}   ${sha}   ${trailing}`)
  }
  return lines
}
