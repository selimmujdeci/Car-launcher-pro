/**
 * OBD Teşhis Timeline — tip modeli (Faz 1 MVP, JS-only).
 *
 * Pasif gözlemci: bağlantı akışının her adımını yapılandırılmış event olarak
 * kaydeder; "neden bağlanmıyor / cihaz yok / ECU cevap vermiyor / protokol
 * tutmuyor" sorusunu uygulama içinde adım adım görünür kılar.
 *
 * V8/JIT: ObdDiagEvent alanları SABİT sırada (hidden class kararlılığı);
 * event üretimi DIAG_EVENT_TEMPLATE üzerinden yapılır (boş {} + dinamik
 * property yok). Süreler monotonik delta'dır (performance.now), duvar saati
 * yalnızca gösterim/id içindir (CLAUDE.md §4 saat-atlama güvenliği).
 */

/** Bağlantı akışının ayrık aşamaları (sıralı). */
export type ObdStage =
  | 'permission'       // BT/konum izni
  | 'bluetooth'        // BT açık/kapalı
  | 'scan'             // cihaz tarama
  | 'deviceFound'      // bir cihaz bulundu/sınıflandı
  | 'select'           // kullanıcı/otomatik cihaz seçimi
  | 'bond'             // eşleşme (bond) durumu
  | 'connectBle'       // BLE GATT bağlantısı
  | 'connectClassic'   // Classic RFCOMM bağlantısı
  | 'elmInit'          // ATZ / ATE0 / ATL0 (Faz 2 native)
  | 'protocol'         // protocol cycle (Faz 2 native)
  | 'ecuQuery'         // PID / ECU cevabı (Faz 2 native)
  | 'liveData'         // canlı veri akışı
  | 'disconnect'       // bağlantı koptu/kapandı
  | 'retry';           // reconnect denemesi

export type ObdDiagStatus = 'pending' | 'success' | 'fail' | 'warn' | 'info';

export type ObdTransport = 'ble' | 'classic' | 'tcp' | 'unknown';

export type ObdSeverity = 'low' | 'medium' | 'high';

/** Bağlanamama nedenleri — sınıflandırma. */
export type ObdFailureReason =
  | 'BT_OFF'
  | 'NO_PERMISSION'
  | 'NO_DEVICE_FOUND'
  | 'PAIRING_PIN'
  | 'BLE_GATT_133'
  | 'RFCOMM_ALL_FAILED'
  | 'ELM_NO_RESPONSE'
  | 'ECU_NO_RESPONSE'
  | 'WRONG_PROTOCOL'
  | 'IGNITION_OFF'
  | 'CLONE_SUSPECT';

/**
 * Tek bir teşhis event'i. Alan sırası interface'le birebir korunmalı
 * (Map-transition / megamorphism önleme).
 */
export interface ObdDiagEvent {
  id:               string;             // "evt-<seq>"
  tsMonoMs:         number;             // performance.now() delta (oturum başından)
  tsWallMs:         number;             // Date.now() — yalnızca gösterim
  stage:            ObdStage;
  status:           ObdDiagStatus;
  transport:        ObdTransport;
  protocol:         string | null;      // 'KWP2000' | 'ISO9141' | 'CAN' | null
  command:          string | null;      // 'ATZ' | 'ATE0' | '0100' | null
  response:         string | null;      // ham ELM cevabı | null
  durationMs:       number | null;      // aşama süresi (monotonik)
  reason:           ObdFailureReason | null;
  userMessage:      string;             // basit mod — Türkçe
  technicalMessage: string;             // teknik mod
  nextAction:       string | null;      // önerilen kullanıcı eylemi
  severity:         ObdSeverity;
}

/**
 * Tüm anahtarları içeren template — event üretimi bunun kopyası üzerinden yapılır.
 * Asla `{}` + dinamik property kullanma; bu template'i spread'le ve override et.
 */
export const DIAG_EVENT_TEMPLATE: Readonly<ObdDiagEvent> = Object.freeze({
  id:               '',
  tsMonoMs:         0,
  tsWallMs:         0,
  stage:            'info' as ObdStage,   // çağıran her zaman override eder
  status:           'info' as ObdDiagStatus,
  transport:        'unknown' as ObdTransport,
  protocol:         null,
  command:          null,
  response:         null,
  durationMs:       null,
  reason:           null,
  userMessage:      '',
  technicalMessage: '',
  nextAction:       null,
  severity:         'low' as ObdSeverity,
});

/** Sınıflandırma metası — basit mod mesajı + önerilen eylem + ağırlık. */
export interface FailureMeta {
  userMessage: string;
  nextAction:  string;
  severity:    ObdSeverity;
}

/**
 * Her bağlanamama nedeni için kullanıcı-dostu Türkçe açıklama ve önerilen eylem.
 * UI hem basit modda (userMessage) hem yönlendirmede (nextAction) kullanır.
 */
export const FAILURE_META: Readonly<Record<ObdFailureReason, FailureMeta>> = Object.freeze({
  BT_OFF: {
    userMessage: 'Bluetooth kapalı.',
    nextAction:  'Bluetooth’u açın ve tekrar deneyin.',
    severity:    'high',
  },
  NO_PERMISSION: {
    userMessage: 'Bluetooth/konum izni verilmemiş.',
    nextAction:  'Uygulama ayarlarından izin verin.',
    severity:    'high',
  },
  NO_DEVICE_FOUND: {
    userMessage: 'OBD cihazı bulunamadı.',
    nextAction:  'Adaptörü OBD soketine takıp kontağı açın, tekrar tarayın.',
    severity:    'high',
  },
  PAIRING_PIN: {
    userMessage: 'Eşleşme/PIN sorunu.',
    nextAction:  'PIN olarak 1234 veya 0000 deneyin.',
    severity:    'medium',
  },
  BLE_GATT_133: {
    userMessage: 'Kablosuz (BLE) bağlantı koptu.',
    nextAction:  'Tekrar deneyin; sistem otomatik yeniden bağlanır.',
    severity:    'medium',
  },
  RFCOMM_ALL_FAILED: {
    userMessage: 'Cihaza bağlanılamadı.',
    nextAction:  'Adaptörü çıkarıp takın, kontağı açık tutun.',
    severity:    'high',
  },
  ELM_NO_RESPONSE: {
    userMessage: 'Adaptör cevap vermiyor.',
    nextAction:  'Sahte/klon adaptör olabilir; başka bir adaptör deneyin.',
    severity:    'high',
  },
  ECU_NO_RESPONSE: {
    userMessage: 'Araç beyni (ECU) cevap vermiyor.',
    nextAction:  'Kontağı açın (motor çalışır konuma getirin).',
    severity:    'high',
  },
  WRONG_PROTOCOL: {
    userMessage: 'Araç protokolü çözülemedi.',
    nextAction:  'Aracınızın OBD-II uyumlu olduğunu doğrulayın.',
    severity:    'medium',
  },
  IGNITION_OFF: {
    userMessage: 'Kontak kapalı.',
    nextAction:  'Kontağı açın ve tekrar deneyin.',
    severity:    'medium',
  },
  CLONE_SUSPECT: {
    userMessage: 'Sahte ELM adaptörü şüphesi.',
    nextAction:  'Orijinal bir ELM327 adaptörü kullanmanız önerilir.',
    severity:    'medium',
  },
});

/** Bir oturumun özeti — export ve "son oturum" kalıcılığı için. */
export interface ObdDiagSession {
  sessionId:    string;
  startedWallMs: number;
  device: {
    name:      string;
    addrMasked: string;      // MAC maskeli — gizlilik
    transport: ObdTransport;
  } | null;
  outcome: 'connected' | 'failed' | 'aborted' | 'pending';
  events:  ObdDiagEvent[];
}
