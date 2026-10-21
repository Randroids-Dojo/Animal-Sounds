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
- The **Dinosaurs** tab has 26 illustrated dinosaurs with unabbreviated names.
  Tapping one speaks its name in Randy's voice without opening a video.
  Images and voice recordings are local assets; repeated taps restart the name
  and selecting another dinosaur stops the previous recording. The same touch
  guards, idle dimming, and screen-time limits apply. Dinosaur entries live in
  `dinosaurs.json`; artwork attribution is in [DINOSAUR_CREDITS.md](DINOSAUR_CREDITS.md).
- The **Foods** tab has 20 food pictures, starting with **Tomato** and **Potato**.
  Each tap speaks the name in Randy's voice without a video. Entries are in
  `foods.json`; food artwork is from OpenMoji (CC BY-SA 4.0), like the animals.
- **Alphabet** has 26 cards in A–Z order. Each starts with an animal and shows
  uppercase letter, lowercase letter, and item name (for example, **Aa Alligator**).
  A tap plays a local recording of "A is for Alligator", then changes that card
  to another item for A. Each letter has five items from animals, foods, colors,
  shapes, and everyday objects. Each card independently shuffles its choices,
  uses every choice before repeating, and avoids back-to-back repeats across
  shuffles. Interrupting a phrase, changing tabs, hiding the app, or reaching a
  screen-time limit leaves its current item unchanged. Cards reset to their
  starting animals on reload. Content is in `alphabet.json`; shuffle logic is
  in `alphabet.js`. Artwork combines OpenMoji 16.0.0 (CC BY-SA 4.0) with original
  SVG illustrations in `images/alphabet/`; phrase recordings are in `audio/alphabet/`.
- Tap the large **Puzzle** tab in the header to open **Animal Puzzle**; tap the
  large **Sounds** tab to return. Swipe navigation is deliberately disabled so
  dragging a puzzle piece cannot accidentally change pages. When six labeled
  tabs do not fit in one row, as on a phone, the tabs show their pictures only
  (the labels remain for screen readers). The title and **Today** timer sit in
  the top grip band, where they take no room from the pages.
  Each round cuts an animal picture, on a sky-and-meadow backdrop, into a
  3×3 jigsaw. Every inner cut has one interlocking knob, the outer edges are
  flat, and the cuts change every round (`jigsaw.js`). The board shows a faint
  copy of the picture with each piece's dashed outline, and spans the screen
  less an 8 px margin. The mixed-up pieces lie in a tray below it, smaller than
  on the board, sized by `Jigsaw.fitLayout()` to fill the height that is left.
  The board gives up width only if tray pieces would otherwise drop below
  48 px. A piece grows to its real size around the finger when picked up and
  goes back to its tray size wherever it is put down. Pieces never rotate, so
  each shape fits only its own spot. A piece
  seats where its own center is released, not where the finger is, so it can
  be carried by a knob. It slides the last bit into place with a soft click,
  and seated neighbors join into one seamless picture. Only a piece's shape,
  plus a fingertip's margin, can be grabbed, so a loose piece's empty corners
  never block another piece. A star, particles, and chime celebrate a
  completed puzzle. Once the chime fades (0.7 s), the animal's name plays in
  Randy's voice, the same recording its tile uses, and a new randomized round
  appears 4.2 s after completion. Leaving the tab, a screen-time lock, or
  hiding the app before then cancels the name. The puzzle stays fixed in the
  viewport; it does not scroll.
  Several fingers can drag several pieces at once, and each piece keeps
  tracking its own finger; a second finger cannot take a piece that is already
  being carried. A contact does not own a piece until it moves with drag intent,
  so a stationary palm, belly, or extra finger cannot block the fingers doing
  the puzzle. Pieces remain where they are released until moved again or placed
  in their matching spot. A piece left over a spot it does not match stays there,
  shakes slightly, and glows faint red for under a second.
- The Puzzle tab stays in portrait when the device turns. It requests a native
  orientation lock where supported, and counter-rotates its play surface in
  kiosk WebViews that reject the lock. Piece sizes and completed slots stay
  intact; rotating during a drag releases the piece safely. Returning to Sounds
  restores the browser's normal orientation.
- Touch input is arbitrated one intentional pointer at a time. Animal taps must
  be brief, stationary fingertip-sized contacts; simultaneous candidates are
  considered together for 90 ms and only the best candidate is committed.
  Long holds, broad contacts (when the WebView reports contact geometry),
  canceled pointers, and every non-winning contact are ignored. Mouse,
  keyboard, and assistive-technology activation continue to use native clicks.
- Every page has a 48 px grip band along all four screen edges (`--safe-edge`
  in `style.css`). Touches that start there do nothing: no taps, puzzle drags,
  page swipes, or waking the dimmed screen. Page content is inset to stay clear
  of it, scrolling tiles pass beneath it, loose puzzle pieces are kept out of
  it, and the video's hold-to-close button sits inside it. The puzzle board may
  reach under it, because the board takes no touches and pieces seat by their
  own center. A hand resting in the
  band does not stop the other hand from tapping or scrolling.
- Playback uses the official YouTube IFrame API. An invisible "tap shield"
  covers the video so little fingers can't pause it, open related videos, or
  click through to YouTube.
- The video auto-returns to the grid when it ends, errors, or never starts
  (watchdog timeout).
- Each video plays once. Looping is explicitly disabled, and the app also
  checks playback progress in case YouTube misses the end event or restarts a
  short. A fixed timeout allows the clip's duration plus 30 seconds for
  buffering. An absolute four-minute maximum also covers unavailable metadata.
- Parent escape hatch: **hold the ✕ in the top-right corner for about 1.2
  seconds** (`HOLD_MS` in app.js) while a video is playing. Quick taps do
  nothing.
- Screen time is limited to **15 active minutes per session** and **one active
  hour per local calendar day**. Each session break lasts **three hours**;
  after the fourth session reaches the daily hour, it stays locked until
  tomorrow. Usage and
  the current lock persist across page reloads, and hidden tabs do not count
  toward usage.
- Screen time starts only after an animal-tile tap or a moved puzzle piece.
  After 45 seconds without either, the app dims and pauses the clock. The next
  tap only wakes the app; a following tile tap or puzzle move resumes counting.
  The whole wake gesture is consumed, including extra fingers, swipes, and
  delayed clicks, so it cannot activate controls behind the dimming layer.
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
  hidden; require **15 taps within 1.5 seconds**, then require the PIN. Do not
  use **Tap Anywhere**: ordinary tile taps can satisfy it.
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
- [ ] Rest a palm or belly on one or more tiles, lift it, and verify no animal
      opens; while it remains down, tap an animal with one fingertip and verify
      only that animal opens.
- [ ] Rest one or more fingers on puzzle pieces, then drag a different piece;
      the moving finger must own the piece and the resting contacts must do
      nothing when lifted.
- [ ] Drag two puzzle pieces at once with two fingers; each must follow its
      own finger, and lifting one must not drop the other.
- [ ] Carry a piece by one of its knobs and let go with the piece over its
      spot; it must slide in with a click and line up with its neighbors.
- [ ] Leave a piece on a slot it does not match; it must stay there, shake
      slightly, and fade out a faint red glow.
- [ ] Hold the tablet with thumbs on the screen edges on every tab; nothing
      should tap, drag, or scroll, and the other hand should still tap and
      scroll normally.
- [ ] Start an upward swipe on an animal tile — the grid must scroll instead
      of opening that tile.
- [ ] Verify that repeated taps on tiles do not open FreeKiosk settings; only
      the hidden fixed-corner gesture plus the PIN should do so.

## Local development

Run the touch-input and playback regression checks with `node --test tests/*.test.js`.

With Playwright and Chrome available, run `node tests/browser-orientation.cjs`
against the local server below, or pass a deployed URL as its first argument.
`PLAYWRIGHT_MODULE` can point to an existing Playwright installation. This
checks both landscape directions, loose-piece dragging, rotation during a
drag, puzzle completion, return navigation, and the touch-input checks.
Run `node tests/browser-wake.cjs` with the same setup to check that dim-screen
taps, multi-touch, swipes, and delayed clicks only wake the app, while the next
gesture works normally.
Run `node tests/browser-jigsaw.cjs` with the same setup to check that only a
piece's shape can be grabbed, that a piece carried by a knob seats by its
center and slides home, and that a finished puzzle shows no backdrop through
its cuts. The gap check first proves it can see a piece moved 6 px. It also
logs every recording's play, pause and end to check that the animal's name
plays once after the chime, in full, with no browser-speech fallback. Set
`VIEWPORT=412x800` to run it at phone size.
Run `node tests/browser-puzzle-layout.cjs` with the same setup to check the
puzzle on three phone sizes, a sideways phone, and the tablet: one row of tabs,
a board spanning the screen less 8 px, tray pieces clear of the grip band, and
pieces that grow when picked up and shrink back where they are put down.
`node --test tests/*.test.js` includes the cut geometry: shared cuts, flat
borders, knob size, and that every knob's head is wider than its neck. It also
sweeps the layout solver across screen sizes.
Run `node tests/browser-multitouch.cjs` with the same setup to drag two pieces
at once with real touch input in portrait and landscape, lift one finger while
the other keeps dragging, and measure the wrong-slot shake and glow frame by
frame.
Run `node tests/browser-safe-area.cjs` with the same setup to check the grip
band on every page: edge taps, swipes, drags, and wake taps do nothing, while
tiles just inside it, a second hand's taps and scrolls, and puzzle drags still
work in both orientations.

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

## Lessons and alphabet speech

Lessons contains **Chicken Wing** and **Wash Hands**. Tapping a card plays its
recorded name and animates its illustration inline for five seconds. Tapping
again restarts it. No additional screen, captions, timers, or controls appear.
Leaving the tab, hiding the app, or reaching a screen-time limit stops it.
Reduced-motion settings keep the instructional poses without repetitive motion.
Chicken Wing uses a front-facing child in matching long sleeves, a connected
shoulder/elbow/wrist chain, and a bent arm crossing the chest to the mouth.
Wash Hands is a condensed visual demonstration of wetting, soap, scrubbing,
rinsing and drying, not a timer for actual handwashing.

Alphabet recordings use explicit American letter names from
`alphabet-pronunciations.json`, including **Why** and **Zee**. Each group stores
its `spokenLetter` for browser speech fallback, which also selects `en-US`.
The refreshed `-us.mp3` filenames prevent cached older recordings from playing.
Display labels remain unchanged, such as `Yy Yak` and `Zz Zebra`.

Lesson audio uses one local five-second track per card, combining the spoken
name with synchronized effects. Chicken Wing coughs at 1.8 and 2.6 seconds;
Wash Hands runs water during wetting and rinsing and bubbles during scrubbing.
The animation follows the audio clock when playback is available. Leaving,
restarting, idle dimming, or a time limit stops the complete track.

The cough is trimmed from [Cough 2 by ezwa](https://commons.wikimedia.org/wiki/File:Cough_2.ogg),
released into the public domain. Water and bubbles are synthesized locally.
`scripts/build-lesson-audio.py` rebuilds the mixes with numpy, scipy, and ffmpeg.

Alphabet Banana's current recording uses `eleven_flash_v2` with the explicit
CMU phonemes `B AA0 N AE1 N AH0`, placing primary stress on the Apple vowel
in the middle syllable. Its versioned filename is `b-banana-us-v3.mp3`.
Chicken Wing's initial and reset artwork use the same rest pose as animation
completion, so switching to Wash Hands cannot restore the coughing pose.
