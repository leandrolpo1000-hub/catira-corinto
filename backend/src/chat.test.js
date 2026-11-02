const assert = require('assert');
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { authOptional, signToken } = require('./middleware');
const { conversationKey } = require('./helpers');
const socialRouter = require('./routes/social');

function user(email) {
  return db.findOne('users', (u) => u.email === email);
}

async function run() {
  const joao = user('joao@email.com');
  const maria = user('maria@email.com');
  const ana = user('ana@email.com');
  assert.ok(joao && maria && ana, 'usuários demo');

  const listing = db.findOne('listings', (l) => l.userId === maria.id && l.status === 'published');
  assert.ok(listing, 'anúncio publicado da Maria');

  const conv = db.insert('conversations', {
    key: conversationKey(joao.id, maria.id, listing.id),
    listingId: listing.id,
    buyerId: joao.id,
    sellerId: maria.id,
    lastMessage: '',
    lastAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });
  const fromMaria = db.insert('messages', {
    conversationId: conv.id,
    senderId: maria.id,
    receiverId: joao.id,
    listingId: listing.id,
    text: '[TESTE] ainda está disponível?',
    replyToId: null,
    createdAt: new Date().toISOString(),
    read: false,
    deleted: false,
    deletedFor: [],
  });

  const app = express();
  app.use(express.json());
  app.use(authOptional);
  app.use('/api', socialRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const tokens = { joao: signToken(joao), maria: signToken(maria), ana: signToken(ana) };
  const createdFiles = [];
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  async function call(who, path, opts = {}) {
    const res = await fetch(base + path, {
      ...opts,
      headers: {
        Authorization: `Bearer ${tokens[who]}`,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  try {
    const list = await call('joao', '/api/conversations');
    assert.strictEqual(list.status, 200);
    const mine = list.body.items.find((c) => c.id === conv.id);
    assert.ok(mine, 'conversa aparece na lista');
    assert.strictEqual(mine.unread, 1, 'uma mensagem não lida');

    const detail = await call('joao', '/api/conversations/' + conv.id);
    assert.strictEqual(detail.status, 200);
    assert.strictEqual(detail.body.messages.length, 1);
    assert.strictEqual(detail.body.messages[0].mine, false);
    assert.strictEqual(detail.body.messages[0].text, fromMaria.text);
    assert.strictEqual(db.findById('messages', fromMaria.id).read, true, 'abrir marca como lida');

    const afterRead = await call('joao', '/api/conversations');
    assert.strictEqual(afterRead.body.items.find((c) => c.id === conv.id).unread, 0);

    const sent = await call('joao', '/api/conversations/' + conv.id + '/messages', {
      method: 'POST',
      body: JSON.stringify({ text: '[TESTE] eu tenho interesse', replyToId: fromMaria.id }),
    });
    assert.strictEqual(sent.status, 201);
    assert.strictEqual(sent.body.replyToId, fromMaria.id);

    const withReply = await call('maria', '/api/conversations/' + conv.id);
    const replyView = withReply.body.messages.find((m) => m.id === sent.body.id);
    assert.ok(replyView.replyTo, 'mensagem respondida carrega a citação');
    assert.strictEqual(replyView.replyTo.text, fromMaria.text);

    const reacted = await call('maria', '/api/conversations/' + conv.id + '/messages/' + sent.body.id + '/reaction', {
      method: 'POST',
      body: JSON.stringify({ emoji: '❤️' }),
    });
    assert.strictEqual(reacted.status, 200);
    assert.deepStrictEqual(reacted.body.message.reactions, ['❤️']);

    const unreacted = await call('maria', '/api/conversations/' + conv.id + '/messages/' + sent.body.id + '/reaction', {
      method: 'POST',
      body: JSON.stringify({ emoji: '❤️' }),
    });
    assert.deepStrictEqual(unreacted.body.message.reactions, [], 'mesmo emoji remove a reação');

    const starred = await call('maria', '/api/conversations/' + conv.id + '/messages/' + sent.body.id + '/star', {
      method: 'POST',
    });
    assert.strictEqual(starred.body.starred, true);
    const unstarred = await call('maria', '/api/conversations/' + conv.id + '/messages/' + sent.body.id + '/star', {
      method: 'POST',
    });
    assert.strictEqual(unstarred.body.starred, false);

    // Envio de foto e áudio (multipart) com legenda e duração.
    async function upload(who, file, fields) {
      const form = new FormData();
      form.append('file', file);
      Object.entries(fields || {}).forEach(([k, v]) => form.append(k, v));
      const res = await fetch(base + '/api/conversations/' + conv.id + '/messages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens[who]}` },
        body: form,
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    }

    const photo = new File([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], 'foto.jpg', { type: 'image/jpeg' });
    const imageSent = await upload('joao', photo, { text: '[TESTE] foto do item' });
    assert.strictEqual(imageSent.status, 201);
    assert.strictEqual(imageSent.body.kind, 'image');
    assert.ok(imageSent.body.fileUrl.startsWith('/uploads/chat-img-'));
    createdFiles.push(imageSent.body.fileUrl);
    assert.strictEqual(db.findById('conversations', conv.id).lastMessage, '[Foto] [TESTE] foto do item');

    const audio = new File([Buffer.from([0x1a, 0x45, 0xdf, 0xa3])], 'audio.webm', { type: 'audio/webm' });
    const audioSent = await upload('joao', audio, { duration: '7' });
    assert.strictEqual(audioSent.status, 201);
    assert.strictEqual(audioSent.body.kind, 'audio');
    assert.strictEqual(audioSent.body.duration, 7);
    createdFiles.push(audioSent.body.fileUrl);
    assert.strictEqual(db.findById('conversations', conv.id).lastMessage, '[Áudio]');

    const seenByMaria = await call('maria', '/api/conversations/' + conv.id);
    const imageView = seenByMaria.body.messages.find((m) => m.id === imageSent.body.id);
    assert.strictEqual(imageView.kind, 'image');
    assert.strictEqual(imageView.text, '[TESTE] foto do item');
    const audioView = seenByMaria.body.messages.find((m) => m.id === audioSent.body.id);
    assert.strictEqual(audioView.duration, 7);

    const badType = await upload('joao', new File([Buffer.from('x')], 'a.txt', { type: 'text/plain' }), {});
    assert.strictEqual(badType.status, 400, 'rejeita arquivo que não é foto nem áudio');

    const forbidden = await call('ana', '/api/conversations/' + conv.id);
    assert.strictEqual(forbidden.status, 403, 'quem não participa não acessa');

    const forAllByOther = await call('maria', '/api/conversations/' + conv.id + '/messages/' + sent.body.id + '?forAll=1', {
      method: 'DELETE',
    });
    assert.strictEqual(forAllByOther.status, 403, 'só o autor apaga para todos');

    const hidden = await call('joao', '/api/conversations/' + conv.id + '/messages/' + sent.body.id + '?forAll=0', {
      method: 'DELETE',
    });
    assert.strictEqual(hidden.status, 200);
    assert.strictEqual(hidden.body.message, null);
    const stillThere = await call('maria', '/api/conversations/' + conv.id);
    assert.ok(stillThere.body.messages.some((m) => m.id === sent.body.id), 'apagar para mim não some para o outro');

    const deleteOther = await call('joao', '/api/conversations/' + conv.id + '/messages/' + fromMaria.id + '?forAll=1', {
      method: 'DELETE',
    });
    assert.strictEqual(deleteOther.status, 403, 'destinatário não apaga mensagem do outro para todos');

    const deleteOwn = await call('joao', '/api/conversations/' + conv.id + '/messages/' + sent.body.id + '?forAll=1', {
      method: 'DELETE',
    });
    assert.strictEqual(deleteOwn.status, 200);
    assert.strictEqual(deleteOwn.body.forAll, true);
    assert.strictEqual(db.findById('messages', sent.body.id).deleted, true);
    assert.strictEqual(db.findById('conversations', conv.id).lastMessage, '[Áudio]');
  } finally {
    server.close();
    db.findWhere('messageReactions', (r) => r.conversationId === conv.id).forEach((r) => db.remove('messageReactions', r.id));
    db.findWhere('messageStars', (r) => r.conversationId === conv.id).forEach((r) => db.remove('messageStars', r.id));
    db.findWhere('messages', (m) => m.conversationId === conv.id).forEach((m) => db.remove('messages', m.id));
    db.remove('conversations', conv.id);
    createdFiles.forEach((url) => {
      try { fs.unlinkSync(path.join(uploadsDir, path.basename(url))); } catch {}
    });
  }
}

run()
  .then(() => {
    console.log('OK chat tests');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })

