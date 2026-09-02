'use client';

import { useState } from 'react';
import type { Match, AnalysisResult } from '@/types';
import AnalysisPanel from './AnalysisPanel';

interface Props { match: Match; accentColor: string; }

export default function MatchCard({ match: m, accentColor }: Props) {
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  const isLive  = m.status === 'inprogress';
  const isDone  = m.status === 'final';
  const isPre   = m.status === 'scheduled';

  const dateStr = (() => {
    try {
      const d = new Date(m.date);
      return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  })();

  const doAnalyze = async () => {
    setAnalyzing(true); setError(''); setOpen(true);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match: m, league: m.leagueLabel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data.result);
    } catch (e) { setError(e instanceof Error ? e.message : '오류 발생'); }
    finally { setAnalyzing(false); }
  };

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 16, overflow: 'hidden',
      boxShadow: isLive ? `0 0 0 1.5px ${accentColor}60` : 'none',
      transition: 'box-shadow 0.2s',
    }}>
      {/* 상태 배지 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 14px',
        background: isLive ? `${accentColor}18` : 'transparent',
        borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{m.leagueLabel}</span>
        {isLive && (
          <span style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 10, fontWeight: 800, color: '#22C55E',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            <span className="live-pulse" style={{
              width: 7, height: 7, borderRadius: '50%',
              background: '#22C55E', display: 'inline-block',
            }} />
            LIVE
          </span>
        )}
        {isDone && <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>종료</span>}
        {isPre  && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{dateStr}</span>}
      </div>

      {/* 경기 정보 */}
      <div style={{ padding: '16px 14px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>

          {/* 홈팀 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
            {m.homeTeam.logo && (
              <img src={m.homeTeam.logo} alt="" style={{ width: 40, height: 40, objectFit: 'contain' }} />
            )}
            <span style={{ fontSize: 12, fontWeight: 700, textAlign: 'center', lineHeight: 1.3 }}>
              {m.homeTeam.shortName || m.homeTeam.name}
            </span>
            {m.homeTeam.record && (
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>{m.homeTeam.record}</span>
            )}
          </div>

          {/* 스코어 / VS */}
          <div style={{ textAlign: 'center', minWidth: 70 }}>
            {(isLive || isDone) && m.homeTeam.score !== undefined ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span style={{
                  fontSize: 28, fontWeight: 900,
                  color: m.homeTeam.winner ? accentColor : 'var(--text)',
                }}>{m.homeTeam.score}</span>
                <span style={{ fontSize: 16, color: 'var(--muted)', fontWeight: 300 }}>:</span>
                <span style={{
                  fontSize: 28, fontWeight: 900,
                  color: m.awayTeam.winner ? accentColor : 'var(--text)',
                }}>{m.awayTeam.score}</span>
              </div>
            ) : (
              <span style={{ fontSize: 20, color: 'var(--muted)', fontWeight: 300 }}>VS</span>
            )}
            {isLive && (
              <div style={{ fontSize: 11, color: '#22C55E', fontWeight: 700, marginTop: 2 }}>
                {m.statusDetail}
              </div>
            )}
            {isDone && (
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>최종</div>
            )}
          </div>

          {/* 원정팀 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
            {m.awayTeam.logo && (
              <img src={m.awayTeam.logo} alt="" style={{ width: 40, height: 40, objectFit: 'contain' }} />
            )}
            <span style={{ fontSize: 12, fontWeight: 700, textAlign: 'center', lineHeight: 1.3 }}>
              {m.awayTeam.shortName || m.awayTeam.name}
            </span>
            {m.awayTeam.record && (
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>{m.awayTeam.record}</span>
            )}
          </div>
        </div>

        {m.venue && (
          <p style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center', marginTop: 8 }}>📍 {m.venue}</p>
        )}
      </div>

      {/* AI 분석 버튼 */}
      <div style={{ padding: '0 14px 14px' }}>
        <button
          onClick={result ? () => setOpen(o => !o) : doAnalyze}
          disabled={analyzing}
          style={{
            width: '100%', padding: '9px 0',
            background: analyzing ? 'rgba(255,255,255,0.05)' : `${accentColor}22`,
            color: analyzing ? 'var(--muted)' : accentColor,
            border: `1.5px solid ${analyzing ? 'transparent' : accentColor + '55'}`,
            borderRadius: 10, fontSize: 12, fontWeight: 800,
            cursor: analyzing ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            transition: 'all 0.2s',
          }}
        >
          {analyzing ? (
            <><span style={{ width: 14, height: 14, border: `2px solid ${accentColor}40`, borderTopColor: accentColor, borderRadius: '50%', display: 'inline-block', animation: 'cc-spin .7s linear infinite' }} />분석 중…</>
          ) : result ? (
            open ? '▲ 분석 닫기' : '▼ AI 분석 보기'
          ) : (
            '🤖 AI 분석하기'
          )}
        </button>
        {error && <p style={{ fontSize: 11, color: '#EF4444', textAlign: 'center', marginTop: 6 }}>❌ {error}</p>}
      </div>

      {/* 분석 패널 */}
      {open && result && (
        <AnalysisPanel
          result={result}
          homeTeamName={m.homeTeam.name}
          awayTeamName={m.awayTeam.name}
          accentColor={accentColor}
        />
      )}
    </div>
  );
}
