const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const MODEL = path.join(__dirname, '..', 'data', 'vosk-model-small-pt-0.3');
const SCRIPT = path.join(__dirname, 'transcribe_vosk.py');

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('timeout'));
    }, timeoutMs || 60000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || ('exit ' + code)));
    });
  });
}

function writeSilenceWav(filePath, seconds, sampleRate) {
  const rate = sampleRate || 16000;
  const samples = Math.max(1, Math.round(rate * seconds));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + samples * 2, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples * 2, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, Buffer.alloc(samples * 2)]));
  return filePath;
}

async function toWav(input) {
  const wavPath = input.replace(/\.[^.]+$/, '') + '-16k.wav';
  await run('ffmpeg', ['-y', '-i', input, '-ac', '1', '-ar', '16000', '-f', 'wav', wavPath], 30000);
  return wavPath;
}

async function transcribeLocal(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  if (!fs.existsSync(MODEL) || !fs.existsSync(SCRIPT)) return '';
  let wav = filePath;
  if (path.extname(filePath).toLowerCase() !== '.wav') {
    try {
      wav = await toWav(filePath);
    } catch {
      return '';
    }
  }
  try {
    const out = await run('python3', [SCRIPT, wav, MODEL], 60000);
    return String(out || '').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

module.exports = { transcribeLocal, writeSilenceWav, MODEL };
