# Media

Screenshots, animations and the demo video. Everything here was produced from
the app itself — there is no mocked-up or hand-drawn artwork, which matters
because the creatures have no image files at all: they are generated at runtime
from a four-colour palette and a seeded RNG (see [`../SPRITES.md`](../SPRITES.md)).

| File | What it is |
|---|---|
| `demo.mp4` | 48s walkthrough — cold start, the pet roaming, the device, two battles. 1920×1080 |
| `roster.png` | All 20 base creatures with names and types |
| `battle.gif` | A battle, start to finish |
| `pet-roaming.gif` | The pet walking along the taskbar |
| `pet-roaming-filmstrip.png` | The same walk as a timed filmstrip, t=0.0s→5.9s |
| `widget-ui.jpg` | The clamshell device on the roster screen |
| `battle-start.jpg` | A wild encounter beginning |
| `battle-super-effective.jpg` | The type chart landing a super-effective hit |

## How they were captured

`pet-roaming.gif` and its filmstrip come from the running desktop app.

`roster.png`, `battle.gif` and the three stills were rendered by running the
real engine — the same `src/engine/` JavaScript, the same procedural sprite
generator, the same battle logic — outside the Tauri shell, so the frames could
be captured cleanly.

`demo.mp4` is a 4K screen capture of the app on a real desktop, cut to 1080p.
Its sound effects are the app's own: same square waveforms, frequencies, sweeps
and envelope as [`../src/engine/audio.js`](../src/engine/audio.js), re-synthesised
and layered in, because Windows offers no audio loopback device to record from
and `soundOn` is off by default. The background music was written for the video
and is not part of the app. The creature on the closing card is animated from
the real walk and move sheets the generator produces.
