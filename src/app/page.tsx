'use client';

import { useState, useEffect, useCallback, useMemo, createContext, useContext } from 'react';
import type { Match } from '@/types';

// ── 색상 테마 ──
const DARK = {
  bg: '#080B11', surface: '#111520', surface2: '#1A2030',
  border: 'rgba(255,255,255,0.07)',
  accent: '#00D4AA', warn: '#FF6240', blue: '#4E9BFF',
  text: '#E2EAF4', muted: '#7A8AA0',
};
const LIGHT = {
  bg: '#F0F4FA', surface: '#FFFFFF', surface2: '#E8EDF5',
  border: 'rgba(0,0,0,0.08)',
  accent: '#00A888', warn: '#E8471E', blue: '#2B7FE0',
  text: '#1A2030', muted: '#7A8AA0',
};

type Theme = typeof DARK;
const ThemeCtx = createContext<Theme>(DARK);
const useC = () => useContext(ThemeCtx);

type OddsRow = { provider: string; home_odds: number | null; draw_odds: number | null; away_odds: number | null; recorded_at: string };
type Absence = { id: string; type: string; reason?: string; player: { name_en: string; name_kr?: string; position?: string } };
type Analysis = {
  winner: string; winner_team: string;
  home_win_pct: number; draw_pct: number; away_win_pct: number;
  expected_score: string; home_analysis: string; away_analysis: string;
  key_points: string[]; tactics: string; injury_impact: string;
  odds_analysis: string; verdict: string; confidence: string;
};

// ── 경기 상세 모달 ──
function MatchDetail({ match, onClose }: { match: Match; onClose: () => void }) {
  const C = useC();
  const [odds, setOdds]         = useState<OddsRow[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [tab, setTab]           = useState<'odds' | 'injuries' | 'ai'>('odds');

  useEffect(() => { setOdds([]); setAbsences([]); }, [match.id]);

  const doAnalyze = async () => {
    setAnalyzing(true);
    try {
      // 이미 분석 결과가 있으면 재분석(force=true)으로 캐시 무시
      const force = !!analysis;
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match, force }),
      });
      const data = await res.json();
      if (data.result) { setAnalysis(data.result); setTab('ai'); }
    } catch { /* 에러 처리 */ }
    finally { setAnalyzing(false); }
  };

  const homeAbs = absences.filter((a: Absence) => (a as unknown as Record<string, unknown>)['team_id'] === match.home_team.id);
  const awayAbs = absences.filter((a: Absence) => (a as unknown as Record<string, unknown>)['team_id'] === match.away_team.id);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 20, width: '100%', maxWidth: 680,
        maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
      }} onClick={e => e.stopPropagation()}>

        {/* 헤더 */}
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ fontSize: 11, color: C.accent, fontWeight: 700, marginBottom: 4, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em' }}>
                {match.league?.name_kr} · {match.betman_round}
              </p>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text }}>
                {match.home_team.name_kr} <span style={{ color: C.muted, fontWeight: 300 }}>vs</span> {match.away_team.name_kr}
              </h2>
              <p style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
                {new Date(match.match_date).toLocaleString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                {match.venue ? ` · ${match.venue}` : ''}
              </p>
            </div>
            <button onClick={onClose} style={{ color: C.muted, background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', padding: 4 }}>✕</button>
          </div>

          {/* 탭 */}
          <div style={{ display: 'flex', gap: 6, marginTop: 16 }}>
            {(['odds', 'injuries', 'ai'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: tab === t ? C.accent : C.surface2,
                color: tab === t ? '#fff' : C.muted,
                transition: 'all 0.15s',
              }}>
                {t === 'odds' ? '📊 배당 비교' : t === 'injuries' ? '🏥 결장자' : '🤖 AI 분석'}
              </button>
            ))}
            <button onClick={doAnalyze} disabled={analyzing} style={{
              marginLeft: 'auto', padding: '6px 16px', borderRadius: 8, border: 'none',
              cursor: analyzing ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 700,
              background: analyzing ? C.surface2 : `${C.accent}20`,
              color: analyzing ? C.muted : C.accent,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              {analyzing
                ? <><span style={{ width: 12, height: 12, border: `2px solid ${C.accent}40`, borderTopColor: C.accent, borderRadius: '50%', display: 'inline-block', animation: 'cc-spin .7s linear infinite' }} />분석 중…</>
                : analysis ? '🔄 재분석' : '✨ AI 분석 시작'}
            </button>
          </div>
        </div>

        {/* 탭 콘텐츠 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {tab === 'odds' && (
            <div>
              {odds.length === 0 ? (
                <EmptyState icon="📊" text="배당 데이터 없음" sub="스크래퍼를 실행하거나 API 키를 설정하세요" />
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                      {['북메이커', '홈', '무', '원정', '업데이트'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: C.muted, fontWeight: 600, fontSize: 11 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {odds.map((o, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: '10px 12px', fontWeight: 700, color: C.text }}>{o.provider}</td>
                        <td style={{ padding: '10px 12px', color: C.blue, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>{o.home_odds ?? '-'}</td>
                        <td style={{ padding: '10px 12px', color: C.muted, fontFamily: 'JetBrains Mono, monospace' }}>{o.draw_odds ?? '-'}</td>
                        <td style={{ padding: '10px 12px', color: C.warn, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>{o.away_odds ?? '-'}</td>
                        <td style={{ padding: '10px 12px', color: C.muted, fontSize: 11 }}>{new Date(o.recorded_at).toLocaleTimeString('ko-KR')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === 'injuries' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {[{ team: match.home_team, abs: homeAbs }, { team: match.away_team, abs: awayAbs }].map(({ team, abs }) => (
                <div key={team.id}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: C.accent, marginBottom: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>🏠 {team.name_kr}</p>
                  {abs.length === 0 ? (
                    <p style={{ fontSize: 12, color: C.muted }}>결장자 없음</p>
                  ) : abs.map((a: Absence) => (
                    <div key={a.id} style={{
                      display: 'flex', gap: 8, alignItems: 'flex-start',
                      background: C.surface2, borderRadius: 8, padding: '10px 12px', marginBottom: 8,
                      borderLeft: `3px solid ${a.type === 'suspended' ? C.warn : a.type === 'doubtful' ? '#EAB308' : '#EF4444'}`,
                    }}>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{a.player?.name_kr || a.player?.name_en}</p>
                        <p style={{ fontSize: 11, color: C.muted }}>{a.type} · {a.reason || '-'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {tab === 'ai' && analysis && <AIAnalysisView analysis={analysis} match={match} />}
          {tab === 'ai' && !analysis && (
            <EmptyState icon="🤖" text="AI 분석 없음" sub="위의 'AI 분석 시작' 버튼을 눌러주세요" />
          )}
        </div>
      </div>
    </div>
  );
}

// ── AI 분석 뷰 ──
function AIAnalysisView({ analysis: r, match }: { analysis: Analysis; match: Match }) {
  const C = useC();
  const total = (r.home_win_pct + r.draw_pct + r.away_win_pct) || 100;
  const hp = Math.round(r.home_win_pct / total * 100);
  const dp = Math.round(r.draw_pct / total * 100);
  const ap = 100 - hp - dp;
  const CONF = { HIGH: { c: C.accent, l: '높음 🔥' }, MEDIUM: { c: '#EAB308', l: '보통 ✅' }, LOW: { c: C.warn, l: '낮음 ⚠️' } };
  const conf = CONF[r.confidence as keyof typeof CONF] ?? CONF.MEDIUM;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ textAlign: 'center', padding: '12px 0' }}>
        <p style={{ fontSize: 11, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>AI 예측 승자</p>
        <p style={{ fontSize: 26, fontWeight: 900, color: C.accent }}>{r.winner}</p>
        <p style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>예상 스코어: <strong style={{ color: C.text }}>{r.expected_score}</strong></p>
        <span style={{ display: 'inline-block', marginTop: 8, padding: '3px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: `${conf.c}20`, color: conf.c }}>신뢰도 {conf.l}</span>
      </div>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
          <span style={{ fontWeight: 700, color: C.blue }}>{match.home_team.name_kr} {hp}%</span>
          {dp > 0 && <span style={{ color: C.muted }}>무 {dp}%</span>}
          <span style={{ fontWeight: 700, color: C.warn }}>{ap}% {match.away_team.name_kr}</span>
        </div>
        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', height: 12 }}>
          <div style={{ width: `${hp}%`, background: C.blue }} />
          {dp > 0 && <div style={{ width: `${dp}%`, background: C.muted }} />}
          <div style={{ width: `${ap}%`, background: C.warn }} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Block title={`🏠 ${match.home_team.name_kr}`} text={r.home_analysis} color={C.blue} />
        <Block title={`✈️ ${match.away_team.name_kr}`} text={r.away_analysis} color={C.warn} />
      </div>
      {r.injury_impact && <Block title="🏥 결장자 영향" text={r.injury_impact} color="#EF4444" />}
      {r.odds_analysis && <Block title="📊 배당 인사이트" text={r.odds_analysis} color={C.accent} />}
      <div>
        <p style={{ fontSize: 11, fontWeight: 700, color: C.accent, marginBottom: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>📌 핵심 분석 포인트</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {r.key_points.map((pt, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: '50%', background: `${C.accent}22`, color: C.accent, fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
              <p style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{pt}</p>
            </div>
          ))}
        </div>
      </div>
      <Block title="⚡ 전술 인사이트" text={r.tactics} color="#8B5CF6" />
      <div style={{ background: `${C.accent}12`, border: `1.5px solid ${C.accent}40`, borderRadius: 12, padding: '14px 16px' }}>
        <p style={{ fontSize: 11, fontWeight: 800, color: C.accent, marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>🎯 최종 AI 픽</p>
        <p style={{ fontSize: 13, color: C.text, lineHeight: 1.7 }}>{r.verdict}</p>
      </div>
    </div>
  );
}

function Block({ title, text, color }: { title: string; text: string; color: string }) {
  const C = useC();
  return (
    <div style={{ background: `${color}10`, border: `1px solid ${color}30`, borderRadius: 10, padding: '12px 14px' }}>
      <p style={{ fontSize: 10, fontWeight: 800, color, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 7 }}>{title}</p>
      <p style={{ fontSize: 12, color: C.text, lineHeight: 1.65 }}>{text}</p>
    </div>
  );
}

function EmptyState({ icon, text, sub }: { icon: string; text: string; sub: string }) {
  const C = useC();
  return (
    <div style={{ textAlign: 'center', padding: '40px 0', color: C.muted }}>
      <p style={{ fontSize: 36, marginBottom: 10 }}>{icon}</p>
      <p style={{ fontWeight: 700, color: C.text }}>{text}</p>
      <p style={{ fontSize: 12, marginTop: 4 }}>{sub}</p>
    </div>
  );
}

// ── 배당 버튼 ──
function OddsButton({
  label, value, color, pct, isBest,
}: {
  label: string;
  value: number | null;
  color: string;
  pct?: number;
  isBest?: boolean;
}) {
  const C = useC();
  const has = value != null;
  const hi = isBest && pct !== undefined;
  const displayColor = hi ? C.blue : color;
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '8px 4px', borderRadius: 6, cursor: 'default',
      border: `1px solid ${hi ? C.blue + 'CC' : has ? color + '55' : C.border}`,
      background: hi ? `${C.blue}22` : has ? `${color}0D` : C.surface,
      minWidth: 56, maxWidth: 120,
      transition: 'all 0.25s',
      position: 'relative',
    }}>
      {hi && (
        <span style={{
          position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)',
          fontSize: 9, fontWeight: 800, color: '#fff',
          background: C.blue, borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap',
        }}>BEST</span>
      )}
      <span style={{ fontSize: 11, color: hi ? C.blue : C.muted, marginBottom: 2, fontWeight: hi ? 800 : 600 }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 800, color: has ? displayColor : C.muted, fontFamily: 'JetBrains Mono, monospace' }}>
        {has ? value!.toFixed(2) : '-'}
      </span>
      {pct !== undefined && (
        <span style={{
          fontSize: 12, fontWeight: 800,
          color: hi ? C.blue : C.muted,
          marginTop: 3,
        }}>
          {pct}%
        </span>
      )}
    </div>
  );
}

// ── 개별 베팅 유형 행 ──
function BetRow({
  combo, isFirst, analyzing, analyzed, pcts, onAnalyze,
}: {
  combo: BetCombo;
  isFirst: boolean;
  analyzing: boolean;
  analyzed: boolean;
  pcts?: number[];          // [p1, p2, p3?] – 확률 배열
  onAnalyze: () => void;
}) {
  const C = useC();

  const maxPct = pcts ? Math.max(...pcts) : -1;
  // 동률이면 첫 번째 최댓값 항목에만 BEST 표시
  const bestIdx = pcts && maxPct > 0 ? pcts.indexOf(maxPct) : -1;
  const isBest = (i: number) => i === bestIdx;

  const renderOdds = () => {
    if (combo.bet_type === 'match_winner' || combo.bet_type === 'handicap' ||
        combo.bet_type === 'ht_match_winner' || combo.bet_type === 'ht_handicap') {
      return (
        <div style={{ flex: 1, display: 'flex', gap: 8, paddingTop: pcts ? 10 : 0 }}>
          <OddsButton label="승" value={combo.home_odds ?? null} color={C.blue}  pct={pcts?.[0]} isBest={isBest(0)} />
          <OddsButton label="무" value={combo.draw_odds ?? null} color={C.muted} pct={pcts?.[1]} isBest={isBest(1)} />
          <OddsButton label="패" value={combo.away_odds ?? null} color={C.warn}  pct={pcts?.[2]} isBest={isBest(2)} />
        </div>
      );
    }
    if (combo.bet_type === 'under_over' || combo.bet_type === 'ht_under_over') {
      return (
        <div style={{ flex: 1, display: 'flex', gap: 8, paddingTop: pcts ? 10 : 0 }}>
          <OddsButton label="언더" value={combo.under_odds ?? null} color={C.blue} pct={pcts?.[0]} isBest={isBest(0)} />
          <OddsButton label="오버" value={combo.over_odds  ?? null} color={C.warn} pct={pcts?.[1]} isBest={isBest(1)} />
          <div style={{ flex: 1 }} />
        </div>
      );
    }
    if (combo.bet_type === 'sum') {
      return (
        <div style={{ flex: 1, display: 'flex', gap: 8, paddingTop: pcts ? 10 : 0 }}>
          <OddsButton label="홀" value={combo.odd_odds  ?? null} color={C.blue} pct={pcts?.[0]} isBest={isBest(0)} />
          <OddsButton label="짝" value={combo.even_odds ?? null} color={C.warn} pct={pcts?.[1]} isBest={isBest(1)} />
          <div style={{ flex: 1 }} />
        </div>
      );
    }
    return <div style={{ flex: 1 }} />;
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      padding: `${pcts ? 14 : 10}px 16px`, background: C.surface2,
      borderTop: `1px solid ${C.border}`,
      transition: 'padding 0.2s',
    }}>
      {/* 조합 번호 */}
      <div style={{ width: 90, flexShrink: 0 }}>
        {combo.betman_combo_no != null ? (
          <>
            <span style={{
              fontSize: 10, color: C.muted, fontWeight: 700,
              border: `1px solid ${C.border}`, borderRadius: 3,
              padding: '1px 5px', background: C.surface,
            }}>조합</span>
            <p style={{ fontSize: 13, fontWeight: 700, color: C.muted, marginTop: 3, fontFamily: 'JetBrains Mono, monospace' }}>
              {combo.betman_combo_no}
            </p>
          </>
        ) : <span style={{ fontSize: 11, color: C.muted }}>—</span>}
      </div>

      {/* 베팅 유형 + 라인 */}
      <div style={{ width: 195, flexShrink: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{combo.bet_label}</p>
        {combo.line_value && (
          <p style={{ fontSize: 11, color: C.accent, marginTop: 2 }}>{combo.line_value}</p>
        )}
      </div>

      {/* 배당 버튼 */}
      {renderOdds()}

      {/* AI 분석 버튼 (첫 번째 행만) */}
      {isFirst ? (
        <button
          onClick={onAnalyze}
          disabled={analyzing}
          style={{
            marginLeft: 16, flexShrink: 0, padding: '7px 14px', borderRadius: 6,
            border: `1px solid ${analyzed ? C.accent + '60' : C.accent + '40'}`,
            background: analyzed ? `${C.accent}18` : `${C.accent}10`,
            color: C.accent, fontSize: 12, fontWeight: 700,
            cursor: analyzing ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
            display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (!analyzing) (e.currentTarget as HTMLButtonElement).style.background = `${C.accent}28`; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = analyzed ? `${C.accent}18` : `${C.accent}10`; }}
        >
          {analyzing
            ? <><span style={{ width: 11, height: 11, border: `2px solid ${C.accent}40`, borderTopColor: C.accent, borderRadius: '50%', display: 'inline-block', animation: 'cc-spin .7s linear infinite' }} />분석중</>
            : analyzed ? '🔄 재분석' : '🤖 분석'}
        </button>
      ) : (
        <div style={{ marginLeft: 16, width: 70, flexShrink: 0 }} />
      )}
    </div>
  );
}

// ── 분석 결과 타입 ──
type MatchAnalysis = {
  winner: string; winner_team: string;
  home_win_pct: number; draw_pct: number; away_win_pct: number;
  expected_score?: string;
  handicap_home_pct?: number; handicap_draw_pct?: number; handicap_away_pct?: number;
  under_pct?: number; over_pct?: number;
  odd_pct?: number; even_pct?: number;
  // 전반전
  ht_home_win_pct?: number; ht_draw_pct?: number; ht_away_win_pct?: number;
  ht_handicap_home_pct?: number; ht_handicap_draw_pct?: number; ht_handicap_away_pct?: number;
  ht_under_pct?: number; ht_over_pct?: number;
  best_bet_type?: string; best_bet_option?: string; best_bet_reason?: string;
  confidence: string;
  // 스포츠별 상세
  sport_type?: 'soccer' | 'baseball';
  match_summary?: string;
  // 축구
  home_attack_rating?: number; home_defense_rating?: number;
  away_attack_rating?: number; away_defense_rating?: number;
  home_recent_form?: string; away_recent_form?: string;
  h2h_summary?: string;
  key_absences_home?: string[]; key_absences_away?: string[];
  // 야구
  home_pitcher_name?: string; away_pitcher_name?: string;
  home_pitcher_era?: number;  away_pitcher_era?: number;
  home_pitcher_record?: string; away_pitcher_record?: string;
  home_batting_avg?: number;  away_batting_avg?: number;
  home_team_hr?: number;      away_team_hr?: number;
  home_team_hits?: number;    away_team_hits?: number;
  home_team_strikeouts?: number; away_team_strikeouts?: number;
};
type AnalysisEntry = MatchAnalysis & { timestamp: number; nth: number };

// ── 카테고리 추천 패널 ──
type BetCatKey = 'match_winner' | 'handicap' | 'under_over' | 'ht_match_winner' | 'ht_handicap' | 'ht_under_over' | 'draw';
type BetPick = {
  match: Match;
  option: string;     // 홈승, 언더 등
  pct: number;
  line?: string | null;
};

const CAT_CONFIG: Record<BetCatKey, { label: string; emoji: string }> = {
  match_winner:    { label: '승무패',      emoji: '⚔️' },
  handicap:        { label: '핸디캡',      emoji: '⚖️' },
  under_over:      { label: '언더오버',    emoji: '↕️' },
  ht_match_winner: { label: '전반승무패',  emoji: '1️⃣' },
  ht_handicap:     { label: '전반핸디',    emoji: '½' },
  ht_under_over:   { label: '전반U/O',     emoji: '🔢' },
  draw:            { label: '무승부',      emoji: '🤝' },
};

function getTopPicks(
  matches: Match[],
  analysisHistory: Record<string, AnalysisEntry[]>,
  cat: BetCatKey,
): BetPick[] {
  const picks: BetPick[] = [];

  for (const m of matches) {
    const history = analysisHistory[m.id];
    if (!history?.length) continue;
    const a = history[history.length - 1];

    // 해당 카테고리의 bet_combo 찾기 (line_value용)
    const rawCombos = (m as unknown as { bet_combos?: BetCombo[] }).bet_combos ?? [];
    // draw 카테고리는 match_winner combo에서 draw_odds를 확인
    const combo = cat === 'draw'
      ? rawCombos.find(c => c.bet_type === 'match_winner')
      : rawCombos.find(c => c.bet_type === cat);

    // match_winner 이외 카테고리는 실제 bet_combo가 있는 경기만 표시
    if (cat !== 'match_winner' && !combo) continue;
    // 무승부 카테고리: draw_odds가 있는 경기만 (야구 제외, 축구 전용)
    if (cat === 'draw' && !combo?.draw_odds) continue;

    let pct = 0;
    let option = '';

    switch (cat) {
      case 'match_winner': {
        const vals = [a.home_win_pct, a.draw_pct, a.away_win_pct];
        const opts = [`${m.home_team.name_kr} 승`, '무승부', `${m.away_team.name_kr} 승`];
        const idx = vals.indexOf(Math.max(...vals));
        pct = vals[idx]; option = opts[idx];
        break;
      }
      case 'handicap': {
        if (!a.handicap_home_pct && !a.handicap_draw_pct && !a.handicap_away_pct) continue;
        const vals = [a.handicap_home_pct ?? 0, a.handicap_draw_pct ?? 0, a.handicap_away_pct ?? 0];
        const opts = [`${m.home_team.name_kr} 승`, '무승부', `${m.away_team.name_kr} 승`];
        const idx = vals.indexOf(Math.max(...vals));
        pct = vals[idx]; option = opts[idx];
        break;
      }
      case 'under_over': {
        if (!a.under_pct && !a.over_pct) continue;
        const vals = [a.under_pct ?? 0, a.over_pct ?? 0];
        const opts = ['언더', '오버'];
        const idx = vals.indexOf(Math.max(...vals));
        pct = vals[idx]; option = opts[idx];
        break;
      }
      case 'ht_match_winner': {
        if (!a.ht_home_win_pct && !a.ht_draw_pct && !a.ht_away_win_pct) continue;
        const vals = [a.ht_home_win_pct ?? 0, a.ht_draw_pct ?? 0, a.ht_away_win_pct ?? 0];
        const opts = [`${m.home_team.name_kr} 승`, '무승부', `${m.away_team.name_kr} 승`];
        const idx = vals.indexOf(Math.max(...vals));
        pct = vals[idx]; option = opts[idx];
        break;
      }
      case 'ht_handicap': {
        if (!a.ht_handicap_home_pct && !a.ht_handicap_draw_pct && !a.ht_handicap_away_pct) continue;
        const vals = [a.ht_handicap_home_pct ?? 0, a.ht_handicap_draw_pct ?? 0, a.ht_handicap_away_pct ?? 0];
        const opts = [`${m.home_team.name_kr} 승`, '무승부', `${m.away_team.name_kr} 승`];
        const idx = vals.indexOf(Math.max(...vals));
        pct = vals[idx]; option = opts[idx];
        break;
      }
      case 'ht_under_over': {
        if (!a.ht_under_pct && !a.ht_over_pct) continue;
        const vals = [a.ht_under_pct ?? 0, a.ht_over_pct ?? 0];
        const opts = ['언더', '오버'];
        const idx = vals.indexOf(Math.max(...vals));
        pct = vals[idx]; option = opts[idx];
        break;
      }
      case 'draw': {
        if (!a.draw_pct) continue;
        pct = a.draw_pct;
        option = '무승부';
        break;
      }
    }

    if (pct > 0) {
      picks.push({ match: m, option, pct, line: combo?.line_value });
    }
  }

  return picks.sort((a, b) => b.pct - a.pct).slice(0, 10);
}

// ── 사이드바: 카테고리 버튼만 (클릭 → 메인 영역으로 전달) ──
function BetCategoryPanel({
  analysisHistory,
  selectedCat,
  onSelectCat,
}: {
  analysisHistory: Record<string, AnalysisEntry[]>;
  selectedCat: BetCatKey | null;
  onSelectCat: (cat: BetCatKey | null) => void;
}) {
  const C = useC();
  const analyzedCount = Object.keys(analysisHistory).length;
  const cats = Object.entries(CAT_CONFIG) as [BetCatKey, { label: string; emoji: string }][];

  return (
    <div style={{ marginTop: 8 }}>
      <p style={{
        fontSize: 10, fontWeight: 800, color: C.muted, letterSpacing: '0.08em',
        textTransform: 'uppercase', marginBottom: 8,
      }}>
        🏆 카테고리 추천
        {analyzedCount === 0 && (
          <span style={{ fontSize: 9, color: C.muted, fontWeight: 400, marginLeft: 4 }}>(분석 후 표시)</span>
        )}
      </p>

      {/* 탭 버튼 (2열 그리드) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        {cats.map(([key, cfg]) => {
          const active = selectedCat === key;
          return (
            <button
              key={key}
              onClick={() => onSelectCat(active ? null : key)}
              style={{
                padding: '8px 4px', borderRadius: 8,
                border: `1px solid ${active ? C.blue + 'BB' : C.border}`,
                background: active ? `${C.blue}20` : C.surface2,
                color: active ? C.blue : C.muted,
                fontSize: 10, fontWeight: active ? 800 : 600,
                cursor: analyzedCount === 0 ? 'not-allowed' : 'pointer',
                textAlign: 'center', lineHeight: 1.4,
                transition: 'all 0.15s',
                opacity: analyzedCount === 0 ? 0.5 : 1,
                boxShadow: active ? `0 0 0 2px ${C.blue}33` : 'none',
              }}
            >
              <span style={{ fontSize: 14, display: 'block', marginBottom: 2 }}>{cfg.emoji}</span>
              {cfg.label}
            </button>
          );
        })}
      </div>
      {selectedCat && (
        <p style={{ fontSize: 10, color: C.blue, textAlign: 'center', marginTop: 8, fontWeight: 700 }}>
          → 오른쪽에서 확인
        </p>
      )}
    </div>
  );
}

// ── 메인 영역: 카테고리 Top 10 뷰 ──
function CategoryPicksView({
  cat,
  matches,
  analysisHistory,
  onClose,
  onClickDetail,
}: {
  cat: BetCatKey;
  matches: Match[];
  analysisHistory: Record<string, AnalysisEntry[]>;
  onClose: () => void;
  onClickDetail: (m: Match) => void;
}) {
  const C = useC();
  const cfg = CAT_CONFIG[cat];
  const picks = useMemo(
    () => getTopPicks(matches, analysisHistory, cat),
    [matches, analysisHistory, cat],
  );

  const MEDAL = ['🥇', '🥈', '🥉'];

  return (
    <div>
      {/* 헤더 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24,
        paddingBottom: 16, borderBottom: `2px solid ${C.blue}33`,
      }}>
        <span style={{ fontSize: 32 }}>{cfg.emoji}</span>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 20, fontWeight: 900, color: C.text, margin: 0, letterSpacing: '-0.02em' }}>
            {cfg.label} 추천 TOP 10
          </h2>
          <p style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
            AI 분석 확률 높은 순 · {picks.length}개 경기
          </p>
        </div>
        <button
          onClick={onClose}
          style={{
            padding: '7px 14px', borderRadius: 8, border: `1px solid ${C.border}`,
            background: C.surface2, color: C.muted, fontSize: 12, fontWeight: 700,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
          }}
        >
          ✕ 닫기
        </button>
      </div>

      {picks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: C.muted }}>
          <p style={{ fontSize: 40, marginBottom: 12 }}>📊</p>
          <p style={{ fontWeight: 700, color: C.text }}>분석된 경기 없음</p>
          <p style={{ fontSize: 12, marginTop: 6 }}>먼저 🤖 전체 분석을 실행하세요</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {picks.map((pick, i) => {
            const isTop3 = i < 3;
            const pctColor = pick.pct >= 65 ? C.accent : pick.pct >= 55 ? C.blue : C.text;
            const date = new Date(pick.match.match_date);

            return (
              <div
                key={pick.match.id}
                onClick={() => onClickDetail(pick.match)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '16px 20px', borderRadius: 12, cursor: 'pointer',
                  border: `1.5px solid ${isTop3 ? C.blue + '55' : C.border}`,
                  background: i === 0 ? `${C.blue}12` : i < 3 ? `${C.blue}07` : C.surface,
                  transition: 'all 0.15s',
                  boxShadow: i === 0 ? `0 2px 12px ${C.blue}20` : 'none',
                }}
                onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = C.blue + '88'}
                onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = isTop3 ? C.blue + '55' : C.border}
              >
                {/* 순위 */}
                <div style={{ width: 44, flexShrink: 0, textAlign: 'center' }}>
                  {isTop3 ? (
                    <span style={{ fontSize: 26 }}>{MEDAL[i]}</span>
                  ) : (
                    <span style={{
                      fontSize: 14, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace',
                      color: C.muted, background: C.surface2, borderRadius: 6,
                      padding: '4px 8px', display: 'inline-block',
                    }}>#{i + 1}</span>
                  )}
                </div>

                {/* 경기 정보 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>
                      {pick.match.league?.name_kr}
                    </span>
                    <span style={{ fontSize: 10, color: C.muted }}>·</span>
                    <span style={{ fontSize: 10, color: C.muted }}>
                      {date.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {pick.match.betman_game_no && (
                      <>
                        <span style={{ fontSize: 10, color: C.muted }}>·</span>
                        <span style={{ fontSize: 10, color: C.muted, fontFamily: 'JetBrains Mono, monospace' }}>
                          #{pick.match.betman_game_no}
                        </span>
                      </>
                    )}
                  </div>
                  <p style={{ fontSize: 16, fontWeight: 800, color: C.text, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {pick.match.home_team.name_kr}
                    <span style={{ color: C.muted, fontWeight: 300, margin: '0 8px', fontSize: 13 }}>vs</span>
                    {pick.match.away_team.name_kr}
                  </p>
                </div>

                {/* AI 추천 픽 */}
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: `${C.blue}15`, border: `1px solid ${C.blue}44`,
                    borderRadius: 8, padding: '6px 12px', marginBottom: 4,
                  }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: C.blue }}>
                      {pick.option}
                    </span>
                    {pick.line && (
                      <span style={{ fontSize: 10, color: C.muted }}>({pick.line})</span>
                    )}
                  </div>
                  <p style={{
                    fontSize: 22, fontWeight: 900, color: pctColor,
                    fontFamily: 'JetBrains Mono, monospace', margin: 0, textAlign: 'right',
                  }}>{pick.pct}%</p>
                </div>

                {/* 확률 바 */}
                <div style={{ width: 6, height: 60, background: C.surface2, borderRadius: 3, flexShrink: 0, overflow: 'hidden', position: 'relative' }}>
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    height: `${pick.pct}%`, background: pctColor,
                    borderRadius: 3, transition: 'height 0.5s',
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 분석 이력 패널 ──
function AnalysisHistoryPanel({ history }: { history: AnalysisEntry[] }) {
  const C = useC();
  if (history.length < 2) return null;

  type DiffItem = { name: string; prev: number; curr: number };
  const Chip = ({ d }: { d: DiffItem }) => {
    const diff = d.curr - d.prev;
    const col = diff > 0 ? '#22C55E' : diff < 0 ? C.warn : C.muted;
    const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '─';
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11,
        background: diff === 0 ? C.surface2 : `${col}12`,
        border: `1px solid ${diff === 0 ? C.border : col + '40'}`,
        borderRadius: 5, padding: '2px 7px', fontFamily: 'JetBrains Mono, monospace' }}>
        <span style={{ color: C.muted, fontSize: 10 }}>{d.name}</span>
        <span style={{ color: C.text }}>{d.prev}%</span>
        <span style={{ color: col, fontWeight: 800, fontSize: 10 }}>{arrow}{Math.abs(diff) || ''}</span>
        <span style={{ color: col, fontWeight: 800 }}>{d.curr}%</span>
      </span>
    );
  };

  return (
    <div style={{ padding: '12px 16px', borderTop: `2px dashed ${C.border}`, background: C.bg }}>
      <p style={{ fontSize: 10, fontWeight: 800, color: C.muted, letterSpacing: '0.07em',
        textTransform: 'uppercase', marginBottom: 10 }}>📊 재분석 이력</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {history.slice(1).map((entry, idx) => {
          const prev = history[idx];
          const time = new Date(entry.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const groups: { label: string; items: DiffItem[] }[] = [
            { label: '승무패', items: [
              { name: '승', prev: prev.home_win_pct, curr: entry.home_win_pct },
              { name: '무', prev: prev.draw_pct, curr: entry.draw_pct },
              { name: '패', prev: prev.away_win_pct, curr: entry.away_win_pct },
            ]},
          ];
          if (prev.handicap_home_pct !== undefined || entry.handicap_home_pct !== undefined) {
            groups.push({ label: '핸디캡', items: [
              { name: '승', prev: prev.handicap_home_pct ?? 0, curr: entry.handicap_home_pct ?? 0 },
              { name: '무', prev: prev.handicap_draw_pct ?? 0, curr: entry.handicap_draw_pct ?? 0 },
              { name: '패', prev: prev.handicap_away_pct ?? 0, curr: entry.handicap_away_pct ?? 0 },
            ]});
          }
          if (prev.under_pct !== undefined || entry.under_pct !== undefined) {
            groups.push({ label: '언더오버', items: [
              { name: '언더', prev: prev.under_pct ?? 0, curr: entry.under_pct ?? 0 },
              { name: '오버', prev: prev.over_pct ?? 0, curr: entry.over_pct ?? 0 },
            ]});
          }
          if (prev.odd_pct !== undefined || entry.odd_pct !== undefined) {
            groups.push({ label: 'SUM', items: [
              { name: '홀', prev: prev.odd_pct ?? 0, curr: entry.odd_pct ?? 0 },
              { name: '짝', prev: prev.even_pct ?? 0, curr: entry.even_pct ?? 0 },
            ]});
          }
          return (
            <div key={idx} style={{ background: C.surface, borderRadius: 8, padding: '10px 12px',
              border: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: C.blue,
                  background: `${C.blue}15`, borderRadius: 4, padding: '2px 7px' }}>
                  {entry.nth}차 재분석
                </span>
                <span style={{ fontSize: 10, color: C.muted }}>{time}</span>
                <span style={{ fontSize: 10, marginLeft: 'auto',
                  color: entry.confidence === 'HIGH' ? C.accent : entry.confidence === 'LOW' ? C.warn : '#EAB308',
                  fontWeight: 700 }}>
                  {entry.confidence === 'HIGH' ? '🔥 신뢰도 높음' : entry.confidence === 'LOW' ? '⚠️ 낮음' : '✅ 보통'}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {groups.map(g => (
                  <div key={g.label} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, width: 50, flexShrink: 0 }}>{g.label}</span>
                    {g.items.map(d => <Chip key={d.name} d={d} />)}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 배트맨 스타일 경기 행 ──
type PitcherInfo = { name: string; era?: number|null; wins?: number|null; losses?: number|null; whip?: number|null; k9?: number|null; source?: string };
type TeamBattingStats = { avg?: number|null; homeRuns?: number|null; hits?: number|null; strikeOuts?: number|null; obp?: number|null; ops?: number|null };
type PitchersData = { home: PitcherInfo|null; away: PitcherInfo|null; leagueType: string; homeTeamStats?: TeamBattingStats|null; awayTeamStats?: TeamBattingStats|null };
type InjuredPlayer = { name: string; injury: string; status: string; chanceOfPlaying?: number|null };
type TeamInjuries = { teamName: string; players: InjuredPlayer[] };
type InjuriesData = { home: TeamInjuries|null; away: TeamInjuries|null; source: string };

// ── 스포츠 타입 감지 ──
function detectSport(leagueName: string): 'baseball' | 'soccer' {
  const b = ['MLB','KBO','NPB','야구','메이저리그','퍼시픽','센트럴'];
  return b.some(k => leagueName.includes(k)) ? 'baseball' : 'soccer';
}

// ── 폼 도트 (W/D/L → 색깔 점) ──
function FormDots({ form }: { form: string }) {
  const C = useC();
  const letters = (form ?? '').toUpperCase().split('').filter(c => 'WDL'.includes(c));
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {letters.map((l, i) => (
        <span key={i} title={l === 'W' ? '승' : l === 'D' ? '무' : '패'} style={{
          width: 10, height: 10, borderRadius: '50%', display: 'inline-block',
          background: l === 'W' ? C.accent : l === 'D' ? '#EAB308' : C.warn,
        }} />
      ))}
    </span>
  );
}

// ── 능력치 바 (1~10 평점) ──
function RatingBar({ value, label, color }: { value: number; label: string; color: string }) {
  const C = useC();
  const pct = Math.min(100, Math.max(0, (value / 10) * 100));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
      <span style={{ fontSize: 10, color: C.muted, width: 28, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 5, background: C.surface2, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.4s' }} />
      </div>
      <span style={{ fontSize: 10, fontWeight: 800, color, width: 18, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{value}</span>
    </div>
  );
}

// ── 축구 상세 분석 패널 ──
function SoccerDetailPanel({
  analysis, injuries, homeName, awayName,
}: {
  analysis: MatchAnalysis;
  injuries: InjuriesData | null;
  homeName: string;
  awayName: string;
}) {
  const C = useC();
  return (
    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* 예상 스코어 */}
      {analysis.expected_score && (
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <span style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>예상 스코어</span>
          <div style={{ fontSize: 28, fontWeight: 900, color: C.accent, fontFamily: 'JetBrains Mono, monospace', letterSpacing: 2, marginTop: 2 }}>
            {analysis.expected_score}
          </div>
        </div>
      )}

      {/* 팀 능력치 비교 */}
      {(analysis.home_attack_rating || analysis.away_attack_rating) && (
        <div>
          <p style={{ fontSize: 10, fontWeight: 800, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>⚽ 팀 전력 비교</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* 홈팀 */}
            <div style={{ background: C.surface2, borderRadius: 8, padding: '8px 10px' }}>
              <p style={{ fontSize: 11, fontWeight: 800, color: C.text, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                🏠 {homeName}
                {analysis.home_recent_form && <FormDots form={analysis.home_recent_form} />}
              </p>
              {analysis.home_attack_rating != null && <RatingBar value={analysis.home_attack_rating} label="공격" color={C.warn} />}
              {analysis.home_defense_rating != null && <RatingBar value={analysis.home_defense_rating} label="수비" color={C.blue} />}
            </div>
            {/* 원정팀 */}
            <div style={{ background: C.surface2, borderRadius: 8, padding: '8px 10px' }}>
              <p style={{ fontSize: 11, fontWeight: 800, color: C.text, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                ✈️ {awayName}
                {analysis.away_recent_form && <FormDots form={analysis.away_recent_form} />}
              </p>
              {analysis.away_attack_rating != null && <RatingBar value={analysis.away_attack_rating} label="공격" color={C.warn} />}
              {analysis.away_defense_rating != null && <RatingBar value={analysis.away_defense_rating} label="수비" color={C.blue} />}
            </div>
          </div>
        </div>
      )}

      {/* 상대전적 */}
      {analysis.h2h_summary && (
        <div style={{ background: C.surface2, borderRadius: 8, padding: '8px 12px' }}>
          <p style={{ fontSize: 10, fontWeight: 800, color: C.blue, marginBottom: 4 }}>📊 상대 전적</p>
          <p style={{ fontSize: 12, color: C.text, lineHeight: 1.5, margin: 0 }}>{analysis.h2h_summary}</p>
        </div>
      )}

      {/* 주요 결장자 */}
      {((analysis.key_absences_home?.length ?? 0) > 0 || (analysis.key_absences_away?.length ?? 0) > 0 ||
        injuries?.home?.players?.length || injuries?.away?.players?.length) && (
        <div style={{ background: `#EAB30810`, border: `1px solid #EAB30830`, borderRadius: 8, padding: '8px 12px' }}>
          <p style={{ fontSize: 10, fontWeight: 800, color: '#EAB308', marginBottom: 6 }}>🏥 주요 결장자</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              { name: homeName, abs: analysis.key_absences_home ?? [], extData: injuries?.home },
              { name: awayName, abs: analysis.key_absences_away ?? [], extData: injuries?.away },
            ].map(({ name, abs, extData }) => {
              const extPlayers = (extData?.players ?? []).filter(p => p.status === '결장' || (p.chanceOfPlaying ?? 100) <= 50);
              const allNames = [...new Set([...abs, ...extPlayers.map(p => p.name)])].slice(0, 5);
              return (
                <div key={name}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.muted }}>{name}:</span>
                  {allNames.length === 0
                    ? <span style={{ fontSize: 10, color: C.accent, marginLeft: 4 }}>결장자 없음</span>
                    : allNames.map((n, i) => (
                      <div key={i} style={{ fontSize: 11, color: C.text, marginTop: 2 }}>
                        <span style={{ color: C.warn }}>⚠ </span>{n}
                      </div>
                    ))
                  }
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 종합 분석 텍스트 */}
      {analysis.match_summary && (
        <div style={{ background: `${C.blue}0C`, border: `1px solid ${C.blue}25`, borderRadius: 8, padding: '10px 12px' }}>
          <p style={{ fontSize: 10, fontWeight: 800, color: C.blue, marginBottom: 6 }}>📝 AI 종합 분석</p>
          <p style={{ fontSize: 12, color: C.text, lineHeight: 1.65, margin: 0, whiteSpace: 'pre-line' }}>{analysis.match_summary}</p>
        </div>
      )}
    </div>
  );
}

// ── 야구 상세 분석 패널 ──
function BaseballDetailPanel({
  analysis, pitchers, homeName, awayName,
}: {
  analysis: MatchAnalysis;
  pitchers: PitchersData | null;
  homeName: string;
  awayName: string;
}) {
  const C = useC();

  // 투수 정보: 외부 API 우선, AI 보조
  const homePitcher = pitchers?.home ?? (analysis.home_pitcher_name ? {
    name: analysis.home_pitcher_name, era: analysis.home_pitcher_era ?? null,
    wins: null, losses: null, whip: null, k9: null,
  } : null);
  const awayPitcher = pitchers?.away ?? (analysis.away_pitcher_name ? {
    name: analysis.away_pitcher_name, era: analysis.away_pitcher_era ?? null,
    wins: null, losses: null, whip: null, k9: null,
  } : null);
  const homeTeamStats = pitchers?.homeTeamStats ?? null;
  const awayTeamStats = pitchers?.awayTeamStats ?? null;

  const StatRow = ({ label, hv, av }: { label: string; hv: string | null; av: string | null }) => (
    <tr>
      <td style={{ padding: '4px 8px', color: C.text, fontWeight: 700, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', textAlign: 'center', background: `${C.blue}10` }}>{hv ?? '—'}</td>
      <td style={{ padding: '4px 8px', color: C.muted, fontSize: 10, fontWeight: 600, textAlign: 'center', whiteSpace: 'nowrap' }}>{label}</td>
      <td style={{ padding: '4px 8px', color: C.text, fontWeight: 700, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', textAlign: 'center', background: `${C.warn}10` }}>{av ?? '—'}</td>
    </tr>
  );

  return (
    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* 예상 스코어 */}
      {analysis.expected_score && (
        <div style={{ textAlign: 'center', padding: '6px 0' }}>
          <span style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>예상 스코어</span>
          <div style={{ fontSize: 28, fontWeight: 900, color: C.accent, fontFamily: 'JetBrains Mono, monospace', letterSpacing: 2, marginTop: 2 }}>
            {analysis.expected_score}
          </div>
        </div>
      )}

      {/* 선발 투수 비교 */}
      {(homePitcher || awayPitcher) && (
        <div>
          <p style={{ fontSize: 10, fontWeight: 800, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>⚾ 선발 투수 비교</p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ padding: '4px 8px', color: C.blue, fontSize: 11, fontWeight: 800, textAlign: 'center', background: `${C.blue}15` }}>
                  🏠 {homeName}
                </th>
                <th style={{ padding: '4px 8px', color: C.muted, fontSize: 10, textAlign: 'center' }}>항목</th>
                <th style={{ padding: '4px 8px', color: C.warn, fontSize: 11, fontWeight: 800, textAlign: 'center', background: `${C.warn}15` }}>
                  ✈️ {awayName}
                </th>
              </tr>
            </thead>
            <tbody>
              <StatRow label="투수명" hv={homePitcher?.name ?? null} av={awayPitcher?.name ?? null} />
              <StatRow label="ERA"
                hv={homePitcher?.era != null ? homePitcher.era.toFixed(2) : (analysis.home_pitcher_era != null ? analysis.home_pitcher_era.toFixed(2) : null)}
                av={awayPitcher?.era != null ? awayPitcher.era.toFixed(2) : (analysis.away_pitcher_era != null ? analysis.away_pitcher_era.toFixed(2) : null)} />
              <StatRow label="시즌성적"
                hv={homePitcher?.wins != null && homePitcher?.losses != null ? `${homePitcher.wins}승${homePitcher.losses}패` : (analysis.home_pitcher_record ?? null)}
                av={awayPitcher?.wins != null && awayPitcher?.losses != null ? `${awayPitcher.wins}승${awayPitcher.losses}패` : (analysis.away_pitcher_record ?? null)} />
              <StatRow label="WHIP"
                hv={homePitcher?.whip != null ? homePitcher.whip.toFixed(2) : null}
                av={awayPitcher?.whip != null ? awayPitcher.whip.toFixed(2) : null} />
              {(homePitcher?.k9 != null || awayPitcher?.k9 != null) && (
                <StatRow label="K/9"
                  hv={homePitcher?.k9 != null ? homePitcher.k9.toFixed(1) : null}
                  av={awayPitcher?.k9 != null ? awayPitcher.k9.toFixed(1) : null} />
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 팀 타격 통계 */}
      {(homeTeamStats || awayTeamStats || analysis.home_batting_avg || analysis.away_batting_avg) && (
        <div>
          <p style={{ fontSize: 10, fontWeight: 800, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>📊 팀 타격 통계 (시즌)</p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ padding: '4px 8px', color: C.blue, fontSize: 11, fontWeight: 800, textAlign: 'center', background: `${C.blue}15` }}>🏠 홈</th>
                <th style={{ padding: '4px 8px', color: C.muted, fontSize: 10, textAlign: 'center' }}>항목</th>
                <th style={{ padding: '4px 8px', color: C.warn, fontSize: 11, fontWeight: 800, textAlign: 'center', background: `${C.warn}15` }}>✈️ 원정</th>
              </tr>
            </thead>
            <tbody>
              <StatRow label="팀 타율"
                hv={(homeTeamStats?.avg ?? analysis.home_batting_avg) != null ? ((homeTeamStats?.avg ?? analysis.home_batting_avg)!).toFixed(3) : null}
                av={(awayTeamStats?.avg ?? analysis.away_batting_avg) != null ? ((awayTeamStats?.avg ?? analysis.away_batting_avg)!).toFixed(3) : null} />
              <StatRow label="홈런"
                hv={(homeTeamStats?.homeRuns ?? analysis.home_team_hr)?.toString() ?? null}
                av={(awayTeamStats?.homeRuns ?? analysis.away_team_hr)?.toString() ?? null} />
              <StatRow label="안타"
                hv={(homeTeamStats?.hits ?? analysis.home_team_hits)?.toString() ?? null}
                av={(awayTeamStats?.hits ?? analysis.away_team_hits)?.toString() ?? null} />
              <StatRow label="삼진"
                hv={(homeTeamStats?.strikeOuts ?? analysis.home_team_strikeouts)?.toString() ?? null}
                av={(awayTeamStats?.strikeOuts ?? analysis.away_team_strikeouts)?.toString() ?? null} />
              {(homeTeamStats?.obp || awayTeamStats?.obp) && (
                <StatRow label="출루율"
                  hv={homeTeamStats?.obp != null ? homeTeamStats.obp.toFixed(3) : null}
                  av={awayTeamStats?.obp != null ? awayTeamStats.obp.toFixed(3) : null} />
              )}
              {(homeTeamStats?.ops || awayTeamStats?.ops) && (
                <StatRow label="OPS"
                  hv={homeTeamStats?.ops != null ? homeTeamStats.ops.toFixed(3) : null}
                  av={awayTeamStats?.ops != null ? awayTeamStats.ops.toFixed(3) : null} />
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 상대전적 */}
      {analysis.h2h_summary && (
        <div style={{ background: C.surface2, borderRadius: 8, padding: '8px 12px' }}>
          <p style={{ fontSize: 10, fontWeight: 800, color: C.blue, marginBottom: 4 }}>📋 상대 전적</p>
          <p style={{ fontSize: 12, color: C.text, lineHeight: 1.5, margin: 0 }}>{analysis.h2h_summary}</p>
        </div>
      )}

      {/* 종합 분석 텍스트 */}
      {analysis.match_summary && (
        <div style={{ background: `${C.accent}0C`, border: `1px solid ${C.accent}25`, borderRadius: 8, padding: '10px 12px' }}>
          <p style={{ fontSize: 10, fontWeight: 800, color: C.accent, marginBottom: 6 }}>📝 AI 종합 분석</p>
          <p style={{ fontSize: 12, color: C.text, lineHeight: 1.65, margin: 0, whiteSpace: 'pre-line' }}>{analysis.match_summary}</p>
        </div>
      )}
    </div>
  );
}

function MatchBetmanRow({
  match, onClickDetail, onDelete, analysisHistory, analyzing, onAnalyze,
}: {
  match: Match;
  onClickDetail: (m: Match) => void;
  onDelete: (id: string, home: string, away: string) => void;
  analysisHistory: AnalysisEntry[];
  analyzing: boolean;
  onAnalyze: (force: boolean) => void;
}) {
  const C = useC();
  const isLive = match.status === 'live';
  const isDone = match.status === 'final';
  const date   = new Date(match.match_date);

  // 외부 데이터 (선발투수 / 부상자)
  const [pitchers, setPitchers] = useState<PitchersData|null>(null);
  const [injuries, setInjuries] = useState<InjuriesData|null>(null);
  const [fetchingExt, setFetchingExt] = useState(false);
  const [extFetched, setExtFetched]   = useState(false);
  const [showExt, setShowExt]         = useState(false);
  const [showDetail, setShowDetail]   = useState(false);

  const sport = detectSport(match.league?.name_kr ?? '');

  // 최신 분석 결과 — useEffect 의존성 배열보다 먼저 선언해야 함
  const analysis = analysisHistory.length > 0 ? analysisHistory[analysisHistory.length - 1] : null;

  const fetchExtData = async () => {
    if (fetchingExt) return;
    setFetchingExt(true);
    try {
      const [pRes, iRes] = await Promise.allSettled([
        fetch(`/api/external/pitchers?match_id=${match.id}`).then(r => r.ok ? r.json() : null),
        fetch(`/api/external/injuries?match_id=${match.id}`).then(r => r.ok ? r.json() : null),
      ]);
      if (pRes.status === 'fulfilled' && pRes.value) setPitchers(pRes.value);
      if (iRes.status === 'fulfilled' && iRes.value) setInjuries(iRes.value);
    } finally {
      setFetchingExt(false);
      setExtFetched(true);
      setShowExt(true);
    }
  };

  // 야구 경기이면 분석 완료 시 상세 패널 자동 열기 + 투수/타선 데이터 자동 수집
  // ※ expected_score가 undefined일 수 있으므로 analysisHistory.length 로 감지
  const hasAnalysis = analysisHistory.length > 0;
  useEffect(() => {
    if (sport !== 'baseball') return;
    // 분석 결과가 생겼을 때: 상세 패널 자동 오픈 + 투수 데이터 수집
    if (hasAnalysis) {
      if (!showDetail) setShowDetail(true);
      if (!extFetched && !fetchingExt) fetchExtData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAnalysis, sport]);

  const accentLine = isLive ? C.accent : isDone ? C.muted : C.blue;

  // bet_combos 가 있으면 사용, 없으면 latest_odds로 승무패 폴백 (getPcts에서 필요하므로 먼저 선언)
  const rawCombos = (match as unknown as { bet_combos?: BetCombo[] }).bet_combos ?? [];

  // 베팅 유형별 확률 매핑
  const allHandicapCombos = rawCombos.filter(c => c.bet_type === 'handicap');
  const getPcts = (combo: BetCombo): number[] | undefined => {
    if (!analysis) return undefined;
    switch (combo.bet_type) {
      case 'match_winner':
        return [analysis.home_win_pct, analysis.draw_pct, analysis.away_win_pct];
      case 'handicap': {
        // ─── 라인 값 파싱 — 승1패는 H-1과 동일하게 1.0 처리 ───
        const parseLineNum = (lv: string | null | undefined) => {
          if (!lv) return 0;
          if (lv.includes('승1패')) return 1.0;
          const n = parseFloat(lv.replace(/[^0-9.]/g, '') || '0');
          return isNaN(n) ? 0 : n;
        };

        // ─── 기본 AI 확률 ───
        const aiBase = [analysis.handicap_home_pct ?? 0, analysis.handicap_draw_pct ?? 0, analysis.handicap_away_pct ?? 0];

        // ─── 승1패 무=0 보정: AI가 무를 0으로 잘못 계산할 때 배당 역산으로 수정 ───
        // 기준 라인(첫 번째 핸디캡)에 무 배당이 있는데 AI가 0%로 출력한 경우
        const refCombo = allHandicapCombos[0] ?? combo;
        const isRefHalfLine = refCombo.line_value?.includes('.5') ?? false;
        const base = (() => {
          if (aiBase[1] !== 0) return aiBase;               // AI가 이미 정상 값
          if (!refCombo.draw_odds) return aiBase;            // 무 배당 없음 (H+2.5 등)
          if (isRefHalfLine) return aiBase;                  // .5 라인은 무 불가, 그대로 사용
          // 배당 역산 정규화: 각 배당의 역수 합산 후 비율 계산
          const rh = refCombo.home_odds ? 1 / refCombo.home_odds : 0;
          const rd = 1 / refCombo.draw_odds;
          const ra = refCombo.away_odds ? 1 / refCombo.away_odds : 0;
          const tot = rh + rd + ra;
          if (tot === 0) return aiBase;
          return [Math.round(rh / tot * 100), Math.round(rd / tot * 100), Math.round(ra / tot * 100)];
        })();

        // 핸디캡이 하나 (또는 단독 조회)여도 .5 라인이면 무 불가
        if (allHandicapCombos.length <= 1) {
          if (combo.line_value && combo.line_value.includes('.5')) {
            const half = Math.round(base[1] / 2);
            return [base[0] + half, 0, base[2] + (base[1] - half)];
          }
          return base;
        }

        const firstLineNum = parseLineNum(allHandicapCombos[0].line_value);
        const thisLineNum  = parseLineNum(combo.line_value);
        const diff = thisLineNum - firstLineNum; // 이 핸디가 첫 번째보다 얼마나 더 불리한가
        if (diff === 0) {
          // 이 라인이 .5면 무(push) 불가 — 드로우를 홈/원정에 배분
          if (combo.line_value && combo.line_value.includes('.5')) {
            const half = Math.round(base[1] / 2);
            return [base[0] + half, 0, base[2] + (base[1] - half)];
          }
          return base;
        }
        // 라인 1점 차이마다 홈 승률 약 10%p 보정 (홈 불리 방향으로 diff가 크면 홈 승률 감소)
        const adjust = Math.round(diff * 10);
        const h = Math.max(5,  Math.min(90, base[0] - adjust));
        const a = Math.max(5,  Math.min(90, base[2] + adjust));
        // .5 라인이면 무(push) 불가
        if (combo.line_value && combo.line_value.includes('.5')) {
          const total = h + a;
          return [Math.round(h * 100 / total), 0, Math.round(a * 100 / total)];
        }
        const d = Math.max(0, 100 - h - a);
        return [h, d, a];
      }
      case 'under_over':
        return [analysis.under_pct ?? 0, analysis.over_pct ?? 0];
      case 'sum':
        return [analysis.odd_pct ?? 0, analysis.even_pct ?? 0];
      case 'ht_match_winner':
        return [analysis.ht_home_win_pct ?? 0, analysis.ht_draw_pct ?? 0, analysis.ht_away_win_pct ?? 0];
      case 'ht_handicap': {
        const htVals = [analysis.ht_handicap_home_pct ?? 0, analysis.ht_handicap_draw_pct ?? 0, analysis.ht_handicap_away_pct ?? 0];
        // .5 라인 (예: H-1.5)은 무(push) 불가 → 드로우를 홈/원정에 균등 배분
        if (combo.line_value && combo.line_value.includes('.5')) {
          const half = Math.round(htVals[1] / 2);
          return [htVals[0] + half, 0, htVals[2] + (htVals[1] - half)];
        }
        return htVals;
      }
      case 'ht_under_over':
        return [analysis.ht_under_pct ?? 0, analysis.ht_over_pct ?? 0];
      default:
        return undefined;
    }
  };

  const displayCombos: BetCombo[] = rawCombos.length > 0
    ? rawCombos
    : match.latest_odds
      ? [{
          bet_type: 'match_winner' as const,
          betman_combo_no: match.betman_game_no ?? null,
          bet_label: '축구 승무패',
          home_odds: match.latest_odds.home_odds,
          draw_odds: match.latest_odds.draw_odds,
          away_odds: match.latest_odds.away_odds,
        }]
      : [];

  return (
    <div style={{
      borderRadius: 8, overflow: 'hidden',
      border: `1px solid ${C.border}`,
      borderLeft: `4px solid ${accentLine}`,
      marginBottom: 6,
      background: C.surface,
    }}>

      {/* ── 경기 헤더 ── */}
      <div
        onClick={() => {
          if (sport === 'baseball') {
            // 야구: 카드 내 상세 패널 + 투수/팀 데이터 자동 표시
            setShowDetail(true);
            if (!extFetched && !fetchingExt) fetchExtData();
          } else {
            onClickDetail(match);
          }
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 0,
          padding: '10px 16px', cursor: 'pointer',
          borderBottom: `1px solid ${C.border}`,
          background: isLive ? `${C.accent}0A` : C.surface,
        }}
        onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = `${C.accent}0A`}
        onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = isLive ? `${C.accent}0A` : C.surface}
      >
        {/* 날짜/시간 */}
        <div style={{ width: 90, flexShrink: 0 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: C.text, lineHeight: 1.4 }}>
            {date.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short' })}
          </p>
          <p style={{ fontSize: 13, fontWeight: 800, color: isLive ? C.accent : C.blue }}>
            {date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>

        {/* 스포츠 아이콘 + 리그 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: 195, flexShrink: 0 }}>
          <span style={{ fontSize: 15, flexShrink: 0 }}>⚽</span>
          <span style={{ fontSize: 12, color: C.muted, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {match.league?.name_kr ?? '기타'}
          </span>
        </div>

        {/* 팀 */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: C.text, whiteSpace: 'nowrap' }}>{match.home_team.name_kr}</span>
          <span style={{ fontSize: 12, color: C.muted, fontWeight: 400, flexShrink: 0 }}>vs</span>
          <span style={{ fontSize: 15, fontWeight: 800, color: C.text, whiteSpace: 'nowrap' }}>{match.away_team.name_kr}</span>
        </div>

        {/* 상태 + 외부데이터 + 삭제 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 12 }}>
          {isLive && (
            <span style={{ fontSize: 11, fontWeight: 800, color: C.accent, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.accent, display: 'inline-block', animation: 'lp 1.4s ease-in-out infinite' }} />LIVE
            </span>
          )}
          {isDone && <span style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>종료</span>}
          {/* 외부 데이터 버튼 */}
          <button
            title="선발투수/결장자 수집"
            onClick={e => {
              e.stopPropagation();
              if (extFetched) { setShowExt(v => !v); }
              else { fetchExtData(); }
            }}
            style={{
              height: 26, borderRadius: 6, border: `1px solid ${extFetched ? C.accent : C.border}40`,
              background: extFetched ? `${C.accent}18` : C.surface2,
              color: extFetched ? C.accent : C.muted,
              fontSize: 11, fontWeight: 700, padding: '0 8px',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              transition: 'all 0.15s',
            }}
          >
            {fetchingExt ? '⏳' : extFetched ? (showExt ? '📊▲' : '📊▼') : '📊 데이터'}
          </button>
          <button
            title="경기 삭제"
            onClick={e => { e.stopPropagation(); onDelete(match.id, match.home_team.name_kr, match.away_team.name_kr); }}
            style={{
              width: 28, height: 28, borderRadius: 6, border: `1px solid ${C.warn}40`,
              background: `${C.warn}10`, color: C.warn, fontSize: 14,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = `${C.warn}28`}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = `${C.warn}10`}
          >🗑</button>
        </div>
      </div>

      {/* ── 베팅 유형별 행 (승무패 / 핸디캡 / 언더오버 / SUM) ── */}
      {displayCombos.length > 0
        ? displayCombos.map((combo, i) => (
            <BetRow
              key={i}
              combo={combo}
              isFirst={i === 0}
              analyzing={analyzing}
              analyzed={analysis !== null}
              pcts={getPcts(combo)}
              onAnalyze={() => onAnalyze(analysis !== null)}
            />
          ))
        : (
          <div style={{ display: 'flex', padding: '14px 16px', background: C.surface2, borderTop: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 12, color: C.muted }}>배당 정보 없음</span>
          </div>
        )
      }

      {/* ── 야구: 투수 데이터 로딩 중 표시 ── */}
      {sport === 'baseball' && showDetail && fetchingExt && (
        <div style={{ padding: '8px 16px', background: `${C.accent}08`, borderTop: `1px solid ${C.accent}20`, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.muted }}>
          <span style={{ width: 10, height: 10, border: `2px solid ${C.accent}40`, borderTopColor: C.accent, borderRadius: '50%', display: 'inline-block', animation: 'cc-spin .7s linear infinite' }} />
          선발투수 · 팀 데이터 수집 중…
        </div>
      )}

      {/* ── 외부 데이터 패널 (투수/결장자) — 야구는 showDetail과 같이 표시 ── */}
      {(showExt || (sport === 'baseball' && showDetail)) && (pitchers || injuries) && (
        <div style={{
          padding: '10px 16px',
          background: `${C.accent}08`,
          borderTop: `1px solid ${C.accent}20`,
          fontSize: 11,
        }}>
          {/* 선발 투수 */}
          {pitchers && (pitchers.home || pitchers.away) && (
            <div style={{ marginBottom: injuries ? 8 : 0 }}>
              <span style={{ fontWeight: 800, color: C.accent, marginRight: 8 }}>⚾ 선발 투수</span>
              <span style={{ color: C.muted, fontSize: 10 }}>[{pitchers.leagueType} 공식]</span>
              <div style={{ marginTop: 5, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {[
                  { side: `홈 (${match.home_team.name_kr})`, data: pitchers.home },
                  { side: `원정 (${match.away_team.name_kr})`, data: pitchers.away },
                ].map(({ side, data }) => (
                  <div key={side} style={{ minWidth: 180 }}>
                    <span style={{ color: C.muted, fontWeight: 600 }}>{side}: </span>
                    {data ? (
                      <span style={{ color: C.text, fontWeight: 700 }}>
                        {data.name}
                        {data.era != null && <span style={{ color: C.muted, fontWeight: 400 }}> ERA {data.era}</span>}
                        {data.wins != null && data.losses != null && <span style={{ color: C.muted, fontWeight: 400 }}> {data.wins}승{data.losses}패</span>}
                        {data.whip != null && <span style={{ color: C.muted, fontWeight: 400 }}> WHIP {data.whip}</span>}
                      </span>
                    ) : (
                      <span style={{ color: C.muted }}>미확인</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* 부상/결장자 */}
          {injuries && (injuries.home || injuries.away) && (
            <div>
              <span style={{ fontWeight: 800, color: '#EAB308', marginRight: 8 }}>🏥 부상/결장</span>
              <span style={{ color: C.muted, fontSize: 10 }}>[{injuries.source}]</span>
              <div style={{ marginTop: 5, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {[
                  { side: `홈 (${match.home_team.name_kr})`, data: injuries.home },
                  { side: `원정 (${match.away_team.name_kr})`, data: injuries.away },
                ].map(({ side, data }) => (
                  <div key={side} style={{ minWidth: 200, maxWidth: 320 }}>
                    <span style={{ color: C.muted, fontWeight: 600 }}>{side}: </span>
                    {!data || data.players.length === 0
                      ? <span style={{ color: C.accent }}>부상자 없음</span>
                      : (
                        <div style={{ marginTop: 3 }}>
                          {data.players.slice(0, 5).map((p, i) => (
                            <div key={i} style={{ color: C.text, marginBottom: 2 }}>
                              <span style={{ color: C.warn }}>⚠ </span>
                              {p.name}
                              <span style={{ color: C.muted }}> — {p.injury.slice(0,40)}</span>
                              {p.chanceOfPlaying != null && (
                                <span style={{ color: p.chanceOfPlaying >= 75 ? C.accent : p.chanceOfPlaying >= 25 ? '#EAB308' : C.warn, marginLeft: 4 }}>
                                  [{p.chanceOfPlaying}%]
                                </span>
                              )}
                            </div>
                          ))}
                          {data.players.length > 5 && (
                            <span style={{ color: C.muted }}>+{data.players.length - 5}명 더</span>
                          )}
                        </div>
                      )
                    }
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── AI 추천 배너 ── */}
      {analysis && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 16px',
          background: `${C.blue}14`,
          borderTop: `1.5px solid ${C.blue}40`,
        }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>💡</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            {analysis.best_bet_option && (
              <span style={{ fontSize: 11, fontWeight: 800, color: C.blue, marginRight: 8 }}>
                AI 추천: {analysis.best_bet_option}
              </span>
            )}
            {analysis.expected_score && (
              <span style={{ fontSize: 11, fontWeight: 800, color: C.accent, marginRight: 8 }}>
                예상: {analysis.expected_score}
              </span>
            )}
            {analysis.best_bet_reason && (
              <span style={{ fontSize: 11, color: C.muted }}>{analysis.best_bet_reason}</span>
            )}
          </div>
          <span style={{
            fontSize: 10, fontWeight: 800, flexShrink: 0,
            padding: '2px 8px', borderRadius: 4,
            background: analysis.confidence === 'HIGH' ? `${C.accent}22` : analysis.confidence === 'LOW' ? `${C.warn}22` : '#EAB30822',
            color: analysis.confidence === 'HIGH' ? C.accent : analysis.confidence === 'LOW' ? C.warn : '#EAB308',
          }}>
            {analysis.confidence === 'HIGH' ? '🔥 신뢰도 높음' : analysis.confidence === 'LOW' ? '⚠️ 신뢰도 낮음' : '✅ 보통'}
          </span>
          {/* 상세 분석 토글 — 야구는 항상 표시, 축구는 상세 내용이 있을 때만 */}
          {(sport === 'baseball' || analysis.match_summary || analysis.home_attack_rating != null || analysis.home_pitcher_name || analysis.expected_score) && (
            <button
              onClick={() => {
                setShowDetail(v => !v);
                // 야구: 상세 버튼 클릭 시에도 투수 데이터 미수집이면 자동 수집
                if (sport === 'baseball' && !extFetched && !fetchingExt) fetchExtData();
              }}
              style={{
                flexShrink: 0, height: 26, borderRadius: 6, border: `1px solid ${C.blue}40`,
                background: showDetail ? `${C.blue}28` : C.surface2,
                color: C.blue, fontSize: 11, fontWeight: 700, padding: '0 8px',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {showDetail ? '▲ 접기' : '📋 상세'}
            </button>
          )}
        </div>
      )}

      {/* ── 스포츠별 상세 분석 패널 ── */}
      {analysis && showDetail && (
        <div style={{ borderTop: `1px solid ${C.border}`, background: C.surface }}>
          {sport === 'soccer'
            ? <SoccerDetailPanel analysis={analysis} injuries={injuries} homeName={match.home_team.name_kr} awayName={match.away_team.name_kr} />
            : <BaseballDetailPanel analysis={analysis} pitchers={pitchers} homeName={match.home_team.name_kr} awayName={match.away_team.name_kr} />
          }
        </div>
      )}

      {/* ── 재분석 이력 패널 ── */}
      <AnalysisHistoryPanel history={analysisHistory} />
    </div>
  );
}

// ── 경기 카드 (하위 호환 유지) ──
function MatchCard({ match, onClick, onDelete }: { match: Match; onClick: () => void; onDelete: (id: string) => void }) {
  const C = useC();
  const [deleting, setDeleting] = useState(false);
  const isLive = match.status === 'live';
  const isDone = match.status === 'final';
  const dateStr = new Date(match.match_date).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`${match.home_team.name_kr} vs ${match.away_team.name_kr} 경기를 삭제할까요?`)) return;
    setDeleting(true);
    try {
      await fetch(`/api/matches/${match.id}`, { method: 'DELETE' });
      onDelete(match.id);
    } catch {
      setDeleting(false);
    }
  };

  return (
    <div style={{
      background: C.surface, border: `1px solid ${isLive ? C.accent + '60' : C.border}`,
      borderRadius: 14, overflow: 'hidden', position: 'relative',
      transition: 'border-color 0.2s, transform 0.15s, box-shadow 0.2s',
      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      opacity: deleting ? 0.4 : 1,
    }}>
      {/* 카드 헤더 */}
      <div
        onClick={onClick}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', borderBottom: `1px solid ${C.border}`, background: isLive ? `${C.accent}10` : C.surface2, cursor: 'pointer' }}
        onMouseEnter={e => { (e.currentTarget.parentElement as HTMLDivElement).style.borderColor = C.accent + '80'; (e.currentTarget.parentElement as HTMLDivElement).style.transform = 'translateY(-2px)'; (e.currentTarget.parentElement as HTMLDivElement).style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)'; }}
        onMouseLeave={e => { (e.currentTarget.parentElement as HTMLDivElement).style.borderColor = isLive ? C.accent + '60' : C.border; (e.currentTarget.parentElement as HTMLDivElement).style.transform = 'none'; (e.currentTarget.parentElement as HTMLDivElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'; }}
      >
        <span style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>{match.betman_game_no && `#${match.betman_game_no} · `}{match.league?.name_kr}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isLive && (
            <span style={{ fontSize: 10, fontWeight: 800, color: C.accent, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.accent, display: 'inline-block', animation: 'lp 1.4s ease-in-out infinite' }} />LIVE
            </span>
          )}
          {isDone && <span style={{ fontSize: 10, color: C.muted }}>종료</span>}
          {!isLive && !isDone && <span style={{ fontSize: 10, color: C.muted }}>{dateStr}</span>}
        </div>
      </div>

      {/* 경기 정보 */}
      <div onClick={onClick} style={{ padding: '14px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <TeamBlock team={match.home_team} score={match.home_score} isWinner={match.home_score !== undefined && match.home_score > (match.away_score ?? 0)} isDone={isDone} />
        <div style={{ textAlign: 'center', flexShrink: 0, minWidth: 50 }}>
          {(isLive || isDone) && match.home_score !== undefined
            ? <span style={{ fontSize: 22, fontWeight: 900, color: C.text }}>{match.home_score} – {match.away_score}</span>
            : <span style={{ fontSize: 16, color: C.muted, fontWeight: 300 }}>VS</span>
          }
        </div>
        <TeamBlock team={match.away_team} score={match.away_score} isWinner={match.away_score !== undefined && match.away_score > (match.home_score ?? 0)} isDone={isDone} />
      </div>

      {/* 삭제 버튼 */}
      <button
        onClick={handleDelete}
        disabled={deleting}
        title="경기 삭제"
        style={{
          position: 'absolute', bottom: 10, right: 10,
          width: 26, height: 26, borderRadius: 8,
          border: `1px solid ${C.warn}40`,
          background: `${C.warn}12`, color: C.warn,
          fontSize: 12, cursor: deleting ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.15s', padding: 0,
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `${C.warn}30`; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = `${C.warn}12`; }}
      >
        {deleting ? '…' : '🗑'}
      </button>
    </div>
  );
}

function TeamBlock({ team, score, isWinner, isDone }: { team: { name_kr: string; logo_url?: string }; score?: number; isWinner: boolean; isDone: boolean }) {
  const C = useC();
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
      {team.logo_url && <img src={team.logo_url} alt="" style={{ width: 36, height: 36, objectFit: 'contain' }} />}
      <p style={{ fontSize: 12, fontWeight: 700, textAlign: 'center', color: isDone && isWinner ? C.accent : C.text, lineHeight: 1.3 }}>{team.name_kr}</p>
    </div>
  );
}

// ── OCR 결과 타입 ──
type OcrBetType = {
  combo_no?: number | null;
  type: 'match_winner' | 'handicap' | 'under_over' | 'sum' | 'ht_match_winner' | 'ht_handicap' | 'ht_under_over';
  label?: string;
  line_value?: string | null;
  home_odds?: number | null;
  draw_odds?: number | null;
  away_odds?: number | null;
  under_odds?: number | null;
  over_odds?: number | null;
  odd_odds?: number | null;
  even_odds?: number | null;
};

type OcrMatch = {
  betman_game_no: string | null;
  league_name: string;
  home_name: string;
  away_name: string;
  match_date: string;
  home_odds: number | null;
  draw_odds: number | null;
  away_odds: number | null;
  bet_types?: OcrBetType[];
};

// ── 베팅 조합 타입 ──
type BetCombo = {
  bet_type: 'match_winner' | 'handicap' | 'under_over' | 'sum' | 'ht_match_winner' | 'ht_handicap' | 'ht_under_over';
  betman_combo_no: number | null;
  bet_label: string;
  line_value?: string | null;
  home_odds?: number | null;
  draw_odds?: number | null;
  away_odds?: number | null;
  under_odds?: number | null;
  over_odds?: number | null;
  odd_odds?: number | null;
  even_odds?: number | null;
};

// ── 경기 추가 모달 (이미지 자동저장 + 수동 입력) ──
function AddMatchModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const C = useC();

  const [form, setForm] = useState({
    betman_round: '', betman_game_no: '',
    league_name: '', home_name: '', away_name: '',
    match_date: '', venue: '',
    home_odds: '', draw_odds: '', away_odds: '',
  });
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState('');

  // 이미지 OCR 상태
  const [imageB64, setImageB64]   = useState<string | null>(null);
  const [imageMime, setImageMime] = useState('image/png');
  const [imageThumb, setThumb]    = useState<string | null>(null);
  const [phase, setPhase]         = useState<'idle'|'analyzing'|'saving'|'done'>('idle');
  const [savedCount, setSavedCount] = useState(0);
  const [ocrPreview, setOcrPreview] = useState<OcrMatch[]>([]);
  const [dragOver, setDragOver]   = useState(false);

  // 이미지 로드
  const loadImage = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setThumb(url);
      setImageB64(url.split(',')[1]);
      setImageMime(file.type || 'image/png');
      setPhase('idle');
      setOcrPreview([]);
      setErr('');
    };
    reader.readAsDataURL(file);
  }, []);

  // Ctrl+V 붙여넣기
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const imgItem = Array.from(e.clipboardData?.items ?? []).find(it => it.type.startsWith('image/'));
      if (imgItem) { const blob = imgItem.getAsFile(); if (blob) loadImage(blob); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [loadImage]);

  // 분석 → 자동저장 (원클릭)
  const analyzeAndSave = async () => {
    if (!imageB64) return;
    setErr(''); setPhase('analyzing');
    let matches: OcrMatch[] = [];
    let round = '';

    try {
      const res = await fetch('/api/matches/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: imageB64, mimeType: imageMime }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      matches = (data.matches ?? []) as OcrMatch[];
      round = data.betman_round ?? '';
      setOcrPreview(matches);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'AI 분석 실패');
      setPhase('idle'); return;
    }

    if (matches.length === 0) {
      setErr('경기를 찾지 못했습니다. 배트맨 화면 이미지를 다시 확인해주세요.');
      setPhase('idle'); return;
    }

    // 자동 저장 (조합 번호 순 = 이미지 순서)
    setPhase('saving');
    let ok = 0;
    for (const m of matches) {
      try {
        const r = await fetch('/api/matches/manual', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            betman_round:   round || undefined,
            betman_game_no: m.betman_game_no || undefined,
            league_name:    m.league_name,
            home_name:      m.home_name,
            away_name:      m.away_name,
            match_date:     m.match_date,
            home_odds:      m.home_odds,
            draw_odds:      m.draw_odds,
            away_odds:      m.away_odds,
            bet_types:      m.bet_types || undefined,
          }),
        });
        if (r.ok) ok++;
      } catch { /* skip individual */ }
    }
    setSavedCount(ok);
    setPhase('done');
    onAdded();
    // 1.8초 후 닫기
    setTimeout(() => onClose(), 1800);
  };

  // 수동 폼 저장
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const submit = async () => {
    if (!form.home_name || !form.away_name || !form.match_date) {
      setErr('홈팀, 원정팀, 경기일시는 필수입니다.'); return;
    }
    setSaving(true); setErr('');
    try {
      const res = await fetch('/api/matches/manual', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onAdded(); onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장 실패');
    } finally { setSaving(false); }
  };

  const Field = ({ label, k, placeholder, type = 'text' }: { label: string; k: string; placeholder?: string; type?: string }) => (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '0.05em', display: 'block', marginBottom: 5 }}>{label}</label>
      <input
        type={type} value={(form as Record<string, string>)[k]} placeholder={placeholder}
        onChange={e => set(k, e.target.value)}
        style={{ width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13, color: C.text, background: C.surface2, border: `1px solid ${C.border}`, outline: 'none', boxSizing: 'border-box' }}
      />
    </div>
  );

  const busy = phase === 'analyzing' || phase === 'saving';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={!busy ? onClose : undefined}>
      <div style={{ background: C.surface, borderRadius: 20, width: '100%', maxWidth: 560, maxHeight: '92vh', overflow: 'auto', padding: 28, boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>

        {/* 헤더 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: C.text }}>➕ 경기 추가</h2>
          {!busy && <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: C.muted }}>✕</button>}
        </div>

        {/* ── 이미지 자동저장 섹션 ── */}
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.accent, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>
            📸 배트맨 화면 이미지 → 자동 저장
          </p>

          {/* 성공 완료 뷰 */}
          {phase === 'done' && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <p style={{ fontSize: 40, marginBottom: 10 }}>✅</p>
              <p style={{ fontSize: 16, fontWeight: 800, color: C.accent, marginBottom: 6 }}>{savedCount}개 경기 저장 완료!</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                {ocrPreview.map((m, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', background: C.surface2, borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
                    <span style={{ color: C.text, fontWeight: 700 }}>{m.betman_game_no && <span style={{ color: C.muted, marginRight: 6 }}>#{m.betman_game_no}</span>}{m.home_name} vs {m.away_name}</span>
                    <span style={{ color: C.muted }}>{m.league_name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 분석/저장 진행 중 */}
          {(phase === 'analyzing' || phase === 'saving') && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <span style={{ display: 'inline-block', width: 40, height: 40, border: `3px solid ${C.accent}30`, borderTopColor: C.accent, borderRadius: '50%', animation: 'cc-spin .8s linear infinite', marginBottom: 14 }} />
              <p style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                {phase === 'analyzing' ? '🤖 AI가 경기 정보 추출 중…' : '💾 경기 자동 저장 중…'}
              </p>
              <p style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>배트맨 조합 번호 순으로 저장합니다</p>
            </div>
          )}

          {/* 이미지 업로드 영역 (idle 상태) */}
          {phase === 'idle' && (
            <>
              {/* 드롭존 */}
              {!imageThumb && (
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) loadImage(f); }}
                  onClick={() => document.getElementById('ocr-file-input')?.click()}
                  style={{
                    border: `2px dashed ${dragOver ? C.accent : C.border}`, borderRadius: 12,
                    padding: '28px 16px', textAlign: 'center', cursor: 'pointer',
                    background: dragOver ? `${C.accent}08` : C.surface2, transition: 'all 0.15s',
                  }}
                >
                  <p style={{ fontSize: 28, marginBottom: 8 }}>🖼️</p>
                  <p style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>배트맨 화면 붙여넣기 (Ctrl+V)</p>
                  <p style={{ fontSize: 11, color: C.muted }}>또는 클릭하여 파일 선택 · 드래그 앤 드롭</p>
                </div>
              )}
              <input id="ocr-file-input" type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) loadImage(f); e.target.value = ''; }} />

              {/* 미리보기 + 분석 버튼 */}
              {imageThumb && (
                <>
                  <div style={{ position: 'relative', marginBottom: 12 }}>
                    <img src={imageThumb} alt="업로드 이미지"
                      style={{ width: '100%', maxHeight: 220, objectFit: 'contain', borderRadius: 10, border: `1px solid ${C.border}` }} />
                    <button
                      onClick={() => { setImageB64(null); setThumb(null); setErr(''); }}
                      style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.65)', border: 'none', borderRadius: '50%', color: '#fff', fontSize: 13, width: 26, height: 26, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >✕</button>
                  </div>
                  <button
                    onClick={analyzeAndSave}
                    style={{
                      width: '100%', padding: '13px', borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: `linear-gradient(135deg, ${C.accent}, ${C.blue})`, color: '#fff',
                      fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      boxShadow: `0 4px 16px ${C.accent}40`,
                    }}
                  >
                    🚀 AI 분석 → 자동 저장
                  </button>
                </>
              )}
            </>
          )}

          {err && <p style={{ fontSize: 12, color: C.warn, marginTop: 10 }}>❌ {err}</p>}
        </div>

        {/* 구분선 */}
        {phase === 'idle' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <div style={{ flex: 1, height: 1, background: C.border }} />
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>또는 직접 입력</span>
              <div style={{ flex: 1, height: 1, background: C.border }} />
            </div>

            {/* 수동 입력 폼 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <Field label="배트맨 회차" k="betman_round" placeholder="예) 2026년 제123회" />
              <Field label="경기 번호" k="betman_game_no" placeholder="예) 8297" />
            </div>
            <Field label="리그명" k="league_name" placeholder="예) 잉글랜드 챔피언십" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <Field label="홈팀 *" k="home_name" placeholder="예) 포츠머스" />
              <Field label="원정팀 *" k="away_name" placeholder="예) 더비 카운티" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <Field label="경기 일시 *" k="match_date" type="datetime-local" />
              <Field label="경기장" k="venue" placeholder="예) Fratton Park" />
            </div>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 10, marginTop: 4 }}>배당 (선택)</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 12px' }}>
              <Field label="홈 승" k="home_odds" placeholder="1.95" type="number" />
              <Field label="무" k="draw_odds" placeholder="3.05" type="number" />
              <Field label="원정 승" k="away_odds" placeholder="3.25" type="number" />
            </div>
            <button onClick={submit} disabled={saving} style={{
              width: '100%', padding: '11px', borderRadius: 10, border: `1px solid ${C.border}`,
              cursor: saving ? 'not-allowed' : 'pointer', background: C.surface2, color: saving ? C.muted : C.text,
              fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              {saving ? <><span style={{ width: 13, height: 13, border: `2px solid ${C.accent}40`, borderTopColor: C.accent, borderRadius: '50%', display: 'inline-block', animation: 'cc-spin .7s linear infinite' }} />저장 중…</> : '💾 수동 입력 저장'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── 메인 페이지 ──
export default function HomePage() {
  const [isDark, setIsDark]         = useState(false);   // 기본: 라이트 모드
  const [matches, setMatches]       = useState<Match[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [selectedMatch, setSelected] = useState<Match | null>(null);
  const [filterStatus, setFilter]   = useState<string>('all');
  const [scraping, setScraping]         = useState(false);
  const [showAddModal, setShowAdd]      = useState(false);
  const [zentotoState, setZentotoState] = useState<'idle'|'loading'|'done'|'error'>('idle');
  const [zentotoMsg, setZentotoMsg]     = useState('');

  // ── 전체 분석 상태 ──
  const [analysisHistory, setAnalysisHistory] = useState<Record<string, AnalysisEntry[]>>({});
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [analyzingAll, setAnalyzingAll] = useState(false);
  const [analyzingAllMode, setAnalyzingAllMode] = useState<'new'|'reanalyze'>('new'); // 전체분석 vs 전체재분석
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [analyzeTotal, setAnalyzeTotal] = useState(0);
  // ── 카테고리 선택 ──
  const [selectedCat, setSelectedCat] = useState<BetCatKey | null>(null);

  const C = isDark ? DARK : LIGHT;

  const fetchMatches = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/betman');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMatches(data.matches ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '데이터 로드 실패');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchMatches(); }, [fetchMatches]);

  const triggerScrape = async () => {
    setScraping(true);
    try {
      await fetch('/api/betman', { method: 'POST' });
      await fetchMatches();
    } finally { setScraping(false); }
  };

  // 젠토토 수집 (서버사이드 → fallback 클라이언트)
  const collectZentoto = async () => {
    setZentotoState('loading');
    setZentotoMsg('');
    try {
      const res = await fetch('/api/matches/zentoto');
      const data = await res.json();

      if (res.status === 422 && data.error === 'JS_RENDER') {
        // 페이지가 JS 렌더링 → 브라우저 직접 수집
        setZentotoMsg('브라우저 수집 시도 중…');
        await collectZentotoBrowser();
        return;
      }
      if (!res.ok) throw new Error(data.error ?? '수집 실패');

      setZentotoState('done');
      setZentotoMsg(`✅ ${data.saved}개 저장 (${data.total}경기 중)`);
      await fetchMatches();
      setTimeout(() => { setZentotoState('idle'); setZentotoMsg(''); }, 4000);
    } catch (e) {
      setZentotoState('error');
      setZentotoMsg(e instanceof Error ? e.message : String(e));
      setTimeout(() => { setZentotoState('idle'); setZentotoMsg(''); }, 5000);
    }
  };

  // 브라우저 DOM 직접 수집 (서버사이드 파싱 실패 시)
  const collectZentotoBrowser = async () => {
    try {
      // 숨겨진 iframe으로 젠토토 로드 (동일 브라우저 세션 활용)
      // — CORS 때문에 iframe 직접 접근 불가이므로 새탭 안내 + 직접 fetch 재시도
      // 실제로는 서버사이드에서 fetch한 HTML을 파싱하는 방식이 가장 안정적
      const proxyRes = await fetch('/api/matches/zentoto', { cache: 'no-store' });
      const d = await proxyRes.json();
      if (d.saved !== undefined) {
        setZentotoState('done');
        setZentotoMsg(`✅ ${d.saved}개 저장 완료`);
        await fetchMatches();
        setTimeout(() => { setZentotoState('idle'); setZentotoMsg(''); }, 4000);
      } else {
        throw new Error(d.message ?? '파싱 실패');
      }
    } catch (e) {
      setZentotoState('error');
      setZentotoMsg('수집 실패 — 잠시 후 다시 시도하세요');
      setTimeout(() => { setZentotoState('idle'); setZentotoMsg(''); }, 5000);
    }
  };

  // 경기 삭제 (개별)
  const handleDelete = async (id: string, home: string, away: string) => {
    if (!window.confirm(`${home} vs ${away} 경기를 삭제할까요?`)) return;
    try {
      const res = await fetch(`/api/matches/${id}`, { method: 'DELETE' });
      if (res.ok) setMatches(prev => prev.filter(m => m.id !== id));
    } catch { /* ignore */ }
  };

  // 종료 경기 일괄 삭제
  const [deletingFinal, setDeletingFinal] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const deleteAllMatches = async () => {
    if (matches.length === 0) { alert('삭제할 경기가 없습니다.'); return; }
    if (!window.confirm(`경기 ${matches.length}개를 전부 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`)) return;
    setDeletingAll(true);
    try {
      const res = await fetch('/api/matches/delete-all', { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        setMatches([]);
        setAnalysisHistory({});
        setSelectedCat(null);
        setFilter('all');
        setSelected(null);
        alert(`경기 ${data.deleted ?? matches.length}개가 모두 삭제되었습니다.`);
      } else {
        alert('삭제 실패: ' + (data.error ?? '알 수 없는 오류'));
      }
    } catch { alert('네트워크 오류로 삭제에 실패했습니다.'); }
    finally { setDeletingAll(false); }
  };
  const deleteFinalMatches = async () => {
    const finalCount = matches.filter(m => m.status === 'final').length;
    if (finalCount === 0) { alert('삭제할 종료 경기가 없습니다.'); return; }
    if (!window.confirm(`종료된 경기 ${finalCount}개를 모두 삭제할까요?`)) return;
    setDeletingFinal(true);
    try {
      const res = await fetch('/api/matches/final-delete', { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        setMatches(prev => prev.filter(m => m.status !== 'final'));
        setSelectedCat(null);
        setFilter('all');
        alert(`종료 경기 ${data.deleted ?? finalCount}개가 삭제되었습니다.`);
      } else {
        alert('삭제 실패: ' + (data.error ?? '알 수 없는 오류'));
      }
    } catch { alert('네트워크 오류로 삭제에 실패했습니다.'); }
    finally { setDeletingFinal(false); }
  };

  // 개별 경기 분석 (force=true면 캐시 무시 → 재분석)
  const [analyzeErrMsg, setAnalyzeErrMsg] = useState('');
  const analyzeMatch = useCallback(async (match: Match, force = false): Promise<boolean> => {
    setAnalyzingIds(prev => new Set([...prev, match.id]));
    const ctrl = new AbortController();
    const killTimer = setTimeout(() => ctrl.abort(), 55000);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match, force }),
        signal: ctrl.signal,
      });
      clearTimeout(killTimer);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setAnalyzeErrMsg(`분석 실패: ${err.detail ?? err.error ?? res.status}`);
        setTimeout(() => setAnalyzeErrMsg(''), 5000);
        return false;
      }
      const data = await res.json();
      if (data.result) {
        setAnalysisHistory(prev => {
          const existing = prev[match.id] ?? [];
          const nth = existing.length + 1;
          const entry: AnalysisEntry = { ...(data.result as MatchAnalysis), timestamp: Date.now(), nth };
          return { ...prev, [match.id]: [...existing, entry] };
        });
        return true;
      }
      return false;
    } catch (e) {
      clearTimeout(killTimer);
      setAnalyzeErrMsg(`오류: ${e instanceof Error ? e.message : String(e)}`);
      setTimeout(() => setAnalyzeErrMsg(''), 5000);
      return false;
    }
    finally {
      setAnalyzingIds(prev => { const s = new Set(prev); s.delete(match.id); return s; });
    }
  }, []);

  const filtered = filterStatus === 'all' ? matches : matches.filter(m => m.status === filterStatus);

  // 전체 경기 일괄 분석 — setTimeout 큐 방식 + 실패 시 3초 후 재시도
  const analyzeAll = () => {
    const pending = [...matches.filter(m => !(analysisHistory[m.id]?.length))];
    if (!pending.length) return;
    setAnalyzingAll(true);
    setAnalyzingAllMode('new');
    setAnalyzeProgress(0);
    setAnalyzeTotal(pending.length);

    let done = 0;

    const runOne = (match: Match, retried: boolean, cb: () => void) => {
      analyzeMatch(match)
        .then(ok => {
          if (!ok && !retried) {
            // 1차 실패 → 3초 후 재시도 1회
            setTimeout(() => runOne(match, true, cb), 3000);
          } else {
            cb();
          }
        })
        .catch(() => cb()); // 예외도 무시하고 계속
    };

    const next = (idx: number) => {
      if (idx >= pending.length) {
        setAnalyzingAll(false);
        return;
      }
      runOne(pending[idx], false, () => {
        done++;
        setAnalyzeProgress(done);
        setTimeout(() => next(idx + 1), 800); // 다음 경기
      });
    };

    next(0);
  };

  return (
    <ThemeCtx.Provider value={C}>
      <div style={{ height: '100vh', overflow: 'hidden', background: C.bg, color: C.text, fontFamily: 'Space Grotesk, -apple-system, sans-serif', transition: 'background 0.25s, color 0.25s' }}>
        <div style={{ display: 'flex', height: '100vh' }}>

          {/* 사이드바 */}
          <aside style={{ width: 270, background: C.surface, borderRight: `1px solid ${C.border}`, padding: '24px 16px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16, transition: 'background 0.25s', overflowY: 'auto' }}>
            {/* 로고 + 다크모드 토글 */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 22 }}>⚽</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: C.text, letterSpacing: '-0.02em' }}>SportsBet AI</span>
                </div>
                {/* 낮/밤 토글 버튼 */}
                <button
                  onClick={() => setIsDark(d => !d)}
                  title={isDark ? '라이트 모드로 전환' : '다크 모드로 전환'}
                  style={{
                    width: 46, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer', padding: 0,
                    background: isDark ? '#1A2030' : '#D1E3FF',
                    position: 'relative', transition: 'background 0.25s', flexShrink: 0,
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 3, left: isDark ? 23 : 3,
                    width: 20, height: 20, borderRadius: '50%',
                    background: isDark ? '#F0C040' : '#4E9BFF',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, transition: 'left 0.25s, background 0.25s',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
                  }}>
                    {isDark ? '🌙' : '☀️'}
                  </span>
                </button>
              </div>
              <p style={{ fontSize: 10, color: C.muted, fontFamily: 'JetBrains Mono, monospace' }}>배트맨 기반 분석기</p>
            </div>

            {/* 필터 */}
            <div>
              <p style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>경기 상태</p>
              {[
                { id: 'all',       label: '전체',    count: matches.length },
                { id: 'scheduled', label: '예정',    count: matches.filter(m => m.status === 'scheduled').length },
                { id: 'live',      label: '진행 중', count: matches.filter(m => m.status === 'live').length },
              ].map(f => (
                <button key={f.id} onClick={() => { setFilter(f.id); setSelectedCat(null); }} style={{
                  width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', marginBottom: 4,
                  background: filterStatus === f.id ? `${C.accent}18` : 'transparent',
                  color: filterStatus === f.id ? C.accent : C.muted,
                  fontSize: 13, fontWeight: filterStatus === f.id ? 700 : 400,
                  textAlign: 'left', transition: 'all 0.15s',
                }}>
                  {f.label}
                  <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', background: C.surface2, color: C.muted, padding: '1px 6px', borderRadius: 4 }}>{f.count}</span>
                </button>
              ))}
              {/* 종료경기삭제 버튼 */}
              <button
                onClick={deleteFinalMatches}
                disabled={deletingFinal}
                style={{
                  width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 10px', borderRadius: 8, border: 'none', cursor: deletingFinal ? 'not-allowed' : 'pointer', marginBottom: 4,
                  background: 'transparent',
                  color: matches.filter(m => m.status === 'final').length > 0 ? C.warn : C.muted,
                  fontSize: 13, fontWeight: 400,
                  textAlign: 'left', transition: 'all 0.15s',
                }}
              >
                {deletingFinal ? '삭제 중…' : '🗑 종료경기삭제'}
                <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', background: C.surface2, color: C.muted, padding: '1px 6px', borderRadius: 4 }}>
                  {matches.filter(m => m.status === 'final').length}
                </span>
              </button>

              {/* 경기 전체 삭제 버튼 */}
              <button
                onClick={deleteAllMatches}
                disabled={deletingAll || matches.length === 0}
                style={{
                  width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 10px', borderRadius: 8, border: 'none',
                  cursor: deletingAll || matches.length === 0 ? 'not-allowed' : 'pointer',
                  background: 'transparent',
                  color: matches.length > 0 ? C.warn : C.muted,
                  fontSize: 13, fontWeight: 400,
                  textAlign: 'left', transition: 'all 0.15s',
                }}
              >
                {deletingAll ? '삭제 중…' : '🗑 경기전체삭제'}
                <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', background: C.surface2, color: C.muted, padding: '1px 6px', borderRadius: 4 }}>
                  {matches.length}
                </span>
              </button>
            </div>

            {/* 버튼 영역 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

              {/* 전체 재분석 버튼 */}
              <button
                onClick={() => {
                  const all = [...matches];
                  if (!all.length) return;
                  setAnalyzingAll(true);
                  setAnalyzingAllMode('reanalyze');
                  setAnalyzeProgress(0);
                  setAnalyzeTotal(all.length);
                  let done = 0;
                  const runOne = (match: Match, retried: boolean, cb: () => void) => {
                    analyzeMatch(match, true) // force=true → 캐시 무시 재분석
                      .then(ok => {
                        if (!ok && !retried) {
                          setTimeout(() => runOne(match, true, cb), 3000);
                        } else { cb(); }
                      })
                      .catch(() => cb());
                  };
                  const next = (idx: number) => {
                    if (idx >= all.length) { setAnalyzingAll(false); return; }
                    runOne(all[idx], false, () => {
                      done++;
                      setAnalyzeProgress(done);
                      setTimeout(() => next(idx + 1), 800);
                    });
                  };
                  next(0);
                }}
                disabled={analyzingAll || matches.length === 0}
                style={{
                  width: '100%', padding: '11px', borderRadius: 10,
                  border: `1px solid ${C.warn}`,
                  background: analyzingAll ? `${C.warn}20` : `${C.warn}18`,
                  color: analyzingAll ? C.warn : C.warn,
                  fontSize: 12, fontWeight: 800,
                  cursor: analyzingAll || matches.length === 0 ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  transition: 'all 0.2s',
                }}
              >
                {analyzingAll
                  ? <>
                      <span style={{ width: 13, height: 13, border: `2px solid ${C.warn}40`, borderTopColor: C.warn, borderRadius: '50%', display: 'inline-block', animation: 'cc-spin .7s linear infinite' }} />
                      {analyzeProgress}/{analyzeTotal} 재분석 중…
                    </>
                  : '🔄 전체 재분석'}
              </button>

              {/* 전체 분석 버튼 */}
              <button
                onClick={analyzeAll}
                disabled={analyzingAll || filtered.length === 0}
                style={{
                  width: '100%', padding: '11px', borderRadius: 10,
                  border: `1px solid ${C.blue}`,
                  background: analyzingAll && analyzingAllMode === 'new' ? `${C.blue}20` : C.blue,
                  color: analyzingAll && analyzingAllMode === 'new' ? C.blue : '#fff',
                  fontSize: 12, fontWeight: 800, cursor: analyzingAll || filtered.length === 0 ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  transition: 'all 0.2s',
                }}
              >
                {analyzingAll && analyzingAllMode === 'new'
                  ? <>
                      <span style={{ width: 13, height: 13, border: `2px solid ${C.blue}40`, borderTopColor: C.blue, borderRadius: '50%', display: 'inline-block', animation: 'cc-spin .7s linear infinite' }} />
                      {analyzeProgress}/{analyzeTotal} 분석 중…
                    </>
                  : '🤖 전체 분석'}
              </button>

              {/* 남은 분석 이어서 하기 버튼 */}
              {(() => {
                // 분석 미완료: ① 분석 자체가 없거나
                //              ② ht 베팅이 있는데 ht 값이 누락된 경우(캐시 불완전)
                const needsForce = (m: Match) => {
                  const hist = analysisHistory[m.id];
                  if (!hist?.length) return false;
                  const latest = hist[hist.length - 1];
                  const combos = (m as unknown as { bet_combos?: BetCombo[] }).bet_combos ?? [];
                  const hasHt = combos.some(c =>
                    c.bet_type === 'ht_match_winner' || c.bet_type === 'ht_handicap' || c.bet_type === 'ht_under_over'
                  );
                  return hasHt && !latest.ht_home_win_pct && !latest.ht_draw_pct && !latest.ht_away_win_pct;
                };
                const remaining = matches.filter(m => !analysisHistory[m.id]?.length || needsForce(m));
                if (remaining.length === 0) return null;
                return (
                  <button
                    onClick={() => {
                      setAnalyzingAll(false);
                      setTimeout(() => {
                        const pending = matches.filter(m => !analysisHistory[m.id]?.length || needsForce(m));
                        if (!pending.length) return;
                        setAnalyzingAll(true);
                        setAnalyzeProgress(0);
                        setAnalyzeTotal(pending.length);
                        let done = 0;
                        const runOne = (match: Match, retried: boolean, cb: () => void) => {
                          const force = needsForce(match);
                          analyzeMatch(match, force)
                            .then(ok => {
                              if (!ok && !retried) {
                                setTimeout(() => runOne(match, true, cb), 3000);
                              } else { cb(); }
                            })
                            .catch(() => cb());
                        };
                        const next = (idx: number) => {
                          if (idx >= pending.length) { setAnalyzingAll(false); return; }
                          runOne(pending[idx], false, () => {
                            done++;
                            setAnalyzeProgress(done);
                            setTimeout(() => next(idx + 1), 800);
                          });
                        };
                        next(0);
                      }, 200);
                    }}
                    disabled={analyzingAll}
                    style={{
                      width: '100%', padding: '11px', borderRadius: 10,
                      border: `1px solid ${C.blue}`,
                      background: analyzingAll ? `${C.blue}10` : `${C.blue}18`,
                      color: C.blue,
                      fontSize: 12, fontWeight: 800,
                      cursor: analyzingAll ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      transition: 'all 0.2s',
                    }}
                  >
                    ⏩ 남은 분석 이어서 하기 ({remaining.length}개)
                  </button>
                );
              })()}

              {/* 경기 직접 추가 */}
              <button onClick={() => setShowAdd(true)} style={{
                width: '100%', padding: '10px', borderRadius: 10, border: `1px solid ${C.accent}`,
                background: C.accent, color: '#fff',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>
                ➕ 경기 직접 추가
              </button>

              {/* 젠토토 수집 */}
              <button
                onClick={collectZentoto}
                disabled={zentotoState === 'loading'}
                style={{
                  width: '100%', padding: '10px', borderRadius: 10,
                  border: `1px solid ${zentotoState === 'done' ? C.accent + '80' : zentotoState === 'error' ? C.warn + '80' : C.blue + '60'}`,
                  background: zentotoState === 'done' ? `${C.accent}18` : zentotoState === 'error' ? `${C.warn}18` : `${C.blue}14`,
                  color: zentotoState === 'done' ? C.accent : zentotoState === 'error' ? C.warn : C.blue,
                  fontSize: 12, fontWeight: 700,
                  cursor: zentotoState === 'loading' ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  transition: 'all 0.2s',
                }}
              >
                {zentotoState === 'loading'
                  ? <><span style={{ width: 12, height: 12, border: `2px solid ${C.blue}40`, borderTopColor: C.blue, borderRadius: '50%', display: 'inline-block', animation: 'cc-spin .7s linear infinite' }} />수집 중…</>
                  : '🌐 젠토토 수집'}
              </button>
              {zentotoMsg && (
                <p style={{ fontSize: 10, textAlign: 'center', marginTop: -4,
                  color: zentotoState === 'error' ? C.warn : zentotoState === 'done' ? C.accent : C.muted }}>
                  {zentotoMsg}
                </p>
              )}

              {/* 배트맨 자동 수집 */}
              <button onClick={triggerScrape} disabled={scraping} style={{
                width: '100%', padding: '10px', borderRadius: 10, border: `1px solid ${C.border}`,
                background: C.surface2, color: scraping ? C.muted : C.muted,
                fontSize: 12, fontWeight: 600, cursor: scraping ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                {scraping
                  ? <><span style={{ width: 12, height: 12, border: `2px solid ${C.accent}40`, borderTopColor: C.accent, borderRadius: '50%', display: 'inline-block', animation: 'cc-spin .7s linear infinite' }} />수집 중…</>
                  : '🔄 배트맨 자동 수집'}
              </button>
            </div>

            {/* 카테고리 추천 패널 */}
            <div style={{ flex: 1, minHeight: 0 }}>
              <div style={{ height: 1, background: C.border, marginTop: 4, marginBottom: 12 }} />
              <BetCategoryPanel
                analysisHistory={analysisHistory}
                selectedCat={selectedCat}
                onSelectCat={setSelectedCat}
              />
            </div>
          </aside>

          {/* 메인 콘텐츠 */}
          <main style={{ flex: 1, padding: '28px 28px', overflowY: 'scroll' }}>

            {/* ── 카테고리 TOP 10 뷰 ── */}
            {selectedCat ? (
              <CategoryPicksView
                cat={selectedCat}
                matches={filtered}
                analysisHistory={analysisHistory}
                onClose={() => setSelectedCat(null)}
                onClickDetail={(match) => setSelected(match)}
              />
            ) : (
              <>
                {/* ── 분석 오류 토스트 ── */}
                {analyzeErrMsg && (
                  <div style={{
                    marginBottom: 12, padding: '10px 16px', borderRadius: 8,
                    background: '#ff4d4f20', border: '1px solid #ff4d4f60',
                    color: '#ff4d4f', fontSize: 13, fontWeight: 600,
                  }}>
                    ⚠️ {analyzeErrMsg}
                  </div>
                )}

                {/* ── 경기 대시보드 헤더 ── */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
                  <div>
                    <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em', color: C.text }}>경기 대시보드</h1>
                    <p style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>배트맨 발매 대상 경기 · 클릭하여 배당·결장자·AI 분석 확인</p>
                  </div>
                  <button onClick={fetchMatches} disabled={loading} style={{
                    padding: '8px 16px', borderRadius: 8, border: `1px solid ${C.border}`,
                    background: C.surface2, color: loading ? C.muted : C.text,
                    fontSize: 12, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    {loading ? '로딩 중…' : '↻ 새로고침'}
                  </button>
                </div>

                {error && (
                  <div style={{ background: `${C.warn}15`, border: `1px solid ${C.warn}40`, borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: C.warn }}>
                    ❌ {error}
                  </div>
                )}

                {loading && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} style={{ height: 120, background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, animation: 'pulse 1.5s ease-in-out infinite', opacity: 0.6 }} />
                    ))}
                  </div>
                )}

                {!loading && filtered.length === 0 && !error && (
                  <div style={{ textAlign: 'center', padding: '80px 0', color: C.muted }}>
                    <p style={{ fontSize: 48, marginBottom: 16 }}>🗓️</p>
                    <p style={{ fontWeight: 700, color: C.text, fontSize: 16 }}>발매 대상 경기 없음</p>
                    <p style={{ fontSize: 13, marginTop: 6 }}>➕ 경기 직접 추가 버튼으로 이미지를 붙여넣으세요</p>
                  </div>
                )}

                {!loading && filtered.length > 0 && (
                  <div>
                    {filtered.map(m => (
                      <MatchBetmanRow
                        key={m.id}
                        match={m}
                        analysisHistory={analysisHistory[m.id] ?? []}
                        analyzing={analyzingIds.has(m.id)}
                        onAnalyze={(force) => analyzeMatch(m, force)}
                        onClickDetail={(match) => setSelected(match)}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </main>
        </div>

        {selectedMatch && <MatchDetail match={selectedMatch} onClose={() => setSelected(null)} />}
        {showAddModal && <AddMatchModal onClose={() => setShowAdd(false)} onAdded={fetchMatches} />}

        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap');
          @keyframes cc-spin { to { transform: rotate(360deg); } }
          @keyframes lp { 0%,100%{opacity:1}50%{opacity:0.3} }
          @keyframes pulse { 0%,100%{opacity:0.6}50%{opacity:0.3} }
          body { margin: 0; }
          * { box-sizing: border-box; }
          ::-webkit-scrollbar { width: 5px; }
          ::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.25); border-radius: 3px; }
        `}</style>
      </div>
    </ThemeCtx.Provider>
  );
}
