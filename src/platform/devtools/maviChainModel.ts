/**
 * maviChainModel.ts — Mavi eylem zincirinin SAF korelasyon modeli (MAVI-M4-LAB-2).
 *
 * Tek komutun hikâyesini TEK grupta toplar:
 *   komut alındı → actionId → kapı kararı → yürütücü sonucu → M6 TTS sonucu
 *
 * BU DOSYA YENİ BİR OTORİTE VEYA DEPO DEĞİLDİR: `action/maviActionTrace`in ürettiği
 * bounded halkayı yalnız GRUPLAR ve SINIFLANDIRIR. Yeni olay üretmez.
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok · modül durumu yok · React importu yok.
 *
 * ── DÜRÜSTLÜK KURALLARI (pazarlıksız) ───────────────────────────────────────
 *  · **Eksik aşama TAHMİN EDİLMEZ.** Gözlenmemiş her aşama açıkça
 *    `observed:false` taşır → ekran "gözlemlenmedi" yazar. "Muhtemelen başarılı"
 *    gibi bir çıkarım YAPILMAZ.
 *  · **Proaktif güvenlik uyarısı kullanıcı turu gibi GÖSTERİLMEZ:**
 *    `proactive_speech` ayrı bir türdür, `turnId` taşımaz ve HİÇBİR turun
 *    içine konmaz — ayrı listede döner.
 *  · `turnId` olmayan (korelasyonsuz) aşamalar uydurma bir gruba İTİLMEZ;
 *    "ilişkilendirilemedi" kovasında kalır.
 *  · Gruplar bounded'dır — liste sınırsız büyümez.
 */

import type { MaviActionStage, MaviActionTraceRecord } from '../action/maviActionTrace';

/* ══════════════════════════════════════════════════════════════════════════
 * Tipler
 * ════════════════════════════════════════════════════════════════════════ */

/** Ekranda gösterilecek azami tur grubu — Mali-400 render bütçesi. */
export const MAX_CHAIN_GROUPS = 25;

/** Zincirdeki kullanıcı-turu aşamaları — GÖSTERİM SIRASI budur. */
export const CHAIN_STEP_ORDER: readonly MaviActionStage[] = [
  'turn_started', 'gate', 'result', 'speech',
] as const;

export const CHAIN_STEP_LABEL: Readonly<Record<MaviActionStage, string>> = {
  turn_started:     'komut alındı',
  gate:             'kapı kararı',
  result:           'yürütücü sonucu',
  speech:           'TTS sonucu',
  proactive_speech: 'proaktif güvenlik uyarısı',
} as const;

export interface ChainStep {
  readonly stage: MaviActionStage;
  readonly label: string;
  /** `false` → bu aşama HİÇ gözlenmedi. Değer UYDURULMAZ. */
  readonly observed: boolean;
  readonly status: string | null;
  readonly reason: string | null;
  readonly atMs: number | null;
}

/** Turun bütünsel hükmü — FAIL-CLOSED: kanıt yoksa `INCOMPLETE`. */
export type ChainVerdict =
  /** Aşamalar eksik → ne olduğu SÖYLENEMEZ. */
  | 'INCOMPLETE'
  /** Kapı reddetti; yürütücü hiç çalışmadı. */
  | 'BLOCKED_BY_GATE'
  /** Açık kullanıcı onayı beklendi. */
  | 'AWAITING_CONFIRMATION'
  /** Yürütücü portu yok. */
  | 'UNSUPPORTED'
  /** Yürütücü hata/ret döndürdü. */
  | 'FAILED'
  /** Yürütücü başarı KANITI döndürdü. */
  | 'SUCCEEDED'
  /** Çağrıldı ama sonuç doğrulanamadı. */
  | 'UNVERIFIED';

export const CHAIN_VERDICT_LABEL: Readonly<Record<ChainVerdict, string>> = {
  INCOMPLETE:            'EKSİK GÖZLEM',
  BLOCKED_BY_GATE:       'KAPI ENGELLEDİ',
  AWAITING_CONFIRMATION: 'ONAY BEKLENDİ',
  UNSUPPORTED:           'DESTEKLENMİYOR',
  FAILED:                'BAŞARISIZ',
  SUCCEEDED:             'BAŞARILI',
  UNVERIFIED:            'DOĞRULANAMADI',
} as const;

export interface ChainGroup {
  readonly turnId: number;
  /** Defter kimliği — hiçbir aşamada gözlenmediyse `null` (uydurulmaz). */
  readonly actionId: string | null;
  readonly intent: string | null;
  readonly steps: readonly ChainStep[];
  readonly verdict: ChainVerdict;
  /** Gruptaki en yeni damga — sıralama için. */
  readonly lastAtMs: number;
  /** Kullanıcıya "kaç aşama gözlendi" dürüstlüğü. */
  readonly observedCount: number;
}

export interface ChainView {
  readonly groups: readonly ChainGroup[];
  /**
   * Proaktif güvenlik uyarıları — AYRI liste. Bunlar kullanıcı turu DEĞİLDİR ve
   * hiçbir gruba karışmaz.
   */
  readonly proactive: readonly MaviActionTraceRecord[];
  /** `turnId` taşımayan, ilişkilendirilemeyen aşamalar (dürüstlük kovası). */
  readonly uncorrelated: readonly MaviActionTraceRecord[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Gruplama
 * ════════════════════════════════════════════════════════════════════════ */

function _step(stage: MaviActionStage, rec: MaviActionTraceRecord | undefined): ChainStep {
  if (!rec) {
    // GÖZLENMEDİ — tahmin YOK, sahte "ok"/"0"/tarih YOK.
    return { stage, label: CHAIN_STEP_LABEL[stage], observed: false, status: null, reason: null, atMs: null };
  }
  return {
    stage,
    label:    CHAIN_STEP_LABEL[stage],
    observed: true,
    status:   rec.status || null,
    reason:   rec.reason || null,
    atMs:     rec.atMs,
  };
}

/**
 * Turun hükmü. **Yalnız GÖZLENEN kanıttan** türetilir.
 * Sıra fail-closed'dır: yürütücü sonucu yoksa kapı kararına bakılır; o da yoksa
 * `INCOMPLETE` (ne olduğu SÖYLENEMEZ).
 */
export function deriveChainVerdict(steps: readonly ChainStep[]): ChainVerdict {
  const gate   = steps.find((s) => s.stage === 'gate');
  const result = steps.find((s) => s.stage === 'result');

  if (result?.observed) {
    switch (result.status) {
      case 'succeeded':          return 'SUCCEEDED';
      case 'failed':             return 'FAILED';
      case 'unsupported':        return 'UNSUPPORTED';
      case 'denied':             return 'BLOCKED_BY_GATE';
      case 'needs_confirmation': return 'AWAITING_CONFIRMATION';
      case 'unknown':            return 'UNVERIFIED';
      default:                   return 'INCOMPLETE';
    }
  }
  if (gate?.observed) {
    if (gate.status === 'denied')             return 'BLOCKED_BY_GATE';
    if (gate.status === 'needs_confirmation') return 'AWAITING_CONFIRMATION';
    if (gate.status === 'unsupported')        return 'UNSUPPORTED';
    // Kapı GEÇTİ ama yürütücü sonucu gözlenmedi → "başarılı" DENEMEZ.
    return 'INCOMPLETE';
  }
  return 'INCOMPLETE';
}

/**
 * Aşama halkasını tur gruplarına çevirir (EN YENİ TUR ÖNCE).
 *
 * Girdi `null`/bozuk ise boş görünüm döner (fail-soft; ekran çökmez).
 */
export function buildChainView(
  trace: readonly MaviActionTraceRecord[] | null | undefined,
  maxGroups: number = MAX_CHAIN_GROUPS,
): ChainView {
  const empty: ChainView = { groups: [], proactive: [], uncorrelated: [] };
  if (!Array.isArray(trace)) return empty;

  const proactive: MaviActionTraceRecord[] = [];
  const uncorrelated: MaviActionTraceRecord[] = [];
  /** turnId → aşama → EN YENİ kayıt (halka en yeniden eskiye gelir → ilk gören kazanır). */
  const byTurn = new Map<number, Map<MaviActionStage, MaviActionTraceRecord>>();
  const order: number[] = [];

  for (const rec of trace) {
    if (!rec || typeof rec.stage !== 'string') continue;

    // Proaktif hat ASLA bir tura karışmaz (ayrı tür, ayrı liste).
    if (rec.stage === 'proactive_speech') { proactive.push(rec); continue; }

    if (typeof rec.turnId !== 'number' || !Number.isFinite(rec.turnId)) {
      uncorrelated.push(rec);
      continue;
    }

    let stages = byTurn.get(rec.turnId);
    if (!stages) {
      stages = new Map();
      byTurn.set(rec.turnId, stages);
      order.push(rec.turnId);   // ilk görülme = en yeni (halka sırası korunur)
    }
    // Aynı turda aynı aşama birden fazlaysa EN YENİSİ tutulur.
    if (!stages.has(rec.stage)) stages.set(rec.stage, rec);
  }

  const cap = typeof maxGroups === 'number' && maxGroups > 0 ? Math.floor(maxGroups) : MAX_CHAIN_GROUPS;
  const groups: ChainGroup[] = [];

  for (const turnId of order) {
    if (groups.length >= cap) break;
    const stages = byTurn.get(turnId);
    if (!stages) continue;

    const steps = CHAIN_STEP_ORDER.map((s) => _step(s, stages.get(s)));
    const observedCount = steps.filter((s) => s.observed).length;

    // Kimlik YALNIZ gözlenen kayıtlardan alınır; yoksa null (uydurulmaz).
    const idSrc = stages.get('gate') ?? stages.get('result');
    let lastAtMs = 0;
    for (const rec of stages.values()) if (rec.atMs > lastAtMs) lastAtMs = rec.atMs;

    groups.push({
      turnId,
      actionId: idSrc?.actionId ?? null,
      intent:   idSrc?.intent ?? null,
      steps,
      verdict:  deriveChainVerdict(steps),
      lastAtMs,
      observedCount,
    });
  }

  return { groups, proactive, uncorrelated };
}

/** Hüküm başına grup sayısı (rozet/sayaç). */
export function countByChainVerdict(groups: readonly ChainGroup[]): Readonly<Record<ChainVerdict, number>> {
  const out: Record<ChainVerdict, number> = {
    INCOMPLETE: 0, BLOCKED_BY_GATE: 0, AWAITING_CONFIRMATION: 0,
    UNSUPPORTED: 0, FAILED: 0, SUCCEEDED: 0, UNVERIFIED: 0,
  };
  if (!Array.isArray(groups)) return out;
  for (const g of groups) {
    if (g && Object.prototype.hasOwnProperty.call(out, g.verdict)) out[g.verdict as ChainVerdict]++;
  }
  return out;
}
