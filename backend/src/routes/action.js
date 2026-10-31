const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { randomUUID } = require('crypto');
const { authRequired, authOptional, adminRequired } = require('../middleware');
const action = require('../action');

const router = express.Router();
const adminRouter = express.Router();
adminRouter.use(adminRequired);

const UPLOADS = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

const AUDIO_MAX = 8 * 1024 * 1024;

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').slice(0, 8) || (action.isAudioFile(file) ? '.webm' : '.jpg');
      const prefix = action.isAudioFile(file) ? 'acao-audio-' : 'acao-';
      cb(null, prefix + randomUUID() + ext);
    },
  }),
  limits: { fileSize: AUDIO_MAX, files: action.MAX_PHOTOS + 1 },
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype)) return cb(null, true);
    if (action.isAudioFile(file)) return cb(null, true);
    cb(new Error('Envie apenas fotos ou um áudio.'));
  },
});

function sendErr(res, e) {
  const status = e.status || 400;
  const body = { error: e.message || 'Algo deu errado.' };
  if (e.emailVerifyRequired) body.emailVerifyRequired = true;
  return res.status(status).json(body);
}

router.get('/', authOptional, (req, res) => {
  res.json(action.listPublished({
    userId: req.query.userId,
    page: req.query.page,
    limit: req.query.limit,
  }));
});

router.get('/eligible', authRequired, (req, res) => {
  res.json({ items: action.eligibleListings(req.user) });
});

function receivePostFiles(req, res, next) {
  upload.fields([
    { name: 'photos', maxCount: action.MAX_PHOTOS },
    { name: 'audio', maxCount: 1 },
  ])(req, res, (err) => {
    if (!err) return next();
    let message = err.message || 'Falha no envio do arquivo.';
    if (err.code === 'LIMIT_FILE_SIZE') message = 'Cada arquivo pode ter no máximo 8 MB.';
    if (err.code === 'LIMIT_UNEXPECTED_FILE') message = 'Envie no máximo um áudio e até 8 fotos.';
    const e = new Error(message);
    e.status = 400;
    return sendErr(res, e);
  });
}

router.post('/', authRequired, receivePostFiles, async (req, res) => {
  try {
    const files = (req.files && req.files.photos) || [];
    const audio = req.files && req.files.audio && req.files.audio[0];
    const post = await action.createPost(req.user, req.body || {}, files, audio);
    res.status(201).json(post);
  } catch (e) {
    sendErr(res, e);
  }
});

router.post('/transcribe', authRequired, (req, res, next) => {
  upload.single('audio')(req, res, (err) => {
    if (!err) return next();
    const e = new Error(err.code === 'LIMIT_FILE_SIZE' ? 'O áudio pode ter no máximo 8 MB.' : (err.message || 'Falha no envio do áudio.'));
    e.status = 400;
    return sendErr(res, e);
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie o áudio para transcrever.' });
    const { transcribeAudio } = require('../assistant');
    const raw = await transcribeAudio(req.file.path, req.file.originalname, req.file.mimetype);
    const text = action.validateTranscript(raw);
    res.json({ text });
  } catch (e) {
    sendErr(res, e);
  }
});

router.post('/:id/report', authRequired, (req, res) => {
  try {
    const b = req.body || {};
    const report = action.reportPost(req.user, req.params.id, b.reason, b.description);
    res.status(201).json(report);
  } catch (e) {
    sendErr(res, e);
  }
});

adminRouter.get('/', (req, res) => {
  res.json(action.listAdmin({ status: req.query.status }));
});

adminRouter.post('/:id/action', (req, res) => {
  try {
    const row = action.moderatePost(req.params.id, req.body && req.body.action);
    res.json(row);
  } catch (e) {
    sendErr(res, e);
  }
});

module.exports = { router, adminRouter };
