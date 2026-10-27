"""Build five-second lesson tracks. Requires numpy, scipy and ffmpeg."""
from pathlib import Path
import subprocess, tempfile
import numpy as np
from scipy.signal import butter, sosfilt
from scipy.io.wavfile import write

ROOT = Path(__file__).resolve().parents[1]
RATE = 44100
rng = np.random.default_rng(42)

def ff(*args):
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', *map(str,args)], check=True)

def fade(sound, duration=.035):
    n = min(round(duration*RATE), len(sound)//2)
    sound[:n] *= np.linspace(0,1,n)
    sound[-n:] *= np.linspace(1,0,n)
    return sound

# Filtered rushing water plus overlapping resonant droplets.
def water(duration):
    t = np.arange(round(duration*RATE))/RATE
    noise = sosfilt(butter(2,[450,6500],btype='bandpass',fs=RATE,output='sos'),rng.normal(size=len(t)))
    sound = .09 * noise * (1 + .12*np.sin(2*np.pi*19*t))
    for start in np.arange(0,duration-.04,.012):
        length = min(int(.06*RATE),len(t)-int(start*RATE))
        dt = np.arange(length)/RATE
        f = rng.uniform(700,2200)
        drop = .018*np.sin(2*np.pi*(f*dt-700*dt*dt))*np.exp(-dt*70)
        offset = int(start*RATE)
        sound[offset:offset+length] += drop
    return fade(sound)

wash = np.zeros(RATE*5)
wash[:int(.65*RATE)] += water(.65) * .65  # Keep the lesson name clear.
wash[int(3.5*RATE):int(4.2*RATE)] += water(.7)
length = int(2.4*RATE)
t = np.arange(length)/RATE
foam = .025*sosfilt(butter(2,[500,2800],btype='bandpass',fs=RATE,output='sos'),rng.normal(size=length))*(.5+.5*np.sin(2*np.pi*3*t)**2)
for start in np.arange(.02,2.28,.085):
    offset = int(start*RATE)
    dt = np.arange(min(int(.12*RATE),length-offset))/RATE
    f = rng.uniform(350,1100)
    pop = .12*np.sin(2*np.pi*f*(dt+2*dt*dt))*np.exp(-dt*35)*(1-np.exp(-dt*800))
    foam[offset:offset+len(pop)] += pop
wash[int(1.1*RATE):int(1.1*RATE)+length] += fade(foam)
with tempfile.TemporaryDirectory() as tmp:
    wav=Path(tmp)/'wash.wav'
    write(wav,RATE,(wash*32767).astype(np.int16))
    ff('-i',ROOT/'audio/wash-hands.mp3','-i',wav,'-filter_complex',
       '[0:a][1:a]amix=inputs=2:normalize=0,alimiter=limit=0.9,apad=whole_dur=5[out]',
       '-map','[out]','-t','5','-ar',RATE,'-ac','2','-b:a','128k',ROOT/'audio/lessons/wash-hands.mp3')
    ff('-i',ROOT/'audio/chicken-wing.mp3','-i',ROOT/'audio/lessons/cough-source.ogg','-filter_complex',
       '[1:a]atrim=start=0.41:end=1.01,asetpts=PTS-STARTPTS,highpass=f=180,lowpass=f=5000,volume=0.7,afade=t=out:st=0.5:d=0.1,asplit=2[c1][c2];[c1]adelay=1800:all=1[a];[c2]adelay=2600:all=1[b];[0:a][a][b]amix=inputs=3:normalize=0,alimiter=limit=0.9,apad=whole_dur=5[out]',
       '-map','[out]','-t','5','-ar',RATE,'-ac','2','-b:a','128k',ROOT/'audio/lessons/chicken-wing.mp3')
print('Built both five-second lesson tracks.')
