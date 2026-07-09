/**
 * discoveryModel — Otomatik PID/DID keşif yakalama boru hattının SAF veri modeli (PR-DISC-1).
 *
 * AMAÇ: araçtan gözlemlenen ancak katalogda (StandardPidRegistry / araç DID profili)
 * bulunmayan PID/DID'leri yapılandırılmış tek bir kayıt tipiyle temsil etmek. Bu dosya
 * SAF'tır — React/Capacitor/native importu YOK; kök vitest paketinden test edilebilir
 * (Clean Architecture: model katmanı dış bağımlılık taşımaz).
 *
 * DEDUPLİKASYON: bir keşif kimliği ECU adresi + mode + PID/DID + kaynak (PID/DID) ile
 * tanımlanır; zaman/yanıt kimliğe DAHİL DEĞİL (aynı sinyalin tekrar gözlemi = tek kayıt).
 * Kimlik üzerinden FNV-1a hash üretilir (DiscoveryCache hash-tabanlı dedup için kullanır).
 */

/** Keşfin kaynağı: standart Mode 01 PID mi, üretici UDS DID mi. */
export type DiscoverySource = 'PID' | 'DID';

/**
 * Tek bir keşif kaydı. Alanlar görev tanımıyla birebir; opsiyoneller gerçekten
 * bilinmeyebilen alanlar (decodedValue/firmwareVersion) — uydurma yok, yoksa undefined.
 */
export interface DiscoveryRecord {
  /** Kaydın alındığı an (Date.now() — sıralama/gösterim; süre hesabı için DEĞİL). */
  timestamp:        number;
  /** Araç/profil kimliği (profil adı veya VIN türevi). Bilinmiyorsa ''. */
  vehicleProfile:   string;
  /** Yanıt veren ECU adresi ('7E8', '18DAF110'…). Bilinmiyorsa ''. */
  ecuAddress:       string;
  /** Taşıma protokolü ('ISO15765-4', '6'…). Bilinmiyorsa ''. */
  protocol:         string;
  /** OBD servisi/modu ('01' PID, '22' DID, '09' araç bilgisi…). */
  mode:             string;
  /** PID veya DID (büyük-harf hex, ör. '78' / 'F190'). */
  pidOrDid:         string;
  /** ECU'ya gönderilen ham istek ('22F190'). */
  request:          string;
  /** ECU ham yanıtı (hex). Negatif yanıt/NO DATA da olabilir. */
  rawResponse:      string;
  /** Çözülmüş fiziksel/metin değer — YALNIZ güvenilir çözülebildiyse. */
  decodedValue?:    number | string;
  /** ECU bu PID/DID'i pozitif (veri) yanıtladı mı. */
  supported:        boolean;
  /** Kaynak türü. */
  discoverySource:  DiscoverySource;
  /** ECU firmware/kalibrasyon sürümü — biliniyorsa. */
  firmwareVersion?: string;
}

/**
 * Yeni kayıt üretir — TAM şekilli template (hidden-class kararlılığı + eksik alan yok).
 * Zorunlu alanların varsayılanı güvenli boş değerdir; çağıran bildiğini geçer.
 */
export function createDiscoveryRecord(input: Partial<DiscoveryRecord> & {
  pidOrDid: string;
  discoverySource: DiscoverySource;
}): DiscoveryRecord {
  return {
    timestamp:       input.timestamp       ?? Date.now(),
    vehicleProfile:  input.vehicleProfile  ?? '',
    ecuAddress:      normalizeHex(input.ecuAddress ?? ''),
    protocol:        input.protocol        ?? '',
    mode:            normalizeHex(input.mode ?? ''),
    pidOrDid:        normalizeHex(input.pidOrDid),
    request:         (input.request        ?? '').trim(),
    rawResponse:     (input.rawResponse    ?? '').trim(),
    decodedValue:    input.decodedValue,
    supported:       input.supported       ?? false,
    discoverySource: input.discoverySource,
    firmwareVersion: input.firmwareVersion,
  };
}

/** Hex/kimlik alanını normalize eder: boşluksuz, büyük harf. */
export function normalizeHex(s: string): string {
  return (s ?? '').replace(/\s+/g, '').toUpperCase();
}

/**
 * Bir keşfin KİMLİK anahtarı — dedup bunun üzerinden yapılır. Zaman/yanıt/değer
 * DAHİL DEĞİL: aynı ECU+mode+PID/DID+kaynak = TEK keşif (tekrar gözlem yeni kayıt değil).
 */
export function dedupKey(r: Pick<DiscoveryRecord,
  'discoverySource' | 'mode' | 'ecuAddress' | 'pidOrDid'>): string {
  return `${r.discoverySource}|${normalizeHex(r.mode)}|${normalizeHex(r.ecuAddress)}|${normalizeHex(r.pidOrDid)}`;
}

/**
 * FNV-1a 32-bit hash → 8 haneli hex. Saf/deterministik; harici bağımlılık yok.
 * (Kriptografik değil — yalnız dedup kimliği; çakışma olasılığı bu ölçekte ihmal edilebilir.)
 */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // 32-bit FNV asal çarpımı (Math.imul ile taşma-güvenli)
    h = Math.imul(h, 0x01000193);
  }
  // İşaretsiz 32-bit hex
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Bir kaydın dedup hash'i (DiscoveryCache anahtarı). */
export function discoveryHash(r: Pick<DiscoveryRecord,
  'discoverySource' | 'mode' | 'ecuAddress' | 'pidOrDid'>): string {
  return fnv1a(dedupKey(r));
}
