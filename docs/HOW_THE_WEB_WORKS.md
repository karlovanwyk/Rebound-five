# How the web works: from `localhost:5173` to a moving ball

This walks through what actually happens between typing an address and seeing the game,
during development and in production, and tells you exactly where to watch each step in
Chrome DevTools (F12; Edge is the same, Firefox is very similar).

## 1. Typing `localhost:5173`

- **Name resolution.** `localhost` is special: it always means _this machine_
  (`127.0.0.1` for IPv4, `::1` for IPv6). No DNS server is asked.
- **Connection.** The browser opens a TCP connection to port 5173. Listening on that port
  is **Vite's dev server**, a Node.js program started by `npm run dev`. (Ports are just
  numbers that let many servers share one machine; 5173 is Vite's default.)
- **Request.** The browser sends an HTTP request:

  ```
  GET / HTTP/1.1
  Host: localhost:5173
  Accept: text/html,...
  ```

**Watch it:** DevTools → **Network** tab → reload. The first row is `localhost` (type
`document`). Click it: **Headers** shows the request and the `200 OK` response, and
**Response** shows the HTML.

## 2. `index.html` and native ES modules

Vite returns `index.html` with one small addition: a `<script type="module"
src="/@vite/client">` tag (the hot-reload client, step 4). The browser parses the HTML
and finds:

```html
<link rel="stylesheet" href="/src/styles.css" />
<script type="module" src="/src/main.ts"></script>
```

`type="module"` means **native ES modules**: the browser itself understands `import` and
`export`. When it fetches `main.ts` and sees `import { Loop } from './core/Loop'`, it
makes _another_ request for `/src/core/Loop.ts`, and so on down the import graph.
During development, **nothing is bundled**: you'll see one request per source file (the
project has about 60) plus a few for Vite itself and pre-bundled dependencies.

But browsers don't understand TypeScript. Vite **transforms each file on demand**: when
the request for `Loop.ts` arrives, it strips the type annotations (Vite 8 uses the Oxc
transformer, written in Rust, so it takes well under a millisecond per file) and replies
with plain JavaScript (`Content-Type: text/javascript`). It also rewrites bare imports
like `import ... from 'three'`, which a browser can't resolve, into real URLs such as
`/node_modules/.vite/deps/three.js`. Dependencies are **pre-bundled** once into
`node_modules/.vite`, because `three` alone is hundreds of small files and fetching them
one by one would be slow.

Vite doesn't type check while serving. That's what `npm run typecheck` and your editor
are for, which is why the dev server starts in about 200 ms.

**Watch it:**

- Network tab, filter **JS**: the `.ts` files arriving one by one, plus `three.js` from
  `.vite/deps`. Click `main.ts` → **Response**: it's JavaScript, types gone.
- Click any request → **Initiator** tab: which file imported it. That's the import graph.
- **Sources** tab: your original `.ts` files (via source maps), where you can set
  breakpoints.

## 3. Starting the game

`main.ts` runs once everything it imports has loaded. It creates the `WebGLRenderer`,
which asks the browser for a **WebGL context** (a connection to the GPU), builds the
scene, and calls `requestAnimationFrame(frame)`. From then on, the browser calls `frame`
before each screen refresh.

The menus are ordinary HTML elements layered over the `<canvas>`. The 3D view and the
UI are separate layers that the browser's compositor stacks together.

## 4. Hot module replacement over a WebSocket

The `/@vite/client` script opens a **WebSocket** back to the dev server: a long-lived,
two-way connection, unlike HTTP's request/response. Vite watches your files. When you
save:

1. Vite works out which modules are affected and sends a JSON message down the socket,
   e.g. `{"type":"update","updates":[{"type":"css-update","path":"/src/styles.css",...}]}`.
2. For **CSS**, the client fetches the new stylesheet (`?t=<timestamp>` defeats the cache)
   and swaps it in place: no reload, the match keeps running.
3. For **TypeScript**, a module can only be swapped live if it declares how
   (`import.meta.hot.accept`). This game doesn't: a running simulation can't safely swap
   its code mid-tick. So Vite sends `{"type":"full-reload"}` and the page reloads in a
   fraction of a second.

**Watch it:** Network tab → filter **WS** → click the `localhost:5173` socket →
**Messages**. Save `styles.css` and see a `css-update` arrive; save a `.ts` file and see
`full-reload`.

## 5. What `npm run build` produces

```
dist/
  index.html
  favicon.svg
  assets/
    index-<hash>.js          ~690 kB (~180 kB gzipped): your code + three.js, minified
    index-<hash>.css         ~8 kB
    DebugTools-<hash>.js     ~6 kB: only loaded with #debug
    lil-gui.esm-<hash>.js    ~31 kB: only loaded with #debug
    *.js.map                 source maps, so DevTools can still show your .ts files
```

- **Bundling.** Production does the opposite of dev: Vite (using the Rolldown bundler)
  follows the import graph and concatenates modules into a few files, because one big
  request beats eighty small ones over a real network.
- **Tree shaking.** Code that's never imported (most of three.js's loaders and helpers)
  is left out.
- **Minification.** Whitespace, comments and long names are removed.
- **Hashed file names.** `<hash>` is computed from the file's contents. If the content
  changes, the name changes. So a server can tell browsers to cache `assets/*` _forever_
  (`Cache-Control: immutable`): a new deploy simply references new file names, and only
  `index.html` must never be cached for long.
- **Code splitting.** `main.ts` loads the debug tools with a **dynamic import**:
  `import('./ui/DebugTools')`, and inside that, `import('lil-gui')`. A dynamic import
  returns a Promise and tells the bundler "this can be a separate file, loaded later".
  So normal players never download lil-gui.

**Watch it:** `npm run build`, then `npm run preview` and open http://localhost:4173.
In the Network tab you'll see only a handful of files with hashed names. Now add `#debug`
to the URL (changing the hash doesn't reload the page) and watch `DebugTools-….js` and
`lil-gui.esm-….js` appear only then. Tick **Disable cache** to see full sizes; the
**Size** column shows bytes transferred (compressed) versus resource size.

## 6. Why you must click before sound plays or a gamepad appears

- **Autoplay policy.** Browsers block audio until the user has _interacted_ with the page
  (a click, tap or key press: "user activation"). Otherwise every page could blare
  sound on load. An `AudioContext` created before that starts **suspended**. So
  `AudioEngine.unlock()` creates and resumes it inside our first `keydown` or
  `pointerdown` handler, which is why the boot screen says "press any key".
- **Gamepads.** `navigator.getGamepads()` returns nothing until you press a button on the
  controller while the page is focused. If any page could list your connected devices
  silently, that list would help fingerprint and track you. Pressing a button is
  consent, and the `gamepadconnected` event fires. Hence the "press any button" prompt.

**Watch it:** in the Console, before clicking, type `new AudioContext().state`: it
says `"suspended"`. After clicking, our context is `"running"`.

## 7. Main thread versus GPU

Your JavaScript runs on the browser's **main thread**, which also handles input events,
layout and painting of the HTML UI. In one frame of Rebound Five:

| Main thread (CPU)                                                                          | GPU                                                                             |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| input events (keyboard, pointer)                                                           |                                                                                 |
| `Loop.frame`: 0–3 simulation ticks (physics, AI)                                           |                                                                                 |
| `SceneView.sync`: interpolate, pose bodies (Three.js matrices)                             |                                                                                 |
| `WebGLRenderer.render`: walk the scene, sort objects, issue **draw calls** (a few hundred) |                                                                                 |
| HUD text and minimap (Canvas 2D)                                                           | shadow map pass: scene from the light's view                                    |
|                                                                                            | main pass: run vertex and fragment shaders for every triangle and pixel         |
|                                                                                            | crowd: **one** instanced draw call; the bounce is computed in the vertex shader |
|                                                                                            | compositor: stack the WebGL canvas and the HTML UI, show on screen              |

The CPU _describes_ the frame; the GPU _draws_ it, in parallel. Two lessons from this
project:

- **Draw calls cost CPU time.** 1,500 separate crowd meshes would be 1,500 draw calls.
  An `InstancedMesh` makes it one, and the per-spectator bounce runs in the vertex shader,
  so the CPU only updates two numbers (time and excitement) per frame.
- **Pixels cost GPU time.** That's why `devicePixelRatio` is capped at 2, and only one
  light renders a shadow map.

At 60 Hz you have 16.7 ms per frame for all of it. Miss that and a frame is dropped.

## 8. The DevTools Performance tab

1. Start a match. Open **Performance**, click **Record**, play for 5 seconds, stop.
2. **Frames** row: green bars are frames. Hover to see their duration; you want ~16.7 ms
   (60 fps) or less. Red or long bars are dropped frames.
3. **Main** row (flame chart): find **Animation frame fired** → `frame` (Loop.ts). Below
   it you'll see `update` → `step` → `stepWorld`, `AIController.update` and `render` →
   `WebGLRenderer.render`. Width is time. Zoom in with W/S.
4. **GPU** row: the GPU working, often in parallel with the next frame's JavaScript.
5. **Bottom-Up** tab: which functions take the most total time. Expect three.js
   rendering and the AI's prediction and scoring near the top.
6. Tick **Memory** before recording to see the JS heap. A sawtooth means garbage
   collection. The hot paths (physics, snapshots, replay buffer) reuse objects to keep it
   flat.

Also worth a look:

- **Application** tab → **Local Storage** → `http://localhost:5173` → key
  `rebound-five/save/v1`: your records as JSON. Edit or delete them and reload.
- `chrome://gpu`: whether WebGL is hardware accelerated on your machine.
- **Console** in `#debug` mode: `rebound.session().world` is the live simulation state.
  Try `rebound.config.BALL.gravity = 3` for moon football.
