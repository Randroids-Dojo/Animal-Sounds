#!/usr/bin/env bash
# Shows playlist videos not yet in animals.json, and warns if any animal is
# missing its voice clip in audio/. Requires yt-dlp (brew install yt-dlp).
set -euo pipefail
cd "$(dirname "$0")/.."

PLAYLIST_URL="https://youtube.com/playlist?list=PLHO8AJ-73A6g"

yt-dlp --flat-playlist --print "%(id)s | %(title)s" "$PLAYLIST_URL" |
python3 -c '
import json, pathlib, sys

# Videos deliberately not in the app (uploader disabled embedding).
excluded = {"OevEJh1E5zk"}  # "Gimmie kiss!" parakeet

animals = json.load(open("animals.json"))
have = {a["videoId"] for a in animals} | excluded

print("Playlist videos not yet in animals.json:")
missing = [line for line in sys.stdin if line.split(" | ")[0].strip() not in have]
sys.stdout.write("".join("  " + m for m in missing) or "  (none — every video is in the app)\n")

print()
print("Voice clip check (audio/<name>.mp3, lowercase, spaces as dashes):")
slug = lambda name: name.lower().replace(" ", "-")
bad = sorted({a["name"] for a in animals
              if not pathlib.Path("audio", slug(a["name"]) + ".mp3").exists()})
sys.stdout.write("".join(f"  MISSING clip for {n}\n" for n in bad) or "  every animal has a voice clip\n")
'
