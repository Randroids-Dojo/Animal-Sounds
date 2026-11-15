"""Record the goldfish's lines (fish-talk.js) in Randy's voice.

Run with the ChannelKnowledgeBase venv, which has the ElevenLabs key, numpy
and mlx_whisper:

    ../ChannelKnowledgeBase/.venv/bin/python scripts/build-fish-voice.py [ids...]

With no ids it records only lines whose file is missing. Each line gets two
takes (up to four if Whisper mishears both). It keeps a take Whisper heard
correctly whose pitch is closest to the existing name recordings (about
107 Hz), as the robot names were chosen.
"""
from pathlib import Path
import difflib, json, re, shutil, subprocess, sys, tempfile
import numpy as np
import mlx_whisper

ROOT = Path(__file__).resolve().parents[1]
CKB = ROOT.parent / "ChannelKnowledgeBase"
TARGET_HZ = 107


def lines():
    out = subprocess.run(["node", "-e", 'console.log(JSON.stringify(require("./fish-talk.js").all()))'],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return [line for line in json.loads(out) if line["audio"].startswith("audio/fish/")]


def samples(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32)


def pitch(x, rate=16000):
    found, size = [], 640
    for start in range(0, len(x) - size, 320):
        frame = x[start:start + size]
        if np.sqrt((frame ** 2).mean()) < 0.03:
            continue
        frame = frame - frame.mean()
        corr = np.correlate(frame, frame, "full")[size - 1:]
        low, high = int(rate / 300), int(rate / 70)
        lag = low + int(np.argmax(corr[low:high]))
        if corr[lag] > 0.3 * corr[0]:
            found.append(rate / lag)
    return float(np.median(found)) if found else 0.0


NUMBERS = "zero one two three four five six seven eight nine ten eleven".split()


def words(text):
    # Whisper writes some numbers as digits ("10 months").
    text = re.sub(r"\d+", lambda match: NUMBERS[int(match.group())] if int(match.group()) < len(NUMBERS) else match.group(), text)
    return re.sub(r"[^a-z ]", "", text.lower().replace("-", " ")).split()


def heard_right(path, text):
    heard = mlx_whisper.transcribe(str(path), path_or_hf_repo="mlx-community/whisper-large-v3-turbo")["text"]
    score = difflib.SequenceMatcher(None, words(heard), words(text)).ratio()
    return score >= 0.95, heard.strip()


def record(line, folder):
    takes = []
    for take in range(1, 5):
        path = folder / f"{line['id']}-{take}.mp3"
        subprocess.run([str(CKB / ".venv/bin/python"), "pipeline/say.py", "--voice-id-env", "ELEVENLABS_RANDY_VOICE_ID",
                        "--text", line["text"], "-o", str(path)], cwd=CKB, check=True, capture_output=True)
        right, heard = heard_right(path, line["text"])
        hz = pitch(samples(path))
        print(f"  take {take}: {hz:5.1f} Hz {'ok ' if right else 'BAD'} {heard!r}", flush=True)
        if right:
            takes.append((abs(hz - TARGET_HZ), path))
        if take >= 2 and takes:
            break
    if not takes:
        raise SystemExit(f"No take of {line['id']} was heard right")
    best = min(takes)[1]
    destination = ROOT / line["audio"]
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(best, destination)


def main():
    wanted = set(sys.argv[1:])
    every = lines()
    if wanted:
        todo = [line for line in every if line["id"] in wanted]
    else:
        todo = [line for line in every if not (ROOT / line["audio"]).exists()]
    print(f"Recording {len(todo)} lines", flush=True)
    with tempfile.TemporaryDirectory() as tmp:
        for line in todo:
            print(f"{line['id']}: {line['text']}", flush=True)
            record(line, Path(tmp))


if __name__ == "__main__":
    main()
