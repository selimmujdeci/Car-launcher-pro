/**
 * offlineClassification.ts — ÇEVRİMDIŞI İZİN SINIFLANDIRMASI (saf, I/O yok).
 *
 * ── NEDEN VAR ─────────────────────────────────────────────────────────
 * Kuyruk her işlemi taşıyabilir; ama her işlem çevrimdışı KAYDEDİLMEMELİDİR.
 * Rol değişikliği, üyeden çıkarma, eşleştirme ve sahiplik devri **güvenlik
 * yetkisi** üretir: bunları çevrimdışı kuyruğa alıp kullanıcıya "kaydedildi"
 * demek, henüz kimsenin vermediği bir yetkiyi vermiş gibi göstermektir.
 * Sunucu saatler sonra reddettiğinde kullanıcı yetkiyi çoktan varsaymıştır.
 *
 * Bu yüzden üç sınıf vardır ve kapı ÜRÜN YOLUNDADIR (`enqueueOfflineMutation`):
 *
 *   A. OFFLINE_ALLOWED  — düşük riskli; kuyruğa alınır, "kaydedildi" denebilir.
 *   B. OFFLINE_DEFERRED — kuyruğa alınır ama TAMAMLANMIŞ GÖSTERİLMEZ;
 *                         kullanıcıya "sunucu onayı bekleniyor" denir.
 *   C. ONLINE_REQUIRED  — çevrimdışıyken KUYRUĞA ALINMAZ. Reddedilir.
 *
 * Saf modül: React importu YOK · I/O YOK · timer YOK · `Date.now()` YOK.
 */

import type { OperationType } from './types';

export const OFFLINE_CLASSES = [
  'OFFLINE_ALLOWED',
  'OFFLINE_DEFERRED',
  'ONLINE_REQUIRED',
] as const;
export type OfflineClass = (typeof OFFLINE_CLASSES)[number];

/**
 * İşlem türü → çevrimdışı sınıfı.
 *
 * ONLINE_REQUIRED gerekçeleri (hepsi güvenlik yetkisi üretir veya sahiplik
 * değiştirir — çevrimdışı "olmuş gibi" gösterilemez):
 *   · MEMBER_ROLE_UPDATE / MEMBER_REMOVE → yetki değişimi, son-admin koruması
 *     yalnız sunucuda hesaplanabilir.
 *   · VEHICLE_PAIR / OWNERSHIP_CLAIM     → linking code tüketimi tek kullanımlık
 *     ve sunucuda atomiktir; yerelde "tüketildi" sayılamaz.
 *   · VEHICLE_ASSIGN_COMPANY / VEHICLE_REMOVE_COMPANY → araç sahipliğini
 *     filolar arasında taşır.
 */
const CLASSIFICATION: Readonly<Record<OperationType, OfflineClass>> = {
  // C — güvenlik / sahiplik
  MEMBER_ROLE_UPDATE:     'ONLINE_REQUIRED',
  MEMBER_REMOVE:          'ONLINE_REQUIRED',
  VEHICLE_PAIR:           'ONLINE_REQUIRED',
  OWNERSHIP_CLAIM:        'ONLINE_REQUIRED',
  VEHICLE_ASSIGN_COMPANY: 'ONLINE_REQUIRED',
  VEHICLE_REMOVE_COMPANY: 'ONLINE_REQUIRED',
  //   · Sahiplik devri → tek transaction'da sunucuda uygulanır; yerelde
  //     "devredildi" sayılamaz. Kabul anında araç revizyonu doğrulanır.
  VEHICLE_TRANSFER_START:  'ONLINE_REQUIRED',
  VEHICLE_TRANSFER_ACCEPT: 'ONLINE_REQUIRED',
  VEHICLE_TRANSFER_REJECT: 'ONLINE_REQUIRED',
  VEHICLE_TRANSFER_CANCEL: 'ONLINE_REQUIRED',

  // B — sunucu onayı bekleyen, geri alınabilir yönetim işlemleri
  COMPANY_CREATE:         'OFFLINE_DEFERRED',
  COMPANY_UPDATE:         'OFFLINE_DEFERRED',
  MEMBER_ADD:             'OFFLINE_DEFERRED',
  //   · Bakım kayıtları güvenlik yetkisi ÜRETMEZ (kullanıcının kendi
  //     defterine yazdığı satırdır) ama `OFFLINE_ALLOWED` de değildir:
  //     RLS araç eşleşmesini sunucuda doğrular ve eşleşme kopmuşsa yazma
  //     reddedilir. Bu yüzden kullanıcıya "hesabınıza kaydedildi" DENMEZ —
  //     "sıraya alındı, sunucu onaylayınca hesabınıza geçecek" denir.
  FUEL_LOG_ADD:           'OFFLINE_DEFERRED',
  SERVICE_RECORD_ADD:     'OFFLINE_DEFERRED',

  // A — telemetri; sahiplik/yetki üretmez, sırası sonda gelir
  LOCATION_EVENT:         'OFFLINE_ALLOWED',
  VEHICLE_EVENT:          'OFFLINE_ALLOWED',
};

/** Bilinmeyen işlem türü → fail-closed ONLINE_REQUIRED. */
export function classifyOffline(operationType: unknown): OfflineClass {
  if (typeof operationType !== 'string') return 'ONLINE_REQUIRED';
  return CLASSIFICATION[operationType as OperationType] ?? 'ONLINE_REQUIRED';
}

export function isQueueableOffline(operationType: unknown): boolean {
  return classifyOffline(operationType) !== 'ONLINE_REQUIRED';
}

/**
 * Kullanıcıya gösterilecek DÜRÜST metin.
 *
 * "Kaydedildi" YALNIZ sunucu doğruladığında veya işlem gerçekten düşük riskli
 * (`OFFLINE_ALLOWED`) olduğunda kullanılır — CLAUDE.md §11.
 */
export function offlineMessageFor(operationType: unknown): string {
  switch (classifyOffline(operationType)) {
    case 'OFFLINE_ALLOWED':
      return 'Çevrimdışısınız — kaydedildi, bağlantı gelince gönderilecek.';
    case 'OFFLINE_DEFERRED':
      return 'Çevrimdışısınız — işlem sıraya alındı. Sunucu onaylayana kadar tamamlanmış sayılmaz.';
    case 'ONLINE_REQUIRED':
      return 'Bu işlem için internet bağlantısı gerekli. Güvenlik ve yetki değişiklikleri çevrimdışı kaydedilemez.';
  }
}

/** LAB / gözlem yüzeyi için kısa sınıf etiketi. */
export function offlineClassLabel(value: OfflineClass): string {
  switch (value) {
    case 'OFFLINE_ALLOWED':  return 'Çevrimdışı yapılabilir';
    case 'OFFLINE_DEFERRED': return 'Çevrimdışı sıraya alınır (onay bekler)';
    case 'ONLINE_REQUIRED':  return 'İnternet gerektirir';
  }
}

/** Sınıf başına işlem türleri (LAB tablosu ve testler için). */
export function operationsByClass(): Readonly<Record<OfflineClass, readonly OperationType[]>> {
  const out: Record<OfflineClass, OperationType[]> = {
    OFFLINE_ALLOWED: [], OFFLINE_DEFERRED: [], ONLINE_REQUIRED: [],
  };
  for (const [operation, klass] of Object.entries(CLASSIFICATION) as [OperationType, OfflineClass][]) {
    out[klass].push(operation);
  }
  return out;
}
