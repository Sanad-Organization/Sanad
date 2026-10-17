'use client';

import { useActionState } from 'react';
import { Button, Field, Input, Notice } from '@sanad/ui';
import { sendMagicLink, type LoginState } from './actions';

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, { status: 'idle' });
  if (state.status === 'sent') {
    return <Notice tone="success">If that address can sign in, a link is on its way. Check your inbox.</Notice>;
  }
  return (
    <form action={action} noValidate>
      <input type="hidden" name="next" value={next} />
      {state.status === 'error' && state.message ? <Notice tone="danger">{state.message}</Notice> : null}
      <Field label="Work email" error={state.status === 'error' ? state.message : undefined}>
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
  );
}
