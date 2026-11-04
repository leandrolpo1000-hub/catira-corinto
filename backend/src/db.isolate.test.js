const assert = require('assert');
const path = require('path');

const db = require('./db');

function run() {
  assert.ok(
    db.SQLITE_FILE.includes('catira-test-'),
    'processo de teste não usa o sqlite de produção'
  );
  assert.ok(
    !db.SQLITE_FILE.endsWith(path.join('data', 'catira.sqlite')),
    'sqlite de teste fica fora de backend/data/catira.sqlite'
  );
  assert.ok(db.findOne('users', (u) => u.email === 'joao@email.com'), 'importa o json original só para leitura');
  db.close();
  console.log('db.isolate.test.js ok');
}

run();
