-- =====================================================================
--  명지전문대학 장학금 & 수당 계좌 등록(지급) · 학생용
--  Supabase 데이터베이스 설정 스크립트 (새로 설치 기준)
--
--  사용법: Supabase 대시보드 > SQL Editor > New query 에 이 파일 전체를
--          붙여넣고 [Run] 을 누릅니다. (여러 번 실행해도 안전합니다)
--
--  보안 원칙
--   · 학생(로그인 없음, anon) : 신청서 "추가"와 통장 사본 "업로드"만 가능
--                                조회·수정·삭제 불가 (본인 것도 불가)
--   · 같은 학번 하루 5회까지 신청 가능 (장난·대량 신청 방지)
--   · 사업·대회 목록은 관리자만 등록·수정, 학생은 "모집중"인 것만 보고 선택
--   · 관리자(로그인 + admins 등록): 조회, 상태 변경, 삭제, 첨부파일 열람
--   · 관리자 작업 기록(admin_logs): 추가·조회만 가능, 수정·삭제 불가
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 관리자 명단
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. 사업·대회 (관리자가 등록)
-- ---------------------------------------------------------------------
create or replace function public.kst_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Seoul')::date;
$$;
grant execute on function public.kst_today() to anon, authenticated;

create table if not exists public.programs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  pay_type   text not null check (pay_type in ('경진대회','기타')),
  start_date date,                         -- 비우면 즉시 모집
  end_date   date,                         -- 비우면 마감일 없음
  active     boolean not null default true, -- false = 관리자가 마감
  created_at timestamptz not null default now(),
  constraint program_dates check (start_date is null or end_date is null or start_date <= end_date)
);
alter table public.programs enable row level security;
revoke all on public.programs from anon, authenticated;
grant select on public.programs to anon, authenticated;
grant insert (name, pay_type, start_date, end_date, active),
      update (name, pay_type, start_date, end_date, active),
      delete
  on public.programs to authenticated;

-- 학생(누구나): 모집중인 것만 보임
drop policy if exists "programs_select_open" on public.programs;
create policy "programs_select_open" on public.programs
  for select to anon, authenticated
  using (active
         and (start_date is null or start_date <= (select public.kst_today()))
         and (end_date   is null or end_date   >= (select public.kst_today())));
-- 관리자: 전부 보임, 등록·수정·삭제
drop policy if exists "programs_select_admin" on public.programs;
create policy "programs_select_admin" on public.programs
  for select to authenticated using ((select public.is_admin()));
drop policy if exists "programs_insert_admin" on public.programs;
create policy "programs_insert_admin" on public.programs
  for insert to authenticated with check ((select public.is_admin()));
drop policy if exists "programs_update_admin" on public.programs;
create policy "programs_update_admin" on public.programs
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "programs_delete_admin" on public.programs;
create policy "programs_delete_admin" on public.programs
  for delete to authenticated using ((select public.is_admin()));

-- ---------------------------------------------------------------------
-- 3. 신청 내역
-- ---------------------------------------------------------------------
create table if not exists public.applications (
  id            uuid primary key default gen_random_uuid(),
  pay_type      text not null check (pay_type in ('경진대회','기타')),
  program_id    uuid references public.programs(id) on delete restrict,  -- 신청이 있는 사업은 삭제 불가(마감만)
  program       text check (program is null or char_length(program) <= 60), -- 신청 당시 사업명(서버가 자동 기록)
  stu_id        text not null check (stu_id ~ '^[0-9]{6,12}$'),
  name          text not null check (char_length(name) between 1 and 30),
  dept          text not null check (char_length(dept) between 1 and 60),
  grade         text check (grade is null or grade in ('','1','2','3','4')),
  phone         text not null check (phone ~ '^01[016789]-?[0-9]{3,4}-?[0-9]{4}$'),
  email         text check (email is null or email = '' or
                            (char_length(email) <= 100 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  bank          text not null check (char_length(bank) between 1 and 30),
  account       text not null check (account ~ '^[0-9-]{10,24}$'
                                     and char_length(regexp_replace(account, '[^0-9]', '', 'g')) between 10 and 16),
  holder        text not null check (char_length(holder) between 1 and 30),
  bank_doc_path text,
  agreed        boolean not null check (agreed),
  status        text not null default '접수' check (status in ('접수','확인완료','반려')),
  admin_memo    text check (admin_memo is null or char_length(admin_memo) <= 300),
  created_at    timestamptz not null default now(),

  -- 예금주는 본인 성명과 같아야 함(공백 무시)
  constraint holder_matches_name check (replace(holder, ' ', '') = replace(name, ' ', '')),
  -- 통장 사본 경로는 "신청ID/bankbook.확장자" 형식만 → 남의 파일을 가리킬 수 없음
  constraint bank_doc_path_format check (
    bank_doc_path is null or
    (bank_doc_path ~ '^[0-9a-f-]{36}/bankbook\.(jpg|png|pdf)$'
     and split_part(bank_doc_path, '/', 1) = id::text))
);
create index if not exists applications_stu_id_idx  on public.applications (stu_id);
create index if not exists applications_created_idx on public.applications (created_at desc);
create index if not exists applications_program_idx on public.applications (program_id);

alter table public.applications enable row level security;

-- 컬럼 단위 권한: 학생은 상태(status)·메모·신청일시·사업명(program)을 직접 넣을 수 없음
revoke all on public.applications from anon, authenticated;
grant insert (id, pay_type, program_id, stu_id, name, dept, grade, phone, email,
              bank, account, holder, bank_doc_path, agreed)
  on public.applications to anon, authenticated;
grant select, delete on public.applications to authenticated;
grant update (status, admin_memo) on public.applications to authenticated;

drop policy if exists "applications_insert_student" on public.applications;
drop policy if exists "applications_insert_anyone"  on public.applications;
create policy "applications_insert_anyone" on public.applications
  for insert to anon, authenticated
  with check (true);                       -- 형식 검사는 위 check 제약조건이 담당

drop policy if exists "applications_select_admin" on public.applications;
create policy "applications_select_admin" on public.applications
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "applications_update_admin" on public.applications;
create policy "applications_update_admin" on public.applications
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "applications_delete_admin" on public.applications;
create policy "applications_delete_admin" on public.applications
  for delete to authenticated using ((select public.is_admin()));

-- 사업·대회 확인 + 같은 학번 하루 신청 횟수 제한
create or replace function public.applications_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare p public.programs;
begin
  if new.program_id is not null then
    select * into p from public.programs where id = new.program_id;
    if not found or not (p.active
        and (p.start_date is null or p.start_date <= public.kst_today())
        and (p.end_date   is null or p.end_date   >= public.kst_today())) then
      raise exception 'PROGRAM_CLOSED' using errcode = 'P0001', hint = '모집중인 사업·대회가 아닙니다.';
    end if;
    if p.pay_type <> new.pay_type then
      raise exception 'PROGRAM_MISMATCH' using errcode = 'P0001', hint = '지급 구분과 사업·대회가 맞지 않습니다.';
    end if;
    new.program := p.name;                  -- 신청 당시 이름을 기록
  else
    new.program := null;
  end if;
  if (select count(*) from public.applications a
       where a.stu_id = new.stu_id and a.created_at > now() - interval '1 day') >= 5 then
    raise exception 'TOO_MANY' using errcode = 'P0001',
      hint = '같은 학번으로 하루 5회까지 신청할 수 있습니다.';
  end if;
  return new;
end $$;
revoke all on function public.applications_guard() from public;
drop trigger if exists applications_guard on public.applications;
create trigger applications_guard before insert on public.applications
  for each row execute function public.applications_guard();

-- 이전 버전(이메일 인증)에서 만든 함수가 있으면 정리
drop function if exists public.my_applications();
drop function if exists public.email_allowed();

-- ---------------------------------------------------------------------
-- 4. 관리자 작업 기록 (추가·조회만 가능 → 지우거나 고칠 수 없음)
-- ---------------------------------------------------------------------
create table if not exists public.admin_logs (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  admin_id    uuid not null default auth.uid(),
  admin_email text default (auth.jwt() ->> 'email'),
  action      text not null check (char_length(action) between 1 and 50),
  detail      text check (detail is null or char_length(detail) <= 300)
);
alter table public.admin_logs enable row level security;
revoke all on public.admin_logs from anon, authenticated;
grant insert (action, detail) on public.admin_logs to authenticated;
grant select on public.admin_logs to authenticated;

drop policy if exists "admin_logs_insert_admin" on public.admin_logs;
create policy "admin_logs_insert_admin" on public.admin_logs
  for insert to authenticated
  with check ((select public.is_admin()) and admin_id = (select auth.uid()));

drop policy if exists "admin_logs_select_admin" on public.admin_logs;
create policy "admin_logs_select_admin" on public.admin_logs
  for select to authenticated using ((select public.is_admin()));

-- ---------------------------------------------------------------------
-- 5. 통장 사본 저장소 (비공개)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-docs', 'student-docs', false, 5242880,
        array['image/jpeg','image/png','application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 업로드: 누구나, 단 정해진 경로 형식만, 새 파일만(덮어쓰기 불가)
drop policy if exists "student_docs_insert_student" on storage.objects;
drop policy if exists "student_docs_insert_anyone"  on storage.objects;
create policy "student_docs_insert_anyone" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'student-docs'
    and name ~ '^[0-9a-f-]{36}/bankbook\.(jpg|png|pdf)$'
  );

-- 열람·삭제: 관리자만
drop policy if exists "student_docs_select_admin" on storage.objects;
create policy "student_docs_select_admin" on storage.objects
  for select to authenticated
  using (bucket_id = 'student-docs' and (select public.is_admin()));

drop policy if exists "student_docs_delete_admin" on storage.objects;
create policy "student_docs_delete_admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'student-docs' and (select public.is_admin()));

-- =====================================================================
--  [설치 후 1회] 관리자 지정
--  1) 대시보드 > Authentication > Users > Add user 로 관리자 계정 생성
--  2) 아래 문장의 이메일을 바꿔 실행
--
--  insert into public.admins (user_id, name)
--  select id, '장학담당' from auth.users where email = 'admin@mjc.ac.kr';
-- =====================================================================

-- =====================================================================
--  [선택] 보관기간(5년) 지난 신청내역 확인
--  select id, stu_id, name, created_at from public.applications
--   where created_at < now() - interval '5 years';
--  ※ 삭제는 관리자 화면에서 하면 통장 사본도 함께 삭제됩니다.
-- =====================================================================
