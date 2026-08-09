# Sprites

Peeceemons ships with no art files. Every creature is drawn procedurally from
its four-colour palette, so the app is complete on its own. Real art is a
drop-in upgrade: if a PNG exists it is used, and if it does not the procedural
version stands in. Nothing breaks either way, and you can convert the roster
one creature at a time.

---

## The sheet spec

Put files at `src/assets/sprites/<Name>/`, using the exact name from
`src/data/creatures.json` (`Flarepup`, `Tidalwyrm`, …).

| File | Frames | Meaning |
|---|---|---|
| `idle.png` | 2 | resting, blinking |
| `walk.png` | 2 | the two-frame walk cycle |
| `move.png` | up to 4 | the type's signature move |

Every sheet must be:

- **32 × 32 px per frame**, laid out as a **horizontal strip** (a 4-frame sheet
  is 128 × 32)
- **transparent PNG**, origin **bottom-centre** — the creature stands on the
  bottom edge of its frame and is horizontally centred
- **exactly the creature's four palette colours** plus transparency
- **hard edges, no anti-aliasing**. A soft edge shows up as a grey halo when
  the sprite is scaled up 3×

Facing right. The engine mirrors the sprite when the creature walks left, so
do not draw a left-facing version.

Any sheet can be hand-drawn or hand-refined in Aseprite, Piskel, or anything
else, and it will drop straight in. The pipeline below is a starting point,
not a requirement.

---

## The pipeline (optional)

`sprite-pipeline/` generates all 20 sheets from a local
[ComfyUI](https://github.com/comfyanonymous/ComfyUI). It is deliberately not
prompt-and-hope: every creature uses the same model, sampler, steps and CFG,
and its own fixed seed from `creatures.json`. Rerunning reproduces the same
art, and one bad creature can be re-rolled without touching the rest.

### Before your first run

Open `sprite-pipeline/pipeline.config.json` and check two fields.

**`checkpoint`** — must match a filename in `ComfyUI/models/checkpoints`
exactly. It is currently set to:

```json
"checkpoint": "v1-5-pruned-emaonly-fp16.safetensors"
```

That is an SD1.5 model, chosen because nearly every pixel-art LoRA is trained
on 1.5. You also have `sdXL_v10VAEFix.safetensors` and
`dreamshaperXL_v21TurboDPMSDE.safetensors` if you would rather use SDXL — if
you switch to an XL model, set `width` and `height` to `1024`.

**`lora`** — currently `null`, because there is no pixel-art LoRA in
`ComfyUI/models/loras` yet. The set will look considerably more cohesive with
one. Download any pixel-art LoRA for your base model, drop the `.safetensors`
into `ComfyUI/models/loras`, and put its exact filename here:

```json
"lora": "pixel-art-xl.safetensors",
"lora_strength": 0.85
```

With `lora` left as `null` the pipeline simply skips that node and wires the
prompt straight to the checkpoint, so it still runs — the output is just less
consistent between creatures.

### Running it

```bash
# 1. Check every workflow builds, without contacting ComfyUI at all
python sprite-pipeline/generate.py --dry-run

# 2. Start ComfyUI, then generate everything (20 images, a few minutes on a 4070)
python sprite-pipeline/generate.py

# 3. Re-roll a single creature you are not happy with
python sprite-pipeline/generate.py --only Flarepup
```

If one creature keeps coming out badly, give it a different seed rather than
fighting the prompt:

```json
"seed_overrides": { "Flarepup": 777123 }
```

Then rerun `--only Flarepup`.

### What it does

**Stage 1 — generate.** Posts the workflow to ComfyUI's `/prompt`, polls
`/history`, downloads the result to `sprite-pipeline/_raw/<Name>.png`. The
prompt is built from the creature's own design note:

> `16-bit RPG monster sprite, single {design note}, front view, chunky pixel
> art, bold black outline, flat cel shading, Game Boy Color palette, centered,
> solid magenta background`

**Stage 2 — clean up.** Deterministic, no AI: magenta chroma-key to
transparency → autocrop → centre on a square → nearest-neighbour downscale to
32 × 32 → quantise every pixel to the creature's exact four ramp colours.

**Stage 3 — derive the frames.** Diffusion cannot give you frame-consistent
animation, so the frames are derived from the one clean sprite: the blink
darkens the eye row, the walk offsets the lower third and bobs the body, and
the move frames come from a small per-type table (Fire flashes, Ice squashes,
Electric jitters with a white rim, Shadow fades, and so on).

Outputs land in `src/assets/sprites/<Name>/`, plus
`sprite-pipeline/_preview/contact-sheet.png` showing all 20 in colour and as
silhouettes for a one-glance review.

### Testing it without ComfyUI

```bash
python sprite-pipeline/postprocess.py --self-test
```

Synthesises an input for each creature, runs the whole of stages 2 and 3, and
checks every sheet is the right size, non-empty and palette-clean. It writes
to `sprite-pipeline/_preview/_selftest/`, never to the live asset folder, so it
cannot overwrite real art or override the procedural placeholders.

You can also run the cleanup on any image you already have:

```bash
python sprite-pipeline/postprocess.py --input my-drawing.png --creature Flarepup
```

---

## Removing art

Delete the folder. `src/assets/sprites/<Name>/` going away puts that creature
straight back to its procedural placeholder on the next launch — there is no
cache to clear and no setting to change.
