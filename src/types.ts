export interface KiwiSource {
  name: string
  description: string
  repo: string
  ref?: string
  paths?: string[]
  exclude?: string[]
  include?: string[]
  dest?: string
}

export interface KiwiConfig {
  dest?: string
  sources: KiwiSource[]
}

export interface ResolvedSource extends KiwiSource {
  ref: string | undefined
  paths: string[] | undefined
  exclude: string[]
  include: string[]
  destDir: string
}

export interface KiwiMeta {
  name: string
  description: string
  repo: string
  ref: string | undefined
  sha: string
  paths: string[] | undefined
  exclude: string[]
  include: string[]
  dest: string
  syncedAt: string
}

export interface LockFile {
  sources: Record<string, { addedAt: string; dest?: string }>
}
