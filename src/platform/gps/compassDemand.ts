/**
 * compassDemand.ts — Compass (cihaz yönü) TALEP SÖZLEŞMESİ.
 *
 * NEDEN: Cihaz QA'sında (Xiaomi zircon, 2026-07-11) uygulamanın boşta ana ekranda
 * `rot_vec` (absolute orientation) ve `game_rotvec` (relative orientation) sensörlerini
 * **60 Hz'de sürekli açık** tuttuğu ölçüldü. Kaynağı: `gpsService._startCompassListener()`
 * `startGPSTracking()` ile birlikte açılıyor ve uygulama ön plandayken **hiç kapanmıyordu**
 * (Orientation Sensor Gate arka planda söküyor ama ön plan talebini bilmiyor —
 * Ledger #42'de bu sınırlama zaten yazılıydı).
 *
 * BU MODÜL: compass'a GERÇEKTEN ihtiyaç duyan tüketicilerin (heading-up harita,
 * aktif navigasyon) ref-count'lu talep kaydı. gpsService bu talebi dinler:
 *   ilk acquire → compass gate aboneliği AÇILIR
 *   son release → compass gate aboneliği KAPANIR
 *
 * SÖZLEŞME:
 *  - Owner bazlı: aynı owner iki kez acquire ederse sayaç BİR kez artar (duplicate yok).
 *  - release idempotent: bilinmeyen/zaten bırakılmış owner → sessiz no-op.
 *  - Owner sayısı SINIRLI (bounded) — kaçak tüketici belleği şişiremez.
 *  - Timer/polling YOK; yalnız olay-güdümlü bildirim.
 *  - Import YAN ETKİSİZ: bu dosyayı import etmek hiçbir sensör açmaz/kapatmaz.
 *  - gpsService bu kapının SAHİBİ DEĞİLDİR — yalnız abonesidir.
 *
 * KAPSAM DIŞI (bilinçli): native örnekleme hızı (Chromium DeviceOrientation 60 Hz sabit),
 * Generic Sensor API, heading blend/smoothing algoritması — HİÇBİRİ değişmez.
 */

/** Talep sahibi kimliği — okunabilir ve teşhis edilebilir olmalı. */
export type CompassOwner = string;

/** Aynı anda kayıtlı olabilecek en fazla owner (bounded — kaçak tüketici koruması). */
export const MAX_COMPASS_OWNERS = 32;

type DemandListener = (hasDemand: boolean) => void;

const _owners    = new Set<CompassOwner>();
const _listeners = new Set<DemandListener>();

function _notify(): void {
  const has = _owners.size > 0;
  for (const l of _listeners) {
    try { l(has); } catch { /* fail-soft: bir abone patlarsa diğerleri etkilenmez */ }
  }
}

/**
 * Compass talebini kaydeder. Aynı owner için tekrar çağrılırsa sayaç ARTMAZ.
 * @returns bu owner'ın talebini bırakan idempotent fonksiyon
 */
export function acquireCompassDemand(owner: CompassOwner): () => void {
  if (typeof owner !== 'string' || owner.length === 0) {
    return () => undefined;   // fail-soft: geçersiz owner sessizce yok sayılır
  }
  if (_owners.has(owner)) {
    return () => releaseCompassDemand(owner);   // duplicate acquire → aynı release
  }
  if (_owners.size >= MAX_COMPASS_OWNERS) {
    // Bounded: yeni owner kaydedilmez. Talep zaten >0 olduğundan compass AÇIK kalır
    // (fail-safe yön: sensörü erken kapatmaktansa açık bırak).
    return () => undefined;
  }

  const wasEmpty = _owners.size === 0;
  _owners.add(owner);
  if (wasEmpty) _notify();     // 0 → 1 geçişi: compass AÇ
  return () => releaseCompassDemand(owner);
}

/** Talebi bırakır. İdempotent — bilinmeyen owner sessiz no-op. */
export function releaseCompassDemand(owner: CompassOwner): void {
  if (!_owners.delete(owner)) return;
  if (_owners.size === 0) _notify();   // 1 → 0 geçişi: compass KAPAT
}

/** Şu an compass'a ihtiyaç duyan bir tüketici var mı? */
export function hasCompassDemand(): boolean {
  return _owners.size > 0;
}

/** Kayıtlı owner sayısı (teşhis/test). */
export function getCompassDemandCount(): number {
  return _owners.size;
}

/** Kayıtlı owner adları (yalnız teşhis — kopya döner). */
export function getCompassOwners(): CompassOwner[] {
  return [..._owners];
}

/**
 * Talep değişimlerini dinler (0↔1 geçişlerinde tetiklenir; ara sayaç değişimlerinde DEĞİL).
 * gpsService bunu kullanır. Dönen fonksiyon aboneliği kaldırır (zero-leak).
 */
export function subscribeCompassDemand(listener: DemandListener): () => void {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

/** Test/teardown: tüm owner ve dinleyicileri temizler (zero-leak). */
export function resetCompassDemand(): void {
  _owners.clear();
  _listeners.clear();
}
