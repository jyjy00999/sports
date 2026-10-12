-- ============================================================
-- 스포츠 분석기 — Supabase 스키마 복구용 SQL
-- Supabase Dashboard > SQL Editor 에 통째로 붙여넣고 실행하세요.
-- 코드(src/lib/supabase.ts, src/app/api/**)에서 역으로 추출한 스키마입니다.
-- ============================================================

-- UUID 생성 함수 (Supabase 기본 제공)
create extension if not exists "pgcrypto";

-- ── 종목 ─────────────────────────────────────────────────────
create table if not exists sports (
  id         uuid primary key default gen_random_uuid(),
  name_en    text not null unique,          -- soccer | baseball | basketball | volleyball
  name_kr    text not null,
  created_at timestamptz not null default now()
);

-- ── 리그 ─────────────────────────────────────────────────────
create table if not exists leagues (
  id         uuid primary key default gen_random_uuid(),
  name_kr    text not null,
  name_en    text,
  logo_url   text,
  sport_id   uuid references sports(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists leagues_name_kr_key on leagues(name_kr);
create index if not exists leagues_sport_id_idx on leagues(sport_id);

-- ── 팀 ───────────────────────────────────────────────────────
create table if not exists teams (
  id         uuid primary key default gen_random_uuid(),
  name_kr    text not null,
  name_en    text,
  short_name text,
  logo_url   text,
  league_id  uuid references leagues(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists teams_name_kr_key on teams(name_kr);
create index if not exists teams_league_id_idx on teams(league_id);

-- ── 팀 별칭 (수집처마다 표기가 달라서 매핑용) ──────────────────
create table if not exists team_aliases (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references teams(id) on delete cascade,
  alias      text not null,
  source     text,                            -- zentoto | betman | ocr ...
  created_at timestamptz not null default now(),
  unique (alias)
);
create index if not exists team_aliases_team_id_idx on team_aliases(team_id);

-- ── 선수 ─────────────────────────────────────────────────────
create table if not exists players (
  id         uuid primary key default gen_random_uuid(),
  name_en    text,
  name_kr    text,
  position   text,
  photo_url  text,
  team_id    uuid references teams(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists players_team_id_idx on players(team_id);

-- ── 경기 ─────────────────────────────────────────────────────
create table if not exists matches (
  id             uuid primary key default gen_random_uuid(),
  betman_id      text unique,                 -- 예: zentoto-8635 (upsert 충돌 키)
  betman_game_no text,
  betman_round   text,
  league_id      uuid references leagues(id) on delete set null,
  home_team_id   uuid references teams(id) on delete set null,
  away_team_id   uuid references teams(id) on delete set null,
  match_date     timestamptz not null,
  venue          text,
  status         text not null default 'scheduled',  -- scheduled | live | finished
  mapping_status text,                               -- manual | auto
  home_score     integer,
  away_score     integer,
  created_at     timestamptz not null default now()
);
create index if not exists matches_match_date_idx    on matches(match_date);
create index if not exists matches_betman_round_idx  on matches(betman_round);
create index if not exists matches_betman_game_no_idx on matches(betman_game_no);

-- ── 배당 이력 (베팅 유형별 조합 포함) ─────────────────────────
create table if not exists odds_history (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references matches(id) on delete cascade,
  provider        text not null,              -- zentoto | betman | bet365 | pinnacle
  bet_type        text,                       -- match_winner | handicap | margin |
                                              -- under_over | sum |
                                              -- ht_match_winner | ht_handicap | ht_under_over
  betman_combo_no integer,
  bet_label       text,
  line_value      text,                       -- 'H+2.5' | 'U/O 5.5' | '승1패' | '승5패'
  home_odds       numeric,
  draw_odds       numeric,
  away_odds       numeric,
  under_odds      numeric,
  over_odds       numeric,
  odd_odds        numeric,
  even_odds       numeric,
  recorded_at     timestamptz not null default now()
);
create index if not exists odds_history_match_id_idx on odds_history(match_id);
create index if not exists odds_history_lookup_idx   on odds_history(match_id, provider, recorded_at desc);

-- ── 결장자 ───────────────────────────────────────────────────
create table if not exists match_absences (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references matches(id) on delete cascade,
  team_id    uuid references teams(id) on delete set null,
  player_id  uuid references players(id) on delete set null,
  type       text,                            -- injury | suspension | rest
  reason     text,
  created_at timestamptz not null default now()
);
create index if not exists match_absences_match_id_idx on match_absences(match_id);

-- ── AI 분석 캐시 (12시간 TTL) ────────────────────────────────
create table if not exists ai_analyses (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references matches(id) on delete cascade,
  result     jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (match_id)                           -- saveAnalysis가 match_id로 upsert
);
create index if not exists ai_analyses_expires_at_idx on ai_analyses(expires_at);

-- ── 종목 기본 데이터 ─────────────────────────────────────────
insert into sports (name_en, name_kr) values
  ('soccer', '축구'), ('baseball', '야구'), ('basketball', '농구'), ('volleyball', '배구')
on conflict (name_en) do nothing;

-- ============================================================
-- RLS: 이 앱은 service_role 키로만 서버에서 접근합니다.
-- service_role 은 RLS를 우회하므로 아래처럼 RLS를 켜 두면
-- anon 키로의 직접 접근을 막을 수 있습니다.
-- ============================================================
alter table sports         enable row level security;
alter table leagues        enable row level security;
alter table teams          enable row level security;
alter table team_aliases   enable row level security;
alter table players        enable row level security;
alter table matches        enable row level security;
alter table odds_history   enable row level security;
alter table match_absences enable row level security;
alter table ai_analyses    enable row level security;
