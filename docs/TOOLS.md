# Tools and dependencies

Everything this project depends on, what it does and why it's here. Versions are pinned
exactly in `package.json` (no `^`), so everyone gets the same tools; `package-lock.json`
pins their dependencies too. **If you add a package, update this file, the README and
`requirements.txt`.**

## Runtime dependencies (shipped to players)

| Package   | Version | What it does                                                                                                  | Why it's here                                                                                                                                                                                                                                   |
| --------- | ------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `three`   | 0.187.0 | 3D library over WebGL: scene graph, cameras, materials, shaders, plus math classes (`Vector3`, `Quaternion`). | Rendering with `WebGLRenderer`. The sim uses only its math classes (allowed because they don't need WebGL). Addons that ship inside the package (`three/addons/libs/stats.module.js` for the FPS meter) are used too, at no extra install cost. |
| `lil-gui` | 0.21.0  | Tiny library for tweak panels: sliders and checkboxes bound to object properties.                             | The `#debug` tuning panel bound to `config.ts`. Loaded with a dynamic `import()`, so it's a separate chunk only downloaded in debug mode.                                                                                                       |

## Development dependencies (tools only)

| Package                  | Version | What it does                                                                                                                                                                                                                    | Why it's here                                                                                                                                                                |
| ------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vite`                   | 8.3.8   | Dev server and build tool. In dev it serves native ES modules and transforms TypeScript on demand, with hot reload over a WebSocket. For production it bundles, tree-shakes, minifies, hashes and code-splits (using Rolldown). | Fast feedback while developing and an optimised `dist/` for deployment. Config: `vite.config.ts`.                                                                            |
| `typescript`             | 6.0.3   | Type checker (`tsc`).                                                                                                                                                                                                           | Strict types catch whole classes of bugs before you run anything. Only used for checking (`noEmit`): Vite strips the types itself. Config: `tsconfig.json`.                  |
| `@types/three`           | 0.187.0 | Type definitions for three.js.                                                                                                                                                                                                  | Autocomplete and type checking for every three.js call. Matches the `three` version.                                                                                         |
| `vitest`                 | 5.1.1   | Test runner with a Jest-style API (`describe`, `it`, `expect`).                                                                                                                                                                 | Runs the unit tests and the headless CPU vs CPU match in Node. It reuses `vite.config.ts`, so imports resolve exactly as in the game.                                        |
| `eslint`                 | 10.15.0 | Linter: finds bugs and enforces rules by analysing code.                                                                                                                                                                        | Catches mistakes, and enforces the architecture: `src/sim` may not touch the DOM, the clock, `Math.random()` or presentation code. Config: `eslint.config.js` (flat config). |
| `@eslint/js`             | 10.0.1  | ESLint's built-in recommended rules for JavaScript.                                                                                                                                                                             | Baseline rule set.                                                                                                                                                           |
| `typescript-eslint`      | 8.73.0  | Parser and rules that let ESLint understand TypeScript.                                                                                                                                                                         | TypeScript-aware linting (e.g. `consistent-type-imports`, no unused vars).                                                                                                   |
| `globals`                | 17.14.0 | Lists of global variables per environment (browser, Node).                                                                                                                                                                      | Tells ESLint that `window` exists in `src/` and `process` in config files.                                                                                                   |
| `eslint-config-prettier` | 10.1.8  | Turns off ESLint rules that conflict with Prettier.                                                                                                                                                                             | So the linter and formatter never fight over style.                                                                                                                          |
| `prettier`               | 3.10.1  | Opinionated code formatter.                                                                                                                                                                                                     | Consistent formatting with zero debate; runs on save in VS Code. Config: `.prettierrc`.                                                                                      |

## Transitive type package worth knowing

- `@types/stats.js` comes in automatically with `@types/three` and provides the types for
  the Stats FPS meter. It isn't listed in `package.json` because we don't depend on it
  directly.

## Platform and editor tools

| Tool                                                          | What it does                                  | Why it's here                                                                                                                                                                                  |
| ------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node.js** (≥ 22.12; `.nvmrc` → 26)                          | JavaScript runtime outside the browser.       | Runs Vite, TypeScript, ESLint, Prettier and the tests. Vite 8 requires 20.19+/22.12+.                                                                                                          |
| **npm**                                                       | Node's package manager.                       | `npm install` reads `package.json` and `package-lock.json`; `npm run <script>` runs the scripts.                                                                                               |
| **Git**                                                       | Version control.                              | Each milestone is a commit you can check out to see the game at that stage (`git log`, `git checkout <hash>`). `.gitattributes` keeps line endings consistent across Windows, macOS and Linux. |
| **VS Code**                                                   | Editor.                                       | `.vscode/` has recommended extensions, format-on-save and a Chrome debugging launch config.                                                                                                    |
| ESLint extension (`dbaeumer.vscode-eslint`)                   | Shows lint problems inline.                   | Immediate feedback while typing.                                                                                                                                                               |
| Prettier extension (`esbenp.prettier-vscode`)                 | Formats on save.                              | Set as the default formatter in `.vscode/settings.json`.                                                                                                                                       |
| Vitest extension (`vitest.explorer`)                          | Testing panel: run and debug single tests.    | Faster test-driven iteration.                                                                                                                                                                  |
| Markdown Preview Mermaid Support (`bierner.markdown-mermaid`) | Renders Mermaid diagrams in Markdown preview. | The diagrams in `docs/`.                                                                                                                                                                       |
| **Chrome / Edge DevTools**                                    | Inspect, debug and profile the running game.  | See [HOW_THE_WEB_WORKS.md](HOW_THE_WEB_WORKS.md).                                                                                                                                              |

## Browser APIs used directly (no libraries)

`requestAnimationFrame`, `performance.now()`, keyboard events, Pointer Events, the
Gamepad API, the Canvas 2D API (pitch, nets, ball, boards, minimap, debug labels), the
Web Audio API (all sound), `localStorage` (records and settings), the Page Visibility API
(auto-pause) and WebGL (through three.js).

## Things deliberately _not_ used

- **A physics engine**: the ball physics is a few hundred commented lines you can read (see
  [PHYSICS.md](PHYSICS.md)).
- **A UI framework** (React, Vue...): the UI is a few screens of plain DOM (`ui/dom.ts`).
- **Asset files**: models, textures and sounds are all generated in code.
- **Network calls at runtime**: the built game is a fully static site.
