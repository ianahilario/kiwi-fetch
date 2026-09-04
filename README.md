<p align="center">
  <img src="assets/kiwi.png" alt="A cute cartoon illustration of a black and tan long-haired dog happily playing with a colorful rope ball" width="160" />
</p>

# kiwi-fetch

<a href="https://www.npmjs.com/package/kiwi-fetch">
  <img alt="npm downloads" src="https://img.shields.io/npm/d18m/kiwi-fetch.svg">
</a>
<a href="https://www.npmjs.com/package/kiwi-fetch">
  <img alt="npm downloads weekly" src="https://img.shields.io/npm/dw/kiwi-fetch.svg">
</a>

Pull another git repo — or just some of its folders and files — into this project so coding agents can read it as context.

Typical case: an automation test repo that needs the app repo beside it. Edit `kiwi.config.ts`, then run `kiwi-fetch sync`.

```bash
npm i -D kiwi-fetch
npx kiwi-fetch init
# edit kiwi.config.ts
npx kiwi-fetch sync
```

## Config

`kiwi.config.ts` is the source of truth. Change a description, add a folder, drop a source — save, then `sync`. `sync` makes disk match the file.

```ts
import { defineConfig } from 'kiwi-fetch'

export default defineConfig({
  dest: '.kiwi',
  sources: [
    {
      name: 'app',
      description:
        'Production app source under test. Read when writing or debugging e2e tests that depend on UI, routes, or API behavior.',
      repo: 'acme/my-app',
      ref: 'main',
      // omit paths: whole repo minus default excludes (no package.json, node_modules, .env, …)
    },
    {
      name: 'app-with-manifest',
      description:
        'Same whole-repo copy as `app`, plus package.json so tests can read dependency versions.',
      repo: 'acme/my-app',
      ref: 'main',
      include: ['package.json'],
    },
    {
      name: 'app-src',
      description:
        'App src/ tree only. Prefer this over `app` when you only need application code, not the rest of the repo.',
      repo: 'acme/my-app',
      ref: 'main',
      paths: ['src'],
    },
    {
      name: 'app-routes',
      description:
        'App route table (src/app/routes.ts). Read when a test needs the list of URLs or route names.',
      repo: 'acme/my-app',
      ref: 'main',
      paths: ['src/app/routes.ts'],
    },
    {
      name: 'acme/app',
      description:
        'Same whole-repo copy as `app`, nested under .kiwi/acme/app. Skip the upstream .claude folder.',
      repo: 'acme/my-app',
      ref: 'main',
      exclude: ['.claude'],
    },
  ],
})
```

Those land at `.kiwi/app/` (whole repo without default-excluded files), `.kiwi/app-with-manifest/` (whole repo plus `package.json` via `include`), `.kiwi/app-src/src/...`, `.kiwi/app-routes/src/app/routes.ts`, and `.kiwi/acme/app/` (`name: 'acme/app'`, `.claude` skipped). Names cannot overlap (`app` and `app/src` together is an error). Omit `paths` to copy the whole repo minus [default excludes](#default-excludes). Add extra skip patterns per source with `exclude`.

## Default excludes

These are always skipped, including when you omit `paths` and fetch a whole repo:

- `node_modules`
- `dist`
- `build`
- `coverage`
- `.git`
- `.env`
- `.env.*`
- `*.pem`
- `id_rsa`
- `package.json`
- `package-lock.json`

Per-source `exclude` is added on top of this list. Other lockfiles such as `pnpm-lock.yaml` are still copied unless you exclude them.

**Without `include`** — whole repo, default excludes apply (`package.json` is skipped):

```ts
{
  name: 'app',
  description: 'Production app source under test.',
  repo: 'acme/my-app',
  ref: 'main',
}
```

**With `include`** — same whole-repo fetch, but bring default-excluded files back:

```ts
{
  name: 'app-with-manifest',
  description: 'App source plus package.json for dependency versions.',
  repo: 'acme/my-app',
  ref: 'main',
  include: ['package.json'],
}
```

**With `exclude`** — extra skip patterns on top of the defaults (here, the upstream `.claude` folder):

```ts
{
  name: 'acme/app',
  description: 'App source without the upstream .claude folder.',
  repo: 'acme/my-app',
  ref: 'main',
  exclude: ['.claude'],
}
```

Listing a default-excluded file in `paths` also copies it: `paths: ['src', 'package.json']`. `exclude` always wins over `include`.

`description` is required. On sync it is written into `AGENTS.md`, `CLAUDE.md`, and `.kiwi/README.md` so agents can skip a copy that is irrelevant to the task. `<<name>>` in that catalog is the source `name` from config, for example `<<app>>` if you set `name: 'app'`.

## Commands

Placeholders use `<<angle>>` so they are not literal args. `<<name>>` is the source `name` in `kiwi.config.ts`.

| Command | What it does |
| --- | --- |
| `kiwi-fetch init` | Write `kiwi.config.ts` (commented folder and file examples), `kiwi.lock.json`, `.gitignore`, `.cursorignore`, `.claudeignore`, `CLAUDE.md`, `AGENTS.md` |
| `kiwi-fetch sync` | Fetch or refresh every source |
| `kiwi-fetch sync <<name>>` | Fetch or refresh one source |
| `kiwi-fetch list` | Show name, repo, sha, and last pulled / added time |
| `kiwi-fetch add <<repo>>` | Optional shortcut that edits the config, then syncs |
| `kiwi-fetch remove <<name>>` | Optional shortcut; same as deleting the source in config and running sync |

First fetch and later refresh are both `sync`. If the remote sha (and paths / ref / exclude) did not change, that source is skipped.

`kiwi-fetch list` looks like:

```
app   acme/my-app@main   abc1234   last pulled 2 hours ago (2026-09-04 08:43)
app   acme/my-app@main   —         added 2 hours ago (2026-09-04 08:43)
```

The added date is stored in committed `kiwi.lock.json` (not a sha lock). Last pulled time is in `.kiwi/<<name>>/.kiwi-meta.json`, which is gitignored with the rest of `.kiwi/`.

## Private repos

kiwi-fetch never stores tokens in config. It uses the same credentials you already use for `git clone`.

```ts
{
  name: 'app',
  description: 'Private app source for these tests.',
  repo: 'acme/private-app',
  // or: 'git@github.com:acme/private-app.git'
}
```

On sync it tries, in order:

1. SSH URL as-is, if you configured one
2. Token from `KIWI_FETCH_TOKEN`, then `GH_TOKEN` / `GITHUB_TOKEN`, then `gh auth token`
3. Git credential helper (`gh auth setup-git`, macOS keychain, …)
4. HTTPS rewritten to SSH, if HTTPS auth fails

Missing login fails fast (`GIT_TERMINAL_PROMPT=0`) with hints: `gh auth login`, `ssh -T git@github.com`, or set a token with repo read access.

Public repos clone anonymously over HTTPS.

## Agents and gitignore

`.kiwi/` is gitignored so fetched context does not pollute the test repo. Init/sync also write:

- `.cursorignore` with `!.kiwi/` so Cursor can index it
- `.claudeignore` with the same un-ignore (Claude Code's ignore-file equivalent)
- `.claude/settings.json` `permissions.allow` for `Read(.kiwi/**)` so Claude Code may read the gitignored copy
- `AGENTS.md` and `CLAUDE.md` catalogs of each source plus its description. `<<name>>` is the config `name`, not a literal:

```markdown
- **<<app>>** (`.kiwi/app`): Production app source under test. ...
- **<<app-src>>** (`.kiwi/app-src`): App src/ tree only. ...
- **<<acme/app>>** (`.kiwi/acme/app`): Same whole-repo copy as `app`, nested under folders. Skip the upstream .claude folder. ...
```

Do not edit files inside `.kiwi/` — the next sync wipes that folder and copies again.
