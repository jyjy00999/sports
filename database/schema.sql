-- ══════════════════════════════════════════════════
--  배트맨 스포츠 분석기 — 데이터베이스 스키마 v1.0
--  Supabase (PostgreSQL 15+) 에서 실행
-- ══════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- 팀명 퍼지 매칭용

-- ──────────────────────────────────────────────────
-- 1. 스포츠 / 리그 마스터
-- ──────────────────────────────────────────────────
CREATE TABLE sports (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name_kr   TEXT NOT NULL,   -- 축구, 야구, 농구, 배구
  name_en   TEXT NOT NULL,   -- soccer, baseball, basketball, volleyball
  icon      TEXT             -- 이모지
);

CREATE TABLE leagues (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sport_id        UUID REFERENCES sports(id) ON DELETE CASCADE,
  name_kr         TEXT NOT NULL,   -- 프리미어리그
  name_en         TEXT NOT NULL,   -- Premier League
  country         TEXT,            -- England
  logo_url        TEXT,
  -- 외부 API ID
  api_football_id INTEGER UNIQUE,  -- API-Football league id
  espn_slug       TEXT,            -- 'soccer/eng.1'
  -- 메타
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────────
-- 2. 팀 마스터 + 이름 매핑
-- ──────────────────────────────────────────────────
CREATE TABLE teams (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id       UUID REFERENCES leagues(id),
  name_kr         TEXT NOT NULL,
  name_en         TEXT NOT NULL,
  short_name      TEXT,
  abbreviation    TEXT,
  logo_url        TEXT,
  -- 외부 ID
  api_football_id INTEGER UNIQUE,
  espn_id         TEXT,
  -- 메타
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 배트맨 한글 팀명 ↔ team_id 매핑 (프로젝트 핵심 테이블)
CREATE TABLE team_aliases (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id     UUID REFERENCES teams(id) ON DELETE CASCADE,
  alias       TEXT NOT NULL,           -- 배트맨에 표기되는 팀명 (예: "맨체스터시티")
  source      TEXT DEFAULT 'betman',   -- betman | manual | auto
  confidence  FLOAT DEFAULT 1.0,       -- 0.0 ~ 1.0
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(alias, source)
);

-- 팀명 퍼지 검색 인덱스
CREATE INDEX idx_team_aliases_trgm ON team_aliases USING GIN (alias gin_trgm_ops);

-- ──────────────────────────────────────────────────
-- 3. 경기 (허브 테이블)
-- ──────────────────────────────────────────────────
CREATE TABLE matches (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- 외부 ID (허브 역할)
  betman_id       TEXT UNIQUE,          -- 배트맨 고유 경기번호
  api_football_id INTEGER,              -- API-Football fixture_id
  espn_id         TEXT,

  -- 배트맨 전용
  betman_round    TEXT,                 -- '2025년 제120회'
  betman_game_no  SMALLINT,             -- 1~14번 경기

  -- 경기 정보
  league_id       UUID REFERENCES leagues(id),
  home_team_id    UUID REFERENCES teams(id),
  away_team_id    UUID REFERENCES teams(id),
  match_date      TIMESTAMPTZ NOT NULL,
  status          TEXT DEFAULT 'scheduled', -- scheduled|live|final|postponed|cancelled

  -- 스코어
  home_score      SMALLINT,
  away_score      SMALLINT,
  score_detail    JSONB,                -- 전반/후반/연장 등 상세

  -- 매핑 상태
  mapping_status  TEXT DEFAULT 'pending', -- pending|matched|unmatched|manual

  venue           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_matches_date       ON matches(match_date DESC);
CREATE INDEX idx_matches_betman     ON matches(betman_id);
CREATE INDEX idx_matches_round      ON matches(betman_round);
CREATE INDEX idx_matches_status     ON matches(status);
CREATE INDEX idx_matches_api_fb     ON matches(api_football_id);

-- ──────────────────────────────────────────────────
-- 4. 배당 이력 (시계열)
-- ──────────────────────────────────────────────────
CREATE TABLE odds_history (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id    UUID REFERENCES matches(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL,           -- betman | bet365 | pinnacle | avg
  home_odds   DECIMAL(6,3),
  draw_odds   DECIMAL(6,3),            -- NULL for sports without draw
  away_odds   DECIMAL(6,3),
  -- 배당 변화 감지용
  home_odds_prev DECIMAL(6,3),
  away_odds_prev DECIMAL(6,3),
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_odds_match_time ON odds_history(match_id, recorded_at DESC);
CREATE INDEX idx_odds_provider   ON odds_history(provider, recorded_at DESC);

-- ──────────────────────────────────────────────────
-- 5. 선수 + 스탯 + 결장
-- ──────────────────────────────────────────────────
CREATE TABLE players (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id         UUID REFERENCES teams(id),
  name_kr         TEXT,
  name_en         TEXT NOT NULL,
  position        TEXT,                -- GK|DEF|MID|FWD|P|C|PG|SG|SF|PF
  jersey_no       SMALLINT,
  nationality     TEXT,
  photo_url       TEXT,
  api_football_id INTEGER UNIQUE,
  espn_id         TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE player_season_stats (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id       UUID REFERENCES players(id) ON DELETE CASCADE,
  league_id       UUID REFERENCES leagues(id),
  season          TEXT NOT NULL,       -- '2024-25'
  -- 공통
  appearances     SMALLINT DEFAULT 0,
  minutes_played  INTEGER DEFAULT 0,
  rating          DECIMAL(4,2),        -- API-Football 평점
  -- 축구
  goals           SMALLINT DEFAULT 0,
  assists         SMALLINT DEFAULT 0,
  shots_total     SMALLINT,
  shots_on_target SMALLINT,
  passes_accuracy DECIMAL(5,2),
  dribbles_success SMALLINT,
  yellow_cards    SMALLINT DEFAULT 0,
  red_cards       SMALLINT DEFAULT 0,
  -- 야구 (Baseball)
  batting_avg     DECIMAL(5,3),
  era             DECIMAL(5,2),
  home_runs       SMALLINT,
  rbi             SMALLINT,
  -- 농구 (Basketball)
  points_per_game  DECIMAL(5,2),
  rebounds_per_game DECIMAL(5,2),
  assists_per_game  DECIMAL(5,2),
  -- 메타
  fetched_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id, league_id, season)
);

-- 결장자 / 부상자 / 출전 정지
CREATE TABLE injuries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id       UUID REFERENCES players(id) ON DELETE CASCADE,
  team_id         UUID REFERENCES teams(id),
  type            TEXT NOT NULL,       -- injured | suspended | doubtful | illness
  reason          TEXT,                -- '햄스트링 부상', '누적 경고'
  severity        TEXT,                -- minor | moderate | major
  expected_return DATE,
  is_active       BOOLEAN DEFAULT TRUE,
  source          TEXT DEFAULT 'api-football',
  fetched_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_injuries_team     ON injuries(team_id, is_active);
CREATE INDEX idx_injuries_player   ON injuries(player_id);

-- 경기별 예상 결장 (match + player 연결)
CREATE TABLE match_absences (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id    UUID REFERENCES matches(id) ON DELETE CASCADE,
  player_id   UUID REFERENCES players(id),
  team_id     UUID REFERENCES teams(id),
  reason      TEXT,
  type        TEXT,                    -- injured | suspended | doubtful
  confirmed   BOOLEAN DEFAULT FALSE,
  UNIQUE(match_id, player_id)
);

-- ──────────────────────────────────────────────────
-- 6. AI 분석 캐시
-- ──────────────────────────────────────────────────
CREATE TABLE ai_analyses (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id    UUID REFERENCES matches(id) ON DELETE CASCADE UNIQUE,
  model       TEXT DEFAULT 'claude-sonnet-4-6',
  prompt_ver  TEXT DEFAULT 'v1',
  result      JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ DEFAULT NOW() + INTERVAL '12 hours'
);

-- ──────────────────────────────────────────────────
-- 7. 크롤링 로그 (디버깅용)
-- ──────────────────────────────────────────────────
CREATE TABLE scrape_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source      TEXT NOT NULL,           -- betman | api-football | espn | odds-api
  job_type    TEXT,                    -- schedule | odds | injuries | stats
  status      TEXT,                    -- success | error | partial
  records     INTEGER DEFAULT 0,
  error_msg   TEXT,
  duration_ms INTEGER,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────────
-- 8. 초기 마스터 데이터 삽입
-- ──────────────────────────────────────────────────
INSERT INTO sports (name_kr, name_en, icon) VALUES
  ('축구',   'soccer',     '⚽'),
  ('야구',   'baseball',   '⚾'),
  ('농구',   'basketball', '🏀'),
  ('배구',   'volleyball', '🏐');

-- 주요 리그 (sport_id는 실행 후 업데이트 필요)
-- INSERT INTO leagues ... (Phase 1 데이터 로더에서 처리)
