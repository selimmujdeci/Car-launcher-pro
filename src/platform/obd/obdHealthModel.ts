/**
 * obdHealthModel — P0-OBD-06 · OBD HAT VE SİNYAL SAĞLIĞININ SÖZLEŞMESİ (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React importu YOK.
 *
 * ── NEDEN VAR (ölçülen boşluk) ────────────────────────────────────────────
 * Depoda ZATEN üç sağlık kanıtı vardı ve üçü de FARKLI soruya bakıyordu:
 *   · `obdService.transportConnected/dataFresh` → hat ve ECU sessizliği (uyarlanabilir eşik)
 *   · `ObdHealthMonitor`                        → skor + MUTLAK donma bayrağı
 *   · `linkLossLedger`                          → kopmanın nedeni (geçmiş kaydı)
 * Hiçbiri **ALAN BAŞINA** "bu sinyal hâlâ yenileniyor mu" sorusunu yanıtlamıyordu.
 * Sonuç: Bluetooth bağlı + ELM cevap veriyor iken TEK BİR PID donmuş olabilir ve
 * hiçbir katman bunu görmezdi.
 *
 * Bu modül DÖRDÜNCÜ bir sağlık sistemi KURMAZ: mevcut kanıtları (monitörün alan
 * zamanlaması + taşıma durumu) TEK bir sözleşmeye çevirir. Eşik matematiği de
 * yeniden yazılmaz — `obdFreshnessPolicy.computeFreshnessWindow` (P0-OBD-02'nin
 * tazelik otoritesi) YENİDEN KULLANILIR.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *   DISCONNECTED — taşıma yok. Veri hakkında hiçbir iddia yok.
 *   STALLED      — taşıma AÇIK ama beklenen yenileme GELMİYOR. En tehlikeli
 *                  durum budur: ekran doludur ama sayılar ölüdür.
 *   DEGRADED     — veri geliyor ama güvenilirlik düşük (red/NO DATA baskısı,
 *                  gecikme beklenenin çok üstünde).
 *   HEALTHY      — beklenen kadansta, kabul edilen ölçüm akıyor.
 *
 * ── İKİ AYRI SORU: STALL vs FREEZE ────────────────────────────────────────
 *   STALL  = YENİLEME gelmiyor (yeni ölçüm yok). ARIZADIR.
 *   FREEZE = ölçüm geliyor ama DEĞER değişmiyor. TEK BAŞINA ARIZA DEĞİLDİR —
 *            park hâlinde devir 0, hız 0 sabit kalır ve bu tamamen normaldir.
 * Bu yüzden `frozen` bir HÜKÜM değil, bir GÖZLEMDİR ve sağlık durumunu
 * DÜŞÜRMEZ. İkisini birleştirmek, duran araçta sahte alarm üretirdi.
 */

import type { FieldTimingSnapshot, HealthField } from './ObdHealthMonitor';
import { computeFreshnessWindow, type ObdFreshnessClass } from './obdFreshnessPolicy';

/* ── Sözleşme ─────────────────────────────────────────────────────────────── */

export type ObdHealthState = 'HEALTHY' | 'DEGRADED' | 'STALLED' | 'DISCONNECTED';

/** Bir sinyalin sağlıksızlığının SEBEBİ — dört neden BİRLEŞTİRİLMEZ. */
export type ObdHealthCause =
  | 'ok'
  /** Taşıma yok — hiçbir veri iddiası yapılamaz. */
  | 'disconnected'
  /** Bu oturumda o alandan HİÇ kabul edilmiş ölçüm gelmedi. */
  | 'never_seen'
  /** Beklenen yenileme penceresi aşıldı — yeni ölçüm GELMİYOR. */
  | 'stalled'
  /** Native değer sunmuyor (`-1`): sorulmadı ya da ECU NO DATA döndürüyor. */
  | 'no_data'
  /** Değer geliyor ama sanitizer reddediyor (aralık dışı / imkânsız sıçrama). */
  | 'parse_error'
  /** Ölçüm geliyor ama gözlenen aralık beklenenin çok üstünde. */
  | 'slow';

export const HEALTH_CAUSE_LABEL: Readonly<Record<ObdHealthCause, string>> = {
  ok:           'Normal',
  disconnected: 'Bağlantı yok',
  never_seen:   'Bu oturumda hiç ölçüm gelmedi',
  stalled:      'Yenileme durdu',
  no_data:      'ECU veri vermiyor (NO DATA)',
  parse_error:  'Gelen değer reddedildi (aralık/sıçrama)',
  slow:         'Beklenenden yavaş',
};

/**
 * Alanın tazelik SINIFI. Sıcak sinyaller (hız/devir) donduğunda saniyeler içinde
 * fark edilmeli; yavaş sinyaller kendi kadanslarına göre değerlendirilmeli —
 * aksi hâlde 15 sn'de bir okunan bir sıcaklık haksız yere "durdu" sayılırdı.
 */
export const FIELD_CLASS: Readonly<Record<HealthField, ObdFreshnessClass>> = {
  speed:         'hot',
  rpm:           'hot',
  throttle:      'hot',
  engineTemp:    'medium',
  fuelLevel:     'slow',
  intakeTemp:    'slow',
  boostPressure: 'hot',
  voltage:       'medium',
};

/**
 * Sıcak sinyaller için MUTLAK stall tavanı (ms).
 *
 * NEDEN VAR: `computeFreshnessWindow` taban olarak `hot` sınıfına 10 sn verir —
 * bu, KARARIN gerektirdiği tazelik içindir. Ama hız/devir için KULLANICI algısı
 * çok daha sıkıdır: gösterge 4-5 sn donduğunda sürücü bunu görür. Bu tavan,
 * sıcak alanların stall eşiğini kadanstan türetilen değerin ALTINA çeker —
 * "hızlı fark edilsin" şartının somut karşılığı.
 */
export const HOT_STALL_CEILING_MS = 5_000;

/** Gözlenen aralık beklenenin bu katını aşarsa `slow` (henüz stall değil). */
export const SLOW_FACTOR = 2.5;

export interface FieldHealthInput {
  readonly field: HealthField;
  readonly timing: FieldTimingSnapshot | undefined;
  /** Monotonik şimdi (`performance.now()`) — bu modül saat OKUMAZ. */
  readonly nowMs: number;
  /** Aktif poll periyodu (`AdaptivePollingController.fastMs`). */
  readonly expectedIntervalMs: number;
  /** Taşıma canlı mı. `false` → alan hükmü koşulsuz `DISCONNECTED`. */
  readonly transportConnected: boolean;
}

export interface FieldHealth {
  readonly field: HealthField;
  readonly state: ObdHealthState;
  readonly cause: ObdHealthCause;
  /** Son kabul edilen ölçümün yaşı (ms); hiç yoksa `null` — sahte 0 YOK. */
  readonly ageMs: number | null;
  /** Bu alan için stall eşiği (ms) — ekranda "neden" sorusunu yanıtlar. */
  readonly stallMs: number;
  /** Gözlenen ortalama aralık (ms); tek örnekte `null`. */
  readonly observedIntervalMs: number | null;
  /**
   * Değer uzun süredir DEĞİŞMEDİ mi. GÖZLEMDİR, HÜKÜM DEĞİL: park hâlinde
   * sabit 0 tamamen normaldir ve `state`i DÜŞÜRMEZ.
   */
  readonly frozen: boolean;
  /** Değerin son değişiminden bu yana geçen süre; bilinmiyorsa `null`. */
  readonly unchangedMs: number | null;
}

/** Bir alanın stall eşiği — sınıf + gerçek kadans; sıcakta mutlak tavan uygulanır. */
export function stallThresholdMs(field: HealthField, expectedIntervalMs: number): number {
  const cls = FIELD_CLASS[field] ?? 'medium';
  const w = computeFreshnessWindow({
    cls, path: 'core',
    coreWindowMs: Number.isFinite(expectedIntervalMs) && expectedIntervalMs > 0
      ? expectedIntervalMs * 3
      : 0,
  });
  if (cls !== 'hot') return w.staleMs;
  /* Sıcak alanda kadans tavanı AŞMAZ: gösterge donmasını 10 sn beklemek,
     "hızlı fark edilsin" şartını fiilen iptal ederdi. Ama kadans gerçekten
     yavaşsa (POWER_SAVE 15 sn) eşik ondan da küçük OLAMAZ — aksi hâlde
     sağlıklı bir yavaş modda sürekli sahte stall üretirdik. */
  const cadenceFloor = Number.isFinite(expectedIntervalMs) && expectedIntervalMs > 0
    ? expectedIntervalMs * 2
    : HOT_STALL_CEILING_MS;
  return Math.max(HOT_STALL_CEILING_MS, Math.min(w.staleMs, cadenceFloor));
}

/** Değerin "donmuş" sayılacağı süre — stall eşiğinin 6 katı (gözlem amaçlı, geniş). */
export function frozenThresholdMs(stallMs: number): number { return stallMs * 6; }

/**
 * Bir alanın BEKLENEN yenileme aralığı (ms).
 *
 * ── NEDEN AYRI FONKSİYON (ölçülen kusur) ──────────────────────────────────
 * İlk yazımda "yavaş mı" kararı, alanın gözlenen aralığını ÇEKİRDEK FAST poll
 * periyoduyla kıyaslıyordu. Bu YANLIŞTI: yakıt seviyesi (0x2F) native tarafta
 * `VERY_SLOW_EVERY_N_CYCLES` kademesindedir ve 20 sn'de bir gelmesi TAMAMEN
 * NORMALDİR — fast periyot 1 sn olduğu için sağlıklı bir sinyal sürekli
 * "yavaş" damgası yiyordu. Beklenti artık alanın KENDİ sınıfından türer.
 *
 * `hot` alanlar gerçekten her turda okunur → çekirdek periyot doğru referanstır.
 * Diğerleri için beklenti stall eşiğinin üçte biridir (üç kaçırılan yenileme
 * toleransı — `obdRetryPolicy.STALE_MISSED_POLLS` ile aynı fikir).
 */
export function expectedFieldIntervalMs(
  field: HealthField, expectedIntervalMs: number,
): number | null {
  const cls = FIELD_CLASS[field] ?? 'medium';
  if (cls === 'hot') {
    return Number.isFinite(expectedIntervalMs) && expectedIntervalMs > 0 ? expectedIntervalMs : null;
  }
  return stallThresholdMs(field, expectedIntervalMs) / 3;
}

/**
 * Tek bir alanın sağlık hükmü.
 *
 * FAIL-CLOSED SIRA (bilinçli): taşıma → hiç ölçüm → stall → red → NO DATA → yavaş.
 * Taşıma kopukken "NO DATA" demek nedeni YANLIŞ yere koyardı; hiç ölçüm gelmemişken
 * "durdu" demek de yanlış olurdu (henüz başlamadı).
 */
export function classifyFieldHealth(i: FieldHealthInput): FieldHealth {
  const stallMs = stallThresholdMs(i.field, i.expectedIntervalMs);
  const t = i.timing;

  const base = {
    field: i.field, stallMs,
    observedIntervalMs: t?.observedIntervalMs ?? null,
  };

  if (!i.transportConnected) {
    return { ...base, state: 'DISCONNECTED', cause: 'disconnected',
      ageMs: null, frozen: false, unchangedMs: null };
  }
  if (t === undefined || t.lastAcceptedAtMs === null) {
    /* HİÇ ölçüm gelmedi. "Sağlıklı" DEĞİL, "durdu" da DEĞİL — henüz kanıt yok.
       ECU sürekli NO DATA veriyorsa sebebi budur ve AÇIKÇA söylenir. */
    const cause: ObdHealthCause =
      t !== undefined && t.notOfferedCount > 0 ? 'no_data'
      : t !== undefined && t.rejectedCount > 0 ? 'parse_error'
      : 'never_seen';
    return { ...base, state: 'STALLED', cause, ageMs: null, frozen: false, unchangedMs: null };
  }

  const ageMs = Math.max(0, i.nowMs - t.lastAcceptedAtMs);
  const unchangedMs = t.lastChangedAtMs === null ? null : Math.max(0, i.nowMs - t.lastChangedAtMs);
  /* FREEZE bir GÖZLEMDİR: yenileme geliyor ama değer sabit. Duran araçta
     normaldir → `state`i DÜŞÜRMEZ. */
  const frozen = unchangedMs !== null && ageMs <= stallMs && unchangedMs > frozenThresholdMs(stallMs);

  if (ageMs > stallMs) {
    /* Yenileme DURDU. Sebebi ayırt edilebiliyorsa söylenir: son turlarda native
       değer sunmadıysa NO DATA, sunup reddedildiyse çözümleme hatası. */
    const lastMiss = t.lastNotOfferedAtMs;
    const lastRej  = t.lastRejectedAtMs;
    const missFresh = lastMiss !== null && lastMiss > t.lastAcceptedAtMs;
    const rejFresh  = lastRej  !== null && lastRej  > t.lastAcceptedAtMs;
    const cause: ObdHealthCause =
      rejFresh && (!missFresh || lastRej! >= lastMiss!) ? 'parse_error'
      : missFresh ? 'no_data'
      : 'stalled';
    return { ...base, state: 'STALLED', cause, ageMs, frozen: false, unchangedMs };
  }

  const iv = t.observedIntervalMs;
  /* Beklenti alanın KENDİ sınıfından gelir — çekirdek fast periyodundan DEĞİL.
     (Aksi hâlde 20 sn'de bir okunan yakıt seviyesi sürekli "yavaş" damgası yerdi.) */
  const expected = expectedFieldIntervalMs(i.field, i.expectedIntervalMs);
  if (iv !== null && expected !== null && iv > expected * SLOW_FACTOR) {
    return { ...base, state: 'DEGRADED', cause: 'slow', ageMs, frozen, unchangedMs };
  }
  if (t.rejectedCount > 0 && t.rejectedCount >= t.acceptedCount) {
    /* Kabul kadar (ya da daha çok) red var → veri geliyor ama güvenilmez. */
    return { ...base, state: 'DEGRADED', cause: 'parse_error', ageMs, frozen, unchangedMs };
  }

  return { ...base, state: 'HEALTHY', cause: 'ok', ageMs, frozen, unchangedMs };
}

/* ── Hat düzeyi hüküm ─────────────────────────────────────────────────────── */

export interface LinkHealthInput {
  readonly transportConnected: boolean;
  /** `obdService.dataFresh` — ECU sessizliğinin MEVCUT otoritesi (yeniden yazılmaz). */
  readonly dataFresh: boolean;
  readonly fields: readonly FieldHealth[];
}

export interface LinkHealth {
  readonly state: ObdHealthState;
  readonly reason: string;
  /** Sıcak sinyallerden kaçı durdu — hat hükmünün ana girdisi. */
  readonly hotStalled: number;
  readonly stalled: number;
  readonly degraded: number;
  readonly healthy: number;
}

/**
 * Hattın tek hükmü.
 *
 * ÖNEMLİ: "Bluetooth bağlı" ve "ELM cevap veriyor" TEK BAŞLARINA SAĞLIK DEĞİLDİR.
 * Bu fonksiyon hükmü VERİ AKIŞINDAN türetir; taşıma yalnız en dıştaki kapıdır.
 */
export function classifyLinkHealth(i: LinkHealthInput): LinkHealth {
  if (!i.transportConnected) {
    return { state: 'DISCONNECTED', reason: 'Taşıma bağlı değil — veri hakkında iddia YOK.',
      hotStalled: 0, stalled: 0, degraded: 0, healthy: 0 };
  }

  let hotStalled = 0, stalled = 0, degraded = 0, healthy = 0;
  for (const f of i.fields) {
    if (f.state === 'STALLED') { stalled++; if (FIELD_CLASS[f.field] === 'hot') hotStalled++; }
    else if (f.state === 'DEGRADED') degraded++;
    else if (f.state === 'HEALTHY') healthy++;
  }

  /* Sıcak bir sinyal durduysa hat SAĞLIKLI SAYILAMAZ — gösterge donmuş demektir. */
  if (hotStalled > 0) {
    return { state: 'STALLED',
      reason: `${hotStalled} sıcak sinyal (hız/devir sınıfı) yenilenmiyor — `
        + `taşıma açık ama gösterge ölü.`,
      hotStalled, stalled, degraded, healthy };
  }
  if (healthy === 0 && stalled > 0) {
    return { state: 'STALLED', reason: 'Hiçbir sinyal yenilenmiyor.',
      hotStalled, stalled, degraded, healthy };
  }
  /* `dataFresh` MEVCUT otoritedir (uyarlanabilir eşik) — yok sayılmaz. */
  if (!i.dataFresh) {
    return { state: 'DEGRADED', reason: 'ECU sessiz (veri tazelik kapısı kapalı).',
      hotStalled, stalled, degraded, healthy };
  }
  if (degraded > 0 || stalled > 0) {
    return { state: 'DEGRADED',
      reason: `${stalled} sinyal durdu, ${degraded} sinyal düşük güvenilirlikte.`,
      hotStalled, stalled, degraded, healthy };
  }
  if (healthy === 0) {
    return { state: 'DEGRADED', reason: 'Henüz hiçbir sinyalden ölçüm alınmadı.',
      hotStalled, stalled, degraded, healthy };
  }
  return { state: 'HEALTHY', reason: `${healthy} sinyal beklenen kadansta akıyor.`,
    hotStalled, stalled, degraded, healthy };
}

/**
 * P0-OBD-07 — MOTOR ÇALIŞIYOR MU (sıcak sinyal tazelik kapısıyla birlikte).
 *
 * ── NEDEN SAF BİR FONKSİYON ───────────────────────────────────────────────
 * Bu karar üç yerde tüketiliyor (erken uyarı bağlamı · makullük denetimi ·
 * gelecekteki kurallar) ve her birinde yeniden yazılırsa ayrışır. Saf olması
 * ayrıca DETERMİNİSTİK KİLİTLENEBİLMESİNİ sağlar: devir sağlığının her hâli
 * mock'suz sınanır.
 *
 * ── NEDEN GEREKLİ (ölçülen boşluk) ────────────────────────────────────────
 * `store.rpm` SAB hot-path'inden akar ve **kanonik tazelik penceresi YOKTUR**
 * (P0-OBD-02 yalnız `obdSignals` kayıtlarını kapsar). Hat durduğunda devir son
 * değerinde DONAR; buradan bakan biri "motor 2000 devirde çalışıyor" sanar ve
 * motor-bağımlı TÜM kurallar ölü bir hattın son değeriyle çalışır.
 *
 * İKİNCİ FRESHNESS SİSTEMİ DEĞİLDİR: rpm'in BAŞKA hiçbir tazelik otoritesi
 * yoktur; bu kapı onun TEK otoritesidir. Kanonik sinyaller buradan GEÇMEZ.
 *
 * FAIL-CLOSED: devir karar kalitesinde değilse `null` ("bilinmiyor") döner.
 * "Motor duruyor" DEMEYİZ — o da bir iddiadır ve bazı kuralları yanlış yönde
 * açardı (kontak kapalıyken düşük voltaj NORMALDİR).
 *
 * @param rpmState Devir sinyalinin sağlık hükmü; bilinmiyorsa `null` geçilir
 *                 (o zaman kapı UYGULANMAZ — sağlık okunamadıysa eski davranış).
 * @param rpm      `store.rpm` ham değeri.
 */
export function engineRunningFrom(
  rpmState: ObdHealthState | null, rpm: unknown,
): boolean | null {
  if (rpmState !== null && !isDecisionGrade(rpmState)) return null;
  if (typeof rpm !== 'number' || !Number.isFinite(rpm) || rpm < 0) return null;
  return rpm > ENGINE_RUNNING_RPM;
}

/** Motorun "çalışıyor" sayıldığı devir eşiği — marş/rölanti ayrımı. */
export const ENGINE_RUNNING_RPM = 400;

/**
 * Karar katmanları için TEK kapı: bu hat karar üretmeye uygun mu?
 *
 * Guardian · Prediction · Mavi bunu kullanır. `STALLED`/`DISCONNECTED` iken
 * bayat veriyle karar üretmek, tam olarak bu turun kapattığı kusurdur.
 */
export function isDecisionGrade(state: ObdHealthState): boolean {
  return state === 'HEALTHY' || state === 'DEGRADED';
}
