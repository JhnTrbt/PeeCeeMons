# Claude Code Build Prompt — "Peeceemons"

Paste everything below into Claude Code as your build brief. Build it incrementally in the order given, running the app after each phase so I can see progress.

The app is built in two tracks:
- **Track A — the app** (§1–§7, §9–§10): the roaming pet + clamshell widget. This runs immediately on procedural placeholder sprites.
- **Track B — the sprite pipeline** (§8): a controlled ComfyUI-based pipeline that generates the 20 final sprite sheets. Optional and parallel — the app never blocks on it.

---

## 0. What we're building

**Peeceemons** is a Game Boy Color–style desktop companion app for Windows.

Two parts:
1. **A roaming pet** — a small retro pixel creature that walks along the bottom of the screen (over the taskbar), idles, and plays a type-based "move" animation.
2. **A clamshell control widget** — a Game-Boy-shaped device that flips open to show a boot screen, a creature-select carousel, and physical buttons to pick your critter, trigger moves, and start/stop the pet.

It must be easy to package and send to friends.

**Hard constraint — original creatures only.** All 20 creatures in this app are ORIGINAL designs defined in this document. Do NOT reproduce, imitate, or name-match any existing commercial creatures (Pokémon or otherwise), and do NOT use "in the style of Pokémon" in any generation prompt. Use only the names, types, and design notes in the roster below. "Game Boy Color palette" refers to the hardware's colour aesthetic, which is fine.

---

## 1. Tech stack (and why)

- **Shell: Tauri v2** (Rust wrapper + web frontend).
  - Chosen over Electron because the packaged app is a few MB instead of ~100 MB — small enough to actually send over Discord/email, which is a core requirement.
  - The frontend is plain HTML/CSS/JS + Canvas — that's where all creature and animation logic lives. You (Claude Code) handle the thin Rust shell; keep Rust to the minimum needed for windows, global shortcuts, autostart, and config file I/O.
- **Rendering:** HTML5 Canvas, `image-rendering: pixelated`, `requestAnimationFrame` loop.
- **Config:** a single `peeceemons.config.json` in the app data dir, read/written via Tauri's fs API.
- **Sprite pipeline (Track B): Python** — a batch driver against the ComfyUI HTTP API plus a deterministic post-processing step (PIL/Pillow). Lives in `sprite-pipeline/`, separate from the app.
- **Packaging:** `tauri build` producing (a) an NSIS installer `.exe` and (b) a portable build.

Prerequisites to install/verify first: Rust (stable), Node.js LTS, Microsoft Visual C++ Build Tools, WebView2 (preinstalled on Win10/11). For Track B: Python 3.11+, Pillow, requests. If any are missing, tell me the exact install command before continuing.

> Fallback: if transparent + click-through overlay windows misbehave on this machine's WebView2, switch the shell to Electron with the same frontend. Flag it before switching; don't switch silently.

---

## 2. Architecture

Three logical pieces:

- **Overlay window** (`overlay.html`) — transparent, frameless, always-on-top, `skipTaskbar`, spans full screen width along the bottom. Click-through everywhere except the creature sprite (use Tauri `set_ignore_cursor_events`, toggled by hit-testing the sprite bounds). Hosts the roaming pet + move animations.
- **Widget window** (`widget.html`) — the Game Boy clamshell. Frameless, draggable, small fixed size, remembers its last position. Not always-on-top by default (user can toggle).
- **Config + shortcuts layer** (Rust) — owns global hotkeys, autostart, single-instance lock, and reading/writing config.

Data flow:
```
Widget UI (select creature / move) -> config.json -> Overlay reads config -> renders pet + move
Global hotkeys -> toggle widget / toggle roaming / trigger move / quit
```
Windows communicate via Tauri events (emit/listen), not by polling files.

---

## 3. Visual style

- **Palette:** Game Boy Color feel — full colour but a limited, punchy retro palette. Each creature uses a 4-colour ramp (base, shade, highlight, outline). Backgrounds/UI use a soft GBC-green-tinted chrome for the device body and a bright "screen" green-white for the LCD area.
- **Pixel spec for creatures:** authored on a small grid (start with ~16×16 logical pixels for placeholders; final sheets at 32×32 — see §8). Two walk frames minimum; one "move" animation (2–4 frames) per type.
- **UI text:** a bundled pixel/monospace bitmap-style font (ship the font file with the app; do not rely on a CDN). Sentence case.
- **No smoothing anywhere** — everything crisp-pixel.

---

## 4. The clamshell widget (`widget.html`)

A drawn Game Boy that flips open. Screen states:

1. **BOOT** — logo animation: the word "PEECEEMONS" slides/drops in with a short chime and a scanline sweep (original homage, ~1.5s), then auto-advances to SELECT.
2. **SELECT** — a rotating carousel of creature **silhouettes** (all black). The centered/highlighted creature colourises into its full sprite. Show its name, type, and tier below the LCD. Left/right cycles creatures; up/down cycles tier filter (Starter / Wild / Legendary / All).
3. **ACTIVE** — shows the currently chosen creature idling on the LCD, its move name, and status (roaming: on/off).

Rendered physical controls (clickable AND keyboard-mapped):

| Control | Click target | Keyboard | Action |
|---|---|---|---|
| D-pad left/right | left/right pad | Arrow Left / Right | cycle creature |
| D-pad up/down | up/down pad | Arrow Up / Down | cycle tier filter |
| A | A button | Enter | confirm selection -> sets active creature |
| B | B button | Backspace / Esc | back / cancel |
| START | start button | S | start/stop the roaming pet |
| SELECT | select button | Tab | trigger the active creature's move once |

- Clicking the closed clamshell flips it open (animated); a close/minimize control flips it shut (widget hides to a global hotkey, doesn't quit the app).
- The whole widget must be operable by keyboard alone.
- Add a small settings affordance (gear on the LCD chrome) opening a simple options panel: move-timer seconds, move hotkey, sound on/off, launch-on-startup, reduced-motion.

---

## 5. The roaming pet (`overlay.html`)

Behavior:
- Walks left/right along the bottom edge; turns at screen edges; occasional idle pauses; blink; and occasionally glance toward the cursor.
- Facing flips the sprite horizontally.
- Clicking the sprite makes it do a small hop (fun feedback; requires the click-through hit-test to expose the sprite).

Move animations:
- Each creature has exactly one signature move, determined by its **type** (see §6). One move/animation per type.
- A move fires when EITHER:
  - the **auto-timer** elapses (configurable `moveTimerSeconds`, randomized ±30% so it's not robotic), OR
  - the user presses the **move hotkey** (global shortcut, default `Ctrl+Alt+M`) or SELECT / `Tab` on the widget.
- A move has a short cooldown so it can't spam.

---

## 6. Type + move system

Ten types, each with ONE signature move and animation. Implement moves as reusable, data-driven modules (particle emitter + sprite-frame swap + optional screen-shake), so a creature just references its type's move.

| Type | Signature move | Animation / effect |
|---|---|---|
| Fire | Ember Burst | rising ember particles + brief body flash |
| Water | Bubble Stream | bubbles arc outward and pop |
| Grass | Leaf Spin | leaves spiral out and drift down |
| Electric | Static Jolt | lightning flash + radial sparks |
| Ice | Frost Puff | snowflakes + a shiver squash-stretch |
| Rock | Boulder Roll | dust cloud + horizontal shake |
| Psychic | Mind Wave | expanding ripple rings + soft glow |
| Shadow | Shade Step | fade out -> smoke puff -> fade in offset |
| Dragon | Sky Roar | wind lines + screen-shake (legendary flavour) |
| Normal | Quick Dash | fast dash + dust puff, returns to spot |

Moves must be **configurable and modular** — new types/moves added by dropping a new module and a table entry, no engine rewrite.

---

## 7. Creature roster (20 original creatures)

Three tiers. Each creature: name, tier, type (-> its move from §6), and a design note for the sprite. Palettes are 4-colour ramps; pick GBC-punchy colours per the note. Store the roster as data (`data/creatures.json`) so it's editable without touching engine code. Each entry also carries a `palette` (4 hex colours) and a `seed` (int) used by the sprite pipeline in §8.

**Starters (9)** — one per core type:

| # | Name | Type | Design note |
|---|---|---|---|
| 1 | Flarepup | Fire | small orange fox-pup, flame tuft on head |
| 2 | Dripling | Water | round blue tadpole-blob with a fin crest |
| 3 | Sproutle | Grass | green seed-sprite with a leaf sprouting up |
| 4 | Voltnip | Electric | yellow rodent-critter with a bolt-shaped tail |
| 5 | Frostkit | Ice | pale-cyan kitten with icicle whiskers |
| 6 | Pebblump | Rock | grey boulder-golem with stubby arms |
| 7 | Mystmind | Psychic | violet floating orb with a single calm eye |
| 8 | Shadeling | Shadow | dark-indigo wisp with glowing dot eyes |
| 9 | Nibblet | Normal | beige round mouse-bun, big ears |

**Wild (7):**

| # | Name | Type | Design note |
|---|---|---|---|
| 10 | Cindermoth | Fire | orange-red moth, ember-speckled wings |
| 11 | Puddleye | Water | blue slime with a droplet eye |
| 12 | Bramblebun | Grass | green rabbit with thorny-vine ears |
| 13 | Sparrowatt | Electric | yellow sparrow with crackling wingtips |
| 14 | Snowtuft | Ice | white fluff-ball with a frosty crown |
| 15 | Cragbeetle | Rock | grey armored beetle, stone shell |
| 16 | Dozeghost | Shadow | sleepy purple ghost, half-closed eyes |

**Legendary (4)** — rarer, larger silhouettes, dual-flavour:

| # | Name | Type (move) | Design note |
|---|---|---|---|
| 17 | Pyrothrone | Dragon (Sky Roar) | crowned fire-drake, ember mane |
| 18 | Tidalwyrm | Dragon (Sky Roar) | serpentine water-dragon, wave crest |
| 19 | Aurorex | Psychic (Mind Wave) | aurora-lit ice stag, glowing antlers |
| 20 | Umbraking | Dragon (Sky Roar) | shadow-dragon, void-black with violet edges |

---

## 8. Sprites and the sprite-generation pipeline (Track B)

### 8.1 Runtime sprite loading (build this first)
- **Ship procedural placeholder sprites** so the app runs and is fully testable immediately: generate each creature from its `palette` + a simple body silhouette in JS.
- **Drop-in system for final art:** load real sprites from `/assets/sprites/<name>/idle.png`, `walk.png`, `move.png`. If a file exists, use it; else fall back to the procedural placeholder.
- **Sheet spec (write this into `SPRITES.md`):** frame size 32×32 px, transparent PNG, horizontal strips. `idle.png` = 2 frames (idle, blink). `walk.png` = 2 frames. `move.png` = up to 4 frames. Origin bottom-center. Exactly the creature's 4 palette colours + transparency, hard edges, no anti-aliasing.

### 8.2 The generation pipeline (`sprite-pipeline/`, Python, optional Phase B)
A controlled, repeatable pipeline — NOT prompt-and-hope. It produces all 20 sheets to the spec above and is re-runnable per creature. Three stages:

**Stage 1 — base design (ComfyUI API, batched).**
- A templated ComfyUI workflow saved as `sprite-pipeline/workflow.template.json` with placeholder slots for `{positive}`, `{negative}`, `{seed}`.
- A driver `generate.py` reads `data/creatures.json`, and for each creature POSTs to the ComfyUI `/prompt` endpoint, polls `/history/<id>`, and downloads the image. Fixed sampler/steps/CFG; per-creature `seed` from the roster so runs are reproducible.
- Prompt template (fill from each creature's name + design note):
  - positive: `16-bit RPG monster sprite, single {design note}, front view, chunky pixel art, bold black outline, flat cel shading, Game Boy Color palette, centered, solid magenta background`
  - negative: `text, watermark, signature, multiple creatures, realistic, 3d, blurry, gradient, drop shadow, extra limbs`
- Model/checkpoint and any pixel-art LoRA are set in `sprite-pipeline/pipeline.config.json` — leave placeholders for me to fill with my local model names; do not hardcode. Use one shared style prefix + one LoRA across all 20 so the set looks cohesive.
- Requires my ComfyUI running locally with the API enabled. RTX 4070 SUPER handles this comfortably; batch all 20 sequentially.

**Stage 2 — post-process (deterministic, Pillow).**
For each generated base image, in order:
1. remove background by magenta chroma-key (`#FF00FF`) -> transparent (fallback: `rembg` if chroma fails).
2. autocrop to content, then center on a square canvas.
3. downscale with nearest-neighbor to 32×32.
4. quantize to that creature's exact 4-colour `palette` (map each pixel to nearest ramp colour) + transparency.
5. save as `idle.png` frame 0.

**Stage 3 — frame derivation (deterministic, procedural).**
Diffusion won't give frame-consistent animation, so DERIVE frames from the one clean sprite:
- `idle.png` frame 1 (blink): copy frame 0, darken the eye row 1px.
- `walk.png` (2 frames): from idle, offset the lower ~third of the sprite by 1px (alternate feet) and bob the whole sprite ±1px.
- `move.png` (type-driven starter frames): Fire -> brightness-flash frame; Ice -> horizontal squash; Electric -> 1px jitter + white outline flash; etc. Keep a small per-type table.
- These are a solid automated starting point; note in `SPRITES.md` that any sheet can be hand-refined and will still drop in.

**Outputs & control.**
- Writes `/assets/sprites/<name>/{idle,walk,move}.png` matching §8.1.
- Also writes `sprite-pipeline/_preview/contact-sheet.png` (all 20, silhouettes + colour) for one-glance review.
- `pipeline.config.json` holds model/LoRA names, sampler settings, and per-creature seed overrides, so regeneration is deterministic and tweakable one creature at a time.
- `generate.py` supports `--only Flarepup` to rebuild a single creature without touching the rest.

---

## 9. Config schema (`peeceemons.config.json`)

```json
{
  "activeCreature": "Flarepup",
  "roaming": true,
  "moveTimerSeconds": 25,
  "moveHotkey": "Ctrl+Alt+M",
  "widgetHotkey": "Ctrl+Alt+P",
  "roamToggleHotkey": "Ctrl+Alt+O",
  "quitHotkey": "Ctrl+Alt+Q",
  "soundOn": false,
  "reducedMotion": false,
  "launchOnStartup": false,
  "widgetPosition": { "x": 40, "y": 40 },
  "unlocked": ["Flarepup", "Dripling", "Sproutle", "Voltnip", "Frostkit", "Pebblump", "Mystmind", "Shadeling", "Nibblet"]
}
```
Write on change; read on launch; validate and fall back to defaults if malformed.

---

## 10. Global shortcuts & startup

- Register global hotkeys (all configurable): open/toggle widget, start/stop roaming, trigger move, quit.
- Create a **Start Menu + Desktop shortcut** during install (that's the "startup shortcut" for launching the app).
- **Launch-on-startup** toggle via `tauri-plugin-autostart`, off by default.
- **Single-instance** lock so double-launch focuses the existing widget instead of opening a second app.
- **Quit** fully closes both windows and unregisters hotkeys.

---

## 11. Suggested add-on features (build in this priority order)

1. **Idle personality** — blink, occasional sleep, glance at cursor. (cheap, high charm)
2. **Sound blips** — retro select/confirm/move sounds, off by default, toggle in settings. Bundle the audio files locally.
3. **Reduced-motion mode** — disables screen-shake and heavy particles; respect it for accessibility.
4. **Unlock/progression** — start with the 9 starters; wilds and legendaries "appear" over time or via a simple in-widget action, tracked in `unlocked`. Gives friends a reason to keep it running.
5. **Remember state** — last creature, widget position, roaming on/off persist across launches.
6. **Party mode (stretch)** — allow 2–3 creatures roaming at once, capped for performance.

Flag any feature that risks overlay performance (many simultaneous particles/creatures) and cap it.

---

## 12. Distribution (make it shareable)

- Produce two outputs from `tauri build`: an **NSIS installer** and a **portable** build.
- Even a Tauri app exceeds Discord's 25 MB / typical email limits once bundled, so set up the primary share path as **GitHub Releases**: I upload the installer there, friends download via a link. Add a short `RELEASE.md` with the release steps.
- Also produce a `.zip` of the portable build as a secondary "just send the file" option, and report its final size so I know if it clears Discord's limit.
- Include a plain-language `README.md` for friends: what it is, how to install, the hotkeys, and how to quit.

---

## 13. Project structure (target)

```
peeceemons/
  src-tauri/            # Rust shell: windows, hotkeys, autostart, config I/O
  src/
    overlay.html        # roaming pet
    widget.html         # clamshell control
    engine/
      loop.js           # raf loop
      creature.js       # walk/idle/move state machine
      moves/            # one module per type move
      particles.js
      sprites.js        # placeholder gen + drop-in loader
    data/
      creatures.json    # roster + palettes + seeds
    assets/
      sprites/          # drop-in final art (from sprite-pipeline)
      audio/  fonts/
  sprite-pipeline/      # Track B (Python): generate.py, workflow.template.json,
                        # pipeline.config.json, postprocess.py, _preview/
  README.md  SPRITES.md  RELEASE.md
```

---

## 14. Build order (checkpoints — run the app after each)

**Track A — app**
1. Scaffold Tauri + verify prerequisites; blank overlay + widget windows open.
2. Overlay: transparent, always-on-top, click-through, bottom-strip; procedural creature walks + turns at edges.
3. Engine: idle/walk state machine + blink + click-to-hop; hit-test for click-through.
4. Type/move system: implement all 10 moves as modules; trigger one manually.
5. Config layer: read/write `peeceemons.config.json`; overlay reacts to config changes via events.
6. Widget: draw clamshell, flip animation, BOOT -> SELECT -> ACTIVE states.
7. Widget controls: d-pad/A/B/START/SELECT, full keyboard mapping, silhouette->colour carousel.
8. Global hotkeys + single-instance + quit; wire START to roaming, move hotkey to move.
9. Move auto-timer (randomized) + cooldown.
10. Add-ons in §11 priority order.

**Track B — sprites (optional, can run in parallel once §7 data exists)**
11. Build `sprite-pipeline/`: workflow template + `generate.py` + `postprocess.py` + frame derivation; wire to `data/creatures.json`. Leave model/LoRA config for me to fill. Generate a contact sheet.
12. Confirm generated sheets satisfy §8.1 and drop straight into `/assets/sprites/`.

**Packaging**
13. Installer + portable + zip; shortcuts; autostart toggle; README/RELEASE docs; report build sizes.

---

## 15. Definition of done

- App launches from a desktop shortcut; a creature roams the bottom of the screen.
- Widget opens on hotkey, flips open, lets me pick any of the 20 creatures (silhouette -> colour), and sets it live.
- Each type's move plays on timer and on the move hotkey, with the correct animation.
- START toggles roaming; quit hotkey fully closes it; settings persist across relaunch.
- Everything runs with procedural placeholder sprites (Track B is not required for the app to work).
- `sprite-pipeline/` can batch-generate all 20 sheets to §8.1 spec (given my ComfyUI + model config), and `--only <name>` regenerates one.
- `tauri build` produces an installer + portable zip; sizes reported; README written for friends.

---

## Notes for me (I'm a beginner coder)

- Explain each Rust file's purpose in a comment header; keep Rust minimal.
- After each checkpoint, tell me the one command to run it and what I should see.
- For Track B, tell me exactly what to put in `pipeline.config.json` (model + LoRA names, ComfyUI URL) before I run `generate.py`.
- If you hit a decision point (transparency issues, hotkey conflicts, ComfyUI API shape), stop and ask rather than guessing.
