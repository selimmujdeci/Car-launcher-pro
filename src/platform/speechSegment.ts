/**
 * speechSegment.ts — söyleyiş segmentasyonu + segment-bazlı prozodi (P0-2 + P1-1)
 *
 * Tek bir uzun utterance'ı motorun düz, sabit hız/perdede okuması "metin okuma"
 * hissi yaratır. Bu katman metni noktalama sınırlarından cümleciklere böler ve
 * her segmente:
 *   - kendine özgü RATE  (kısa cümlecik biraz hızlı, uzun cümlecik biraz sakin),
 *   - kendine özgü PITCH (soru sonu hafif yükselir, düz cümle sonu hafif düşer),
 *   - sonrasına bir DURAKLAMA (virgül < nokta < soru/ünlem) atar.
 *
 * Native taraf (CarLauncherPlugin.speakSegments) segmentleri sırayla kuyruğa alır;
 * ilk segment QUEUE_FLUSH, sonrakiler QUEUE_ADD, aralara playSilentUtterance ile
 * sessizlik. Yalnız SON segmentin bitişi "konuşma bitti" sayılır.
 *
 * Motordan bağımsız (saf string + sayı): offline, düşük donanım, ücretsiz.
 */

export interface SpeechSegment {
  /** Seslendirilecek metin parçası. */
  text: string;
  /** Bu segmentin konuşma hızı (taban * faktör), motor-güvenli aralığa clamp'li. */
  rate: number;
  /** Bu segmentin perdesi (taban * faktör), motor-güvenli aralığa clamp'li. */
  pitch: number;
  /** Segmentten SONRA eklenecek sessizlik (ms). Son segmentte 0. */
  pauseMs: number;
}

export interface SegmentOptions {
  /** Taban hız (ttsSpeak rate). Varsayılan 1.0. */
  rate?: number;
  /** Taban perde (ttsSpeak pitch). Varsayılan 1.0. */
  pitch?: number;
  /** Düşük donanım: segment sayısı ve bölme agresifliği düşürülür. */
  lowEnd?: boolean;
}

/* ── Duraklama haritası (ms) — doğal Türkçe konuşma ritmi ─────────────────── */
const PAUSE_COMMA = 120;   // virgül / noktalı virgül / iki nokta
const PAUSE_PERIOD = 280;  // nokta
const PAUSE_QUEST = 320;   // soru / ünlem (hafif daha uzun, vurgu sonrası nefes)

/* ── Prozodi faktörleri ───────────────────────────────────────────────────── */
const RATE_SHORT = 1.06;   // ≤ SHORT_WORDS kelime → biraz hızlı
const RATE_LONG = 0.95;    // ≥ LONG_WORDS kelime → biraz sakin/akıcı
const PITCH_QUEST_END = 1.10; // soru cümlesinin SON segmenti → yükselen ton
const PITCH_STMT_END = 0.94;  // düz cümlenin SON segmenti → düşen kapanış
const SHORT_WORDS = 5;
const LONG_WORDS = 14;

/* ── Motor-güvenli aralık (Android setSpeechRate/setPitch + Web Speech) ───── */
const RATE_MIN = 0.5, RATE_MAX = 2.0;
const PITCH_MIN = 0.5, PITCH_MAX = 2.0;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ── Segment sayısı tavanı — düşük donanımda çok sayıda kısa utterance
 *    ucuz motorlarda çoğunlukla sarsıntı yaratır; tavan ile birleştirilir. */
const MAX_SEGMENTS_NORMAL = 8;
const MAX_SEGMENTS_LOWEND = 4;

interface RawClause { text: string; terminator: '.' | '?' | '!' | ',' | ''; sentenceEnd: boolean; }

/**
 * Metni cümlelere, ardından (düşük donanım değilse) virgül cümleciklerine böler.
 * Terminatör ve "cümle sonu mu" bilgisini korur — prozodi bunu kullanır.
 */
function _split(text: string, lowEnd: boolean): RawClause[] {
  const clauses: RawClause[] = [];
  // Cümleleri terminatörüyle birlikte yakala (… çoklu nokta tek sayılır).
  const sentenceRe = /[^.!?…]+[.!?…]*/g;
  const sentences = text.match(sentenceRe) ?? [text];

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const termMatch = sentence.match(/([.!?…]+)\s*$/);
    const term = termMatch ? termMatch[1] : '';
    const isQuest = term.includes('?');
    const isExcl = term.includes('!');
    const sentenceTerm: RawClause['terminator'] = isQuest ? '?' : isExcl ? '!' : term ? '.' : '';
    const body = term ? sentence.slice(0, sentence.length - termMatch![0].length + (termMatch![0].length - term.length)).trim() : sentence;
    const core = body.replace(/[.!?…]+$/, '').trim();

    // Düşük donanım: cümleyi virgülden bölmeden tek parça bırak (daha az utterance).
    if (lowEnd || !core.includes(',') ) {
      clauses.push({ text: core || sentence, terminator: sentenceTerm, sentenceEnd: true });
      continue;
    }

    // Virgül cümlecikleri — sonuncusu cümle sonu terminatörünü taşır.
    const parts = core.split(',').map((p) => p.trim()).filter(Boolean);
    parts.forEach((p, i) => {
      const last = i === parts.length - 1;
      clauses.push({
        text: p,
        terminator: last ? sentenceTerm : ',',
        sentenceEnd: last,
      });
    });
  }
  return clauses.length ? clauses : [{ text: text.trim(), terminator: '', sentenceEnd: true }];
}

/** Cümlecik sayısını tavana indir: bitişikleri (cümle sonu olmayanları tercih) birleştir. */
function _enforceLimit(clauses: RawClause[], max: number): RawClause[] {
  if (clauses.length <= max) return clauses;
  const out = clauses.slice();
  while (out.length > max) {
    // Birleştirilecek en iyi aday: cümle-sonu OLMAYAN ilk cümlecik (sonrakiyle birleşir).
    let idx = out.findIndex((c) => !c.sentenceEnd);
    if (idx === -1 || idx === out.length - 1) idx = 0; // hepsi cümle sonu → ilk ikiyi birleştir
    const a = out[idx];
    const b = out[idx + 1];
    out.splice(idx, 2, {
      text: `${a.text}${a.terminator === ',' ? ',' : ''} ${b.text}`.replace(/\s+/g, ' ').trim(),
      terminator: b.terminator,
      sentenceEnd: b.sentenceEnd,
    });
  }
  return out;
}

function _wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/**
 * Metni prozodi-zenginleştirilmiş segmentlere böler.
 * Tek cümlecik çıkarsa tek elemanlı dizi döner (çağıran tek-utterance yoluna düşebilir).
 */
export function segmentSpeech(text: string, opts: SegmentOptions = {}): SpeechSegment[] {
  const baseRate = opts.rate ?? 1.0;
  const basePitch = opts.pitch ?? 1.0;
  const lowEnd = !!opts.lowEnd;
  const clean = (text ?? '').trim();
  if (!clean) return [];

  const max = lowEnd ? MAX_SEGMENTS_LOWEND : MAX_SEGMENTS_NORMAL;
  const clauses = _enforceLimit(_split(clean, lowEnd), max);

  return clauses.map((c, i) => {
    const last = i === clauses.length - 1;
    const words = _wordCount(c.text);

    // Hız: uzunluğa göre (kısa hızlı, uzun sakin).
    let rateF = 1.0;
    if (words <= SHORT_WORDS) rateF = RATE_SHORT;
    else if (words >= LONG_WORDS) rateF = RATE_LONG;

    // Perde: yalnız CÜMLE SONUNDA kontur uygula (soru yüksel, düz cümle düş).
    let pitchF = 1.0;
    if (c.sentenceEnd) pitchF = c.terminator === '?' ? PITCH_QUEST_END : c.terminator === '!' ? 1.04 : PITCH_STMT_END;

    // Duraklama: terminatöre göre. Son segmentte sessizlik yok.
    let pauseMs = 0;
    if (!last) {
      pauseMs = c.terminator === ',' ? PAUSE_COMMA
        : c.terminator === '?' || c.terminator === '!' ? PAUSE_QUEST
        : PAUSE_PERIOD;
    }

    // Cümlecik metnine terminatörü geri ekle — motor doğal tonlama için kullanır.
    const piece = c.sentenceEnd && c.terminator && c.terminator !== ','
      ? `${c.text}${c.terminator}`
      : c.text;

    return {
      text: piece,
      rate: clamp(baseRate * rateF, RATE_MIN, RATE_MAX),
      pitch: clamp(basePitch * pitchF, PITCH_MIN, PITCH_MAX),
      pauseMs,
    };
  });
}
