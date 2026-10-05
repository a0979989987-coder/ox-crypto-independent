-- LOCAL DESIGN DRAFT ONLY. Not a production migration; do not apply remotely.
-- Existing ox_accounts / ox_bitget_links are prerequisites, not recreated here.
create schema ox_review;
revoke all on schema ox_review from public,anon,authenticated;
create table ox_review.administrators (
  account_id uuid primary key references public.ox_accounts(id),
  active boolean not null default false
);
create table ox_review.approvals (
  id uuid primary key,
  account_id uuid not null references public.ox_accounts(id),
  uid text not null check (uid ~ '^[1-9][0-9]{0,19}$'),
  claim_revision uuid not null,
  version uuid not null,
  level text not null check (level in ('ordinary','core')),
  capabilities jsonb not null,
  policy_version text not null,
  source text not null default 'manual_approval' check(source = 'manual_approval'),
  ownership_verified boolean not null default false check(not ownership_verified),
  status text not null check(status in ('active','revoked','invalidated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Proposed: only one active manually-approved OX member per UID.
-- Pending claims remain non-unique and never reserve a UID.
create unique index ox_review_active_uid on ox_review.approvals(uid) where status='active';
create unique index ox_review_active_member on ox_review.approvals(account_id) where status='active';
create table ox_review.audit (
  sequence bigint generated always as identity primary key,
  actor_id uuid not null,
  action text not null check(action in ('approve','revoke','invalidate')),
  approval_id uuid not null references ox_review.approvals(id),
  reason text not null,
  detail jsonb not null,
  created_at timestamptz not null default now()
);
create table ox_review.batches (
  actor_id uuid not null, idempotency_key uuid not null, fingerprint text not null,
  result jsonb not null, created_at timestamptz not null default now(),
  primary key(actor_id,idempotency_key)
);
alter table ox_review.administrators enable row level security;
alter table ox_review.approvals enable row level security;
alter table ox_review.audit enable row level security;
alter table ox_review.batches enable row level security;
revoke all on all tables in schema ox_review from public,anon,authenticated;
revoke all on all sequences in schema ox_review from public,anon,authenticated;
-- No client grants, default-open policy, client admin bootstrap, or service key.
-- Production requires reviewed narrow JWT/RLS RPCs before any deployment.
