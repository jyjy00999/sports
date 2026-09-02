import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '스포츠 분석기',
  description: 'AI 기반 스포츠 경기 분석 · Claude AI',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body style={{ background: 'var(--bg)', color: 'var(--text)' }}>
        {children}
      </body>
    </html>
  );
}
