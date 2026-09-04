#!/usr/bin/env node
import { defineCommand, runMain } from 'citty'
import { createRequire } from 'node:module'
import { runAdd, runInit, runList, runRemove, runSync } from './commands.ts'

const require = createRequire(import.meta.url)
const { version } = require('../package.json') as { version: string }

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
}

const init = defineCommand({
  meta: {
    name: 'init',
    description:
      'Create kiwi.config.ts, kiwi.lock.json, .gitignore, .cursorignore, .claudeignore, CLAUDE.md, and AGENTS.md',
  },
  args: {
    prepare: {
      type: 'boolean',
      description: 'Add a package.json prepare script that runs kiwi-fetch sync',
      default: false,
    },
  },
  async run({ args }) {
    try {
      const lines = await runInit(process.cwd(), args.prepare)
      for (const line of lines) {
        console.log(line)
      }
    } catch (error) {
      fail(error)
    }
  },
})

const add = defineCommand({
  meta: {
    name: 'add',
    description:
      'Optional shortcut: kiwi-fetch add <<repo>> [--name <<name>>] [--description <<text>>] [--ref <<ref>>] [--path <<path>>]. Editing kiwi.config.ts is the normal way.',
  },
  args: {
    repo: {
      type: 'positional',
      required: true,
      description: '<<repo>> owner/repo, git URL, or local path',
    },
    name: {
      type: 'string',
      description: '<<name>> source name in kiwi.config.ts',
    },
    description: {
      type: 'string',
      description: '<<text>> why agents should read this source (required)',
    },
    ref: {
      type: 'string',
      description: '<<ref>> branch, tag, or sha',
    },
    path: {
      type: 'string',
      description: '<<path>> file or folder to include',
    },
  },
  async run({ args }) {
    try {
      const lines = await runAdd(process.cwd(), {
        repo: String(args.repo),
        name: args.name ? String(args.name) : undefined,
        description: args.description ? String(args.description) : undefined,
        ref: args.ref ? String(args.ref) : undefined,
        path: args.path ? String(args.path) : undefined,
      })
      for (const line of lines) {
        console.log(line)
      }
    } catch (error) {
      fail(error)
    }
  },
})

const sync = defineCommand({
  meta: {
    name: 'sync',
    description: 'Fetch or refresh sources. Usage: kiwi-fetch sync [<<name>>]',
  },
  args: {
    name: {
      type: 'positional',
      required: false,
      description: '<<name>> from kiwi.config.ts. Omit to sync every source.',
    },
  },
  async run({ args }) {
    try {
      const name = args.name ? String(args.name) : undefined
      const lines = await runSync(process.cwd(), name)
      for (const line of lines) {
        console.log(line)
      }
    } catch (error) {
      fail(error)
    }
  },
})

const list = defineCommand({
  meta: {
    name: 'list',
    description:
      'Show sources as <<name>>  <<repo>>@<<ref>>  <<sha>>  last pulled <<relative>> (<<local datetime>>) — or added, if never synced',
  },
  async run() {
    try {
      const lines = await runList(process.cwd())
      for (const line of lines) {
        console.log(line)
      }
    } catch (error) {
      fail(error)
    }
  },
})

const remove = defineCommand({
  meta: {
    name: 'remove',
    description:
      'Optional shortcut: kiwi-fetch remove <<name>>. Same as deleting the source in kiwi.config.ts and running sync.',
  },
  args: {
    name: {
      type: 'positional',
      required: true,
      description: '<<name>> from kiwi.config.ts',
    },
  },
  async run({ args }) {
    try {
      const lines = await runRemove(process.cwd(), String(args.name))
      for (const line of lines) {
        console.log(line)
      }
    } catch (error) {
      fail(error)
    }
  },
})

const main = defineCommand({
  meta: {
    name: 'kiwi-fetch',
    version,
    description:
      'Pull other git repos or specific files into this project for agent context. Edit kiwi.config.ts, then kiwi-fetch sync.',
  },
  subCommands: {
    init,
    add,
    sync,
    list,
    remove,
  },
})

await runMain(main)
