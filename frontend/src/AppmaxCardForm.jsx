import { useEffect, useRef } from 'react';
import { initAppmaxScripts, loadAppmaxScript, scriptUrlOf } from './appmax';

export default function AppmaxCardForm({
  visible = false,
  externalId = '',
  scriptUrl,
  env,
  onIp,
  onToken,
  onError,
}) {
  const onIpRef = useRef(onIp);
  const onTokenRef = useRef(onToken);
  const onErrorRef = useRef(onError);
  onIpRef.current = onIp;
  onTokenRef.current = onToken;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!externalId) return undefined;
    let cancelled = false;
    loadAppmaxScript(scriptUrl || scriptUrlOf(env)).then((sdk) => {
      if (cancelled || !sdk) return;
      try {
        initAppmaxScripts({
          sdk,
          externalId,
          onIp: (payload) => {
            const ip = payload && payload.ip ? payload.ip : payload;
            if (onIpRef.current) onIpRef.current(ip);
          },
          onTokenize: ({ token }) => {
            if (onTokenRef.current) onTokenRef.current(token);
          },
          onError: (err) => {
            if (onErrorRef.current) onErrorRef.current(err);
          },
        });
      } catch (err) {
        if (onErrorRef.current) onErrorRef.current(err);
      }
    }).catch((err) => {
      if (!cancelled && onErrorRef.current) onErrorRef.current(err);
    });
    return () => { cancelled = true; };
  }, [externalId, scriptUrl, env]);

  function onSubmit(e) {
    e.preventDefault();
  }

  return (
    <>
      <form data-appmax-customer hidden />
      <form
        data-appmax-checkout
        method="POST"
        onSubmit={onSubmit}
        className={visible ? '' : 'hidden'}
      >
        <input required name="card-number" placeholder="Número do cartão" inputMode="numeric" autoComplete="cc-number" />
        <input required name="card-holder-name" placeholder="Nome impresso no cartão" autoComplete="cc-name" />
        <input required name="exp-month" placeholder="MM" inputMode="numeric" autoComplete="cc-exp-month" />
        <input required name="exp-year" placeholder="AAAA" inputMode="numeric" autoComplete="cc-exp-year" />
        <input required name="cvv" placeholder="CVV" inputMode="numeric" autoComplete="cc-csc" />
        <button type="submit">Pagar com cartão</button>
      </form>
    </>
  );
}
