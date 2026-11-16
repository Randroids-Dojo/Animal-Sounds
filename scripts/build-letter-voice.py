"""Record the letter names the Words tab speaks (audio/letters/a.mp3 to z.mp3)
in Randy's voice, and check them.

Run with the ChannelKnowledgeBase venv, which has the ElevenLabs key, numpy
and mlx_whisper:

    ../ChannelKnowledgeBase/.venv/bin/python scripts/build-letter-voice.py record [letters...]
    ../ChannelKnowledgeBase/.venv/bin/python scripts/build-letter-voice.py check

record, with no letters, records only the missing ones. Each name is spoken
from its American pronunciation in CMU phonemes (eleven_flash_v2, as for
Alphabet's Banana): spelled-out text was read "uh" for A and "eye" for "Ay".
Takes are rendered until two pass: both Whisper models must hear the
right letter when the take sits between two other letters, both must hear
it on its own too, and the take must be short. Of those, it keeps the one
whose pitch is closest to the other name recordings (about 107 Hz). If ten
takes bring none that both models hear alone, a take one of them hears
alone will do. The kept take is trimmed so the name starts right away and
levelled to the other names.

Whisper alone is a noisy judge of one short syllable (a clear "ay" can come
back as "8" or "Hey"), and among other letters it is a lenient one (an
"eech" between letters still reads as H). So check uses both:
- each letter between two others, three different pairs, by two
  different Whisper models, every time;
- all 26 joined in four random orders, by both models, where each must be
  heard as the right letter at its place (the order is random, so Whisper
  cannot fill in the alphabet from memory);
- each letter on its own, by at least one of the models;
- its length, pitch and loudness beside the other recordings.
It exits non-zero if any letter fails.
"""
from pathlib import Path
import difflib, os, random, re, shutil, subprocess, sys, tempfile
import numpy as np
import mlx_whisper

ROOT = Path(__file__).resolve().parents[1]
CKB = ROOT.parent / "ChannelKnowledgeBase"
sys.path.insert(0, str(CKB / "pipeline"))
from common import load_env  # noqa: E402
from generate_elevenlabs_voiceover import DEFAULT_VOICE_SETTINGS, tts_segment  # noqa: E402
OUT = ROOT / "audio" / "letters"
RATE = 44100
TARGET_HZ = 107
# The other names' voiced loudness, measured over audio/*.mp3.
TARGET_DB = -17.8
MODELS = ["mlx-community/whisper-large-v3-turbo", "mlx-community/whisper-large-v3-mlx"]

# Each letter's American name in CMU phonemes.
PHONEMES = {
    "A": "EY1", "B": "B IY1", "C": "S IY1", "D": "D IY1", "E": "IY1", "F": "EH1 F", "G": "JH IY1",
    "H": "EY1 CH", "I": "AY1", "J": "JH EY1", "K": "K EY1", "L": "EH1 L", "M": "EH1 M", "N": "EH1 N",
    "O": "OW1", "P": "P IY1", "Q": "K Y UW1", "R": "AA1 R", "S": "EH1 S", "T": "T IY1", "U": "Y UW1",
    "V": "V IY1", "W": "D AH1 B AH0 L Y UW0", "X": "EH1 K S", "Y": "W AY1", "Z": "Z IY1",
}
MODEL = "eleven_flash_v2"
# A little slower than the voice's own pace, so a short name is not rushed.
SPEED = 0.85
# What Whisper may write for each letter's name: the letter, or a word that
# sounds the same. Nothing that sounds different (no "uh" for A, no "aye"
# for A, no "zed" for Z).
HEARD_AS = {
    "A": {"a", "ay"}, "B": {"b", "be", "bee"}, "C": {"c", "see", "sea", "si"}, "D": {"d", "dee"},
    "E": {"e", "ee"}, "F": {"f", "ef", "eff"}, "G": {"g", "gee", "jee"}, "H": {"h", "aitch", "haitch"},
    "I": {"i", "eye", "aye"}, "J": {"j", "jay"}, "K": {"k", "kay"}, "L": {"l", "el", "ell"},
    "M": {"m", "em"}, "N": {"n", "en"}, "O": {"o", "oh", "owe"}, "P": {"p", "pee", "pea"},
    "Q": {"q", "cue", "queue"}, "R": {"r", "are", "ar"}, "S": {"s", "es", "ess"}, "T": {"t", "tee", "tea"},
    "U": {"u", "you", "yu"}, "V": {"v", "vee"}, "W": {"w", "double you", "doubleyou", "double u"},
    "X": {"x", "ex"}, "Y": {"y", "why"}, "Z": {"z", "zee"},
}
# Seconds: long enough to be a name, short enough to be only the name.
SHORTEST = 0.3
LONGEST = {"W": 1.3}


def decode(path, rate=RATE):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(rate), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def encode(x, path):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(RATE), "-ac", "1", "-i", "-",
                    "-c:a", "libmp3lame", "-b:a", "128k", str(path)], input=x.astype(np.float32).tobytes(), check=True)


def envelope(x, rate=RATE):
    window = int(0.05 * rate)
    return np.sqrt(np.convolve(x ** 2, np.ones(window) / window, "same"))


def voiced(x, below_peak_db=28, rate=RATE):
    env = envelope(x, rate)
    return env > env.max() * 10 ** (-below_peak_db / 20)


def pitch(x, rate=RATE):
    x = decode_rate(x, rate, 16000)
    found, size = [], 640
    for start in range(0, len(x) - size, 320):
        frame = x[start:start + size]
        if np.sqrt((frame ** 2).mean()) < 0.03:
            continue
        frame = frame - frame.mean()
        corr = np.correlate(frame, frame, "full")[size - 1:]
        low, high = int(16000 / 300), int(16000 / 70)
        lag = low + int(np.argmax(corr[low:high]))
        if corr[lag] > 0.3 * corr[0]:
            found.append(16000 / lag)
    return float(np.median(found)) if found else 0.0


def decode_rate(x, rate, wanted):
    if rate == wanted:
        return x
    positions = np.arange(0, len(x), rate / wanted)
    return np.interp(positions, np.arange(len(x)), x).astype(np.float32)


def loudness(x):
    on = voiced(x)
    return 20 * np.log10(np.sqrt((x[on] ** 2).mean()) + 1e-9)


# The name starts 30 ms in and the clip ends 120 ms after it, so it follows
# the seating click at once. Then it is levelled to the other names, with
# its peak kept below -1 dB.
def finish(x):
    start_on = voiced(x, 28)
    end_on = voiced(x, 38)
    first = max(0, int(np.argmax(start_on)) - int(0.03 * RATE))
    last = min(len(x), len(x) - int(np.argmax(end_on[::-1])) + int(0.12 * RATE))
    x = x[first:last].copy()
    fade = int(0.01 * RATE)
    x[:fade] *= np.linspace(0, 1, fade)
    x[-fade:] *= np.linspace(1, 0, fade)
    gain = 10 ** ((TARGET_DB - loudness(x)) / 20)
    gain = min(gain, 10 ** (-1 / 20) / (np.abs(x).max() + 1e-9))
    return x * gain


def words(text):
    return re.sub(r"[^a-z ]", " ", text.lower()).split()


def transcribe(path, model):
    return mlx_whisper.transcribe(str(path), path_or_hf_repo=model, language="en")["text"].strip()


def heard_letter(text):
    """The letter a transcription names, or None if it is anything else."""
    said = " ".join(words(text))
    for letter, forms in HEARD_AS.items():
        if said in forms:
            return letter
    return None


def length_ok(letter, seconds):
    return SHORTEST <= seconds <= LONGEST.get(letter, 1.0)


def letters_in(text):
    """The letters a transcription names, in order; "double you" is one."""
    tokens = words(text)
    heard, index = [], 0
    while index < len(tokens):
        if index + 1 < len(tokens) and heard_letter(" ".join(tokens[index:index + 2])) == "W":
            heard.append("W")
            index += 2
            continue
        heard.append(heard_letter(tokens[index]) or f"?{tokens[index]}")
        index += 1
    return heard


GAP = np.zeros(int(0.7 * RATE), np.float32)


def in_context(x, before, after, folder, name):
    """What both models hear for x between two other letters' clips."""
    path = folder / f"{name}-context.mp3"
    encode(np.concatenate([before[1], GAP, x, GAP, after[1], GAP]), path)
    return [(letters_in(text), text) for text in (transcribe(path, model) for model in MODELS)]


def carriers(letter, count, rng):
    """Pairs of other letters already recorded, to put around a take."""
    others = [other for other in sorted(PHONEMES) if other != letter and (OUT / f"{other.lower()}.mp3").exists()]
    if len(others) < 2:
        raise SystemExit("Record two letters first, e.g. B and W, to hear the others among")
    return [[(other, decode(OUT / f"{other.lower()}.mp3")) for other in rng.sample(others, 2)] for _ in range(count)]


def speak(letter, path):
    load_env()
    tts_segment(
        api_key=os.environ["ELEVENLABS_API_KEY"],
        voice_id=os.environ["ELEVENLABS_RANDY_VOICE_ID"],
        model_id=MODEL,
        text=f'<phoneme alphabet="cmu-arpabet" ph="{PHONEMES[letter]}">{letter}</phoneme>.',
        output_path=path,
        timeout=90,
        voice_settings={**DEFAULT_VOICE_SETTINGS, "speed": SPEED},
    )


def record(letter, folder):
    keep, near = [], []
    rng = random.Random(letter)
    for take in range(1, 11):
        raw = folder / f"{letter}-{take}.mp3"
        speak(letter, raw)
        x = finish(decode(raw))
        seconds = len(x) / RATE
        hz = pitch(x)
        before, after = carriers(letter, 1, rng)[0]
        heard = in_context(x, before, after, folder, f"{letter}-{take}")
        shaped = folder / f"{letter}-{take}-final.mp3"
        encode(x, shaped)
        alone = [transcribe(shaped, model) for model in MODELS]
        alone_right = sum(heard_letter(text) == letter for text in alone)
        right = length_ok(letter, seconds) and all(found == [before[0], letter, after[0]] for found, _ in heard)
        verdict = "ok " if right and alone_right == 2 else "ok1" if right and alone_right == 1 else "BAD"
        print(f"  take {take} {seconds:4.2f} s {hz:5.1f} Hz {verdict} in context {[text for _, text in heard]} alone {alone}", flush=True)
        if right and alone_right == 2:
            keep.append((abs(hz - TARGET_HZ), take, shaped))
        elif right and alone_right == 1:
            near.append((abs(hz - TARGET_HZ), take, shaped))
        if len(keep) >= 2:
            break
    if not keep and not near:
        raise SystemExit(f"No take of {letter} was heard right")
    best = min(keep or near)[2]
    OUT.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(best, OUT / f"{letter.lower()}.mp3")


def check():
    letters = sorted(PHONEMES)
    clips = {letter: OUT / f"{letter.lower()}.mp3" for letter in letters}
    missing = [letter for letter, path in clips.items() if not path.exists()]
    if missing:
        raise SystemExit(f"Missing: {missing}")
    failures = {letter: [] for letter in letters}
    print("Each letter between two others (three pairs, two models), and alone for reference:")
    with tempfile.TemporaryDirectory() as tmp:
        for letter in letters:
            x = decode(clips[letter])
            seconds, hz, db = len(x) / RATE, pitch(x), loudness(x)
            wrong = []
            for before, after in carriers(letter, 3, random.Random(f"check-{letter}")):
                for found, text in in_context(x, before, after, Path(tmp), letter):
                    if found != [before[0], letter, after[0]]:
                        wrong.append(f"{before[0]}-{letter}-{after[0]} heard {text!r}")
            alone = [transcribe(clips[letter], model) for model in MODELS]
            failures[letter].extend(wrong)
            if not any(heard_letter(text) == letter for text in alone):
                failures[letter].append(f"alone heard {alone}")
            if not length_ok(letter, seconds):
                failures[letter].append(f"{seconds:.2f} s long")
            if not 85 <= hz <= 135:
                failures[letter].append(f"pitch {hz:.0f} Hz")
            if abs(db - TARGET_DB) > 2:
                failures[letter].append(f"loudness {db:.1f} dB")
            print(f"  {letter}: {seconds:4.2f} s {hz:5.1f} Hz {db:6.1f} dB  in context {6 - len(wrong)}/6"
                  f"  alone: {alone[0]!r} / {alone[1]!r}", flush=True)

    print("All 26 in random orders:")
    gap = np.zeros(int(0.7 * RATE), np.float32)
    decoded = {letter: decode(clips[letter]) for letter in letters}
    with tempfile.TemporaryDirectory() as tmp:
        for seed in range(4):
            order = letters[:]
            random.Random(seed).shuffle(order)
            joined = Path(tmp) / f"order-{seed}.mp3"
            encode(np.concatenate([part for letter in order for part in (decoded[letter], gap)]), joined)
            for model in MODELS:
                text = transcribe(joined, model)
                heard = letters_in(text)
                matcher = difflib.SequenceMatcher(None, order, heard, autojunk=False)
                matched = set()
                for block in matcher.get_matching_blocks():
                    matched.update(order[block.a:block.a + block.size])
                short = model.split("/")[-1].replace("whisper-", "")
                misses = [letter for letter in order if letter not in matched]
                for letter in misses:
                    failures[letter].append(f"in order {seed} by {short}")
                print(f"  order {seed} {''.join(order)} {short:16} {'all heard' if not misses else 'missed ' + ''.join(misses)}"
                      f"{'' if not misses else '  heard: ' + text}", flush=True)

    bad = {letter: reasons for letter, reasons in failures.items() if reasons}
    if bad:
        print("FAILED:")
        for letter, reasons in bad.items():
            print(f"  {letter}: {'; '.join(reasons)}")
        raise SystemExit(1)
    print("All 26 letters passed every check.")


def main():
    command, *rest = sys.argv[1:] or ["record"]
    if command == "check":
        check()
        return
    wanted = [letter.upper() for letter in rest] or [letter for letter in sorted(PHONEMES) if not (OUT / f"{letter.lower()}.mp3").exists()]
    print(f"Recording {len(wanted)} letters", flush=True)
    with tempfile.TemporaryDirectory() as tmp:
        for letter in wanted:
            print(f"{letter}:", flush=True)
            record(letter, Path(tmp))


if __name__ == "__main__":
    main()
