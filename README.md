# `import-single-ts`

![Static Badge](https://img.shields.io/badge/version-1.1.5-green)
![NPM](https://img.shields.io/npm/l/import-single-ts)
![GitHub issues](https://img.shields.io/github/issues/antitoxic/import-single-ts)
![GitHub Sponsors](https://img.shields.io/github/sponsors/antitoxic)

## Description

Drop-in replacement for the JS-native `import(..)` but **works with TypeScript
files**.

## Use-case

1. You have a running `node.js` process, and you want to import `.ts` file from
   it
2. **BUT** you realize you can't do `import './myfile.ts'`,
   `require('./myfile.ts')` or `await import('./myfile.ts')`.
3. And you **DON'T want** an additional compilation step before the process
   starts

**This is where `import-single-ts` comes in**. It allows you do
`await importSingleTs('./myfile.ts')` with **_no extra steps needed_**.

A common example would be defining things like configuration or setup in a
type-safe (_ts_) environment. Think `vite.config.ts`, `webpack.config.ts`, etc.

## Usage

1. Make sure you've installed the `esbuild` (_it's a peer dependency_)
2. ```ts
   import { importSingleTs } from 'import-single-ts';
   // or for cjs: const { importSingleTs } = require('import-single-ts');
   // ...
   await importSingleTs('./some.ts'); // place where you need it
   ```

   It has the same API as the native dynamic import — `import()`\*.

   \* With some optional extras (_see below_).

## Features & Limitations

- 🔄 **Drop-in replacement for `import()`** — no learning curve, you can just
  replace the dynamic `await import('./some.js')` calls with
  `await importSingleTs('./some.ts')` and it will just work as expected.
- ⚡ **Fast** — uses `esbuild` internally and learns from the best (_`vite`'s &
  esbuild plugins' source code_)
- 📐 **Only compiles the minimum** — The `.ts` file being loaded may have
  multiple imports, which can, in turn, have more imports at any depth. Any
  imported files, which `node` can run by itself, are not compiled. Instead,
  they are loaded from their original path which means they are kept in the
  internal node module cache and there won't be duplicate module executions if
  they are imported again.
- 🚀 **No dependencies** + 1 **peer** dependency of `esbuild`
- 🧩️ **Customizable import resolution** — it exposes
  [options used in](https://esbuild.github.io/api/#path-resolution) `esbuild`,
  so you can provide things like
  [custom conditions](https://nodejs.org/api/packages.html#packages_resolving_user_conditions)
  for
  [conditional exports](https://nodejs.org/api/packages.html#conditional-exports),
  aliases, etc. Simply pass in a second argument like so:
  ```ts
  await importSingleTs('./some.ts', { conditions: ['mycompany-dev'], alias: { a: "b" }, ... })
  ```
- 💻️ **Node.js REPL** is supported as well
- ⛔️ Not intended for [`bun`](https://bun.sh/docs/runtime/typescript) —
  TypeScript is supported out of the box in `bun`, no need to use this package.
- ⛔️ Not intended for `Windows` — it's not tested on `Windows` and I won't be
  able to dedicate extra time to debug problems there.

## Funding ![GitHub Sponsors](https://img.shields.io/github/sponsors/antitoxic)

If this makes your work easier,
[consider becoming a sponsor](https://github.com/sponsors/antitoxic).

## Inspiration

- I wanted to load up the exports from `.ts` file and use it as a type-safe
  config. There didn't seem to be an easy way to do that.
- I looked into
  [`vite`](https://github.com/vitejs/vite/blob/eef4aaa063ed420c213cb9e24f680230cf2132b2/packages/vite/src/node/config.ts)'s
  internal logic that deals with loading up `vite.config.ts` file. Before
  settling on using `esbuild` I wasn't sure if there was a better way to do
  compile on-the-fly. When I saw vite's approach I was relieved that looks like
  the only way, and I've also adapted pieces of their config handling code
- I also researched
  [`esbuild` node-resolve plugin](https://github.com/remorses/esbuild-plugins/tree/master/node-resolve/).
  This was helpful to quickly glance `esbuild` plugin system. Sadly this relies
  on the [`resolve`](https://github.com/browserify/resolve) package which
  [doesn't support `package.json` "exports" at all](https://github.com/browserify/resolve/pull/224).
- I noticed that
  [node `require.extensions` is deprecated](https://nodejs.org/api/modules.html#requireextensions).
  They actually recommend compiling ahead of time which is what this package
  does.

## Prior art

- [`ts-import`](https://github.com/radarsu/ts-import) — it internally uses
  `tsc`, so loading up a file is **_slow_**. Another problem of `tsc` is it can
  run only for a single project, so if you are in a monorepo environment, and
  you depend on typescript files from other projects it won't work as expected.

## Possible improvements

- replace `enhanced-resolve` when
  [web-infra-dev/oxc](https://github.com/web-infra-dev/oxc) ports it to Rust

## Development notes

- It's build as `cjs` but can be used in both `CJS` and `ESM` environments.
  That's because in `mjs` can't use stack trace to figure out the directory
  where `importSingleTs` was called from:
  https://github.com/nodejs/node/issues/46992
