import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export async function POST(req: Request) {
  try {
    const { imageBase64, mimeType = 'image/png' } = await req.json();

    if (!imageBase64) {
      return NextResponse.json({ error: '이미지가 없습니다.' }, { status: 400 });
    }

    const response = await anthropic.messages.create({
      model: 'claude-opus-5',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: `이 이미지는 배트맨(betman.co.kr) 스포츠 토토 사이트 화면입니다.
현재 날짜는 2026년 9월 1일입니다.

각 경기마다 최대 7가지 베팅 유형이 있습니다:
1. 승무패 (축구/야구 풀게임 승패) → type: "match_winner"
2. 핸디캡 H N.N (풀게임 핸디캡) → type: "handicap"
3. 언더오버 U/O N.N (풀게임 언더오버) → type: "under_over"
4. SUM 홀/짝 → type: "sum"
5. 전반전/5회 승무패 (축구 전반전 or 야구 5회말까지 승패) → type: "ht_match_winner"
6. 전반전/5회 핸디캡 (축구 전반전 or 야구 5회말까지 핸디캡) → type: "ht_handicap"
7. 전반전/5회 언더오버 (축구 전반전 or 야구 5회말까지 언더오버) → type: "ht_under_over"

야구 경기 구분 규칙:
- 같은 경기에 핸디캡/언더오버가 두 세트 있을 때: 라인 값이 큰 쪽(예: U/O 8.5, H-2.5)이 풀게임(match_winner~sum), 라인 값이 작은 쪽(예: U/O 4.5, H-1.5)이 5회전반전(ht_*)
- 야구 5회전 승패(승1패)는 풀게임 승패 다음에 나오면 ht_match_winner
- 야구 5회전 핸디캡은 ht_handicap, 5회전 언더오버는 ht_under_over

각 유형마다 별도의 조합 번호가 있습니다 (예: 8297, 8298, 8299, 8300).
betman_game_no는 해당 경기의 첫 번째 조합(승무패) 번호입니다.

순수 JSON만 반환하세요 (마크다운 없이):

{
  "betman_round": "회차 문자열 또는 null",
  "matches": [
    {
      "betman_game_no": "승무패 조합 번호 (예: 8297)",
      "league_name": "리그명 (예: 잉글랜드 챔피언십)",
      "home_name": "홈팀 이름",
      "away_name": "원정팀 이름",
      "match_date": "YYYY-MM-DDTHH:mm:00+09:00 (월.일 형식이면 2026년 적용)",
      "home_odds": 승무패 승 배당 숫자,
      "draw_odds": 승무패 무 배당 숫자,
      "away_odds": 승무패 패 배당 숫자,
      "bet_types": [
        {
          "combo_no": 8297,
          "type": "match_winner",
          "label": "축구 승무패",
          "line_value": null,
          "home_odds": 1.95,
          "draw_odds": 3.05,
          "away_odds": 3.25
        },
        {
          "combo_no": 8298,
          "type": "handicap",
          "label": "축구 핸디캡 H -1.0",
          "line_value": "H -1.0",
          "home_odds": 3.65,
          "draw_odds": 3.50,
          "away_odds": 1.70
        },
        {
          "combo_no": 8299,
          "type": "under_over",
          "label": "축구 언더오버 U/O 2.5",
          "line_value": "U/O 2.5",
          "under_odds": 1.63,
          "over_odds": 1.91
        },
        {
          "combo_no": 8300,
          "type": "sum",
          "label": "축구 SUM",
          "odd_odds": 1.81,
          "even_odds": 1.79
        }
      ]
    }
  ]
}

규칙:
- 이미지에 보이는 모든 경기의 모든 베팅 유형을 추출하세요
- bet_types 배열은 조합 번호 오름차순으로 정렬
- 해당 유형이 없으면 null 또는 생략 (없는 배당은 null)
- 핸디캡/언더오버 라인 값(line_value)을 정확히 추출 (예: "H -1.0", "U/O 2.5")
- 조합 번호 순서대로(오름차순) 경기 목록 반환`,
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Claude 응답을 받지 못했습니다.');
    }

    const raw = textBlock.text
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('JSON 파싱 실패. 응답: ' + raw.slice(0, 300));
      parsed = JSON.parse(m[0]);
    }

    return NextResponse.json(parsed);
  } catch (err) {
    console.error('[OCR]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
