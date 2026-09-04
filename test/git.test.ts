import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { isSshUrl, resolveRepoUrl, toSshUrl } from '../src/git.ts'

describe('repo URL helpers', () => {
  it('resolves owner/repo to GitHub HTTPS', () => {
    expect(resolveRepoUrl('acme/my-app')).toBe('https://github.com/acme/my-app.git')
  })

  it('leaves git URLs and SSH alone', () => {
    expect(resolveRepoUrl('https://github.com/acme/my-app.git')).toBe(
      'https://github.com/acme/my-app.git'
    )
    expect(isSshUrl('git@github.com:acme/my-app.git')).toBe(true)
    expect(resolveRepoUrl('git@github.com:acme/my-app.git')).toBe('git@github.com:acme/my-app.git')
  })

  it('rewrites GitHub/GitLab HTTPS to SSH', () => {
    expect(toSshUrl('https://github.com/acme/my-app.git')).toBe('git@github.com:acme/my-app.git')
    expect(toSshUrl('https://gitlab.com/acme/my-app.git')).toBe('git@gitlab.com:acme/my-app.git')
  })
})

describe('git binary', () => {
  it('is available for clones', () => {
    const result = spawnSync('git', ['--version'], { encoding: 'utf8' })
    expect(result.status).toBe(0)
  })
})
