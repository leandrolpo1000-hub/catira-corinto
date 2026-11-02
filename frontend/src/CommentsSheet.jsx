import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './api';
import { Ico } from './icons';

const COMMENT_EMOJIS = ['❤️', '🙌', '🔥', '👏', '😢', '😍', '😮', '😂'];

function nestComments(rows) {
  const roots = [];
  const byId = {};
  (rows || []).forEach((c) => {
    byId[c.id] = { ...c, replies: [] };
  });
  (rows || []).forEach((c) => {
    if (c.parentId && byId[c.parentId]) byId[c.parentId].replies.push(byId[c.id]);
    else roots.push(byId[c.id]);
  });
  return roots;
}

function CommentRow({ comment, nested: isNested, user, isOwner, openReplies, setOpenReplies, startReply, remove, likeComment }) {
  const liked = !!comment.liked;
  const canDelete = user && (isOwner || comment.userId === user.id);
  const replies = comment.replies || [];
  const shown = openReplies[comment.id];
  return (
    <div className={'acao-cmt' + (isNested ? ' nested' : '')}>
      <span className="avatar sm" style={{ background: comment.author && comment.author.avatarColor }}>
        {((comment.author && comment.author.name) || '?').slice(0, 1)}
      </span>
      <div className="acao-cmt-body">
        <p>
          <strong>{comment.author ? comment.author.name : 'Alguém'}</strong>
          {' '}{comment.text}
        </p>
        <div className="acao-cmt-meta">
          <em>{comment.timeAgo}</em>
          {!!comment.likeCount && (
            <em>{comment.likeCount === 1 ? '1 curtida' : comment.likeCount + ' curtidas'}</em>
          )}
          <button type="button" onClick={() => startReply(comment)}>Responder</button>
          {canDelete && (
            <button type="button" onClick={() => remove(comment)}>Excluir</button>
          )}
        </div>
        {!!replies.length && (
          <button
            type="button"
            className="acao-cmt-more"
            onClick={() => setOpenReplies((s) => ({ ...s, [comment.id]: !shown }))}
          >
            {shown ? 'Ocultar respostas' : 'Ver respostas (' + replies.length + ')'}
          </button>
        )}
        {shown && replies.map((r) => (
          <CommentRow
            key={r.id}
            comment={r}
            nested
            user={user}
            isOwner={isOwner}
            openReplies={openReplies}
            setOpenReplies={setOpenReplies}
            startReply={startReply}
            remove={remove}
            likeComment={likeComment}
          />
        ))}
      </div>
      <button
        type="button"
        className={'acao-cmt-heart' + (liked ? ' on' : '')}
        onClick={() => likeComment(comment)}
        aria-label={liked ? 'Descurtir comentário' : 'Curtir comentário'}
        aria-pressed={liked}
      >
        <Ico name="heart" size={14} stroke={1.8} fill={liked ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
}

export function CommentsSheet({ subject, user, base, loginNext, onClose, onChange }) {
  const [items, setItems] = useState([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [openReplies, setOpenReplies] = useState({});
  const inputRef = useRef(null);
  const nav = useNavigate();
  const isOwner = user && subject.author && user.id === subject.author.id;
  const nested = nestComments(items);

  useEffect(() => {
    api(base + '/comments')
      .then((d) => setItems(d.items || []))
      .catch(() => setItems([]));
  }, [subject.id, base]);

  function patchItem(row) {
    setItems((prev) => prev.map((c) => (c.id === row.id ? { ...c, ...row } : c)));
  }

  async function send(e) {
    e.preventDefault();
    if (!user) {
      nav('/entrar?next=' + loginNext);
      return;
    }
    setErr('');
    setBusy(true);
    try {
      const row = await api(base + '/comments', {
        method: 'POST',
        body: JSON.stringify({ text, parentId: replyTo ? replyTo.id : undefined }),
      });
      setItems((prev) => prev.concat(row));
      setText('');
      setReplyTo(null);
      if (row.parentId) setOpenReplies((s) => ({ ...s, [row.parentId]: true }));
      onChange && onChange({ ...subject, commentCount: (subject.commentCount || 0) + 1 });
    } catch (ex) {
      setErr(ex.message);
    }
    setBusy(false);
  }

  async function likeComment(comment) {
    if (!user) {
      nav('/entrar?next=' + loginNext);
      return;
    }
    try {
      const row = await api(base + '/comments/' + comment.id + '/like', { method: 'POST' });
      patchItem(row);
    } catch (ex) {
      setErr(ex.message);
    }
  }

  async function remove(comment) {
    try {
      await api(base + '/comments/' + comment.id, { method: 'DELETE' });
      setItems((prev) => {
        const next = prev.filter((c) => c.id !== comment.id && c.parentId !== comment.id);
        onChange && onChange({ ...subject, commentCount: next.length });
        return next;
      });
    } catch (ex) {
      setErr(ex.message);
    }
  }

  function startReply(comment) {
    if (!user) {
      nav('/entrar?next=' + loginNext);
      return;
    }
    const name = comment.author && comment.author.name ? comment.author.name : '';
    setReplyTo(comment);
    setText(name ? '@' + name.replace(/\s+/g, '') + ' ' : '');
    setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
  }

  function addEmoji(emo) {
    setText((prev) => (prev + emo).slice(0, 240));
    if (inputRef.current) inputRef.current.focus();
  }

  return (
    <div className="modal-bg acao-sheet-bg" onClick={onClose}>
      <div className="acao-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="acao-sheet-bar" />
        <h3>Comentários</h3>
        <div className="acao-sheet-list">
          {!nested.length && <p className="hint">Seja o primeiro a comentar.</p>}
          {nested.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              user={user}
              isOwner={isOwner}
              openReplies={openReplies}
              setOpenReplies={setOpenReplies}
              startReply={startReply}
              remove={remove}
              likeComment={likeComment}
            />
          ))}
        </div>
        {err && <div className="error">{err}</div>}
        {replyTo && (
          <div className="acao-sheet-reply">
            <span>Respondendo a {replyTo.author ? replyTo.author.name : 'alguém'}</span>
            <button type="button" onClick={() => { setReplyTo(null); setText(''); }}>Cancelar</button>
          </div>
        )}
        <div className="acao-sheet-emos">
          {COMMENT_EMOJIS.map((emo) => (
            <button type="button" key={emo} onClick={() => addEmoji(emo)} aria-label={'Emoji ' + emo}>{emo}</button>
          ))}
        </div>
        <form className="acao-sheet-form" onSubmit={send}>
          <span className="avatar sm" style={{ background: user && user.avatarColor }}>
            {((user && user.name) || '?').slice(0, 1)}
          </span>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={240}
            placeholder={user ? 'Adicione um comentário...' : 'Entre para comentar'}
          />
          <button type="submit" className="acao-sheet-post" disabled={busy || !text.trim()}>
            Post
          </button>
        </form>
      </div>
    </div>
  );
}
