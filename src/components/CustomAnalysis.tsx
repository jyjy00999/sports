'use client';

import { useState } from 'react';
import type { AnalysisResult } from '@/types';
import AnalysisPanel from './AnalysisPanel';

interface Props { sportLabel: string; leagueLabel: string; accentColor: string; }

const QUICK = [
  '손흥민 vs 이강인 비교 분석',
  '올 시즌 KBO 우승팀 예측',
  '맨체스터 시티 최근 부진 이유 분석',
  'NBA 이번 시즌 파이널 예측',
  '이 선수 영입 가치 분석',
];

export default function CustomAnalysis({ sportLabel, leagueLabel, accentColor }: Props) {
  const [query, setQuery]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<AnalysisResult | null>(null);
  const [error, setError]       = useState('');

  const doAnalyze = async (q?: string) => {
    const text = q ?? query;
    if (!text.trim()) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customQuery: text, sport: sportLabel, league: leagueLabel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data.result);
    } catch (e) { setError(e instanceof Error ? e.message : '분석 실패'); }
    finally { setLoading(false); }
  };

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 16, overflow: 'hidden',
    }}>
      <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--border)' }}>
        <p style={{ fontSize: 12, fontWeight: 800, color: accentColor, marginBottom: 10 }}>✏️ 직접 분석 요청</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && doAnalyze()}
            placeholder="예: 두산 vs LG 경기 분석, 손흥민 이번 시즌 폼..."
            style={{
              flex: 1, padding: '9px 12px', borderRadius: 10,
              background: 'var(--surface2)', border: '1px solid var(--border)',
              color: 'var(--text)', fontSize: 12, outline: 'none',
            }}
          />
          <button
            onClick={() => doAnalyze()}
            disabled={loading || !query.trim()}
            style={{
              padding: '9px 18px', borderRadius: 10, border: 'none',
              background: loading || !query.trim() ? 'rgba(255,255,255,0.08)' : accentColor,
              color: loading || !query.trim() ? 'var(--muted)' : '#000',
              fontSize: 12, fontWeight: 800, cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
            }}
          >
            {loading
              ? <><span style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'cc-spin .7s linear infinite' }} />분석 중</>
              : '🤖 분석'}
          </button>
        </div>

        {/* 빠른 예시 */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {QUICK.map(q => (
            <button
              key={q}
              onClick={() => { setQuery(q); doAnalyze(q); }}
              style={{
                padding: '4px 10px', borderRadius: 20, border: `1px solid ${accentColor}40`,
                background: `${accentColor}12`, color: accentColor,
                fontSize: 10, fontWeight: 600, cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >{q}</button>
          ))}
        </div>
      </div>

      {error && (
        <p style={{ padding: '12px 16px', fontSize: 12, color: '#EF4444' }}>❌ {error}</p>
      )}

      {result && (
        <AnalysisPanel
          result={result}
          homeTeamName="팀 A / 선수 A"
          awayTeamName="팀 B / 선수 B"
          accentColor={accentColor}
        />
      )}
    </div>
  );
}
