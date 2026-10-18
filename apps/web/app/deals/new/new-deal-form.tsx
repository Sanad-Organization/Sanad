'use client';

import { useActionState } from 'react';
import { Button, Field, Input, Notice, Select, Textarea } from '@sanad/ui';
import { MAX_GITHUB_URLS, ROUNDS, type DealField } from '@/lib/deal-form';
import { createDeal, type NewDealState } from './actions';

export function NewDealForm({ fundId, fundName }: { fundId: string; fundName: string }) {
  const [state, action, pending] = useActionState<NewDealState, FormData>(createDeal, { status: 'idle' });
  const errors = state.status === 'invalid' ? state.errors : {};
  const values = state.status === 'idle' ? undefined : state.values;
  const err = (f: DealField) => errors[f];
  // After a refusal because the fund changed, the next submit targets the fund now selected.
  const fund = (state.status === 'error' && state.fund) || { id: fundId, name: fundName };

  return (
    // Keyed by the returned values so the fields show what was typed after a refusal.
    <form action={action} noValidate key={JSON.stringify(values ?? {})}>
      <input type="hidden" name="fund_id" value={fund.id} />
      <p className="muted">Creating in {fund.name}</p>
      {state.status === 'error' ? <Notice tone="danger">{state.message}</Notice> : null}
      {state.status === 'invalid' ? (
        <Notice tone="danger">Some details are not valid. Check the highlighted fields.</Notice>
      ) : null}
      <Field label="Company name" error={err('company_name')}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            name="company_name"
            required
            maxLength={200}
            autoComplete="off"
            defaultValue={values?.company_name}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>
      <Field label="Website" hint="Optional. For example https://example.com" error={err('website')}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            name="website"
            type="url"
            inputMode="url"
            maxLength={500}
            defaultValue={values?.website}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>
      <Field label="Sector" hint="Optional. For example fintech or logistics" error={err('sector')}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            name="sector"
            maxLength={100}
            defaultValue={values?.sector}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>
      <Field label="Country" hint="Optional. Two-letter code, such as AE" error={err('country')}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            name="country"
            maxLength={2}
            autoComplete="off"
            defaultValue={values?.country}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>
      <Field label="Round" hint="Optional" error={err('round')}>
        {({ id, describedBy, invalid }) => (
          <Select
            id={id}
            name="round"
            defaultValue={values?.round ?? ''}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          >
            <option value="">Not set</option>
            {ROUNDS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label="GitHub repositories"
        hint={`Optional. Up to ${MAX_GITHUB_URLS}, one per line, like https://github.com/owner/repo`}
        error={err('github_urls')}
      >
        {({ id, describedBy, invalid }) => (
          <Textarea
            id={id}
            name="github_urls"
            rows={3}
            defaultValue={values?.github_urls}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create deal'}
      </Button>
    </form>
  );
}
