#!/usr/bin/env python3
import json
import sys
import wave

from vosk import KaldiRecognizer, Model, SetLogLevel

SetLogLevel(-1)

if len(sys.argv) < 3:
    sys.stderr.write("usage: transcribe_vosk.py <wav> <model>\n")
    sys.exit(1)

path, model_dir = sys.argv[1], sys.argv[2]
wf = wave.open(path, "rb")
if wf.getnchannels() != 1 or wf.getsampwidth() != 2:
    sys.stderr.write("wav must be 16-bit mono\n")
    sys.exit(1)

rec = KaldiRecognizer(Model(model_dir), wf.getframerate())
rec.SetWords(False)
while True:
    data = wf.readframes(4000)
    if not data:
        break
    rec.AcceptWaveform(data)
print(json.loads(rec.FinalResult()).get("text", ""), end="")
