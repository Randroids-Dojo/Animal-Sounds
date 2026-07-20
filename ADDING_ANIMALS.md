# Adding a New Animal Tile

Follow these steps on the Mac whenever a new short is added to the
[Animal Sounds playlist](https://youtube.com/playlist?list=PLHO8AJ-73A6g).
The example below adds a **Zebra** with video `dQw4w9WgXcQ` — substitute your
animal and video ID throughout.

All commands run from the repo root: `~/Documents/Dev/Animal-Sounds`

## 1. Get the video ID

The ID is the part after `/shorts/` or `v=` in the video's URL. To see which
playlist videos aren't in the app yet:

```bash
./scripts/refresh-playlist.sh
```

## 2. Check the video allows embedding (30 seconds, saves headaches)

```bash
yt-dlp --no-download --print "%(playable_in_embed)s" "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

Must print `True`. If it prints `False`, the uploader disabled embedding and
the video **cannot be used** — find a different short of that animal.

## 3. Create the tile image

Tile art comes from [OpenMoji](https://openmoji.org). Search the animal there
and note the hexcode shown on its page (e.g. zebra = `1F993`), then:

```bash
curl -sfL "https://cdn.jsdelivr.net/npm/openmoji@latest/color/svg/1F993.svg" -o images/zebra.svg
```

The filename convention is the lowercase animal name, spaces as dashes
(`guinea-pig.svg`).

If OpenMoji has no glyph for the animal, either reuse the nearest species
(that's how ferret→otter and yak→bison work) or reuse `images/bird.svg` with
a `hue` value (step 5) to recolor it. Any SVG or PNG dropped into `images/`
works too.

## 4. Generate the voice clip (Randy saying the name)

```bash
cd audio && randysay --text "Zebra" -o zebra.mp3 && afplay zebra.mp3 && cd ..
```

- Filename: lowercase name, spaces as dashes (`guinea-pig.mp3`).
- `afplay` plays it back so you can check it sounds right; rerun the command
  to regenerate if it's weird.
- `randysay` is the alias in `~/.zshrc` for
  `ChannelKnowledgeBase/.venv/bin/python .../pipeline/say.py`.

## 5. Add the entry to animals.json

Add one object to the array — position in the array = position in the grid:

```json
{ "name": "Zebra", "videoId": "dQw4w9WgXcQ", "image": "images/zebra.svg" }
```

- `name` is what's shown on the tile AND decides which voice clip plays
  (`Zebra` → `audio/zebra.mp3`), so it must match the mp3 filename.
- Optional `"hue": 150` rotates the image's colors by that many degrees —
  used to make tiles that share `bird.svg` look different (see the
  woodpecker entries for examples).
- Duplicate animals are fine; give them the same `name` (see the two geese).

## 6. Test locally (optional but smart)

```bash
python3 -m http.server 8642
```

Open <http://localhost:8642> — the new tile should show its image, speak the
name in Randy's voice when tapped, play the video, and return to the grid
when it ends. Ctrl-C the server when done.

## 7. Commit and deploy

```bash
git add -A && git commit -m "Add zebra tile"
vercel deploy --prod --yes
```

## 8. Refresh the tablet

The kiosk keeps the old page loaded until it reloads. Easiest: hold the
tablet's power button and restart it — it boots straight back into the app
with the new tile. (Alternative: tap the screen 10× fast → PIN `1234` →
"Back to Kiosk", which also reloads the page.)
