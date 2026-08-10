# Peeceemons — cheat sheet

Everything you need on one page: installing it, starting it, stopping it, and
what to do when something looks wrong.

---

## 1. Install

### The normal way

1. Download **`Peeceemons_0.1.0_x64-setup.exe`**.
2. Double-click it.
3. **Windows will warn you.** You'll see *"Windows protected your PC"*. This is
   only because the app isn't code-signed — click **More info**, then
   **Run anyway**.
4. That's it. No admin password needed; it installs just for you and adds a
   **Desktop** and **Start Menu** shortcut.

### The no-install way

Unzip **`Peeceemons-0.1.0-portable.zip`** anywhere and run `peeceemons.exe`.
Nothing is written outside your own settings file.

**Needs:** Windows 10 or 11. Nothing else — the browser engine it uses is
already part of Windows.

---

## 2. Start it

| How | What to do |
|---|---|
| Desktop shortcut | Double-click **Peeceemons** |
| Start Menu | Search "Peeceemons" |
| Portable | Run `peeceemons.exe` |
| Every time you log in | Turn on **⚙ → Start with PC** |

Your pet appears along the bottom of your main screen, and the clamshell
device opens next to it.

Running it twice does nothing bad — the second launch just brings the existing
device to the front.

---

## 3. Stop it

**There are three different "stops", and it's easy to mix them up.**

| I want to… | Do this | Result |
|---|---|---|
| **Quit completely** | **`Ctrl + Alt + Q`** | Pet and device both close. Nothing left running. |
| Hide the device, keep the pet | **`Ctrl + Alt + P`** | Device disappears. **App is still running.** |
| Stop the pet wandering | **`START`** on the device, or **`Ctrl + Alt + O`** | Pet stands still. App still running. |

> The device has no ✕ button on purpose — `Ctrl + Alt + P` hides it and
> `Ctrl + Alt + Q` quits. If you think you closed the app but the pet is still
> on screen, you only hid the device.

**If a hotkey doesn't work:** open Task Manager (`Ctrl + Shift + Esc`), find
**peeceemons.exe**, and click End task.

---

## 4. Hotkeys

Work anywhere, in any app:

| Hotkey | Does |
|---|---|
| `Ctrl + Alt + P` | Show / hide the device |
| `Ctrl + Alt + M` | Make the pet do its move |
| `Ctrl + Alt + O` | Roaming on / off |
| `Ctrl + Alt + Q` | **Quit** |

If another program already uses one, the device says so on its screen instead
of failing silently. You can change the move hotkey in **⚙ → Move hotkey**.

---

## 5. The device

Click the buttons, or use the keyboard — they do exactly the same thing.

| Button | Key | Does |
|---|---|---|
| D-pad ← → | Arrows | Flick through creatures |
| D-pad ↑ ↓ | Arrows | Filter: All / Starter / Evolved / Wild / Legendary |
| **A** | `Enter` | Pick the highlighted creature · attack in battle |
| **B** | `Backspace` / `Esc` | Back · flee a battle |
| **START** | `S` | Roaming on / off |
| **SELECT** | `Tab` | Spar with the highlighted creature · otherwise do the move |
| ⚙ | click | Options |

Drag the device anywhere by its body. It remembers where you left it.

---

## 6. Collecting

You start with 9 creatures. There are **29 in total** — 20 to find, 9 to earn.

**To find one (11 remaining):** every ~40 minutes, **grass rustles around your
pet and a `!` appears**. **Click your pet** to start a battle. Beat the same
creature enough times (3–5 for a common, 7–10 for a legendary) and it joins
you. The dots under a locked creature show your progress.

**To earn one (9 evolutions):** win **10 battles using the same starter** and
it evolves. Practice battles count towards this.

**Battle tips**
- Press **A** to attack. Type matters — see **⚙ → Type chart**.
- ~1 attack in 10 misses.
- Hits sometimes leave a status: burn, paralysis, chill, curse and so on.
- Want to fight now? Highlight anyone and press **SELECT**, or use
  **⚙ → Practice battle**. Practice can't catch anything but does count
  towards evolving.

---

## 7. Options (⚙)

| Setting | What it's for |
|---|---|
| Move timer | How often the pet shows off by itself |
| Move hotkey | Pick a different combination |
| Sound | Retro blips (off by default) |
| Reduced motion | No screen shake, fewer particles |
| Start with PC | Launch on login |
| Pet size | 1× – 6× |
| Device size | 50% – 200% |
| Wild encounters | How often, or **Off** |
| Practice battle | A no-stakes fight |
| Type chart / Hotkey list | Reference screens |
| Reset all | Back to defaults |

---

## 8. Something's wrong

| Problem | Fix |
|---|---|
| **Can't see the pet** | It may be behind a full-screen app. Minimise it. Check roaming is on (`Ctrl + Alt + O`). |
| **Pet is hiding behind the taskbar** | It re-asserts itself every 2 seconds — give it a moment. |
| **Can't click something under the pet** | The overlay is click-through everywhere except the pet itself. Move the pet by toggling roaming. |
| **A hotkey does nothing** | Another app has claimed it. Change it in **⚙ → Move hotkey**. |
| **Device is too big / too small** | **⚙ → Device size** |
| **Device has vanished off-screen** | Quit and relaunch — it recentres itself if the saved spot is unreachable. |
| **Want to start over** | **⚙ → Reset all**, or delete the folder below. |
| **Encounters are annoying** | **⚙ → Wild encounters → Off** |

**Your settings live at:**

```
%APPDATA%\com.peeceemons.app\peeceemons.config.json
```

Delete that folder to wipe everything — creatures, progress, positions.

---

## 9. Uninstall

**Settings → Apps → Installed apps → Peeceemons → Uninstall.**

Portable version: delete the folder. Either way, also delete
`%APPDATA%\com.peeceemons.app\` if you want the save data gone too.

---

## 10. Running from source

Only needed if you're changing the code.

```powershell
# One-off setup
winget install --id Rustlang.Rustup -e
cargo install tauri-cli --version "^2" --locked

# Run it (rebuilds and relaunches as you edit)
cd src-tauri
cargo tauri dev

# Build the installer
cargo tauri build
```

There's **no Node.js, no npm, no `node_modules`** — the frontend is plain
HTML/CSS/JS served straight from `src/`.

**Handy while developing:** if a change to the frontend doesn't seem to take
effect, the browser engine has cached it. Delete
`%LOCALAPPDATA%\com.peeceemons.app\EBWebView` and relaunch.

See `SPRITES.md` for generating real pixel art, and `RELEASE.md` for
publishing.
