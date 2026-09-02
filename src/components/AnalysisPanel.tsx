'use client';

import type { AnalysisResult } from '@/types';

interface Props {
  result: AnalysisResult;
  homeTeamName: string;
  awayTeamName: string;
  accentColor: string;
}

const CONF_LABEL = { HIGH: '높음 🔥', MEDIUM: '보통 ✅', LOW: '낮음 ⚠️' };
const CONF_COLOR = { HIGH: '#22C55E', MEDIUM: '#EAB308', LOW: '#EF4444' };

export default function AnalysisPanel({ result: r, homeTeamName, awayTeamName, accentColor }: Props) {
  const total = (r.homeWinPct ?? 0) + (r.drawPct ?? 0) + (r.awayWinPct ?? 0) || 100;
  const hp = Math.round((r.homeWinPct / total) * 100);
  const dp = Math.round((r.drawPct / total) * 100);
  const ap = 100 - hp - dp;

  return (
    <div className="anim-slide" style={{
      borderTop: '1px solid var(--border)',
      padding: '18px 14px 18px',
      background: 'var(--surface2)',
      display: 'flex', flexDirection: 'column', gap: 16,
    }}>

      {/* 예상 승자 */}
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>AI 예측</p>
        <p style={{ fontSize: 20, fontWeight: 900, color: accentColor }}>{r.winner}</p>
        {r.expectedScore !== '-' && (
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>예상 스코어: <strong style={{ color: 'var(--text)' }}>{r.expectedScore}</strong></p>
        )}
        <span style={{
          display: 'inline-block', marginTop: 6,
          fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
          background: `${CONF_COLOR[r.confidence]}22`, color: CONF_COLOR[r.confidence],
        }}>신뢰도 {CONF_LABEL[r.confidence]}</span>
      </div>

      {/* 승률 바 */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 6 }}>
          <span style={{ fontWeight: 700, color: '#3B82F6' }}>{homeTeamName.length > 8 ? homeTeamName.slice(0,8)+'…' : homeTeamName} {hp}%</span>
          {dp > 0 && <span style={{ color: 'var(--muted)' }}>무 {dp}%</span>}
          <span style={{ fontWeight: 700, color: '#F97316' }}>{ap}% {awayTeamName.length > 8 ? awayTeamName.slice(0,8)+'…' : awayTeamName}</span>
        </div>
        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', height: 10 }}>
          <div style={{ width: `${hp}%`, background: '#3B82F6', transition: 'width 0.6s' }} />
          {dp > 0 && <div style={{ width: `${dp}%`, background: '#6B7280', transition: 'width 0.6s' }} />}
          <div style={{ width: `${ap}%`, background: '#F97316', transition: 'width 0.6s' }} />
        </div>
      </div>

      {/* 팀 분석 */}
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1, background: '#3B82F610', border: '1px solid #3B82F630', borderRadius: 10, padding: '10px 12px' }}>
          <p style={{ fontSize: 10, fontWeight: 800, color: '#3B82F6', marginBottom: 5 }}>🏠 {homeTeamName}</p>
          <p style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.6 }}>{r.homeAnalysis}</p>
        </div>
        {r.awayAnalysis !== '-' && (
          <div style={{ flex: 1, background: '#F9731610', border: '1px solid #F9731630', borderRadius: 10, padding: '10px 12px' }}>
            <p style={{ fontSize: 10, fontWeight: 800, color: '#F97316', marginBottom: 5 }}>✈️ {awayTeamName}</p>
            <p style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.6 }}>{r.awayAnalysis}</p>
          </div>
        )}
      </div>

      {/* 핵심 포인트 */}
      <div>
        <p style={{ fontSize: 11, fontWeight: 800, color: accentColor, marginBottom: 8 }}>📌 핵심 분석 포인트</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {r.keyPoints.map((pt, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{
                flexShrink: 0, width: 20, height: 20, borderRadius: '50%',
                background: `${accentColor}22`, color: accentColor,
                fontSize: 10, fontWeight: 900,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{i + 1}</span>
              <p style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.55 }}>{pt}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 전술 인사이트 */}
      <div style={{ background: '#8B5CF610', border: '1px solid #8B5CF630', borderRadius: 10, padding: '10px 12px' }}>
        <p style={{ fontSize: 10, fontWeight: 800, color: '#8B5CF6', marginBottom: 5 }}>⚡ 전술 인사이트</p>
        <p style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>{r.tactics}</p>
      </div>

      {/* 최종 픽 */}
      <div style={{
        background: `${accentColor}15`, border: `1.5px solid ${accentColor}40`,
        borderRadius: 12, padding: '12px 14px',
      }}>
        <p style={{ fontSize: 11, fontWeight: 900, color: accentColor, marginBottom: 6 }}>🎯 AI 최종 픽</p>
        <p style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.65 }}>{r.verdict}</p>
      </div>
    </div>
  );
}
