-- 장학금파인더 이용권 스키마 (Supabase SQL Editor에서 1회 실행)
-- 테이블/함수에 jf_ 접두사 — 기존 Supabase 프로젝트(askrank 등)에 같이 둬도 충돌 없음.

create table if not exists jf_credits (
  code text primary key,
  order_id text not null unique,
  payment_key text not null,
  amount integer not null,
  total integer not null,
  remaining integer not null,
  created_at timestamptz not null default now()
);

-- service_role 키로만 접근 (anon 정책 없음)
alter table jf_credits enable row level security;

-- 원자적 차감: 잔여 있으면 1 차감 후 남은 수 반환, 없으면 -1
create or replace function jf_use_credit(p_code text)
returns integer
language sql
security definer
as $$
  with upd as (
    update jf_credits
    set remaining = remaining - 1
    where code = p_code and remaining > 0
    returning remaining
  )
  select coalesce((select remaining from upd), -1);
$$;

-- 차감 복구 (생성 실패 시), total 한도 내에서만
create or replace function jf_refund_credit(p_code text)
returns void
language sql
security definer
as $$
  update jf_credits
  set remaining = remaining + 1
  where code = p_code and remaining < total;
$$;
