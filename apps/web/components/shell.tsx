import type { ReactNode } from 'react';
import { Button, Select } from '@sanad/ui';
import type { Session } from '@/lib/fund';
import { switchFund } from '@/app/deals/actions';

/** Header with the fund switcher (only when the user is in more than one fund) and sign-out. */
export function Shell({ session, children }: { session: Session; children: ReactNode }) {
  const current = session.current;
  return (
    <>
      <header className="shell-header">
        <a className="shell-brand" href="/deals">
          Sanad
        </a>
        <div className="shell-actions">
          {session.funds.length > 1 && current ? (
            <form action={switchFund} className="shell-inline-form">
              <label htmlFor="fund-switcher" className="visually-hidden">
                Fund
              </label>
              <Select id="fund-switcher" name="fund" defaultValue={current.fundId}>
                {session.funds.map((f) => (
                  <option key={f.fundId} value={f.fundId}>
                    {f.fundName}
                  </option>
                ))}
              </Select>
              <Button type="submit" variant="secondary">
                Switch
              </Button>
            </form>
          ) : current ? (
            <span>{current.fundName}</span>
          ) : null}
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="ghost">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className="shell-main">{children}</main>
    </>
  );
}
