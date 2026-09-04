import { spawnSync, type SpawnSyncOptions } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLONE_TIMEOUT_MS = Number(process.env.KIWI_FETCH_CLONE_TIMEOUT_MS ?? 120_000)

export class GitError extends Error {
  readonly authFailed: boolean
  constructor(message: string, authFailed = false) {
    super(message)
    this.name = 'GitError'
    this.authFailed = authFailed
  }
}

function gitEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: 'echo',
    ...extra,
  }
}

export function runGit(
  args: string[],
  options: SpawnSyncOptions & { timeoutMs?: number } = {}
): { stdout: string; stderr: string } {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    env: gitEnv(options.env as NodeJS.ProcessEnv | undefined),
    cwd: options.cwd,
    timeout: options.timeoutMs ?? 30_000,
  })
  if (result.error) {
    const timedOut = 'code' in result.error && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
    throw new GitError(
      timedOut
        ? `git ${args[0]} timed out. Raise KIWI_FETCH_CLONE_TIMEOUT_MS if the repo is large.`
        : result.error.message
    )
  }
  const stdout = result.stdout?.toString() ?? ''
  const stderr = result.stderr?.toString() ?? ''
  if (result.status !== 0) {
    const combined = `${stdout}\n${stderr}`
    throw new GitError(redactSecrets(combined.trim() || `git ${args.join(' ')} failed`), isAuthError(combined))
  }
  return { stdout, stderr }
}

export function redactSecrets(text: string): string {
  return text
    .replace(/x-access-token:[^@\s]+/gi, 'x-access-token:***')
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
    .replace(/ghp_[A-Za-z0-9]+/g, 'ghp_***')
    .replace(/github_pat_[A-Za-z0-9_]+/g, 'github_pat_***')
}

export function isAuthError(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.includes('authentication failed') ||
    lower.includes('could not read username') ||
    lower.includes('permission denied') ||
    lower.includes('repository not found') ||
    lower.includes('invalid username or password') ||
    lower.includes('could not read password') ||
    lower.includes('access denied') ||
    lower.includes('authentication required')
  )
}

export function isSshUrl(url: string): boolean {
  return url.startsWith('git@') || url.startsWith('ssh://')
}

export function isGitUrl(value: string): boolean {
  return (
    isSshUrl(value) ||
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('file://') ||
    value.startsWith('git://')
  )
}

export function resolveRepoUrl(repo: string): string {
  if (isGitUrl(repo) || existsSync(repo)) {
    return repo
  }
  if (/^[^/]+\/[^/]+$/.test(repo)) {
    return `https://github.com/${repo}.git`
  }
  return repo
}

export function toSshUrl(url: string): string | undefined {
  const match = url.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/)
  if (!match) {
    return undefined
  }
  const host = match[1]
  const path = match[2]
  if (host === 'github.com' || host === 'gitlab.com' || host.endsWith('.github.com') || host.includes('gitlab')) {
    return `git@${host}:${path}.git`
  }
  return undefined
}

export function readToken(): string | undefined {
  const fromEnv =
    process.env.KIWI_FETCH_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  if (fromEnv) {
    return fromEnv
  }
  const gh = spawnSync('gh', ['auth', 'token'], {
    encoding: 'utf8',
    env: gitEnv(),
    timeout: 10_000,
  })
  if (gh.status === 0) {
    const token = gh.stdout?.toString().trim()
    return token || undefined
  }
  return undefined
}

function extraHeaderArgs(token: string): string[] {
  return ['-c', `http.extraHeader=Authorization: Bearer ${token}`]
}

export function lsRemoteSha(url: string, ref: string | undefined, token?: string): string {
  const args = [...(token && !isSshUrl(url) ? extraHeaderArgs(token) : []), 'ls-remote', url, ref ?? 'HEAD']
  const { stdout } = runGit(args, { timeoutMs: 30_000 })
  const line = stdout.split('\n').find((row) => row.trim())
  const sha = line?.split(/[\s\t]/)[0]
  if (!sha) {
    throw new GitError(`Could not resolve ref ${ref ?? 'HEAD'} on ${url}`)
  }
  return sha
}

function sparsePatterns(paths: string[]): string[] {
  const patterns = new Set<string>()
  for (const raw of paths) {
    const path = raw.replace(/^\/+/, '').replace(/\/+$/, '')
    patterns.add(`/${path}`)
    patterns.add(`/${path}/**`)
  }
  return [...patterns]
}

function cloneSparse(url: string, ref: string | undefined, paths: string[] | undefined, dest: string, token?: string): void {
  const header = token && !isSshUrl(url) ? extraHeaderArgs(token) : []
  const cloneArgs = [
    ...header,
    'clone',
    '--depth',
    '1',
    '--filter=blob:none',
    '--sparse',
    ...(ref ? ['--branch', ref] : []),
    url,
    dest,
  ]
  runGit(cloneArgs, { timeoutMs: CLONE_TIMEOUT_MS })
  if (paths && paths.length > 0) {
    runGit(['sparse-checkout', 'init', '--no-cone'], { cwd: dest })
    runGit(['sparse-checkout', 'set', '--no-cone', ...sparsePatterns(paths)], { cwd: dest })
  }
}

function cloneFull(url: string, ref: string | undefined, dest: string, token?: string): void {
  const header = token && !isSshUrl(url) ? extraHeaderArgs(token) : []
  const isSha = !!ref && /^[0-9a-f]{7,40}$/i.test(ref)
  if (isSha) {
    runGit(['init', dest])
    runGit([...header, 'remote', 'add', 'origin', url], { cwd: dest })
    runGit([...header, 'fetch', '--depth', '1', 'origin', ref], { cwd: dest, timeoutMs: CLONE_TIMEOUT_MS })
    runGit(['checkout', 'FETCH_HEAD'], { cwd: dest })
    return
  }
  runGit(
    [...header, 'clone', '--depth', '1', ...(ref ? ['--branch', ref] : []), url, dest],
    { timeoutMs: CLONE_TIMEOUT_MS }
  )
}

function cloneOnce(url: string, ref: string | undefined, paths: string[] | undefined, dest: string, token?: string): void {
  const isSha = !!ref && /^[0-9a-f]{7,40}$/i.test(ref)
  if (isSha || !paths?.length) {
    cloneFull(url, ref, dest, token)
    return
  }
  try {
    cloneSparse(url, ref, paths, dest, token)
  } catch (error) {
    rmSync(dest, { recursive: true, force: true })
    if (error instanceof GitError && error.authFailed) {
      throw error
    }
    cloneFull(url, ref, dest, token)
  }
}

export function authHelp(url: string): string {
  return [
    `Authentication failed for ${url}.`,
    ' - gh auth login  (or gh auth setup-git)',
    ' - ssh -T git@github.com  (or the matching host)',
    ' - Set GH_TOKEN / GITHUB_TOKEN / KIWI_FETCH_TOKEN with repo read access',
    ' - Or set repo to the SSH URL you already use, e.g. git@github.com:owner/repo.git',
  ].join('\n')
}

export function resolveShaWithAuth(url: string): { shaFn: (ref: string | undefined) => string; cloneUrl: string; token?: string } {
  if (isSshUrl(url) || url.startsWith('file://') || existsSync(url)) {
    return { shaFn: (ref) => lsRemoteSha(url, ref), cloneUrl: url }
  }

  const token = readToken()
  const attempts: { url: string; token?: string }[] = []
  if (token) {
    attempts.push({ url, token })
  }
  attempts.push({ url })
  const ssh = toSshUrl(url)
  if (ssh) {
    attempts.push({ url: ssh })
  }

  let lastError: GitError | undefined
  for (const attempt of attempts) {
    try {
      const shaFn = (ref: string | undefined) => lsRemoteSha(attempt.url, ref, attempt.token)
      shaFn(undefined)
      return { shaFn, cloneUrl: attempt.url, token: attempt.token }
    } catch (error) {
      lastError = error instanceof GitError ? error : new GitError(String(error))
      if (!lastError.authFailed && attempts.indexOf(attempt) === 0) {
        continue
      }
    }
  }
  if (lastError?.authFailed) {
    throw new GitError(authHelp(url), true)
  }
  throw lastError ?? new GitError(authHelp(url), true)
}

export function cloneRepo(url: string, ref: string | undefined, paths: string[] | undefined): string {
  const dest = mkdtempSync(join(tmpdir(), 'kiwi-fetch-'))
  const resolved = resolveRepoUrl(url)

  if (isSshUrl(resolved) || resolved.startsWith('file://') || existsSync(resolved)) {
    try {
      cloneOnce(resolved, ref, paths, dest)
      return dest
    } catch (error) {
      rmSync(dest, { recursive: true, force: true })
      throw error
    }
  }

  const token = readToken()
  const attempts: { url: string; token?: string }[] = []
  if (token) {
    attempts.push({ url: resolved, token })
  }
  attempts.push({ url: resolved })
  const ssh = toSshUrl(resolved)
  if (ssh) {
    attempts.push({ url: ssh })
  }

  let lastError: GitError | undefined
  for (const attempt of attempts) {
    try {
      cloneOnce(attempt.url, ref, paths, dest, attempt.token)
      return dest
    } catch (error) {
      lastError = error instanceof GitError ? error : new GitError(String(error), isAuthError(String(error)))
      rmSync(dest, { recursive: true, force: true })
      if (!lastError.authFailed) {
        throw lastError
      }
    }
  }
  throw new GitError(authHelp(resolved), true)
}

export function cleanupTemp(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}
