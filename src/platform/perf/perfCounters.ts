/**
 * perfCounters — ARCH-06/F1 · T0 KADEMESİ (DAİMA AÇIK, UCUZ SAYAÇLAR).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── T0 NEDİR ──────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Tek işlem: bir tamsayıyı artırmak. Hot-path'e (CAN yayını · GPS fix · OBD
 * verisi) girmesine İZİN VERİLEN tek ölçüm kademesi budur.
 *
 * **T0'DA KESİNLİKLE YASAK:**
 *   · `JSON.stringify` / payload boyutu ölçümü  → ölçmek istediğimiz maliyeti
 *     ÜRETİR (§39 enstrümantasyon bütçesi)
 *   · nesne tahsisi · dizi push · kapanış oluşturma
 *   · `Date.now()` / `performance.now()` çağrısı  → sayaç zaman İSTEMEZ
 *   · string birleştirme · log
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── MONOTONİK SAYAÇ + TABAN FARKI ─────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Sayaçlar **ASLA otomatik sıfırlanmaz**. Okuma bir yan etki üretmez
 * (`getPerfCounters()` saftır). Pencere hızı isteyen taraf `baseline()`
 * alır ve `deltaSince()` ile farkı hesaplar — böylece iki farklı okuyucu
 * birbirinin penceresini ÇALMAZ (paylaşılan sıfırlanan sayaç klasik ölçüm
 * hatasıdır).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── SABİT ANAHTAR KÜMESİ (V8 hidden-class kararlılığı) ────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Sayaç kabı SABİT anahtarlarla bir kez kurulur; çalışma zamanında yeni alan
 * EKLENMEZ. CLAUDE.md §V8: dinamik alan ekleme Map geçişi üretir ve hot-path'i
 * deoptimize eder. Yeni bir sayaç eklemek = bu dosyada bir satır eklemek.
 */

/**
 * Sayılan olayların KAPALI listesi.
 *
 * Ad şeması: `<alan>.<olay>`. Bir sayacın anlamı BURADA tanımlıdır; LAB
 * yorum uydurmaz.
 */
export type PerfCounterId =
  /* ── Native köprü: JS'e GELEN olaylar ─────────────────────────────── */
  | 'bridge.canData.received'
  | 'bridge.obdData.received'
  | 'bridge.obdStatus.received'
  | 'bridge.obdTraffic.received'
  | 'bridge.mediaChanged.received'
  | 'bridge.mediaAuthorityEvent.received'
  | 'bridge.memoryPressure.received'
  | 'bridge.thermalStatus.received'
  | 'bridge.phoneControl.received'
  | 'bridge.hardwareMedia.received'
  | 'bridge.incomingLocation.received'
  /* ── Native köprü: JS'ten GİDEN seçili sıcak çağrılar ──────────────── */
  | 'bridge.sendDiagnosticPdu.called'
  | 'bridge.mediaCommand.called'
  /* ── GPS ──────────────────────────────────────────────────────────── */
  | 'gps.providerCallback'
  | 'gps.fixAccepted'
  | 'gps.fixThrottled'
  | 'gps.publishedToStore'
  /* ── Harita (yalnız sayaç — koordinat/geometri TAŞINMAZ) ───────────── */
  | 'map.cameraCommand'
  | 'map.setDataCall'
  | 'map.setDataDedupSkip'
  | 'map.routeGeometryRebuild'
  | 'map.styleReload'
  | 'map.instanceMounted'
  | 'map.instanceUnmounted'
  /* ── ARCH-06/F3 · kamera ve rota sunum sayaçları ─────────────────────── */
  /** Kamera hedefi HESAPLANDI (dedup öncesi). */
  | 'map.cameraTargetComputed'
  /** Hedef ÖNCEKİYLE aynıydı → harita mutasyonu GÖNDERİLMEDİ. */
  | 'map.cameraDedupSkipped'
  /** Kullanıcı pan/zoom yapıyordu → takip kamerası BASTIRILDI. */
  | 'map.cameraSuppressedByUser'
  /** Rota İLERLEME güncellemesi (geometri yeniden kurulumu DEĞİL). */
  | 'map.routeProgressUpdate'
  /** Aynı rota kimliği geldi → geometri yeniden kurulumu ATLANDI. */
  | 'map.routeGeometryDedupSkip'
  /* ── ARCH-06/F3 · bileşen render sayaçları (yalnız adet) ─────────────── */
  | 'render.fullMapView'
  | 'render.miniMapWidget'
  | 'render.navigationHud'
  /* ── ARCH-06/F4 · CAN → VDL yazma yükü ───────────────────────────────── */
  /** CAN emit'i VDL sınırına ULAŞTI (yama kurulmadan önce). */
  | 'can.vdlPatchOffered'
  /** En az bir alan DEĞİŞTİ → tek atomik `set()` yapıldı. */
  | 'can.vdlPatchWritten'
  /** Hiçbir alan değişmedi → `set()` HİÇ çağrılmadı (abone uyandırılmadı). */
  | 'can.vdlPatchSkipped'
  /** Yazılan yamalardaki TOPLAM alan sayısı (ortalama yama boyutu türetilir). */
  | 'can.vdlPatchFields'
  /* ── ARCH-06/F4 · OBD yayın yükü ─────────────────────────────────────── */
  | 'obd.signalPublished'
  | 'obd.signalPublishSkipped'
  /* ── Depolama ─────────────────────────────────────────────────────── */
  | 'storage.setRequest'
  | 'storage.flush'
  | 'storage.largeWrite'
  | 'storage.idleDeferred'
  /* ── Artwork (F5 için taban kanıtı — bu turda YALNIZ ÖLÇÜM) ─────────── */
  | 'artwork.sourceChanged'
  | 'artwork.hashDedupHit'
  | 'artwork.accentDecode'
  /* ── Enstrümantasyonun KENDİ maliyeti (§15 overhead kanıtı) ────────── */
  | 'instrumentation.markRecorded'
  /* ── F6 · tavan uygulanan arka plan işi (gerçek tüketici kanıtı) ──── */
  | 'ceiling.backgroundPullRan'
  | 'ceiling.backgroundPullSkipped'
  /* ── F7 · LAB örneklemesi (tavan uygulanan ikinci gerçek tüketici) ──── */
  | 'lab.autoRefreshRan'
  | 'lab.autoRefreshSkipped'
  /* ── F7 · Mavi bağlam iş yükü (YALNIZ ÖLÇÜM — davranış değişmedi) ───── */
  | 'mavi.contextBuildAttempt'
  | 'mavi.contextInjected'
  | 'mavi.contextSkipped'
  | 'mavi.contextFieldsKept'
  | 'mavi.contextFieldsDropped'
  | 'mavi.contextFieldsStale';

/** Sabit anahtar listesi — kap bununla BİR KEZ kurulur, sonra genişlemez. */
const COUNTER_IDS: readonly PerfCounterId[] = Object.freeze([
  'bridge.canData.received', 'bridge.obdData.received', 'bridge.obdStatus.received',
  'bridge.obdTraffic.received', 'bridge.mediaChanged.received',
  'bridge.mediaAuthorityEvent.received', 'bridge.memoryPressure.received',
  'bridge.thermalStatus.received', 'bridge.phoneControl.received',
  'bridge.hardwareMedia.received', 'bridge.incomingLocation.received',
  'bridge.sendDiagnosticPdu.called', 'bridge.mediaCommand.called',
  'gps.providerCallback', 'gps.fixAccepted', 'gps.fixThrottled', 'gps.publishedToStore',
  'map.cameraCommand', 'map.setDataCall', 'map.setDataDedupSkip',
  'map.routeGeometryRebuild', 'map.styleReload',
  'map.instanceMounted', 'map.instanceUnmounted',
  'map.cameraTargetComputed', 'map.cameraDedupSkipped', 'map.cameraSuppressedByUser',
  'map.routeProgressUpdate', 'map.routeGeometryDedupSkip',
  'render.fullMapView', 'render.miniMapWidget', 'render.navigationHud',
  'can.vdlPatchOffered', 'can.vdlPatchWritten', 'can.vdlPatchSkipped', 'can.vdlPatchFields',
  'obd.signalPublished', 'obd.signalPublishSkipped',
  'storage.setRequest', 'storage.flush', 'storage.largeWrite', 'storage.idleDeferred',
  'artwork.sourceChanged', 'artwork.hashDedupHit', 'artwork.accentDecode',
  'instrumentation.markRecorded',
  'ceiling.backgroundPullRan', 'ceiling.backgroundPullSkipped',
  'lab.autoRefreshRan', 'lab.autoRefreshSkipped',
  'mavi.contextBuildAttempt', 'mavi.contextInjected', 'mavi.contextSkipped',
  'mavi.contextFieldsKept', 'mavi.contextFieldsDropped', 'mavi.contextFieldsStale',
]);

export type PerfCounterSnapshot = Readonly<Record<PerfCounterId, number>>;

/** Sabit şekilli kap — çalışma zamanında alan EKLENMEZ/SİLİNMEZ. */
function emptyCounters(): Record<PerfCounterId, number> {
  const out = {} as Record<PerfCounterId, number>;
  for (let i = 0; i < COUNTER_IDS.length; i += 1) out[COUNTER_IDS[i]!] = 0;
  return out;
}

const _counters: Record<PerfCounterId, number> = emptyCounters();

/** Sayaç kabının kurulduğu monotonik an — hız türetiminin tabanı. */
let _startedAt: number | null = (() => {
  try {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now() : null;
  } catch { return null; }
})();

/**
 * TEK SICAK YOL FONKSİYONU — bir tamsayı artırımı.
 *
 * Bilinmeyen id sessizce yok sayılır (kap sabit şekilli kalır). Bu fonksiyon
 * ASLA throw etmez: bir ölçüm hatası ürün yolunu düşüremez.
 */
export function bumpPerf(id: PerfCounterId, by = 1): void {
  const cur = _counters[id];
  if (cur === undefined) return;
  _counters[id] = cur + by;
}

/** Saf okuma — sıfırlamaz, yan etki üretmez, kopya döner. */
export function getPerfCounters(): PerfCounterSnapshot {
  return Object.freeze({ ..._counters });
}

/** Sayaçların kurulduğu monotonik an (`null` = `performance` yok). */
export function getPerfCountersStartedAt(): number | null { return _startedAt; }

/**
 * Taban görüntüsü — pencere hızı hesaplamak isteyen HER okuyucu kendi
 * tabanını alır. Paylaşılan sıfırlama YOKTUR.
 */
export function baselinePerfCounters(): { readonly at: number | null; readonly counters: PerfCounterSnapshot } {
  let at: number | null = null;
  try {
    at = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now() : null;
  } catch { at = null; }
  return Object.freeze({ at, counters: getPerfCounters() });
}

/** İki görüntü arasındaki fark. Negatif fark (imkânsız) `null`a düşer. */
export function deltaSince(
  base: { readonly counters: PerfCounterSnapshot }, id: PerfCounterId,
): number | null {
  const now = _counters[id];
  const then = base.counters[id];
  if (now === undefined || then === undefined) return null;
  const d = now - then;
  return d >= 0 ? d : null;
}

/** @internal YALNIZ TEST — üretim kodu çağırmaz (statik kilit korur). */
export function _resetPerfCountersForTest(): void {
  for (let i = 0; i < COUNTER_IDS.length; i += 1) _counters[COUNTER_IDS[i]!] = 0;
  try {
    _startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now() : null;
  } catch { _startedAt = null; }
}

/** Kapalı sayaç listesi (test ve LAB için). */
export function perfCounterIds(): readonly PerfCounterId[] { return COUNTER_IDS; }
