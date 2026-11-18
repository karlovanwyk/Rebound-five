# Rebound Five

**Arcade 5-a-side soccer in the browser.** Four outfield players and a keeper per side,
in an enclosed arena where the ball rebounds off the boards. There are no throw-ins,
corners, offside or fouls, so play never stops. You control one player against a CPU
team that thinks in layers: a team brain, per-player state machines, steering
behaviours and option scoring. It plays by exactly the same rules you do.

Built with TypeScript, [Three.js](https://threejs.org) and [Vite](https://vite.dev), with
no physics engine, no image or audio files and no runtime network calls. Players are built
from capsules and spheres, the pitch is painted on a canvas, and every sound is
synthesised with the Web Audio API.

## Game modes

| Mode             | What it is                                                                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Quick Match**  | Pick a kit, CPU difficulty (Easy, Normal, Hard), match length (2, 3 or 5 real minutes) and a ball. The clock shows 90 minutes squeezed into that time.                             |
| **Cup**          | Three knockout rounds against increasingly difficult CPU teams. Lose once and you're out. Drawn cup matches go to **golden goal**.                                                 |
| **Attract mode** | A CPU vs CPU match plays behind the menus.                                                                                                                                         |
| **Records**      | Wins, draws and losses per difficulty, cups won and your longest win streak, saved in your browser. Winning on each difficulty (and winning the Cup) unlocks extra kits and balls. |

After every goal you get a celebration (camera move, crowd roar and jump, scorer
animation) and an **instant replay** from behind the goal. The full-time screen shows
possession, shots, shots on target, passes completed, tackles and saves.

## Controls

### Keyboard

| Action                                        | Key                |
| --------------------------------------------- | ------------------ |
| Move                                          | WASD / arrows      |
| Sprint                                        | Shift              |
| Short pass (to the teammate you're aiming at) | J                  |
| Lofted through ball                           | I                  |
| Shoot: hold to charge, release to strike      | K                  |
| Tackle (sprint + tackle = slide tackle)       | L                  |
| Switch player                                 | Q                  |
| Pause                                         | P or Esc           |
| Mute                                          | M                  |
| Menus                                         | Arrows, Enter, Esc |

Aim shots by holding a direction: pushing diagonally toward goal picks a corner.

### Gamepad (standard mapping, Xbox names)

| Action                 | Button                      |
| ---------------------- | --------------------------- |
| Move                   | Left stick or d-pad         |
| Sprint                 | RT or RB                    |
| Pass                   | A                           |
| Through ball           | Y                           |
| Shoot (hold to charge) | B                           |
| Tackle / slide         | X                           |
| Switch player          | LB                          |
| Pause                  | Start / Menu                |
| Mute                   | Back / View                 |
| Menus                  | D-pad, A = select, B = back |

Browsers only reveal a controller after you **press a button on it** while the page has
focus. The game shows a reminder.

### Touch

The controls appear the first time you touch the screen during a match: drag anywhere
on the **left** of the screen for a floating joystick, and use the buttons on the
**right** (PASS, THRU, SHOOT (hold), TACKLE, SPRINT (hold), SWITCH). Pause and mute are
the buttons in the top-right corner. Landscape works best.

## Prerequisites

See **[requirements.txt](requirements.txt)** for the full checklist with versions. In
short: Node.js 22.12+ (24 or 26 LTS recommended; `.nvmrc` says 26), npm, Git, a
WebGL2-capable browser and VS Code with the recommended extensions (VS Code offers to
install them when you open the folder).

## Quick start

```bash
npm install      # downloads the exact versions listed in package-lock.json
npm run dev      # starts the Vite dev server
```

Open **http://localhost:5173** (Vite prints the URL). Press any key or tap to start.
Add `#debug` to the URL (http://localhost:5173/#debug) for the tuning panel and AI overlay.

## npm scripts

| Script               | What it does                                                                            |
| -------------------- | --------------------------------------------------------------------------------------- |
| `npm run dev`        | Starts the Vite dev server with hot module replacement on port 5173.                    |
| `npm run build`      | Type checks with `tsc --noEmit`, then `vite build` writes an optimised site to `dist/`. |
| `npm run preview`    | Serves the built `dist/` folder locally (port 4173), to test the production build.      |
| `npm run typecheck`  | Runs the TypeScript compiler in check-only mode (`tsc --noEmit`).                       |
| `npm run lint`       | Runs ESLint over the project; fails on any error or warning.                            |
| `npm run format`     | Formats every file with Prettier.                                                       |
| `npm test`           | Runs all Vitest tests once (including a headless CPU vs CPU match).                     |
| `npm run test:watch` | Runs Vitest in watch mode, re-running tests as you edit.                                |

## Project structure

```
rebound-five/
  .vscode/       recommended extensions, format-on-save, Chrome debug launch config
  public/        static files copied as-is into the build (favicon.svg)
  src/
    main.ts      entry point: wires everything together, owns the screen flow, starts the loop
    config.ts    every tuning number: physics, speeds, AI presets, colours, kits, teams
    styles.css   HUD and menu styling
    core/        loop, app state machine, storage, seeded RNG, cup logic, match session, replay buffer
    sim/         the headless simulation: no DOM, no rendering, deterministic
      ball/      ball physics, collisions (boards, posts, crossbar, nets), ball prediction
      players/   movement, dribbling, possession, passing, shooting, tackling, goalkeeping
      match/     match phases, clock, goal detection, stats, human control switching
      ai/        TeamBrain, player and keeper state machines, steering, interception, scoring
    input/       the Intent type, keyboard, gamepad, touch and the HumanController
    render/      Three.js: stadium, pitch texture, goals, players, ball, crowd, camera, overlays
    audio/       Web Audio synthesis: effects and crowd
    ui/          HUD, minimap, menus, debug tools
  tests/         Vitest tests, including a headless CPU vs CPU match
  docs/          deeper explanations (architecture, AI, physics, the web platform, exercises, tools)
```

## How the game works

### The simulation is separate from the rendering

Everything under `src/sim` is **headless**: plain data and pure logic that runs the same
in the browser and in Node (that's how the tests play whole matches). It never touches
the DOM, the Three.js scene, the clock or `Math.random()`. ESLint enforces this (see
`eslint.config.js`). Randomness comes from a seeded generator, so the same seed and the
same inputs replay the same match exactly.

Each tick the sim's state is copied into a small **Snapshot**. The renderer only reads
snapshots, never the live sim.

### Everyone is driven by Intents

A player can only be controlled through an `Intent` (`src/input/Intent.ts`): a move
vector, sprint, pass, through ball, shoot (held), tackle and switch. `HumanController`
fills one from your keyboard, gamepad or touch; `AIController` fills them from the AI's
decisions. The sim applies identical rules to both: same speeds, same kick physics, and
shot power earned by holding the button. The CPU can't cheat and never sees your inputs.

### The loop

`core/Loop.ts` runs the simulation at a **fixed 60 ticks per second** with an
accumulator, and renders on every `requestAnimationFrame`. Rendering **interpolates**
between the previous and current tick, so motion is smooth on 60, 120 or 144 Hz screens.
The comments in `Loop.ts` explain why both ideas matter.

### States

`core/GameStateMachine.ts`: **Boot → Menu → TeamSelect → Kickoff ⇄ Playing ⇄ GoalScored →
FullTime**, plus **Paused** (P, Esc, or automatically when the tab is hidden via the Page
Visibility API). The match states mirror the sim's own match phases.

More detail, with diagrams: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## How the CPU thinks

1. A **TeamBrain** decides whether the team is attacking, defending or chasing a loose
   ball. It notices changes only after a difficulty-based reaction time. It shifts a
   formation (stored as normalised pitch coordinates) with the ball, and hands out roles:
   presser, markers, cover, support runners, chaser.
2. Each player runs a **finite state machine** (ChaseBall, Dribble, LookForPass, Shoot,
   Support, Mark, Intercept, ReturnToPosition). Keepers run their own (GuardGoal,
   SaveShot, RushOut, Distribute).
3. **Steering behaviours** (seek, arrive, pursuit, interpose, separation) turn targets
   into natural movement, which is then written as an Intent.
4. On the ball, the AI **scores every option on one scale**: each pass (interception risk,
   value of the target spot, space), the shot (distance, angle, keeper, blockers) and
   dribbling. It picks the best, with a little difficulty-based noise.
5. **Interception maths** (a quadratic for constant velocity, plus sampling of a
   physics-accurate ball prediction) answers "who gets there first?".

Full explanation with diagrams and worked examples: **[docs/AI.md](docs/AI.md)**.

## Tuning the game and the AI

- **`src/config.ts`** holds every number: ball physics (`BALL`), player speeds and ball
  control (`PLAYER`), passing and shooting (`KICK`), tackling (`TACKLE`), keepers
  (`KEEPER`), match flow (`MATCH`), the AI difficulty presets (`AI.presets`), colours,
  kits and teams. The dev server reloads instantly when you save.
- **`#debug` mode** (http://localhost:5173/#debug) adds an FPS meter, a **lil-gui** panel
  bound to those config objects, and an **AI overlay** that draws each AI player's
  current state, role, target point and steering direction. The sim reads config every
  tick, so slider changes apply immediately.
- The headless match in `tests/simulateMatch.ts` is handy for checking how a change
  affects CPU vs CPU results.

## Debugging

- **Browser DevTools** (F12): Console for errors, Sources to set breakpoints in the
  original `.ts` files (Vite serves source maps), Network to watch modules load, and
  Performance to profile frames. [docs/HOW_THE_WEB_WORKS.md](docs/HOW_THE_WEB_WORKS.md)
  says exactly what to look for.
- **VS Code**: run `npm run dev`, then press **F5** and pick **"Launch Chrome against
  localhost"** (or the `#debug` variant). Breakpoints set in VS Code's TypeScript files
  are hit in Chrome.
- **Console handle**: in `#debug` mode the DevTools Console has a `rebound` object.
  `rebound.session().world` is the live simulation state, and
  `rebound.config.BALL.gravity = 3` changes physics on the fly.
- **Tests**: `npm run test:watch`, or the Testing panel from the Vitest extension, to run
  and debug individual tests.

## Build and deploy

```bash
npm run build     # type check + production build into dist/
npm run preview   # serve dist/ at http://localhost:4173 to check it
```

`dist/` is a static site: `index.html` plus hashed JS/CSS files. Upload it to any static
host:

- **GitHub Pages**: push `dist/` to a `gh-pages` branch (or use a Pages workflow). The
  build uses relative asset paths (`base: './'` in `vite.config.ts`), so it works from a
  sub-folder like `username.github.io/rebound-five/`.
- **Netlify / Cloudflare Pages**: build command `npm run build`, publish directory `dist`.
  Or drag the `dist` folder onto Netlify's deploy page.

## Troubleshooting

| Problem                                                                         | Fix                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wrong Node version** (`npm install` or `vite` errors about engines or syntax) | Run `node --version`. You need 22.12 or newer. With nvm: `nvm install` then `nvm use` (reads `.nvmrc`). On Windows use nvm-windows or the installer from nodejs.org.                                 |
| **Port 5173 already in use**                                                    | Vite picks the next free port and prints it; use that URL. Or stop the other process, or run `npm run dev -- --port 3000`.                                                                           |
| **"WebGL is not available"**                                                    | Enable hardware acceleration in your browser settings, update graphics drivers, or try another browser. Check https://get.webgl.org. Remote desktops and some VMs have no GPU.                       |
| **No sound**                                                                    | Browsers only allow audio after you interact with the page: press a key or tap on the start screen. Check the mute button (top right, or M), the tab isn't muted, and your system volume.            |
| **Gamepad not detected**                                                        | Press any button on the controller while the game tab is focused (browsers hide controllers until then). Try another USB port or re-pair over Bluetooth. Test at https://hardwaretester.com/gamepad. |
| **Records disappeared**                                                         | They're stored in this browser's localStorage, per site address. A different port, browser or private window has its own (empty) storage.                                                            |

## Further reading

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): modules, data flow, one tick and one frame step by step
- [docs/AI.md](docs/AI.md): the CPU opponent, layer by layer
- [docs/PHYSICS.md](docs/PHYSICS.md): the ball physics maths
- [docs/HOW_THE_WEB_WORKS.md](docs/HOW_THE_WEB_WORKS.md): from `localhost:5173` to pixels
- [docs/EXERCISES.md](docs/EXERCISES.md): challenges to learn by changing things
- [docs/TOOLS.md](docs/TOOLS.md): every dependency and tool, and why it's here
