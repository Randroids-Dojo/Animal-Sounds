#!/usr/bin/env bash
# Lists the current playlist videos so new additions can be spotted and
# added to animals.json by hand. Requires yt-dlp (brew install yt-dlp).
set -euo pipefail

PLAYLIST_URL="https://youtube.com/playlist?list=PLHO8AJ-73A6g"

echo "Videos currently in the playlist:"
echo
yt-dlp --flat-playlist --print "%(id)s | %(title)s" "$PLAYLIST_URL"

echo
echo "Video IDs already in animals.json:"
echo
grep -o '"videoId": "[^"]*"' "$(dirname "$0")/../animals.json" | cut -d'"' -f4
