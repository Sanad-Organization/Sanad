// Job kinds and their payload schemas. The database CHECK on app_jobs.jobs.kind
// is '^[a-z]+\.[a-z_]+$'; the worker fails an unknown kind permanently.
// Each kind has a JSON Schema in ../schemas/jobs/<kind>.json, read by the
// Python worker too (contract test in services/worker).

export const JOB_KINDS = [
  'deal.collect',
  'web.collect',
  'news.collect',
  'files.parse',
  'chunks.embed',
  'security.outside_in',
  'social.discover',
  'social.collect',
  'mentions.collect',
  'mentions.label',
  'social.analyze',
  'scan.repo',
  'github.revoke_expired',
  'claims.extract',
  'claims.check',
  'deal.analyze',
  'deal.score',
  'questions.draft',
  'verdict.export',
  'ops.sweep',
  'ops.reconcile',
] as const;

export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_KIND_PATTERN = /^[a-z]+\.[a-z_]+$/;
