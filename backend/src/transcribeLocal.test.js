const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { transcribeLocal, writeSilenceWav, MODEL } = require('./transcribeLocal');

async function run() {
  const missing = await transcribeLocal('/tmp/catira-no-such-audio.wav');
  assert.strictEqual(missing, '');

  const silent = path.join(__dirname, '..', 'data', 'silent-transcribe-test.wav');
  writeSilenceWav(silent, 0.4, 16000);
  const quiet = await transcribeLocal(silent);
  assert.strictEqual(typeof quiet, 'string');
  assert.strictEqual(quiet, '');

  assert.ok(fs.existsSync(MODEL), 'modelo vosk pt');

  console.log('OK transcribeLocal tests');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
