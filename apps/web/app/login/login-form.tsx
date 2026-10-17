'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Button, Field, Input, Notice } from '@sanad/ui';
import { sendMagicLink, type LoginState } from './actions';

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, { status: 'idle' });
  const sentRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.status === 'sent') sentRef.current?.focus();
  }, [state.status]);

  return (
    <>
      {/* Always mounted, so screen readers announce what appears in it. */}
      <div role="status" aria-live="polite">
        {state.status === 'sent' ? (
          <p ref={sentRef} tabIndex={-1} className="s-notice s-notice--success">
            If that address can sign in, a link is on its way. Check your inbox.
          </p>
        ) : null}
      </div>
      {state.status === 'sent' ? null : (
        <form action={action} noValidate>
          <input type="hidden" name="next" value={next} />
          {state.status === 'error' ? <Notice tone="danger">{state.message}</Notice> : null}
          <Field label="Work email" error={state.status === 'invalid' ? state.message : undefined}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                name="email"
                type="email"
                autoComplete="email"
                required
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            )}
          </Field>
          <Button type="submit" className="full-width" disabled={pending}>
            {pending ? 'Sending…' : 'Email me a sign-in link'}
          </Button>
        </form>
      )}
    </>
  );
}
