# Animal Sounds

Simple app for kids to play animal sounds from a web browser. Nothing less,
nothing more.

A grid of big animal tiles: tap an animal to hear its sound (a YouTube
short); when the video ends, the app returns to the grid on its own. Built
to run locked-down on a Samsung Galaxy Tab A7 Lite.

The videos come from this YouTube playlist:
<https://youtube.com/playlist?list=PLHO8AJ-73A6g>

## How it works

- Plain static site — no framework, no build step. Deployed to Vercel.
- `animals.json` maps each tile (name + image) to a YouTube video ID.
- Tapping a tile first plays a recording of the animal's name (files in
  `audio/`, generated with `randysay --text "Horse" -o horse.mp3`; filenames
  are the lowercased name with spaces as dashes).
- Swipe left from the animal gallery to open **Animal Puzzle**. Each round
  picks an animal image and shuffles its nine pieces; place each piece in its
  matching outlined slot. A star, particles, and chime celebrate a completed
  puzzle before a new randomized round appears.
- Playback uses the official YouTube IFrame API. An invisible "tap shield"
  covers the video so little fingers can't pause it, open related videos, or
  click through to YouTube.
- The video auto-returns to the grid when it ends, errors, or never starts
  (watchdog timeout).
- Parent escape hatch: **hold the ✕ in the top-right corner for about 1.2
  seconds** (`HOLD_MS` in app.js) while a video is playing. Quick taps do
  nothing.
- Screen time is limited to **15 active minutes per session** and **one active
  hour per local calendar day**. Session breaks use exponential backoff: 30
  minutes after the first session, then 60 (the maximum); after the fourth
  session reaches the daily hour, it stays locked until tomorrow. Usage and
  the current lock persist across page reloads, and hidden tabs do not count
  toward usage.
- Screen time starts only after an animal-tile tap or a moved puzzle piece.
  After one minute without either, the app dims and pauses the clock. The next
  tap only wakes the app; a following tile tap or puzzle move resumes counting.
  Swipes, wake taps, close controls, and passive video playback do not count.
- The header's **Today** timer shows the accumulated active time for the local
  calendar day, including the current active second and excluding dimmed or
  locked time.
- Ad-free playback relies on a YouTube Premium account being signed in once
  in the kiosk browser (see step 6 below). Embedded players honor the
  viewer's Premium session.

## Editing the animals

The tiles are defined in `animals.json`; each entry looks like

```json
{ "name": "Horse", "videoId": "erYhEM4qLpU", "image": "images/horse.svg" }
```

**The entry format, image/voice-clip pipeline, and deploy steps are all in
[ADDING_ANIMALS.md](ADDING_ANIMALS.md)** — that's the canonical guide.
`scripts/refresh-playlist.sh` diffs the playlist against `animals.json` and
checks every animal has its voice clip.

## Tablet setup: full kiosk lockdown (Tab A7 Lite, Android 14)

Plan A uses **FreeKiosk** (free, open-source, MIT). If it misbehaves on this
tablet, Plan B is **Fully Kiosk Browser** (€7.90 one-time) — the steps are
nearly identical; differences are noted inline. Neither requires root.

### 1. Prep the tablet

1. Settings → Software update — install the latest updates.
2. **Remove every account**: Settings → Accounts and backup → Manage
   accounts → remove each one (Google, Samsung, …). Device-owner
   provisioning refuses to run if any account exists. (Removing the
   account does not delete it — you can re-add it any time.)
3. Settings → Lock screen → Screen lock type → **None** (so waking the
   tablet lands straight back in the app).
4. Enable Developer options: Settings → About tablet → Software
   information → tap **Build number** 7 times. Then Settings → Developer
   options → enable **USB debugging**.
5. Optional but recommended: Settings → Display → Screen timeout → 30
   minutes (or "Keep screen on while charging" in Developer options if it
   will live on a charger).

### 2. Sideload the kiosk app from your Mac

Install adb if needed: `brew install android-platform-tools`

- **FreeKiosk**: download the latest APK from
  <https://github.com/RushB-fr/freekiosk/releases>
- **Fully Kiosk**: download the APK from <https://www.fully-kiosk.com>

Connect the tablet by USB, accept the debugging prompt on screen, then:

```bash
adb install path/to/freekiosk.apk
```

(Sideloading avoids re-adding a Google account just for the Play Store.)

### 3. Make it device owner (true lockdown, no root)

```bash
# FreeKiosk:
adb shell dpm set-device-owner com.freekiosk/.DeviceAdminReceiver

# Fully Kiosk (Plan B):
adb shell dpm set-device-owner de.ozerov.fully/.DeviceOwnerReceiver
```

If it complains about accounts, an account still exists — see step 1.2.
Device-owner mode is what disables the status bar, home/recents buttons,
and edge swipes for real (Android "Lock Task Mode").

To undo later: remove device owner from the kiosk app's own settings, or
factory-reset the tablet.

### 4. Configure the kiosk

As configured on Randy's tablet (July 2026), in FreeKiosk's settings
(GENERAL and SECURITY tabs):

- **Start URL**: `https://animal-sounds-beta.vercel.app` (GENERAL).
- **PIN**: set a unique six-digit PIN (do not leave the default `1234`).
- SECURITY: **Enable Lock Mode** ON, **Launch on Boot** ON.
- **Return to Settings**: use **Fixed Corner**, with the return indicator
  hidden; keep the 10-taps-within-3-seconds requirement, then require the
  PIN. Do not use **Tap Anywhere**: ordinary tile taps can satisfy it.
- Disable the volume-button return shortcut unless it is specifically needed
  for maintenance.
- Left OFF (deliberately): Block Power Menu and Show System Info Bar — the
  app warns both interact with audio muting on Samsung/OneUI; audio
  confirmed working with this combination.
- "Appear on top" permission granted via
  `adb shell appops set com.freekiosk SYSTEM_ALERT_WINDOW allow`.

### 5. Buy the license (Plan B only)

Fully Kiosk needs the PLUS license (€7.90 one-time per device) to remove
the watermark and unlock the full lockdown settings. FreeKiosk is free.

### 6. Sign into YouTube Premium (kills ads in the videos)

In the kiosk app's browser, temporarily set the Start URL to
`https://youtube.com`, sign in with the Premium account, then set the
Start URL back to the app. The session cookie persists and embedded
videos play ad-free.

If Google shows *"This browser or app may not be secure"*: in the kiosk
settings, temporarily change the user agent to a desktop Chrome user
agent, sign in, then revert it.

If ads ever reappear (session expired after weeks/months), repeat this
step.

### 7. Escape-proofing checklist

Test with the kiosk locked:

- [ ] Swipe from every edge — nothing should appear.
- [ ] Volume buttons — disabled (videos can be loud; set a volume first).
- [ ] Power button tap — screen sleeps; tapping again wakes straight into
      the app (no lock screen).
- [ ] Long-press power — Samsung may still show the Power off menu; if the
      tablet gets powered off, the kiosk auto-relaunches on boot (verified:
      after a reboot the tablet comes back locked into the app).
- [ ] In-app: tap the video repeatedly — it must not pause or navigate.
- [ ] In-app: quick-tap the ✕ — nothing; hold it ~1.2 s — back to the grid.
- [ ] Hold one finger on the screen, then tap several different animal tiles
      with another finger — each new tile tap must still open its video.
- [ ] Start an upward swipe on an animal tile — the grid must scroll instead
      of opening that tile.
- [ ] Verify that repeated taps on tiles do not open FreeKiosk settings; only
      the hidden fixed-corner gesture plus the PIN should do so.

## Local development

```bash
python3 -m http.server 8642
# open http://localhost:8642
```

Deploy: `vercel --prod` (static site, no configuration needed).

## Credits

Animal artwork from [OpenMoji](https://openmoji.org) — the open-source
emoji and icon project, licensed
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Some animals use nearest-species stand-ins (the ferret is an otter, the
yak is a bison, the guinea pig is a hamster, and several birds share the
songbird art with shifted colors) — swap any file in `images/` to change.

"Fredoka" typeface (SIL Open Font License) is self-hosted in `fonts/`.
