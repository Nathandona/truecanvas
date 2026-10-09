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

## Next: video

The same pieces carry over: the compositor loads the live frame (an iframe of the page, like share links' real site) instead of an image, the camera animates the shot's settings over time, frames are captured one by one with a controlled clock, and ffmpeg (installed with Playwright) encodes the MP4. Backdrops, framing, formats and `.shots.json` stay as they are.
