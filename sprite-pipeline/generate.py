"""generate.py -- Stage 1: drive ComfyUI to produce one base image per creature.

This is a batch driver, not prompt-and-hope. Every creature uses the same
checkpoint, LoRA, sampler, steps and CFG; only the prompt and the seed change.
The seed comes from creatures.json (or seed_overrides in pipeline.config.json),
so a rerun reproduces the same art exactly, and one bad creature can be
re-rolled on its own without disturbing the other nineteen.

    python sprite-pipeline/generate.py --dry-run       # validate, hit nothing
    python sprite-pipeline/generate.py                 # all 20
    python sprite-pipeline/generate.py --only Flarepup # just one
    python sprite-pipeline/generate.py --no-post       # skip stages 2-3

Before the first real run, start ComfyUI with its API enabled and check
`checkpoint` in pipeline.config.json matches a file you actually have.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import uuid
from pathlib import Path

import requests

from postprocess import RAW, ROOT, config, contact_sheet, process, roster

TEMPLATE = ROOT / "sprite-pipeline" / "workflow.template.json"


# --------------------------------------------------------------------------
# prompt building
# --------------------------------------------------------------------------

def build_prompt(spec: dict, cfg: dict) -> tuple[str, str]:
    """§8.2's template, filled from the creature's own design note.

    The note is the only thing that varies. Nothing here references any
    existing commercial creature or franchise -- these are original designs
    and the prompt says only what they look like.
    """
    positive = f"{cfg['style_prefix']} {spec['note']}, {cfg['style_suffix']}"
    return positive, cfg["negative"]


def build_graph(spec: dict, cfg: dict, seed: int) -> dict:
    """Fill the template. Strings are substituted, numbers are set by node id
    so the JSON never has to survive a textual replace."""
    graph = json.loads(TEMPLATE.read_text(encoding="utf-8"))
    graph.pop("$comment", None)

    positive, negative = build_prompt(spec, cfg)

    graph["1"]["inputs"]["ckpt_name"] = cfg["checkpoint"]
    graph["2"]["inputs"]["text"] = positive
    graph["3"]["inputs"]["text"] = negative
    graph["4"]["inputs"]["width"] = cfg["width"]
    graph["4"]["inputs"]["height"] = cfg["height"]
    graph["5"]["inputs"].update(
        seed=seed,
        steps=cfg["steps"],
        cfg=cfg["cfg"],
        sampler_name=cfg["sampler_name"],
        scheduler=cfg["scheduler"],
    )
    graph["7"]["inputs"]["filename_prefix"] = f"peeceemons/{spec['name']}"

    if cfg.get("lora"):
        graph["8"]["inputs"]["lora_name"] = cfg["lora"]
        graph["8"]["inputs"]["strength_model"] = cfg["lora_strength"]
        graph["8"]["inputs"]["strength_clip"] = cfg["lora_strength"]
    else:
        # No LoRA: drop the node and wire the text encoders and sampler
        # straight to the checkpoint.
        del graph["8"]
        graph["2"]["inputs"]["clip"] = ["1", 1]
        graph["3"]["inputs"]["clip"] = ["1", 1]
        graph["5"]["inputs"]["model"] = ["1", 0]

    return graph


def seed_for(spec: dict, cfg: dict) -> int:
    return int(cfg.get("seed_overrides", {}).get(spec["name"], spec["seed"]))


# --------------------------------------------------------------------------
# ComfyUI HTTP
# --------------------------------------------------------------------------

class Comfy:
    def __init__(self, base: str, timeout: int):
        self.base = base.rstrip("/")
        self.timeout = timeout
        self.client_id = str(uuid.uuid4())

    def check(self) -> str:
        r = requests.get(f"{self.base}/system_stats", timeout=10)
        r.raise_for_status()
        d = r.json()
        dev = (d.get("devices") or [{}])[0]
        return dev.get("name", "unknown device")

    def submit(self, graph: dict) -> str:
        r = requests.post(
            f"{self.base}/prompt",
            json={"prompt": graph, "client_id": self.client_id},
            timeout=30,
        )
        if r.status_code != 200:
            # ComfyUI returns a genuinely useful validation body; show it.
            raise RuntimeError(f"/prompt returned {r.status_code}: {r.text[:800]}")
        return r.json()["prompt_id"]

    def wait(self, prompt_id: str) -> dict:
        deadline = time.time() + self.timeout
        while time.time() < deadline:
            r = requests.get(f"{self.base}/history/{prompt_id}", timeout=15)
            if r.status_code == 200:
                hist = r.json().get(prompt_id)
                if hist and hist.get("outputs"):
                    return hist
                if hist and hist.get("status", {}).get("status_str") == "error":
                    raise RuntimeError(f"ComfyUI reported an error: {hist['status']}")
            time.sleep(1.0)
        raise TimeoutError(f"{prompt_id} did not finish within {self.timeout}s")

    def download(self, image: dict) -> bytes:
        q = urllib.parse.urlencode({
            "filename": image["filename"],
            "subfolder": image.get("subfolder", ""),
            "type": image.get("type", "output"),
        })
        r = requests.get(f"{self.base}/view?{q}", timeout=60)
        r.raise_for_status()
        return r.content


def first_image(hist: dict) -> dict:
    for out in hist.get("outputs", {}).values():
        for img in out.get("images", []):
            return img
    raise RuntimeError("the workflow finished but produced no image")


# --------------------------------------------------------------------------
# driver
# --------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description="Peeceemons sprite generation (Stage 1)")
    ap.add_argument("--only", help="one creature by name, e.g. --only Flarepup")
    ap.add_argument("--dry-run", action="store_true",
                    help="build and validate every graph without contacting ComfyUI")
    ap.add_argument("--no-post", action="store_true", help="skip stages 2 and 3")
    ap.add_argument("--skip-existing", action="store_true",
                    help="leave creatures that already have a raw image alone")
    args = ap.parse_args()

    cfg = config()
    specs = roster()

    if args.only:
        if args.only not in specs:
            print(f"unknown creature '{args.only}'.\nTry one of: "
                  f"{', '.join(sorted(specs))}", file=sys.stderr)
            return 2
        targets = [specs[args.only]]
    else:
        targets = list(specs.values())

    # --- dry run: prove the graphs are well formed, touch nothing ---------
    if args.dry_run:
        print(f"dry run: {len(targets)} creature(s)")
        print(f"  checkpoint : {cfg['checkpoint']}")
        print(f"  lora       : {cfg['lora'] or '(none — see SPRITES.md)'}")
        print(f"  sampler    : {cfg['sampler_name']}/{cfg['scheduler']} "
              f"{cfg['steps']} steps, cfg {cfg['cfg']}, {cfg['width']}x{cfg['height']}\n")
        for spec in targets:
            graph = build_graph(spec, cfg, seed_for(spec, cfg))
            missing = [k for k in ("1", "2", "3", "4", "5", "6", "7") if k not in graph]
            if missing:
                print(f"  {spec['name']:<12} BROKEN - missing nodes {missing}")
                return 1
            pos, _ = build_prompt(spec, cfg)
            print(f"  {spec['name']:<12} seed {seed_for(spec, cfg):<9} "
                  f"{len(graph)} nodes")
            print(f"               {pos}")
        print("\nall graphs built cleanly. Start ComfyUI and rerun without --dry-run.")
        return 0

    # --- real run --------------------------------------------------------
    comfy = Comfy(cfg["comfyui_url"], cfg.get("timeout_seconds", 300))
    try:
        device = comfy.check()
    except Exception as e:
        print(f"Cannot reach ComfyUI at {cfg['comfyui_url']}\n  {e}\n\n"
              f"Start ComfyUI first (its API is on by default), or fix\n"
              f"comfyui_url in sprite-pipeline/pipeline.config.json.",
              file=sys.stderr)
        return 1

    print(f"ComfyUI up on {cfg['comfyui_url']} ({device})")
    print(f"generating {len(targets)} creature(s) with {cfg['checkpoint']}\n")
    RAW.mkdir(parents=True, exist_ok=True)

    failures = []
    for i, spec in enumerate(targets, 1):
        dest = RAW / f"{spec['name']}.png"
        if args.skip_existing and dest.exists():
            print(f"[{i}/{len(targets)}] {spec['name']:<12} already done, skipping")
            continue

        seed = seed_for(spec, cfg)
        print(f"[{i}/{len(targets)}] {spec['name']:<12} seed {seed} ... ", end="", flush=True)
        try:
            graph = build_graph(spec, cfg, seed)
            hist = comfy.wait(comfy.submit(graph))
            dest.write_bytes(comfy.download(first_image(hist)))
            print("done", end="")
            if not args.no_post:
                process(dest, spec, cfg, quiet=True)
                print(" -> sheets", end="")
            print()
        except Exception as e:
            print(f"FAILED\n      {e}")
            failures.append(spec["name"])

    if not args.no_post:
        sheet = contact_sheet(list(specs.values()))
        print(f"\ncontact sheet: {sheet.relative_to(ROOT)}")

    if failures:
        print(f"\n{len(failures)} failed: {', '.join(failures)}")
        print("Rerun just those with --only <Name>.")
        return 1

    print(f"\n{len(targets)} creature(s) generated. "
          f"Sheets are in src/assets/sprites/ and the app will pick them up "
          f"on its next launch.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
