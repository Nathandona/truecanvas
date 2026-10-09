# Shots: technical design

Status: built (2026-10-09). A frame staged for social posts (X, LinkedIn) as a PNG: the frame as the app renders it, on a backdrop, framed, at a social format.

## Principles

- **The frame comes from the app**, like Share: real components, real fonts, animations settled on their final state.
- **The staging belongs to Truecanvas**: backdrop and framing never run inside the app, so its styles can't break them and every project gets the shaders, whether it installs them or not.
- **One compositor for preview and export**, so the PNG is exactly what the dialog shows.
- **Settings, not images, are the document**: a shot can be exported again after the design changes.

## Pieces

```
app (next dev)                    Truecanvas server                         editor / browser
/truecanvas/<page>?frame=…  ──►  ShotService.capture (Playwright, 2x,
                                  cached per frame and crop, 5 min)
                                        │ PNG
                                        ▼
                                  /api/shot/frame?key=…  ──────────────►  ShotStage (React):
                                                                          backdrop (Paper shader in WebGL,
                                                                          CSS gradient, color) + grain (SVG
                                                                          noise) + the frame image (crop,
                                                                          margin, radius, shadow, tilt,
                                                                          browser or phone chrome)
                                  ShotService.export: capture again,      the dialog: live preview
                                  then /shot.html?job=… in the
                                  screenshot browser at the format's
                                  size × scale, waits for __shotReady
                                        │ PNG
                                        ▼
                                  download, clipboard, shots/<file>.png
```

- `src/core/shot-model.ts`: the shared model, with no Node or browser APIs: formats, shaders, `normalizeShot` (any input made complete and safe), `shotLayout` (where the frame sits) and `captureHeight` (how much of the frame to capture).
- `src/core/shots.ts`: storage in `<canvasDir>/<page>.shots.json`, newest first.
- `src/server/shot.ts`: capture (with a cache), export jobs, export and a small preview for agents.
- `src/server/screenshot.ts` `render()`: opens a page that sets `window.__shotReady`, at an exact size and scale. Chromium draws WebGL in software (SwiftShader, `--enable-unsafe-swiftshader`), so exports work without a GPU.
- `editor/src/shot/ShotStage.tsx`: the compositor. `editor/shot.html` + `src/shot/main.tsx`: the export page. `editor/src/components/ShotDialog.tsx`: the dialog.
- API: `GET/POST /api/shots`, `POST /api/shots/delete`, `POST /api/shot/capture`, `GET /api/shot/frame`, `GET /api/shot/job`, `POST /api/shot/export`.
- CLI `truecanvas shot`, MCP `make_shot` and `list_shots`.

## Details that matter

- **Crop**: most posts show the top of a page; tall pages are captured only as far as needed. Off the edge, the capture is made tall enough for the frame to run past the bottom of the format.
- **Scale**: exports are 2x by default (2160×2700 for 4:5). Captures taller than the browser's image limit fall back to 1x.
- **Colors**: palettes from the frame itself (sampled in the browser, saturated colors weighted over large neutral surfaces), from the Tailwind theme (saturated and distinct ones, darkest first), and hand-picked ones.
- **Shaders are still images**: `speed` 0; the seed picks the moment (animated shaders) or the angle (static ones), so Shuffle gives a new variation and the same settings give the same image.

## Video

Built 2026-10-09. A shot with `kind: "video"` and a `motion` (`reveal`, `scroll` or `drift`, a duration, a moving backdrop, a scroll distance) exports as a 30 fps MP4 at the format's size.

- **The page is live**: the compositor loads the app's frame route in an iframe (`ShotService.liveSrc`, the same URL the editor uses) instead of the captured image. Its viewport is what the shot shows; for Scroll, a screen of the page.
- **One timeline**: `shotPoseAt(shot, t)` in the shared model gives the frame box's opacity, offset, scale and lift, the page's scroll and the shader's time. The dialog's preview and the recorder both read it, so the preview moves like the export.
- **Frame-exact recording** (`Screenshotter.record`): Playwright's clock is installed on the context, so timers, `requestAnimationFrame` and `performance.now` stand still in every frame of the page, the app's included; an init script pauses CSS and Web Animations and moves them to the virtual time at each step. For each frame: the compositor's time (`__tcSetTime`, synchronous), the app's scroll and animations, `clock.runFor(1/30 s)`, a screenshot piped to ffmpeg. However slow the machine, the video plays at the right speed.
- **The scroll curve** (`scrollProgress`): smoothstep ramps to and from a steady cruising speed. An ease-in-out over the whole scroll peaks near twice the average speed mid-way, which blurs the page; this one peaks under 1.2 times it, and its acceleration starts and ends at zero. Distance, speed (Slow 320, Medium 520, Fast 800 px/s) and length are linked by `linkScroll`: a new distance or speed sets the length, a new length sets the distance.
- **Scroll without a scrollbar**: the frame keeps `overflow: hidden` and is scrolled from code; the editor's preview sends `tc:scroll` to the app's runtime.
- **Encoding** (`server/video.ts`): the system's ffmpeg with libx264 (or `TRUECANVAS_FFMPEG`) writes H.264 MP4, what X and LinkedIn take; otherwise Playwright's ffmpeg writes WebM. `truecanvas doctor` says which.
- **Speed**: about 4 frames a second on a laptop without a GPU. WebGL is software-rendered there, so in videos the shader draws at a fraction of the pixels; it's a soft blur under grain, and the difference doesn't show.
- **Agents**: `make_shot` with `video` records it and returns a frame of the video to check.

Next: camera moves between several frames, captions, and a fake cursor that clicks through a flow.
