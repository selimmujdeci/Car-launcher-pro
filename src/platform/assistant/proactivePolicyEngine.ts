/**
 * proactivePolicyEngine.ts — **MAVİ F9 · PROAKTİF KONUŞMA İZNİNİN TEK KAPISI.**
 *
 * ── NE ÇÖZER (ölçülen kusur G9) ─────────────────────────────────────────────
 * Proaktiflik bugüne kadar TEK MOTORDA ve o motorun İÇİNDE gömülüydü:
 * `companionEngine.tick()` sekiz tetiği sabit bir `if/return` merdiveniyle
 * değerlendiriyor, her tetiğin cooldown'ını kendi modül değişkeninde tutuyordu
 * (`_lastFuelWarnMin` · `_lastDoorWarnMin` · …). Sonuçları ölçüldü:
 *
 *  1. **Dışarıdan kaynak BAĞLANAMIYORDU.** Navigasyon, araç zekâsı veya filo
 *     tarafında proaktif bir ihtiyaç doğsa gidecek bir kapı yoktu; tek yol
 *     `companionEngine`e dokuzuncu bir `if` eklemekti.
 *  2. **Spam yapısal olarak ENGELLİ DEĞİLDİ.** Tetik başına cooldown vardı ama
 *     GLOBAL bir sesli proaktif tavanı yoktu: birbirinden bağımsız beş güvenlik
 *     tetiği aynı yarım saatte sırayla konuşabilirdi.
 *  3. **Reddedilen kaynak SUSMUYORDU.** Kullanıcı bir öneriyi kaç kez keserse
 *     kessin motor aynı sıklıkta tekrar ediyordu — öğrenme YOKTU.
 *  4. Kararın NEDENİ gözlemlenemiyordu: "neden konuşmadı?" sorusunun cevabı
 *     kaynağı okumaktan başka bir yerde YOKTU.
 *
 * F9 kararı tetikten AYIRIR: kaynak **teklif** verir, bu motor **karar** verir.
 *
 * ── NE DEĞİLDİR (pazarlıksız sınırlar) ──────────────────────────────────────
 *  · **GÜVENLİK OTORİTESİ DEĞİLDİR.** Hiçbir güvenlik eşiği burada YENİDEN
 *    hesaplanmaz. `assistantSafetyKernel` · `maviActionAuthority` ·
 *    `AiSafetyGate` bu modülü OKUMAZ ve okumamalıdır.
 *  · **EYLEM YÜRÜTMEZ.** Çıktısı yalnız "bu cümle konuşulabilir mi" hükmüdür;
 *    komut dispatch etmez, navigasyonu, medyayı, aracı ETKİLEMEZ.
 *  · **METİN ÜRETMEZ.** Şablonu teklif sahibi verir (`text()`), motor yalnız
 *    çağırır. LLM'e gitmez (maliyet + internetsiz head unit — mimari §2.8).
 *  · **KUYRUK TUTMAZ.** Aynı tick'te en yüksek skorlu TEK teklif konuşur;
 *    diğerleri DÜŞER. Bayat bir teklif sonradan kendiliğinden oynatılmaz.
 *  · **`safety` SINIFI ÖĞRENMEYLE SUSTURULAMAZ.** Bütçe · presence · sıklık
 *    tavanı · öğrenilmiş bastırma — hiçbiri güvenlik teklifini düşüremez.
 *    Yapısal olarak engellidir (`PROACTIVE_CLASS_RULES`), yorumla değil.
 *  · **İKİNCİ GERÇEKLİK KAYNAĞI KURMAZ.** İş yükü `maviWorkload`tan, presence
 *    ayarlardan, tur meşguliyeti `voiceService`ten GELİR — burada türetilmez.
 *
 * ── SAFLIK ──────────────────────────────────────────────────────────────────
 * Karar çekirdeği (`decideProactive`) SAFTIR: I/O · timer · `Date.now` · store
 * · React importu YOK; yalnız TİP importu vardır. Defter (cooldown · sıklık ·
 * öğrenme) aynı dosyada bounded modül durumudur ve karara **görünüm** olarak
 * verilir — `maviWorkload` ile birebir aynı desen.
 */

import type { MaviWorkloadLevel } from './maviWorkload';

/* ══════════════════════════════════════════════════════════════════════════
 * Sınıflar ve sözleşme
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Teklif sınıfı. **Sınıf bir ETİKET DEĞİL, bir YETKİ SEVİYESİDİR** — tüm
 * bütçe/presence/susturma kuralları buradan türer (spec §17.4).
 */
export type ProactiveKind = 'safety' | 'operational' | 'informational' | 'social';

/** Teklifin medya çalarken davranışı — ürün kararı, teklif sahibi BEYAN EDER. */
export type ProactiveMediaPolicy = 'INTERRUPTS_MEDIA' | 'DEFERS_TO_MEDIA';

/** Teklif sıklık bütçesine tabi mi (chattiness aralığı). */
export type ProactiveBudgetMode = 'SUBJECT' | 'EXEMPT';

/** Teslim kanalı. Bugün üretimde YALNIZ `voice` vardır (bkz. `no_visual_channel`). */
export type ProactiveDeliver = 'voice' | 'visual' | 'both';

/**
 * Bir proaktif konuşma teklifi. **Kaynak teklif verir, karar VERMEZ.**
 *
 * `relevance` bu repoda ÖLÇÜLMÜŞ bir kabul skoru DEĞİLDİR: ürünün BUGÜNKÜ,
 * kodla doğrulanmış tetik ÖNCELİK SIRASINI taşır (yakıt > kapı > lastik > …).
 * Uydurulmuş bir "alaka" değeri değildir ve öyle sunulmaz.
 *
 * `confidence` KANITTAN gelir: sinyal doğrudan gözlemlendiyse 1, türetilmiş ya
 * da dolaylıysa daha düşük. Kaynağı olmayan bir güven değeri YAZILMAZ.
 */
export interface ProactiveProposal {
  /** Kararlı kaynak kimliği — `'companion.fuel'` gibi. Öğrenme anahtarı BUDUR. */
  readonly sourceId: string;
  readonly kind: ProactiveKind;
  /** 0..1 — ürünün doğrulanmış öncelik sırası (bkz. yukarıdaki not). */
  readonly relevance: number;
  /** 0..1 — KANITTAN türetilir. */
  readonly confidence: number;
  /** Ne zaman anlamsızlaşır (monotonik ms). `null` = yalnız BU tick geçerli. */
  readonly decayAtMs: number | null;
  /** Aynı konuyu bastırma anahtarı (birden çok teklif AYNI anahtarı paylaşabilir). */
  readonly cooldownKey: string;
  /** Bu anahtar için minimum tekrar aralığı (ms). */
  readonly cooldownMs: number;
  readonly mediaPolicy: ProactiveMediaPolicy;
  readonly frequencyBudget: ProactiveBudgetMode;
  readonly deliver: ProactiveDeliver;
  /**
   * ŞABLON. Motor yalnız KAZANAN adaydan başlayarak çağırır. `null`/boş dönmesi
   * "bu an söylenecek bir şey yok" demektir — teklif DÜŞER, sıradaki denenir.
   * **Yan etkisiz olmalıdır** (kaynak sırası dışında durum değiştirmemelidir).
   */
  readonly text: () => string | null;
}

/** Kararın bounded girdi bağlamı — hepsi MEVCUT otoritelerden OKUNUR. */
export interface ProactivePolicyContext {
  /** MONOTONİK ms (`performance.now()`). Duvar saati DEĞİL (CLAUDE.md §4). */
  readonly nowMs: number;
  /** `maviWorkload` hükmü. Burada YENİDEN hesaplanmaz. */
  readonly workload: MaviWorkloadLevel;
  /**
   * Yol Arkadaşı presence'ı (F1). **Bir capability şalteri DEĞİLDİR** — yalnız
   * `informational`/`social` sınıflarının SESLİ kanalını yönetir.
   */
  readonly presenceEnabled: boolean;
  /** Sıklık bütçesi aralığı (ms). `Infinity` = bütçeli sınıflar tamamen kapalı. */
  readonly chattinessGapMs: number;
  /** Medya "prominent" (çalıyor) mu. */
  readonly mediaProminent: boolean;
  /** Konuşma sırası meşgul mü (sesli oturum · uçuştaki TTS). */
  readonly turnBusy: boolean;
}

/** Bir teklifin neden düştüğü — bounded kod kümesi, serbest metin YOK. */
export type ProactiveDropReason =
  /** Konuşma sırası meşgul (TurnArbiter). */
  | 'turn_busy'
  /** Kullanıcı bu kaynağı AÇIKÇA susturdu (kalıcı). */
  | 'user_suppressed'
  /** Kaynak öğrenilmiş bastırmada (3 kesinti → geçici sessizlik, decay'li). */
  | 'learned_suppressed'
  /** Teklifin ömrü doldu (bayat teklif konuşulmaz). */
  | 'decayed'
  /** Aynı konu cooldown penceresinde. */
  | 'cooldown'
  /** Sınıfın iş yükü tavanı aşıldı. */
  | 'workload'
  /** Sınıf presence gerektiriyor, Yol Arkadaşı kapalı. */
  | 'presence'
  /** Medya çalıyor ve teklif medyayı kesmiyor. */
  | 'media'
  /** Sıklık bütçesi (chattiness aralığı) dolmadı. */
  | 'budget'
  /** Saatlik sesli proaktif tavanı doldu (`safety` hariç). */
  | 'hourly_ceiling'
  /** Yalnız görsel teslim isteniyor — üretimde görsel proaktif kanal YOK. */
  | 'no_visual_channel'
  /** Şablon bu an cümle üretmedi. */
  | 'no_text'
  /** Daha yüksek skorlu bir teklif kazandı (tek konu kuralı). */
  | 'not_top'
  /** Teklif yapısal olarak geçersiz (kimlik/sınıf/şablon eksik). */
  | 'invalid';

/** Tek bir teklifin bounded sonucu (LAB · test — PII YOK). */
export interface ProactiveDrop {
  readonly sourceId: string;
  readonly reason: ProactiveDropReason;
}

/** Motorun hükmü — SAF VERİ, dondurulmuş. */
export interface ProactiveDecision {
  /** Konuşulmaya İZİN VERİLDİ mi. */
  readonly admitted: boolean;
  readonly sourceId: string | null;
  readonly kind: ProactiveKind | null;
  /** Kazanan şablonun metni. Çağıran seslendirir; motor SESLENDİRMEZ. */
  readonly text: string | null;
  /** Bu tick'te değerlendirilen teklif sayısı. */
  readonly evaluated: number;
  /** Düşen tekliflerin bounded gerekçeleri. */
  readonly drops: readonly ProactiveDrop[];
  /**
   * Bu tick'te SINIF kapılarını (iş yükü + presence) geçen sınıflar. Çağıranın
   * kendi defter tutması için — "teklifim değerlendirilebilir DURUMDA mıydı?"
   */
  readonly admissibleKinds: readonly ProactiveKind[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sınıf kuralları (spec §17.4) — TEK TABLO, yorum DEĞİL
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * İş yükü rütbesi. **`UNKNOWN` = `NORMAL`** — bu F8'de gerekçelendirilmiş ve
 * kilitlenmiş bir karardır (kanıt yokluğu Mavi'yi susturma sebebi değildir);
 * burada YENİDEN tartışılmaz, AYNEN uygulanır.
 */
const WORKLOAD_RANK: Readonly<Record<MaviWorkloadLevel, number>> = Object.freeze({
  LOW: 0, NORMAL: 1, UNKNOWN: 1, ELEVATED: 2, HIGH: 3, CRITICAL: 4,
});

export interface ProactiveClassRule {
  /** Bu sınıfın konuşabileceği EN YÜKSEK iş yükü. */
  readonly maxWorkload: MaviWorkloadLevel;
  /** Sesli kanal Yol Arkadaşı presence'ı gerektiriyor mu. */
  readonly requiresPresence: boolean;
  /** Saatlik sesli proaktif tavanına dahil mi. */
  readonly countsToHourlyCeiling: boolean;
  /** Öğrenilmiş bastırma bu sınıfı susturabilir mi. **`safety` için ASLA.** */
  readonly learnedSuppressible: boolean;
}

export const PROACTIVE_CLASS_RULES: Readonly<Record<ProactiveKind, ProactiveClassRule>> =
  Object.freeze({
    /* Güvenlik: yüksek iş yükü tam da uyarının GEREKTİĞİ andır. Bütçeye,
       presence'a, saatlik tavana ve öğrenmeye TABİ DEĞİLDİR. Tek freni kendi
       cooldown'udur (gevezeleşmesin diye). */
    safety: Object.freeze({
      maxWorkload: 'CRITICAL' as const, requiresPresence: false,
      countsToHourlyCeiling: false, learnedSuppressible: false,
    }),
    /* Operasyonel: yakıt/rota problemi/bağlantı gibi işi ETKİLEYEN durumlar.
       Presence'tan bağımsızdır ama spam tavanına tabidir. */
    operational: Object.freeze({
      maxWorkload: 'HIGH' as const, requiresPresence: false,
      countsToHourlyCeiling: true, learnedSuppressible: true,
    }),
    informational: Object.freeze({
      maxWorkload: 'ELEVATED' as const, requiresPresence: true,
      countsToHourlyCeiling: true, learnedSuppressible: true,
    }),
    social: Object.freeze({
      maxWorkload: 'NORMAL' as const, requiresPresence: true,
      countsToHourlyCeiling: true, learnedSuppressible: true,
    }),
  });

const ALL_KINDS: readonly ProactiveKind[] =
  Object.freeze(['safety', 'operational', 'informational', 'social'] as const);

/* ══════════════════════════════════════════════════════════════════════════
 * Sabitler
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Saatte en fazla kaç SESLİ proaktif (`safety` HARİÇ). Spec §17.5/1'in yapısal
 * spam freni. Değer bugünkü en gevezelik ayarından (`sik` = 10 dk aralık →
 * saatte en çok 6) türetilmiştir: mevcut davranışı KISITLAMAZ, ama birbirinden
 * bağımsız kaynaklar çoğaldığında tavanı YAPISAL olarak kurar.
 */
export const PROACTIVE_VOICE_CEILING_PER_HOUR = 6;

/** Saatlik pencere (ms). */
const HOUR_MS = 3_600_000;

/** Kaç kesinti sonrası kaynak öğrenilmiş bastırmaya girer (spec §17.5/2). */
export const PROACTIVE_REJECT_THRESHOLD = 3;

/** Bu süreden eski bir kesinti artık SAYILMAZ (öğrenme decay'i). */
export const PROACTIVE_REJECT_DECAY_MS = 2 * HOUR_MS;

/** Öğrenilmiş bastırma ne kadar sürer (sonra kaynak kendiliğinden geri gelir). */
export const PROACTIVE_LEARNED_SUPPRESSION_MS = 6 * HOUR_MS;

/** Bounded defter tavanları. */
const MAX_TRACKED_SOURCES = 64;
const MAX_DROPS_PER_DECISION = 16;
const MAX_COUNTER = 1_000_000;

function _bump(v: number): number { return v >= MAX_COUNTER ? MAX_COUNTER : v + 1; }

/* ══════════════════════════════════════════════════════════════════════════
 * Defter görünümü — SAF çekirdeğin okuduğu tek yapı
 * ════════════════════════════════════════════════════════════════════════ */

/** Karar çekirdeğinin gördüğü defter. **Salt-okunur** — çekirdek YAZMAZ. */
export interface ProactiveLedgerView {
  /** cooldownKey → son kabul damgası (monotonik ms). */
  readonly lastAdmittedAtMs: Readonly<Record<string, number>>;
  /** Sınıf farkı gözetmeksizin son SESLİ proaktif damgası. */
  readonly lastVoiceAtMs: number;
  /** Saatlik pencerede sayılan (safety DIŞI) sesli proaktif damgaları. */
  readonly hourlyVoiceAtMs: readonly number[];
  /** Kullanıcının AÇIKÇA susturduğu kaynaklar. */
  readonly userSuppressed: readonly string[];
  /** sourceId → öğrenilmiş bastırmanın bitiş damgası. */
  readonly learnedSuppressedUntilMs: Readonly<Record<string, number>>;
  /** sourceId → decay penceresinde sayılan kesinti adedi. */
  readonly recentRejects: Readonly<Record<string, number>>;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SAF karar çekirdeği
 * ════════════════════════════════════════════════════════════════════════ */

function _unit(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0;
}

function _valid(p: ProactiveProposal | null | undefined): p is ProactiveProposal {
  return !!p
    && typeof p.sourceId === 'string' && p.sourceId.length > 0
    && (PROACTIVE_CLASS_RULES[p.kind] !== undefined)
    && typeof p.text === 'function';
}

/**
 * Öğrenilen kabul çarpanı. **Kanıt yoksa 1.0** — "beğenilmiyor" İDDİA EDİLMEZ.
 * Her kesinti skoru kademeli düşürür; eşiğe gelince bastırma AYRI kapıda devreye
 * girer (bu çarpan tek başına sıfırlamaz).
 */
function _acceptanceFactor(sourceId: string, ledger: ProactiveLedgerView): number {
  const n = ledger.recentRejects[sourceId] ?? 0;
  if (!Number.isFinite(n) || n <= 0) return 1;
  const f = 1 - 0.25 * n;
  return f < 0.25 ? 0.25 : f;
}

/** Zamanlılık: ömrü olmayan teklif 1; dolmuşsa 0 (çağıran zaten düşürür). */
function _timeliness(p: ProactiveProposal, nowMs: number): number {
  if (p.decayAtMs === null || !Number.isFinite(p.decayAtMs)) return 1;
  return nowMs < p.decayAtMs ? 1 : 0;
}

/** Sınıf kapıları (iş yükü + presence) — teklifden BAĞIMSIZ, tick başına aynı. */
function _admissibleKinds(ctx: ProactivePolicyContext): ProactiveKind[] {
  const wl = WORKLOAD_RANK[ctx.workload] ?? WORKLOAD_RANK.UNKNOWN;
  const out: ProactiveKind[] = [];
  for (const k of ALL_KINDS) {
    const r = PROACTIVE_CLASS_RULES[k];
    if (wl > (WORKLOAD_RANK[r.maxWorkload] ?? 0)) continue;
    if (r.requiresPresence && !ctx.presenceEnabled) continue;
    out.push(k);
  }
  return out;
}

const EMPTY_DECISION_BASE = {
  admitted: false as const, sourceId: null, kind: null, text: null,
};

/**
 * Teklifler → hüküm. **SAF · throw ETMEZ · `Date.now` OKUMAZ · deftere YAZMAZ.**
 *
 * Sıra (her teklif için, ilk eşleşen düşürür):
 *  1. yapısal geçersizlik · 2. kullanıcı bastırması · 3. öğrenilmiş bastırma ·
 *  4. ömür (decay) · 5. cooldown · 6. iş yükü · 7. presence · 8. medya ·
 *  9. sıklık bütçesi · 10. saatlik tavan · 11. görsel kanal yokluğu.
 *
 * Ayakta kalanlar skora göre sıralanır (eşitlikte GİRDİ SIRASI korunur — ürünün
 * mevcut öncelik merdiveni budur) ve şablonu ilk cümle üreten KAZANIR. Diğerleri
 * `not_top` ile DÜŞER; kuyruğa ALINMAZ.
 */
export function decideProactive(
  proposals: readonly (ProactiveProposal | null | undefined)[] | null | undefined,
  ctx: ProactivePolicyContext,
  ledger: ProactiveLedgerView,
): ProactiveDecision {
  const drops: ProactiveDrop[] = [];
  const kinds = Object.freeze(_admissibleKinds(ctx));
  const push = (sourceId: string, reason: ProactiveDropReason): void => {
    if (drops.length < MAX_DROPS_PER_DECISION) drops.push({ sourceId, reason });
  };

  const list = Array.isArray(proposals) ? proposals : [];
  if (list.length === 0) {
    return Object.freeze({
      ...EMPTY_DECISION_BASE, evaluated: 0,
      drops: Object.freeze([]), admissibleKinds: kinds,
    });
  }

  /* Konuşma sırası meşgulse HİÇBİR teklif değerlendirilmez — TurnArbiter
     üstündür ve bu motor onu EZEMEZ. */
  if (ctx.turnBusy) {
    for (const p of list) if (_valid(p)) push(p.sourceId, 'turn_busy');
    return Object.freeze({
      ...EMPTY_DECISION_BASE, evaluated: list.length,
      drops: Object.freeze(drops), admissibleKinds: kinds,
    });
  }

  const now = Number.isFinite(ctx.nowMs) ? ctx.nowMs : 0;
  const wl = WORKLOAD_RANK[ctx.workload] ?? WORKLOAD_RANK.UNKNOWN;
  const suppressed = new Set(ledger.userSuppressed);
  const hourlyUsed = ledger.hourlyVoiceAtMs.filter((t) => now - t < HOUR_MS).length;

  const survivors: Array<{ p: ProactiveProposal; score: number; order: number }> = [];

  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!_valid(p)) { push(typeof p?.sourceId === 'string' ? p.sourceId : '?', 'invalid'); continue; }
    const rule = PROACTIVE_CLASS_RULES[p.kind];

    if (suppressed.has(p.sourceId)) { push(p.sourceId, 'user_suppressed'); continue; }

    if (rule.learnedSuppressible) {
      const until = ledger.learnedSuppressedUntilMs[p.sourceId];
      if (typeof until === 'number' && Number.isFinite(until) && now < until) {
        push(p.sourceId, 'learned_suppressed'); continue;
      }
    }

    if (_timeliness(p, now) === 0) { push(p.sourceId, 'decayed'); continue; }

    const last = ledger.lastAdmittedAtMs[p.cooldownKey];
    const cd = Number.isFinite(p.cooldownMs) && p.cooldownMs > 0 ? p.cooldownMs : 0;
    if (typeof last === 'number' && Number.isFinite(last) && now - last < cd) {
      push(p.sourceId, 'cooldown'); continue;
    }

    if (wl > (WORKLOAD_RANK[rule.maxWorkload] ?? 0)) { push(p.sourceId, 'workload'); continue; }
    if (rule.requiresPresence && !ctx.presenceEnabled) { push(p.sourceId, 'presence'); continue; }
    if (ctx.mediaProminent && p.mediaPolicy !== 'INTERRUPTS_MEDIA') {
      push(p.sourceId, 'media'); continue;
    }

    if (p.frequencyBudget === 'SUBJECT') {
      const gap = ctx.chattinessGapMs;
      const since = now - ledger.lastVoiceAtMs;
      if (!Number.isFinite(gap) || since < gap) { push(p.sourceId, 'budget'); continue; }
    }

    if (rule.countsToHourlyCeiling && hourlyUsed >= PROACTIVE_VOICE_CEILING_PER_HOUR) {
      push(p.sourceId, 'hourly_ceiling'); continue;
    }

    /* Görsel proaktif kanal ÜRETİMDE YOKTUR. `visual` teklif SESSİZCE sesli
       kanala kaydırılmaz (yalan olurdu) — dürüstçe düşer ve sayılır. */
    if (p.deliver === 'visual') { push(p.sourceId, 'no_visual_channel'); continue; }

    survivors.push({
      p, order: i,
      score: _unit(p.relevance) * _unit(p.confidence)
        * _timeliness(p, now) * _acceptanceFactor(p.sourceId, ledger),
    });
  }

  /* Eşitlikte GİRDİ SIRASI kazanır → ürünün doğrulanmış öncelik merdiveni
     (yakıt > kapı > lastik > görünürlük > uyku > …) skorlamayla BOZULMAZ. */
  survivors.sort((a, b) => (b.score - a.score) || (a.order - b.order));

  for (let i = 0; i < survivors.length; i++) {
    const entry = survivors[i];
    if (!entry) continue;
    let text: string | null = null;
    try { text = entry.p.text(); } catch { text = null; }
    if (typeof text !== 'string' || text.trim().length === 0) {
      push(entry.p.sourceId, 'no_text');
      continue;
    }
    /* TEK KONU KURALI: kazanan belli — kalan her şey DÜŞER, kuyruğa alınmaz. */
    for (let j = i + 1; j < survivors.length; j++) {
      const rest = survivors[j];
      if (rest) push(rest.p.sourceId, 'not_top');
    }
    return Object.freeze({
      admitted: true as const,
      sourceId: entry.p.sourceId,
      kind: entry.p.kind,
      text,
      evaluated: list.length,
      drops: Object.freeze(drops),
      admissibleKinds: kinds,
    });
  }

  return Object.freeze({
    ...EMPTY_DECISION_BASE, evaluated: list.length,
    drops: Object.freeze(drops), admissibleKinds: kinds,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bounded defter (modül durumu) — TEK örnek, süreç ömürlü
 * ════════════════════════════════════════════════════════════════════════ */

const _lastAdmittedAtMs = new Map<string, number>();
const _learnedUntilMs = new Map<string, number>();
const _rejectStamps = new Map<string, number[]>();
const _userSuppressed = new Set<string>();
let _hourlyVoiceAtMs: number[] = [];
let _lastVoiceAtMs = -Infinity;

/** Uçuştaki proaktif teslim — kesinti kanıtı BUNA bağlanır. */
let _inFlight: { sourceId: string; kind: ProactiveKind } | null = null;

/* Bounded sayaçlar (PII YOK — yalnız adet). */
let _decisions = 0;
let _admitted = 0;
let _interruptions = 0;
let _externalObserved = 0;
const _dropCounts: Record<string, number> = {};
const _admittedBySource: Record<string, number> = {};
const _kindCounts: Record<string, number> = {};
let _lastAdmittedSourceId: string | null = null;
let _lastDropReason: ProactiveDropReason | null = null;

/** Sözlük tavanı — sınırsız kaynak kimliği belleği şişiremez. */
function _capped(map: Map<string, unknown>): boolean {
  return map.size >= MAX_TRACKED_SOURCES;
}

function _recentRejectCount(sourceId: string, nowMs: number): number {
  const stamps = _rejectStamps.get(sourceId);
  if (!stamps) return 0;
  return stamps.filter((t) => nowMs - t < PROACTIVE_REJECT_DECAY_MS).length;
}

/** Defterin SAF görünümü — çekirdek yalnız bunu görür. */
function _ledgerView(nowMs: number): ProactiveLedgerView {
  const cooldowns: Record<string, number> = {};
  for (const [k, v] of _lastAdmittedAtMs) cooldowns[k] = v;
  const learned: Record<string, number> = {};
  for (const [k, v] of _learnedUntilMs) learned[k] = v;
  const rejects: Record<string, number> = {};
  for (const k of _rejectStamps.keys()) rejects[k] = _recentRejectCount(k, nowMs);
  return Object.freeze({
    lastAdmittedAtMs: Object.freeze(cooldowns),
    lastVoiceAtMs: _lastVoiceAtMs,
    hourlyVoiceAtMs: Object.freeze(_hourlyVoiceAtMs.slice()),
    userSuppressed: Object.freeze([..._userSuppressed]),
    learnedSuppressedUntilMs: Object.freeze(learned),
    recentRejects: Object.freeze(rejects),
  });
}

/**
 * **Üretim giriş noktası.** Teklifleri değerlendirir, kazananı deftere işler ve
 * hükmü döner. **SESLENDİRMEZ** — çağıran seslendirir (tek konuşma otoritesi
 * çağıranın hattındadır; bu motor ikinci bir TTS kanalı AÇMAZ).
 */
export function evaluateProactiveProposals(
  proposals: readonly (ProactiveProposal | null | undefined)[] | null | undefined,
  ctx: ProactivePolicyContext,
): ProactiveDecision {
  let decision: ProactiveDecision;
  try {
    decision = decideProactive(proposals, ctx, _ledgerView(ctx.nowMs));
  } catch {
    /* Fail-soft: karar üretilemezse KONUŞULMAZ (fail-closed davranış). */
    return Object.freeze({
      ...EMPTY_DECISION_BASE, evaluated: 0,
      drops: Object.freeze([]), admissibleKinds: Object.freeze([]),
    });
  }

  try {
    _decisions = _bump(_decisions);
    for (const d of decision.drops) {
      _dropCounts[d.reason] = _bump(_dropCounts[d.reason] ?? 0);
      _lastDropReason = d.reason;
    }
    if (decision.admitted && decision.sourceId && decision.kind) {
      _commitAdmitted(decision.sourceId, decision.kind, ctx.nowMs,
        _findCooldownKey(proposals, decision.sourceId));
    }
  } catch { /* defter hatası hükmü bozmaz */ }

  return decision;
}

function _findCooldownKey(
  proposals: readonly (ProactiveProposal | null | undefined)[] | null | undefined,
  sourceId: string,
): string {
  if (Array.isArray(proposals)) {
    for (const p of proposals) {
      if (p && p.sourceId === sourceId && typeof p.cooldownKey === 'string' && p.cooldownKey) {
        return p.cooldownKey;
      }
    }
  }
  return sourceId;
}

function _commitAdmitted(
  sourceId: string, kind: ProactiveKind, nowMs: number, cooldownKey: string,
): void {
  const now = Number.isFinite(nowMs) ? nowMs : 0;
  if (!_capped(_lastAdmittedAtMs) || _lastAdmittedAtMs.has(cooldownKey)) {
    _lastAdmittedAtMs.set(cooldownKey, now);
  }
  /* Sıklık saati SINIF FARKI GÖZETMEZ: bir güvenlik uyarısı da sohbetin
     bütçesini tüketir (mevcut davranış — `speak()` her tetikte saati ilerletirdi). */
  _lastVoiceAtMs = now;
  if (PROACTIVE_CLASS_RULES[kind].countsToHourlyCeiling) {
    _hourlyVoiceAtMs = _hourlyVoiceAtMs.filter((t) => now - t < HOUR_MS);
    _hourlyVoiceAtMs.push(now);
  }
  _admitted = _bump(_admitted);
  _admittedBySource[sourceId] = _bump(_admittedBySource[sourceId] ?? 0);
  _kindCounts[kind] = _bump(_kindCounts[kind] ?? 0);
  _lastAdmittedSourceId = sourceId;
  _inFlight = { sourceId, kind };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Teslim ve öğrenme
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Teslim TAMAMLANDI (TTS bitti / düştü). Kesinti penceresini kapatır.
 * **Bir KABUL kanıtı DEĞİLDİR** — kullanıcının öneriye uyup uymadığını bilmiyoruz.
 */
export function endProactiveDelivery(): void { _inFlight = null; }

/**
 * MAVI-F11 · UI için SALT-OKUNUR sorgu: uçuşta bir proaktif teslim var mı.
 * **Karar üretmez, defteri değiştirmez.** Yüzey katmanı `PROACTIVE` durumunu
 * bundan türetir; bu motorun otoritesi ETKİLENMEZ.
 */
export function isProactiveDeliveryInFlight(): boolean { return _inFlight !== null; }

/**
 * Kullanıcı, uçuştaki proaktif konuşmayı KESTİ (mikrofonu açtı / durdurdu).
 * Bu GERÇEK bir sinyaldir ama "reddetti" demek DEĞİLDİR — kullanıcı ilgisiz bir
 * sebeple de mikrofonu açmış olabilir. Bu yüzden:
 *  · skoru kademeli düşürür (`_acceptanceFactor`),
 *  · eşiğe gelince **geçici** (decay'li) bastırma uygular — kalıcı DEĞİL,
 *  · `safety` sınıfını **ASLA** susturmaz.
 */
export function noteProactiveInterrupted(nowMs: number): void {
  try {
    const f = _inFlight;
    _inFlight = null;
    if (!f) return;
    _interruptions = _bump(_interruptions);
    if (!PROACTIVE_CLASS_RULES[f.kind].learnedSuppressible) return;
    const now = Number.isFinite(nowMs) ? nowMs : 0;
    const stamps = (_rejectStamps.get(f.sourceId) ?? [])
      .filter((t) => now - t < PROACTIVE_REJECT_DECAY_MS);
    stamps.push(now);
    if (!_capped(_rejectStamps) || _rejectStamps.has(f.sourceId)) {
      _rejectStamps.set(f.sourceId, stamps.slice(-PROACTIVE_REJECT_THRESHOLD));
    }
    if (stamps.length >= PROACTIVE_REJECT_THRESHOLD
        && (!_capped(_learnedUntilMs) || _learnedUntilMs.has(f.sourceId))) {
      _learnedUntilMs.set(f.sourceId, now + PROACTIVE_LEARNED_SUPPRESSION_MS);
    }
  } catch { /* fail-soft */ }
}

/**
 * Kullanıcının AÇIK susturma talebi ("bunu bir daha söyleme"). KALICI — yalnız
 * `restoreProactiveSource` geri açar. Çağıranın sözleşmesi: **güvenlik kaynağı
 * kimliği buraya VERİLMEZ** (üretimde bu API'nin çağıranı bugün YOKTUR — açık
 * borç; ayar/intent yüzeyi F9 kapsamında AÇILMADI).
 */
export function suppressProactiveSource(sourceId: string): void {
  if (typeof sourceId !== 'string' || sourceId.length === 0) return;
  if (_userSuppressed.size >= MAX_TRACKED_SOURCES) return;
  _userSuppressed.add(sourceId);
}

/** Susturmayı geri alır (ayarlardan). Öğrenilmiş bastırmayı da temizler. */
export function restoreProactiveSource(sourceId: string): void {
  _userSuppressed.delete(sourceId);
  _learnedUntilMs.delete(sourceId);
  _rejectStamps.delete(sourceId);
}

/**
 * Bu motorun KAPISINDAN GEÇMEYEN bir proaktif konuşma gerçekleşti (kritik arıza
 * hattı gibi kendi kanonik güvenlik kapısı olan yollar). **Yalnız DEFTERE yazar;
 * o hattı GATE'LEMEZ ve susturamaz** — ikinci bir güvenlik otoritesi kurmak
 * yasaktır. Amaç: LAB'daki proaktif tablonun eksik/yalan olmaması.
 */
export function noteExternalProactiveSpoken(
  sourceId: string, kind: ProactiveKind, nowMs: number,
): void {
  try {
    if (typeof sourceId !== 'string' || sourceId.length === 0) return;
    if (PROACTIVE_CLASS_RULES[kind] === undefined) return;
    const now = Number.isFinite(nowMs) ? nowMs : 0;
    _externalObserved = _bump(_externalObserved);
    _kindCounts[kind] = _bump(_kindCounts[kind] ?? 0);
    _admittedBySource[sourceId] = _bump(_admittedBySource[sourceId] ?? 0);
    _lastVoiceAtMs = now;
    if (PROACTIVE_CLASS_RULES[kind].countsToHourlyCeiling) {
      _hourlyVoiceAtMs = _hourlyVoiceAtMs.filter((t) => now - t < HOUR_MS);
      _hourlyVoiceAtMs.push(now);
    }
  } catch { /* fail-soft */ }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bounded tanı — CAROS LAB · **PII YOK** (metin · transcript · konum TAŞINMAZ)
 * ════════════════════════════════════════════════════════════════════════ */

export interface ProactivePolicyDiagnostics {
  readonly decisions: number;
  readonly admitted: number;
  readonly externalObserved: number;
  readonly interruptions: number;
  readonly lastAdmittedSourceId: string | null;
  readonly lastDropReason: ProactiveDropReason | null;
  readonly drops: Readonly<Record<string, number>>;
  readonly admittedBySource: Readonly<Record<string, number>>;
  readonly kinds: Readonly<Record<string, number>>;
  /** Saatlik pencerede sayılan (safety DIŞI) sesli proaktif adedi. */
  readonly hourlyVoiceUsed: number;
  readonly hourlyVoiceCeiling: number;
  readonly userSuppressed: readonly string[];
  readonly learnedSuppressed: readonly string[];
  /**
   * Kabul oranı ölçülebiliyor mu. **Bugün HAYIR:** üretimde "kullanıcı bu
   * öneriyi kabul etti" diyen bir sinyal YOKTUR (yalnız KESİNTİ gözlenebiliyor).
   * Sahte bir oran ÜRETİLMEZ — bu alan dürüstlüğün kendisidir.
   */
  readonly acceptRateMeasurable: false;
}

export function getProactivePolicyDiagnostics(nowMs = 0): ProactivePolicyDiagnostics {
  const now = Number.isFinite(nowMs) ? nowMs : 0;
  const learned: string[] = [];
  for (const [k, until] of _learnedUntilMs) if (now < until) learned.push(k);
  return Object.freeze({
    decisions: _decisions,
    admitted: _admitted,
    externalObserved: _externalObserved,
    interruptions: _interruptions,
    lastAdmittedSourceId: _lastAdmittedSourceId,
    lastDropReason: _lastDropReason,
    drops: Object.freeze({ ..._dropCounts }),
    admittedBySource: Object.freeze({ ..._admittedBySource }),
    kinds: Object.freeze({ ..._kindCounts }),
    hourlyVoiceUsed: _hourlyVoiceAtMs.filter((t) => now - t < HOUR_MS).length,
    hourlyVoiceCeiling: PROACTIVE_VOICE_CEILING_PER_HOUR,
    userSuppressed: Object.freeze([..._userSuppressed]),
    learnedSuppressed: Object.freeze(learned),
    acceptRateMeasurable: false as const,
  });
}

/** @internal — testler arası izolasyon. */
export function _resetProactivePolicyForTest(): void {
  _lastAdmittedAtMs.clear();
  _learnedUntilMs.clear();
  _rejectStamps.clear();
  _userSuppressed.clear();
  _hourlyVoiceAtMs = [];
  _lastVoiceAtMs = -Infinity;
  _inFlight = null;
  _decisions = 0; _admitted = 0; _interruptions = 0; _externalObserved = 0;
  _lastAdmittedSourceId = null; _lastDropReason = null;
  for (const k of Object.keys(_dropCounts)) delete _dropCounts[k];
  for (const k of Object.keys(_admittedBySource)) delete _admittedBySource[k];
  for (const k of Object.keys(_kindCounts)) delete _kindCounts[k];
}
