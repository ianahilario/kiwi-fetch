import { DEFAULT_EXCLUDES } from './constants.ts'

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`)
}

export function pathSegments(relPath: string): string[] {
  return relPath.split(/[/\\]/).filter(Boolean)
}

export function matchesExclude(relPath: string, patterns: string[]): boolean {
  const normalized = relPath.replaceAll('\\', '/')
  const base = normalized.split('/').pop() ?? normalized
  const segments = pathSegments(normalized)

  for (const pattern of patterns) {
    const rx = globToRegExp(pattern)
    if (rx.test(normalized) || rx.test(base)) {
      return true
    }
    if (!pattern.includes('*') && !pattern.includes('/') && segments.includes(pattern)) {
      return true
    }
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -3).replace(/\/$/, '')
      if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
        return true
      }
    }
  }
  return false
}

export function isExcluded(relPath: string, extra: string[] = [], include: string[] = []): boolean {
  if (matchesExclude(relPath, extra)) {
    return true
  }
  if (include.length > 0 && matchesExclude(relPath, include)) {
    return false
  }
  return matchesExclude(relPath, DEFAULT_EXCLUDES)
}

export function includeForSource(include: string[] | undefined, paths: string[] | undefined): string[] {
  const fromConfig = include ?? []
  const fromPaths = (paths ?? []).filter((path) => path !== '.' && matchesExclude(path, DEFAULT_EXCLUDES))
  return [...new Set([...fromConfig, ...fromPaths])]
}

export function shouldCopyPath(relPath: string, extraExclude: string[] = [], include: string[] = []): boolean {
  if (!relPath || relPath === '.') {
    return true
  }
  return !isExcluded(relPath, extraExclude, include)
}
