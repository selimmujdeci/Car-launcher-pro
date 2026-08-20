/**
 * aiCore/runtime/diagnosticEvidence.ts — TANI KANITI ZENGİNLEŞTİRME (SAF · additive · Faz-2.5).
 *
 * AMAÇ: Mevcut Diagnostics V2 otoritesinin ürettiği zengin OBD teşhis anlık görüntüsünü
 * (ObdDeepSnapshot: DTC · handshake/protocol · transport/health · capability outcome ·
 * recovery/disconnect) + kaynak sağlığı + Vehicle Memory bilinen-sınırları AI Core kanıt
 * satırlarına çevirir. VERİ ÜRETMEZ / İKİNCİ OTORİTE KURMAZ — yalnız mevcut kanıtın ŞEKLİNİ
 * AI Core'a uyarlar (read-only, additive).
 *
 * KURALLAR (görev sözleşmesi):
 *  - "0 ≠ no-data": lastPacketAgeMs -1 / null = ÖLÇÜLMEDİ (no-data), 0 DEĞİL. Ölçülmemiş alan
 *    kanıt üretmez veya AÇIKÇA "yakalanmadı" işaretlenir (uydurma yok).
 *  - EKSİK/ESKİ AÇIKÇA: isStale/bayat okuma → summary'de "(bayat)" + düşük güven; hiç
 *    çalışmamış handshake / cache'siz freeze-frame → "yakalanmadı" kanıtı (missing marker).
 *  - BOUNDED/DEDUP: her kategori tavana tabi; anahtarlar kararlı (EvidenceStore dedup eder).
 *  - PII yok: yalnız kod/sayı/enum (makeEvidence sanitize eder). SAF: zaman enjekte, yan etki yok.
 *
 * DECOUPLED: diagnosticSections/obd modüllerini import ETMEZ (yalnız yapısal *Like şekli bilir)
 * → bağımlılık döngüsü yok, OBD çalışma-ağacına dokunmaz, test gerçek servis kurmadan çalışır.
 */

import type { AiEvidenceItem } from '../types';
import type { TriageSections } from '../../diagnosticTriage';
import { makeEvidence } from '../evidenceStore';
import { OBD_FROZEN_ABS_MS } from '../../freshnessPolicy';

/* ── Decoupled girdi şekilleri (ObdDeepSnapshot / sourceHealth *Like) ── */

export interface DiagDtcCodeLike { readonly code?: string; readonly severity?: string; readonly system?: string }
export interface DiagObdDeepLike {
  readonly adapter?: { readonly source?: string; readonly connectionState?: string; readonly lastSeenMs?: number } | null;
  readonly health?: {
    readonly connectionQuality?: number; readonly lastPacketAgeMs?: number;
    readonly isStale?: boolean; readonly reconnectPressure?: number;
  } | null;
  readonly handshake?: {
    readonly outcome?: string; readonly protocolTried?: string | null; readonly protocolActive?: string | null;
    readonly bitmapClass?: string | null; readonly vinClass?: string | null; readonly failReason?: string | null;
    readonly reconnectHistory?: readonly ({ readonly reason?: string } | null)[];
  } | null;
  readonly dtc?: {
    readonly count?: number; readonly isStale?: boolean; readonly error?: string | null;
    readonly codes?: readonly (DiagDtcCodeLike | null)[];
  } | null;
  readonly extended?: { readonly discovered?: boolean; readonly supportedCount?: number; readonly unavailable?: readonly string[] } | null;
  readonly connLifecycle?: Readonly<Record<string, unknown>> | null;
  readonly kwpRecoveryEvidence?: {
    readonly status?: string; readonly recoveryCount?: number;
    readonly maxCoreNoDataStreak?: number; readonly suppressedCount?: number;
    /** #642 — tavan kararının baktığı sayaç (oturum toplamı DEĞİL). */
    readonly consecutiveFailedRecoveries?: number | null;
    /** #642 — snapshot'ın KENDİ tazelenme damgası; yoksa yaş BİLİNMEZ. */
    readonly refreshedAt?: number;
  } | null;
}

/** Kaynak başına sağlık (PlatformSourceHealthDiag *Like — sub-şekil opak, defansif okunur). */
export interface DiagSourceHealthLike {
  readonly can?: unknown;
  readonly obd?: unknown;
  readonly gps?: unknown;
}

/** Cache'lenmiş freeze-frame (varsa). null → bu oturumda yakalanmadı (canlı sorgu YAPILMAZ). */
export interface DiagFreezeFrameLike {
  readonly dtcCode?: string | null;
  readonly valueCount?: number;
  readonly capturedAt?: number;
}

/** Vehicle Memory'den bilinen-sınır gerçeği. */
export interface DiagMemoryLimitLike {
  readonly key: string;
  readonly statement: string;
  readonly confidence: number;
  readonly lastSeen?: number;
}

export interface DiagnosticEvidenceInput {
  readonly obdDeep?: DiagObdDeepLike | null;
  readonly sourceHealth?: DiagSourceHealthLike | null;
  /** null → freeze-frame bu oturumda yakalanmadı (açıkça işaretlenir). */
  readonly freezeFrame?: DiagFreezeFrameLike | null;
  readonly memoryLimits?: readonly DiagMemoryLimitLike[];
}

/* ── Sabitler (bounded) ─────────────────────────────────────────── */

const MAX_DTC_EVIDENCE = 10;
const MAX_MEMORY_EVIDENCE = 8;
/* E-01/E-36: "ObdHealthMonitor ile hizalı" bir YORUMDU, sözleşme değildi —
   artık aynı otoriteden okunur (elle kopyalanan sayı sessizce ayrışamaz). */
const STALE_PACKET_MS = OBD_FROZEN_ABS_MS;

/* ── Saf yardımcılar ────────────────────────────────────────────── */

function _num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function _bool(v: unknown): boolean {
  return v === true;
}
/** Opak kaynak-sağlık değerinden 'stale' bayrağını defansif çıkar. */
function _srcStale(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;          // no-data (ölçülmemiş) — 0 DEĞİL
  if (typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  return _bool(r.stale) || _bool(r.isStale);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kategori üreticileri (her biri bounded + stale/missing işaretli)
 * ════════════════════════════════════════════════════════════════════════ */

/** current DTC — bayat okuma / okuma hatası AÇIKÇA işaretlenir. */
function _dtcEvidence(od: DiagObdDeepLike, now: number, out: AiEvidenceItem[]): void {
  const dtc = od.dtc;
  if (!dtc) return;
  const stale = _bool(dtc.isStale);
  if (typeof dtc.error === 'string' && dtc.error) {
    const ev = makeEvidence({
      key: 'dtc.read_error', kind: 'diagnostic',
      summary: `DTC okuması başarısız: ${dtc.error} — arıza kodları doğrulanamadı`,
      confidence: 0.3, observedAt: now, source: 'diagnostics',
    });
    if (ev) out.push(ev);
  }
  const codes = Array.isArray(dtc.codes) ? dtc.codes.filter((c): c is DiagDtcCodeLike => c != null) : [];
  let n = 0;
  for (const c of codes) {
    if (n >= MAX_DTC_EVIDENCE) break;
    if (typeof c.code !== 'string' || !c.code) continue;
    const sev = c.severity === 'critical' ? 'critical' : c.severity === 'warning' ? 'warning' : 'info';
    const baseConf = sev === 'critical' ? 0.95 : sev === 'warning' ? 0.8 : 0.6;
    const ev = makeEvidence({
      key: `dtc.${c.code}`, kind: 'dtc',
      summary: `Arıza kodu ${c.code} (${sev}${c.system ? `, ${c.system}` : ''})${stale ? ' — bayat okuma' : ''}`,
      confidence: stale ? Math.min(baseConf, 0.5) : baseConf,   // bayat → düşük güven
      observedAt: now, source: 'obd',
    });
    if (ev) { out.push(ev); n++; }
  }
}

/** freeze-frame — cache varsa evidence, yoksa AÇIKÇA "yakalanmadı" (canlı sorgu yok). */
function _freezeEvidence(input: DiagnosticEvidenceInput, now: number, out: AiEvidenceItem[]): void {
  const dtcCount = _num(input.obdDeep?.dtc?.count) ?? 0;
  const ff = input.freezeFrame;
  if (ff && (typeof ff.dtcCode === 'string' || _num(ff.valueCount))) {
    const ev = makeEvidence({
      key: 'freeze.frame', kind: 'diagnostic',
      summary: `Freeze-frame yakalandı${ff.dtcCode ? ` (${ff.dtcCode})` : ''}: ${_num(ff.valueCount) ?? 0} değer`,
      confidence: 0.8, observedAt: _num(ff.capturedAt) ?? now, source: 'obd',
    });
    if (ev) out.push(ev);
    return;
  }
  // DTC var ama freeze cache yok → eksik kanıt açıkça işaretlenir (uydurma yok).
  if (dtcCount > 0) {
    const ev = makeEvidence({
      key: 'freeze.missing', kind: 'diagnostic',
      summary: 'Freeze-frame bu oturumda yakalanmadı — arıza anı koşulları doğrulanamadı',
      confidence: 0.25, observedAt: now, source: 'diagnostics',
    });
    if (ev) out.push(ev);
  }
}

/** protocol/handshake — outcome/fail/protocol uyuşmazlığı. */
function _handshakeEvidence(od: DiagObdDeepLike, now: number, out: AiEvidenceItem[]): void {
  const hs = od.handshake;
  if (!hs || typeof hs.outcome !== 'string' || hs.outcome === 'not_run') {
    if (hs && hs.outcome === 'not_run') {
      const ev = makeEvidence({
        key: 'handshake.not_run', kind: 'diagnostic',
        summary: 'Handshake bu oturumda çalışmadı — VIN/desteklenen-PID keşfi doğrulanamadı',
        confidence: 0.3, observedAt: now, source: 'diagnostics',
      });
      if (ev) out.push(ev);
    }
    return;
  }
  const ok = hs.outcome === 'ok';
  const ev = makeEvidence({
    key: 'handshake.outcome', kind: 'diagnostic',
    summary: `Handshake sonucu: ${hs.outcome}${hs.failReason ? ` (${hs.failReason})` : ''}`,
    confidence: ok ? 0.85 : 0.75, observedAt: now, source: 'obd',
  });
  if (ev) out.push(ev);

  // Protokol uyuşmazlığı: zorlanan var ama aktif yok (araç-değişimi sinyali).
  if (hs.protocolTried && !hs.protocolActive) {
    const pe = makeEvidence({
      key: 'handshake.protocol_mismatch', kind: 'diagnostic',
      summary: `Zorlanan protokol ${hs.protocolTried} aktif değil — araç/protokol uyuşmazlığı`,
      confidence: 0.7, observedAt: now, source: 'obd',
    });
    if (pe) out.push(pe);
  } else if (hs.protocolActive) {
    const pe = makeEvidence({
      key: 'handshake.protocol', kind: 'diagnostic',
      summary: `Aktif protokol: ${hs.protocolActive}`,
      confidence: 0.8, observedAt: now, source: 'obd',
    });
    if (pe) out.push(pe);
  }
}

/** transport + health — connectionQuality/reconnectPressure/freshness (stale AÇIKÇA). */
function _transportEvidence(od: DiagObdDeepLike, now: number, out: AiEvidenceItem[]): void {
  const h = od.health;
  if (!h) return;
  /* SAHTE -1 YASAĞI (#669): `connectionQuality` bağlantı yokken **-1** taşır
     (bilinmiyor sentineli). Ham basıldığı için LAB kanıt satırı
     **"Bağlantı kalitesi %-1"** yazıyordu — hem anlamsız hem de kanıt gibi
     görünen bir bilinmezlik. Negatif değer ÖLÇÜM DEĞİLDİR: kanıt üretilmez.
     Bu, panel tarafında #667'de kapatılan sentinel kusurunun kanıt zincirindeki
     eşidir. */
  const q = _num(h.connectionQuality);
  if (q !== null && q >= 0) {
    const ev = makeEvidence({
      key: 'transport.quality', kind: 'diagnostic',
      summary: `Bağlantı kalitesi %${Math.round(q)}`,
      confidence: q < 50 ? 0.85 : 0.6, observedAt: now, source: 'obd',
    });
    if (ev) out.push(ev);
  }
  const rp = _num(h.reconnectPressure);
  if (rp !== null && rp > 0) {
    // T11 — EŞİK DÜZELTMESİ (saha snapshot 2026-08-01).
    //
    // `reconnectPressure`, 120 sn yarı-ömürle SÖNÜMLENEN reconnect sayacıdır
    // (her kopma +1). Eski kod rp>0 olan HER değere "bağlantı kararsız" diyordu.
    // Sahada ölçülen 0.5346 = TEK bir reconnect'in 108 sn sönümlenmiş hâli
    // (0.5^(108/120)=0.537) — yani iki dakika önce bir kez kopup BAŞARIYLA
    // geri gelmiş, o gündür sorunsuz akan bir bağlantı. Buna "kararsız" demek
    // Mavi'yi yanlış teşhise sürüklüyordu.
    //
    // Eşikler yarı-ömür penceresi cinsinden anlamlıdır:
    //   ≥ 2.0 → pencere içinde 2+ kopma = GERÇEKTEN kararsız
    //   ≥ 1.0 → yakın zamanda bir kopma = dikkat, henüz kararsız değil
    //   <  1.0 → sönümlenmiş tek olay = geçmiş kayıt, arıza iddiası YOK
    const unstable = rp >= 2;
    const recent   = rp >= 1;
    const summary = unstable
      ? `Reconnect baskısı ${rp.toFixed(2)} — bağlantı kararsız (yarı-ömür penceresinde 2+ kopma)`
      : recent
        ? `Reconnect baskısı ${rp.toFixed(2)} — yakın zamanda bir kopma (kararsızlık eşiğinin altında)`
        : `Reconnect baskısı ${rp.toFixed(2)} — sönümlenmiş tek kopma kaydı (şu an kararsızlık kanıtı YOK)`;
    const ev = makeEvidence({
      key: 'transport.reconnect_pressure', kind: 'diagnostic',
      summary,
      confidence: unstable ? 0.75 : recent ? 0.5 : 0.3,
      observedAt: now, source: 'obd',
    });
    if (ev) out.push(ev);
  }
  // Freshness — lastPacketAgeMs -1/null = ÖLÇÜLMEDİ (no-data), 0 DEĞİL.
  const age = _num(h.lastPacketAgeMs);
  const stale = _bool(h.isStale) || (age !== null && age >= 0 && age > STALE_PACKET_MS);
  if (stale) {
    const ageTxt = age !== null && age >= 0 ? `${(age / 1000).toFixed(1)}s` : '?';
    const ev = makeEvidence({
      key: 'transport.freshness', kind: 'diagnostic',
      summary: `Veri donuk/bayat — son paket ${ageTxt} önce (bağlı ama veri akmıyor)`,
      confidence: 0.8, observedAt: now, source: 'obd',
    });
    if (ev) out.push(ev);
  }
}

/** source health — kaynak başına (null = ölçülmedi, stale = AÇIKÇA). */
function _sourceHealthEvidence(sh: DiagSourceHealthLike, now: number, out: AiEvidenceItem[]): void {
  for (const src of ['can', 'obd', 'gps'] as const) {
    const raw = (sh as Record<string, unknown>)[src];
    const st = _srcStale(raw);
    if (st === null) continue;                 // ölçülmedi → kanıt yok (no-data, uydurma yok)
    const ev = makeEvidence({
      key: `source_health.${src}`, kind: 'diagnostic',
      summary: st ? `${src.toUpperCase()} kaynağı bayat (veri gelmiyor)` : `${src.toUpperCase()} kaynağı sağlıklı`,
      confidence: st ? 0.8 : 0.55, observedAt: now, source: 'diagnostics',
    });
    if (ev) out.push(ev);
  }
}

/** Maksimum listelenen PID — üstü "+N daha" olarak AÇIKÇA belirtilir (sessiz kırpma YOK). */
const UNAVAILABLE_PID_PREVIEW_MAX = 6;

/**
 * T8: PID listesini tek canonical koleksiyona indirger — normalize (büyük harf hex,
 * boşluksuz) + duplicate ayıklama. Sayı ve liste ARTIK AYNI kaynaktan gelir.
 */
export function normalizeUnavailablePids(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const norm = item.trim().toUpperCase().replace(/^0X/, '');
    if (norm === '' || seen.has(norm)) continue;   // duplicate iki kez SAYILMAZ
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

/** capability outcome — araç tarafından verilmeyen PID'ler (NRC/NO_DATA sonrası bilinen sınır). */
function _capabilityEvidence(od: DiagObdDeepLike, now: number, out: AiEvidenceItem[]): void {
  // ESKİ KUSUR (saha snapshot 2026-08-01): metin "8 PID … verilmiyor" diyor ama
  // yalnız 6 PID listeliyordu — sayı `unavail.length`ten, liste `slice(0,6)`tan
  // geliyordu ve kırpma HİÇ belirtilmiyordu. Geliştirici eksik iki PID'i arıyordu.
  // Artık ikisi de tek normalize koleksiyondan türer ve kırpma açıkça yazılır.
  const pids = normalizeUnavailablePids(od.extended?.unavailable);
  if (pids.length === 0) return;

  const shown  = pids.slice(0, UNAVAILABLE_PID_PREVIEW_MAX);
  const hidden = pids.length - shown.length;
  const listTxt = hidden > 0
    ? `${shown.join(', ')} (+${hidden} daha, ${shown.length}/${pids.length} gösteriliyor)`
    : shown.join(', ');

  const ev = makeEvidence({
    key: 'capability.unavailable_pids', kind: 'capability',
    summary: `${pids.length} PID araç tarafından verilmiyor (bilinen sınır, arıza değil): ${listTxt}`,
    confidence: 0.7, observedAt: now, source: 'obd',
  });
  if (ev) out.push(ev);
}

/** recovery/disconnect — KWP kurtarma + reconnect geçmişi + connLifecycle sayaçları. */
function _recoveryEvidence(od: DiagObdDeepLike, now: number, out: AiEvidenceItem[]): void {
  const kwp = od.kwpRecoveryEvidence;
  if (kwp && typeof kwp.status === 'string') {
    const rc = _num(kwp.recoveryCount) ?? 0;
    const maxStreak = _num(kwp.maxCoreNoDataStreak) ?? 0;
    const consecFailed = _num(kwp.consecutiveFailedRecoveries);
    /* ── #642 · TAZELİK YALANI KAPATILDI (saha 2026-08-19) ────────────────────
     * Bu kanıt `getKwpRecoveryEvidence()` ÖNBELLEĞİNDEN okunur ve o önbelleği
     * YALNIZ rapor üretimi / LAB ekranı açılışı doldurur — periyodik tazeleyen
     * YOKTUR. Eski kod yine de `observedAt: now` damgası atıyordu.
     * Kullanıcı kopyasında (2026-08-19) sonuç şuydu: AI "KWP kurtarma:
     * NOT_ATTEMPTED (ATPC 0×)" derken canlı otorite AYNI anda
     * `RECOVERED · recoveryCount 4 · son kurtarma 3,5 dk önce` diyordu.
     * AI Mechanic yanlış olguyla akıl yürütüyordu.
     *
     * Artık damga snapshot'ın KENDİ zamanıdır; yaş ölçülebiliyorsa özete yazılır,
     * ölçülemiyorsa "yaş BİLİNMİYOR" denir (sahte tazelik ÜRETİLMEZ). */
    const refreshedAt = _num(kwp.refreshedAt);
    const ageMs = refreshedAt !== null && refreshedAt > 0 ? Math.max(0, now - refreshedAt) : null;
    /* Özet TAVANLIDIR (`MAX_SUMMARY_CHARS`) → kritik bilgi ÖNE alınır ve kısa
       yazılır; uzun cümle kurulursa tazelik etiketi kesilir ve yalan geri gelir. */
    const freshTxt = ageMs === null
      ? ' · yaş ?'
      : ageMs > 30_000 ? ` · ${Math.round(ageMs / 1000)}sn önce` : '';
    const capTxt = consecFailed === null ? ' · ardışık ?' : ` · ardışık ${consecFailed}`;
    const ev = makeEvidence({
      key: 'recovery.kwp', kind: 'diagnostic',
      summary: `KWP: ${kwp.status}${freshTxt}${capTxt} · ATPC ${rc}× · NO_DATA max ${maxStreak}`,
      /* Bayat kanıt daha DÜŞÜK güvenle girer — silinmez, ama "şu an" gibi ağırlık taşımaz. */
      confidence: ageMs !== null && ageMs > 30_000 ? 0.4 : 0.7,
      observedAt: refreshedAt !== null && refreshedAt > 0 ? refreshedAt : now,
      source: 'obd',
    });
    if (ev) out.push(ev);
  }
  const hist = od.handshake?.reconnectHistory;
  if (Array.isArray(hist) && hist.length > 0) {
    const reasons = hist.filter((h) => h != null);
    const timeouts = reasons.filter((h) => h!.reason === 'timeout').length;
    const ev = makeEvidence({
      key: 'recovery.reconnect_history', kind: 'diagnostic',
      summary: `${reasons.length} reconnect kaydı (${timeouts} timeout) bu oturumda`,
      confidence: 0.65, observedAt: now, source: 'obd',
    });
    if (ev) out.push(ev);
  }
  // connLifecycle: defansif — herhangi pozitif sayaç varsa "yaşam-döngüsü aktivitesi" kanıtı.
  const cl = od.connLifecycle;
  if (cl && typeof cl === 'object') {
    // KUSUR (2026-07-27 saha dökümünde yakalandı): burada `Object.values(cl)`
    // körlemesine toplanıyordu — `lastResetAt`/`lastDisconnectAt`/`lastReconnectAt`
    // EPOCH ZAMAN DAMGALARI da sayaçlara ekleniyor, sonuç ~5.36e12 gibi anlamsız bir
    // "aktivite" sayısı oluyordu (kanıt metninde maskeleme bunu gizlediği için uzun
    // süre fark edilmedi). Artık YALNIZ sayaç alanları toplanır.
    // KURAL: yalnız `...Count` ile biten alanlar SAYAÇtır. `lastResetAt`,
    // `lastDisconnectAt`, `lastReconnectAt` gibi `...At` alanları EPOCH zaman
    // damgasıdır ve toplanamaz. (Alan adına bağlı olması, sözleşme değişirse
    // sessizce yanlış toplamaktan iyidir: bilinmeyen alan toplama GİRMEZ.)
    let activity = 0;
    for (const [k, v] of Object.entries(cl)) {
      if (!/Count$/.test(k)) continue;
      const n = _num(v);
      if (n !== null && n > 0) activity += n;
    }
    if (activity > 0) {
      const ev = makeEvidence({
        key: 'recovery.lifecycle', kind: 'diagnostic',
        summary: `Bağlantı yaşam-döngüsü aktivitesi kaydedildi (reset/disconnect/reconnect toplam ${activity})`,
        confidence: 0.55, observedAt: now, source: 'diagnostics',
      });
      if (ev) out.push(ev);
    }
  }
}

/** Vehicle Memory bilinen-sınırları → 'memory' kanıtı (arıza değil, öğrenilmiş sınır). */
function _memoryEvidence(limits: readonly DiagMemoryLimitLike[], now: number, out: AiEvidenceItem[]): void {
  let n = 0;
  for (const f of limits) {
    if (n >= MAX_MEMORY_EVIDENCE) break;
    if (!f || typeof f.key !== 'string' || !f.key || typeof f.statement !== 'string' || !f.statement) continue;
    const ev = makeEvidence({
      key: `memory.${f.key}`, kind: 'memory',
      summary: `Bilinen araç sınırı (arıza değil): ${f.statement}`,
      confidence: _num(f.confidence) ?? 0.6, observedAt: _num(f.lastSeen) ?? now, source: 'memory',
    });
    if (ev) { out.push(ev); n++; }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Genel API
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Mevcut tanı anlık görüntüsünden bounded, dedup-anahtarlı, PII-güvenli kanıt satırları
 * üretir. SAF; hiçbir alan yoksa boş döner (sahte kanıt yok). Fail-soft: her kategori
 * kendi null-check'ini yapar.
 */
export function deriveDiagnosticEvidence(input: DiagnosticEvidenceInput, now: number = Date.now()): AiEvidenceItem[] {
  const out: AiEvidenceItem[] = [];
  const od = input.obdDeep;
  if (od) {
    _dtcEvidence(od, now, out);
    _handshakeEvidence(od, now, out);
    _transportEvidence(od, now, out);
    _capabilityEvidence(od, now, out);
    _recoveryEvidence(od, now, out);
  }
  _freezeEvidence(input, now, out);
  if (input.sourceHealth) _sourceHealthEvidence(input.sourceHealth, now, out);
  if (Array.isArray(input.memoryLimits) && input.memoryLimits.length > 0) _memoryEvidence(input.memoryLimits, now, out);
  return out;
}

/**
 * Zengin OBD anlık görüntüsünü Verdict çekirdeğinin okuduğu TriageSections'a sarar
 * (mevcut Diagnostics V2 motorunu DAHA İYİ besler — ikinci motor değil). SAF.
 */
export function obdDeepToSections(obdDeep: DiagObdDeepLike | null | undefined): TriageSections {
  if (!obdDeep) return {};
  return { obdDeep: obdDeep as unknown as TriageSections['obdDeep'] };
}
