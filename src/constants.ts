export const DEFAULT_DEST = '.kiwi'
export const CONFIG_FILES = ['kiwi.config.ts', 'kiwi.config.js', 'kiwi.config.mjs'] as const
export const LOCK_FILE = 'kiwi.lock.json'
export const META_FILE = '.kiwi-meta.json'
export const AGENTS_START = '<!-- kiwi-fetch:start -->'
export const AGENTS_END = '<!-- kiwi-fetch:end -->'

export const DEFAULT_EXCLUDES = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.env',
  '.env.*',
  '*.pem',
  'id_rsa',
  'package.json',
  'package-lock.json',
]

export const NAME_PATTERN = /^[a-zA-Z0-9._-]+$/
