# Releasing Peeceemons

## Build it

```powershell
cd src-tauri
cargo tauri build
```

Roughly two minutes. The release profile uses `opt-level = "s"`, LTO and
symbol stripping, which is what keeps the result so small.

Then assemble both share formats:

```powershell
# from the repo root
$rel = "src-tauri\target\release"
New-Item -ItemType Directory -Force dist | Out-Null
Copy-Item "$rel\bundle\nsis\Peeceemons_0.1.0_x64-setup.exe" dist -Force

New-Item -ItemType Directory -Force dist\_p\Peeceemons | Out-Null
Copy-Item "$rel\peeceemons.exe" dist\_p\Peeceemons
Compress-Archive dist\_p\Peeceemons dist\Peeceemons-0.1.0-portable.zip -Force
Remove-Item -Recurse -Force dist\_p
```

## Current sizes

| File | Size | Discord (25 MB) |
|---|---|---|
| `Peeceemons_0.1.0_x64-setup.exe` | **1.14 MB** | fits easily |
| `Peeceemons-0.1.0-portable.zip` | **1.34 MB** | fits easily |

Worth knowing: the original plan assumed the bundle would be too big for
Discord and email, so GitHub Releases would be the only realistic route. It is
not — at just over a megabyte you can **attach either file directly to a
Discord message or an email**. GitHub Releases is still the tidier option for
anything public (versioned, one stable link, no re-uploading), but it is a
convenience now rather than a necessity.

## macOS

There is a ready-made GitHub Actions workflow at
`.github/workflows/release.yml` that builds **both** a Windows installer and a
universal macOS `.dmg` (Apple Silicon and Intel in one file) whenever you push
a tag:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

It publishes a **draft** release, so you get to look before anyone else does.
GitHub's macOS runners are free on public repositories.

This exists because **macOS binaries cannot be built on Windows** — Apple's
toolchain only runs on macOS, so a CI runner (or a borrowed Mac) is the only
route.

**Be aware, none of the macOS side has been tested.** The app code is
platform-neutral — every window operation goes through Tauri rather than any
Win32 call — and `macOSPrivateApi` is enabled, which is what transparent
windows need there. But two things are likely to want real work on an actual
Mac:

- **The overlay above the Dock.** macOS window levels do not behave like
  Windows' "topmost", so the pet may sit behind the Dock and need its window
  level raised explicitly.
- **Gatekeeper.** It blocks unnotarised apps considerably harder than
  SmartScreen does — the first launch needs right-click → Open, or
  `xattr -cr /Applications/Peeceemons.app`. Proper notarisation needs an Apple
  Developer account at $99/year.

Treat the Mac build as promising but unproven until someone runs it.

## Publishing to GitHub Releases

1. Create the repo and push, if you have not already:
   ```powershell
   git init
   git add .
   git commit -m "Peeceemons 0.1.0"
   gh repo create peeceemons --public --source=. --push
   ```
2. Tag and publish, attaching both files:
   ```powershell
   gh release create v0.1.0 `
     "dist\Peeceemons_0.1.0_x64-setup.exe" `
     "dist\Peeceemons-0.1.0-portable.zip" `
     --title "Peeceemons 0.1.0" `
     --notes "First release. Twenty original creatures, wild encounters and battles."
   ```
3. Send people the release page link. The installer is the one to point them
   at; the zip is for anyone who would rather not install.

## Things to tell whoever you send it to

**SmartScreen will warn them.** The app is not code-signed, so Windows shows
"Windows protected your PC" and hides the Run button behind **More info**.
This is expected and there is no way around it short of buying a code-signing
certificate (a few hundred pounds a year). Warn people in advance, or they
will assume it is malware.

The installer is per-user, so there is no admin prompt, and it creates Start
Menu and Desktop shortcuts. Uninstall is via Windows Settings → Apps.

## Bumping the version

Change `version` in **both**:

- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

They are separate files and nothing checks that they agree, so it is easy to
ship a mismatch.

## Before you tag

- [ ] `cargo tauri dev` and check the pet roams and the widget opens
- [ ] Trigger a battle and confirm a win banks progress
- [ ] `Ctrl+Alt+Q` fully quits (no `peeceemons.exe` left in Task Manager)
- [ ] Delete `%APPDATA%\com.peeceemons.app\` and relaunch, to check a first
      run from clean works — easy to break, and it is what everyone else gets
- [ ] `python sprite-pipeline/postprocess.py --self-test` still passes
