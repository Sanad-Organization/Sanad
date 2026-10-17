// Sentry on the server only, and only when a DSN is configured. Reports carry
// the error type and stack, never the message, request body, cookies, headers
// or user (bootstrap §9: no PII, no payloads, no error messages).
import type { Instrumentation } from 'next';

const dsn = process.env.SENTRY_DSN;

export async function register() {
  if (!dsn || process.env.NEXT_RUNTIME !== 'nodejs') return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? 'local',
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    // Sentry v11 collects users, cookies, headers, bodies, query params and
    // stack-frame variables by default. All of it is off.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    tracesSampleRate: 0,
    beforeBreadcrumb: () => null,
    beforeSend(event) {
      delete event.request;
      delete event.user;
      delete event.extra;
      delete event.contexts?.trace?.data;
      for (const ex of event.exception?.values ?? []) delete ex.value;
      delete event.message;
      return event;
    },
  });
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!dsn) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(...args);
};
