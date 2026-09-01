/**
 * canonicalObdSignals — P0-OBD-01 · OBD Data Bridge'in TEK KATALOĞU (SAF · React'siz).
 *
 * ── NEDEN VAR (ölçülen kusur) ─────────────────────────────────────────────
 * `StandardPidRegistry` 101 PID çözebiliyor; `extendedPidService` bunları
 * talep-güdümlü okuyabiliyor. Ama okunan değerler `extendedPidService._values`
 * içinde KALIYOR: kanonik `UnifiedVehicleStore`a hiç ulaşmıyorlar. Ölçüm:
 *   · `ObdAdapterData` yalnız 6 alan taşır (speed · fuel · rpm · reverse ·
 *     totalDistance · coolantTemp) ve bunların yalnız 4'ü worker'dan mağazaya döner.
 *   · `safetyStateMapper` motor ısısını ve akü voltajını YALNIZ `canCoolantTemp` /
 *     `canBatteryVolt`ten okur → CAN'ı olmayan (aftermarket ELM327'li) araçta
 *     Guardian'ın aşırı ısınma ve akü kuralları KALICI OLARAK ÖLÜDÜR.
 *   · `obdService._watchAllSupportedPids` desteklenen PID'leri Set SIRASIYLA
 *     (yani ARTAN PID NUMARASIYLA) izlemeye alıyor ve 16'lık tavanı O2 voltajı
 *     (14-1B) gibi düşük numaralı ama düşük değerli PID'lerle dolduruyordu;
 *     yağ sıcaklığı (5C) · ortam ısısı (46) · modül voltajı (42) · yakıt debisi
 *     (5E) gibi KARAR ÜRETEN sinyaller tavanın DIŞINDA kalıyordu.
 *
 * ── BU KATALOĞUN SÖZLEŞMESİ ───────────────────────────────────────────────
 *  · YENİ PID UYDURULMAZ: her kayıt `StandardPidRegistry`de ZATEN tanımlı,
 *    formülü SAE J1979'dan gelen bir PID'e bağlanır (kilit testi doğrular).
 *  · SIRA = ÖNCELİK. `_watchAllSupportedPids` 16 slotu bu sırayla doldurur;
 *    araç desteklemiyorsa PID slot HARCAMAZ (kanıt yoksa sorgu yok).
 *  · Her sinyalin bir KARARI vardır (anayasa "8 Kapı" · 2. ve 8. kapı):
 *    yalnız göstermek için okunan sinyal bu katalogda YER ALMAZ.
 *  · TRAFİK BÜTÇESİ: extended grup turda EN FAZLA 1 PID okur (native round-robin,
 *    POLL_SLOW). Katalog 30 genişletilmiş sinyal TANIMLAR ama aynı anda ≤16'sı
 *    izlenir — 101 PID'i sürekli poll ETMEK YASAK, ELM327 hattı boğulmaz.
 */

import type { ObdFreshnessClass } from './obdFreshnessPolicy';

/** Kanonik OBD sinyal anahtarı — köprünün mağazaya yazdığı ad. */
export type CanonicalObdKey =
  // ── Çekirdek yol (obdService `onOBDData` — EK BUS TRAFİĞİ YOK) ────────────
  | 'coolantTemp' | 'throttle' | 'intakeTemp' | 'manifoldPressure'
  // ── Genişletilmiş yol (extendedPidService round-robin) ────────────────────
  | 'oilTemp' | 'moduleVoltage' | 'ambientTemp' | 'milDtcCount'
  | 'egtBank1' | 'dpfTempBank1' | 'catTempB1S1'
  | 'engineLoad' | 'maf' | 'fuelRate'
  | 'shortFuelTrimB1' | 'longFuelTrimB1' | 'timingAdvance'
  | 'baroPressure' | 'fuelPressure' | 'egrCommanded' | 'egrError'
  | 'absoluteLoad' | 'relativeThrottle' | 'relativeAccelPedal'
  | 'commandedAfr' | 'actualEngineTorque'
  | 'shortFuelTrimB2' | 'longFuelTrimB2' | 'noxSensor1'
  | 'engineRunTime' | 'monitorsNotReady'
  | 'distanceWithMil' | 'distanceSinceClear' | 'ethanolPct';

/**
 * Sinyalin OKUMA YOLU.
 *  · `core`     — `obdService` poll grubundan ZATEN akıyor; köprü yalnız mağazaya
 *                 taşır (EK ELM327 TRAFİĞİ SIFIR, slot tüketmez).
 *  · `extended` — `extendedPidService` round-robin turunda okunur (slot tüketir).
 */
export type CanonicalObdPath = 'core' | 'extended';

/** Aynı fiziksel veriyi taşıyan CAN mağaza alanı (varsa). */
export type CanonicalCanField =
  | 'canCoolantTemp' | 'canOilTemp' | 'canThrottle'
  | 'canBatteryVolt' | 'canAmbientTemp';

export interface CanonicalObdSignalDef {
  /** Mağaza anahtarı. */
  readonly key: CanonicalObdKey;
  /** Kaynak PID (2 hane büyük-harf hex) — `StandardPidRegistry`de TANIMLI olmalı. */
  readonly pid: string;
  /** Okuma yolu (bkz. `CanonicalObdPath`). */
  readonly path: CanonicalObdPath;
  /** Türkçe kısa ad — LAB/asistan bunu gösterir. */
  readonly name: string;
  /** Birim ('°C' · 'V' · '%' · 'kPa' · 'g/s' · 'L/h' · 'km' · 's' · 'ppm' · 'λ' · '°'). */
  readonly unit: string;
  /**
   * Güvenlik-kritik mi. Anayasa: güvenlik katmanı HER tier'da açıktır — bu
   * sinyaller öncelik sırasının başında durur ve düşük-uçta FEDA EDİLMEZ.
   */
  readonly safety: boolean;
  /** Bu sinyalden ÜRETİLEN karar (8 Kapı · 2. ve 8. kapı). Boş bırakılamaz. */
  readonly decision: string;
  /**
   * Aynı fiziksel veriyi taşıyan CAN alanı — TEK KANONİK OTORİTE bu eşlemeden
   * türetilir (`canonicalVehicleSignal.ts`: CAN → OBD → yok).
   * `null` = OBD'ye özgü, CAN karşılığı yok.
   */
  readonly canField: CanonicalCanField | null;
  /**
   * P0-OBD-02 — KARARIN gerektirdiği tazelik sınıfı (sinyalin değişim hızı DEĞİL).
   * Eşik buradan ve GERÇEK okuma kadansından türer; bkz. `obdFreshnessPolicy`.
   */
  readonly freshness: ObdFreshnessClass;
  /**
   * FİZİKSEL geçerlilik bandı — bant DIŞI okuma ÖLÇÜM SAYILMAZ.
   *
   * NEDEN AYRI ALAN (registry'nin min/max'ı yetmiyor): registry bandı FORMÜLÜN
   * teorik aralığıdır (ör. sıcaklık için −40..215 °C, çünkü bayt 0..255'tir).
   * Burada tutulan bant o sinyalin BU ARAÇTA fiziksel olarak mümkün aralığıdır
   * ve `-1` sentinel'ini körlemesine elemek yerine gerçek negatifleri GEÇİRİR.
   */
  readonly physMin: number;
  readonly physMax: number;
  /**
   * `-1` bu sinyal için "sorulmadı/desteklenmiyor" SENTİNEL'i midir?
   *
   * `ObdPollSample` sözleşmesi çekirdek alanlarda `-1` kullanır. Bandı 0'dan
   * başlayan sinyallerde (yüzde, basınç) `-1` zaten bant dışıdır ve ayrı kurala
   * GEREK YOKTUR. Yalnız SICAKLIKLARDA bant negatife uzandığı için `-1` TAM
   * DEĞER olarak elenir.
   *
   * BİLİNEN KISIT (bilinçli, ölçülebilir): gerçekten −1 °C olan bir okuma da
   * elenir. Bu 1 °C'lik kör noktadır; ÖNCEKİ davranış (`v < 0` körlemesine
   * eleme) 41 °C'lik kör nokta demekti ve soğuk iklimde ortam/emme sıcaklığını
   * TAMAMEN yok ediyordu.
   */
  readonly minusOneIsSentinel: boolean;
}

/**
 * ÖNCELİK SIRALI katalog. Sıra bilinçlidir; `_watchAllSupportedPids` slotları
 * bu sırayla dağıtır:
 *
 *  1-7   GÜVENLİK (yağ ısısı · modül voltajı · ortam ısısı · MIL · EGT · DPF · katalizör)
 *        — dizel-özel olanlar (78/7C) benzinlide DESTEKLENMEZ, dolayısıyla benzinli
 *          araçta slot HARCAMAZLAR: yüksek sırada durmaları bedavadır.
 *  8-17  TEŞHİS ÇEKİRDEĞİ (yük · MAF · yakıt debisi · trim · avans · baro · basınç · EGR)
 * 18-24  GÜÇ AKTARMA / EMİSYON bağlamı
 * 25-30  SAYAÇ / MESAFE / YAKIT TİPİ (dakikalar-günler mertebesinde değişir → en sonda)
 */
const DEFS: readonly CanonicalObdSignalDef[] = [
  /* ── Çekirdek yol: sıfır ek trafik, her zaman köprülenir (slot tüketmez) ── */
  { key: 'coolantTemp',      pid: '05', path: 'core', name: 'Soğutma sıvısı sıcaklığı', unit: '°C',  safety: true,
    decision: 'Aşırı ısınma uyarısı ve güç kısma (Guardian ENGINE_OVERHEAT).',   canField: 'canCoolantTemp',
    freshness: 'medium', physMin: -40, physMax: 200, minusOneIsSentinel: true },
  { key: 'throttle',         pid: '11', path: 'core', name: 'Gaz kelebeği konumu',      unit: '%',   safety: false,
    decision: 'Sürüş modu tespiti ve sürücü DNA agresiflik skoru.',              canField: 'canThrottle',
    freshness: 'hot', physMin: 0, physMax: 100, minusOneIsSentinel: false },
  { key: 'intakeTemp',       pid: '0F', path: 'core', name: 'Emme havası sıcaklığı',    unit: '°C',  safety: false,
    decision: 'Hava yoğunluğu düzeltmesi; turbo/intercooler verimi kıyaslaması.', canField: null,
    freshness: 'slow', physMin: -40, physMax: 150, minusOneIsSentinel: true },
  { key: 'manifoldPressure', pid: '0B', path: 'core', name: 'Emme manifoldu basıncı',   unit: 'kPa', safety: false,
    decision: 'Turbo basınç kaybı ve emme kaçağı tespiti (baro ile birlikte).',  canField: null,
    freshness: 'hot', physMin: 0, physMax: 255, minusOneIsSentinel: false },

  /* ── 1-7 · GÜVENLİK ─────────────────────────────────────────────────────── */
  { key: 'oilTemp',       pid: '5C', path: 'extended', name: 'Motor yağı sıcaklığı',      unit: '°C', safety: true,
    decision: 'Yağ aşırı ısınması → sürüş kısıtı; soğuk yağda yüksek devir uyarısı.', canField: 'canOilTemp',
    freshness: 'medium', physMin: -40, physMax: 215, minusOneIsSentinel: true },
  { key: 'moduleVoltage', pid: '42', path: 'extended', name: 'Kontrol ünitesi voltajı',   unit: 'V',  safety: true,
    decision: 'Şarj/alternatör arızası ve akü zayıflığı kararı (BatteryProtectionService).', canField: 'canBatteryVolt',
    freshness: 'medium', physMin: 6, physMax: 18, minusOneIsSentinel: false },
  { key: 'ambientTemp',   pid: '46', path: 'extended', name: 'Ortam hava sıcaklığı',      unit: '°C', safety: true,
    decision: 'Buzlanma uyarısı; termal bütçe ve kabin ön-koşullama kararı.',    canField: 'canAmbientTemp',
    freshness: 'slow', physMin: -50, physMax: 70, minusOneIsSentinel: true },
  { key: 'milDtcCount',   pid: '01', path: 'extended', name: 'Arıza kodu sayısı (MIL)',   unit: '',   safety: true,
    decision: 'Motor arıza lambası yandı mı → sürücü bildirimi + tanı akışı tetikleme.', canField: null,
    freshness: 'slow', physMin: 0, physMax: 127, minusOneIsSentinel: false },
  { key: 'egtBank1',      pid: '78', path: 'extended', name: 'Egzoz gazı sıcaklığı (B1)', unit: '°C', safety: true,
    decision: 'Dizelde egzoz aşırı ısınması → turbo/DPF hasar riski uyarısı.',   canField: null,
    freshness: 'medium', physMin: -40, physMax: 1200, minusOneIsSentinel: true },
  { key: 'dpfTempBank1',  pid: '7C', path: 'extended', name: 'DPF sıcaklığı (B1)',        unit: '°C', safety: true,
    decision: 'Aktif rejenerasyon tespiti → "motoru şimdi durdurma" uyarısı.',   canField: null,
    freshness: 'medium', physMin: -40, physMax: 1200, minusOneIsSentinel: true },
  { key: 'catTempB1S1',   pid: '3C', path: 'extended', name: 'Katalizör sıcaklığı (B1S1)', unit: '°C', safety: true,
    decision: 'Katalizör aşırı ısınması (yanmamış yakıt) → acil servis uyarısı.', canField: null,
    freshness: 'medium', physMin: -40, physMax: 1200, minusOneIsSentinel: true },

  /* ── 8-17 · TEŞHİS ÇEKİRDEĞİ ────────────────────────────────────────────── */
  { key: 'engineLoad',      pid: '04', path: 'extended', name: 'Hesaplanan motor yükü',      unit: '%',   safety: false,
    decision: 'Yük-tüketim tutarlılığı; tırmanış/çekiş bağlamı; anormal yük tanısı.', canField: null,
    freshness: 'hot', physMin: 0, physMax: 100, minusOneIsSentinel: false },
  { key: 'maf',             pid: '10', path: 'extended', name: 'Hava kütle akışı (MAF)',     unit: 'g/s', safety: false,
    decision: 'Emme kaçağı / kirli MAF tanısı ve anlık tüketim türetimi.',       canField: null,
    freshness: 'hot', physMin: 0, physMax: 655, minusOneIsSentinel: false },
  { key: 'fuelRate',        pid: '5E', path: 'extended', name: 'Yakıt tüketim hızı',         unit: 'L/h', safety: false,
    decision: 'GERÇEK anlık tüketim ve menzil (tahmin yerine ÖLÇÜM).',           canField: null,
    freshness: 'hot', physMin: 0, physMax: 300, minusOneIsSentinel: false },
  { key: 'shortFuelTrimB1', pid: '06', path: 'extended', name: 'Kısa dönem yakıt trim (B1)', unit: '%',   safety: false,
    decision: 'Ani karışım sapması → enjektör/kaçak/lambda tanısı.',             canField: null,
    freshness: 'medium', physMin: -100, physMax: 99.2, minusOneIsSentinel: false },
  { key: 'longFuelTrimB1',  pid: '07', path: 'extended', name: 'Uzun dönem yakıt trim (B1)', unit: '%',   safety: false,
    decision: 'Kalıcı karışım sapması → arıza öngörüsü (kod yanmadan önce).',    canField: null,
    freshness: 'slow', physMin: -100, physMax: 99.2, minusOneIsSentinel: false },
  { key: 'timingAdvance',   pid: '0E', path: 'extended', name: 'Ateşleme avansı',            unit: '°',   safety: false,
    decision: 'Vuruntu geri çekmesi → kötü yakıt / aşırı ısınma erken uyarısı.', canField: null,
    freshness: 'hot', physMin: -64, physMax: 63.5, minusOneIsSentinel: false },
  { key: 'baroPressure',    pid: '33', path: 'extended', name: 'Barometrik basınç',          unit: 'kPa', safety: false,
    decision: 'Rakım düzeltmesi; MAP ile birlikte turbo basınç farkı hesabı.',   canField: null,
    freshness: 'slow', physMin: 0, physMax: 255, minusOneIsSentinel: false },
  { key: 'fuelPressure',    pid: '0A', path: 'extended', name: 'Yakıt basıncı',              unit: 'kPa', safety: false,
    decision: 'Yakıt pompası / filtre tıkanıklığı tanısı.',                      canField: null,
    freshness: 'medium', physMin: 0, physMax: 765, minusOneIsSentinel: false },
  { key: 'egrCommanded',    pid: '2C', path: 'extended', name: 'Komutlanan EGR',             unit: '%',   safety: false,
    decision: 'EGR valfi çalışıyor mu → emisyon arızası ve kurum tanısı.',       canField: null,
    freshness: 'medium', physMin: 0, physMax: 100, minusOneIsSentinel: false },
  { key: 'egrError',        pid: '2D', path: 'extended', name: 'EGR hatası',                 unit: '%',   safety: false,
    decision: 'Komut ile gerçekleşen arasındaki fark → tıkalı EGR kanıtı.',      canField: null,
    freshness: 'medium', physMin: -100, physMax: 99.2, minusOneIsSentinel: false },

  /* ── 18-24 · GÜÇ AKTARMA / EMİSYON BAĞLAMI ──────────────────────────────── */
  { key: 'absoluteLoad',       pid: '43', path: 'extended', name: 'Mutlak motor yükü',     unit: '%', safety: false,
    decision: 'Silindir dolgu verimi → güç kaybı tanısı (yük ile çapraz kontrol).', canField: null,
    freshness: 'hot', physMin: 0, physMax: 400, minusOneIsSentinel: false },
  { key: 'relativeThrottle',   pid: '45', path: 'extended', name: 'Bağıl gaz kelebeği',    unit: '%', safety: false,
    decision: 'Gaz kelebeği öğrenme sapması → rölanti dalgalanması tanısı.',     canField: null,
    freshness: 'hot', physMin: 0, physMax: 100, minusOneIsSentinel: false },
  { key: 'relativeAccelPedal', pid: '5A', path: 'extended', name: 'Bağıl gaz pedalı',      unit: '%', safety: false,
    decision: 'Sürücü talebi ile kelebek yanıtı farkı → drive-by-wire tanısı.',  canField: null,
    freshness: 'hot', physMin: 0, physMax: 100, minusOneIsSentinel: false },
  { key: 'commandedAfr',       pid: '44', path: 'extended', name: 'Komutlanan hava-yakıt', unit: 'λ', safety: false,
    decision: 'Zengin/fakir komut → katalizör koruma ve tüketim yorumu.',        canField: null,
    freshness: 'medium', physMin: 0, physMax: 2, minusOneIsSentinel: false },
  { key: 'actualEngineTorque', pid: '62', path: 'extended', name: 'Gerçek motor torku',    unit: '%', safety: false,
    decision: 'Güç kaybı ölçümü; yokuş/yük tahmini ve sürüş modu kararı.',       canField: null,
    freshness: 'hot', physMin: -125, physMax: 130, minusOneIsSentinel: false },
  { key: 'shortFuelTrimB2',    pid: '08', path: 'extended', name: 'Kısa dönem trim (B2)',  unit: '%', safety: false,
    decision: 'Banka farkı → tek taraflı kaçak/enjektör tanısı (B1 ile kıyas).', canField: null,
    freshness: 'medium', physMin: -100, physMax: 99.2, minusOneIsSentinel: false },
  { key: 'longFuelTrimB2',     pid: '09', path: 'extended', name: 'Uzun dönem trim (B2)',  unit: '%', safety: false,
    decision: 'Kalıcı banka farkı → hangi bankanın arızalı olduğunun kanıtı.',   canField: null,
    freshness: 'slow', physMin: -100, physMax: 99.2, minusOneIsSentinel: false },

  /* ── 25-30 · SAYAÇ / MESAFE / YAKIT TİPİ (yavaş değişir) ─────────────────── */
  { key: 'noxSensor1',         pid: '83', path: 'extended', name: 'NOx konsantrasyonu',    unit: 'ppm', safety: false,
    decision: 'AdBlue/SCR verimi → emisyon arızası öngörüsü (dizel).',           canField: null,
    freshness: 'medium', physMin: 0, physMax: 65535, minusOneIsSentinel: false },
  { key: 'engineRunTime',      pid: '1F', path: 'extended', name: 'Motor çalışma süresi',  unit: 's',   safety: false,
    decision: 'Rölantide bekleme süresi ve motor-saati bakım sayacı.',           canField: null,
    freshness: 'archival', physMin: 0, physMax: 65535, minusOneIsSentinel: false },
  { key: 'monitorsNotReady',   pid: '41', path: 'extended', name: 'Hazır olmayan monitör', unit: '',    safety: false,
    decision: 'Muayeneye hazır mı → "şimdi muayeneye gitme" kararı.',            canField: null,
    freshness: 'slow', physMin: 0, physMax: 11, minusOneIsSentinel: false },
  { key: 'distanceWithMil',    pid: '21', path: 'extended', name: 'MIL yanarken yol',      unit: 'km',  safety: false,
    decision: 'Arıza ne kadar süredir yok sayılıyor → aciliyet derecesi.',       canField: null,
    freshness: 'archival', physMin: 0, physMax: 65535, minusOneIsSentinel: false },
  { key: 'distanceSinceClear', pid: '31', path: 'extended', name: 'Kod silindiğinden yol', unit: 'km',  safety: false,
    decision: 'Kodların yeni silinip silinmediği → ikinci el alım kontrolü.',    canField: null,
    freshness: 'archival', physMin: 0, physMax: 65535, minusOneIsSentinel: false },
  { key: 'ethanolPct',         pid: '52', path: 'extended', name: 'Etanol yakıt oranı',    unit: '%',   safety: false,
    decision: 'Yakıt karışımı → tüketim beklentisi ve trim yorumu düzeltmesi.',  canField: null,
    freshness: 'slow', physMin: 0, physMax: 100, minusOneIsSentinel: false },
];

/** Öncelik sırası KORUNMUŞ tam katalog (salt-okunur). */
export const CANONICAL_OBD_SIGNALS: readonly CanonicalObdSignalDef[] = DEFS;

/** Anahtar → tanım. */
export const CANONICAL_OBD_BY_KEY: ReadonlyMap<CanonicalObdKey, CanonicalObdSignalDef> =
  new Map(DEFS.map((d) => [d.key, d]));

/** PID (2 hane büyük-harf hex) → tanım. */
export const CANONICAL_OBD_BY_PID: ReadonlyMap<string, CanonicalObdSignalDef> =
  new Map(DEFS.map((d) => [d.pid, d]));

/**
 * `extendedPidService` üzerinden izlenecek PID'ler — ÖNCELİK SIRASINDA.
 * `obdService._watchAllSupportedPids` 16'lık tavanı bu sırayla doldurur.
 */
export const CANONICAL_EXTENDED_PID_ORDER: readonly string[] =
  DEFS.filter((d) => d.path === 'extended').map((d) => d.pid);

/** Çekirdek yoldan (ek trafik olmadan) köprülenen sinyaller. */
export const CANONICAL_CORE_SIGNALS: readonly CanonicalObdSignalDef[] =
  DEFS.filter((d) => d.path === 'core');

/* ── Değer kabul kapısı (SAF · test edilebilir) ──────────────────────────── */

/**
 * Ham bir okumayı KABUL veya RED eder — sahte veri kapısının TEK yeri.
 *
 * ── NEDEN DEĞİŞTİ (P0-OBD-02) ─────────────────────────────────────────────
 * Eski kural `v < 0` idi: TÜM negatifler eleniyordu. Bu, `-1` sentinel'ini
 * yakalıyordu ama yanında GERÇEK ölçümleri de yok ediyordu — soğuk iklimde
 * ortam sıcaklığı (−12 °C), emme havası (−8 °C) ve soğuk motorda soğutma
 * sıvısı (−5 °C) mağazaya HİÇ yazılamıyordu. Yani "sahte veri üretme" kuralı,
 * kendi başına bir VERİ KAYBI kusuruna dönüşmüştü.
 *
 * Yeni kural iki ayrı soruyu AYRI AYRI sorar:
 *   1. Bu değer bir SENTİNEL mi? (yalnız `-1`, yalnız sentinel bildiren sinyalde)
 *   2. Bu değer FİZİKSEL olarak mümkün mü? (`physMin`..`physMax`)
 *
 * @returns kabul edilen sayı, ya da `null` (yaz**ma**).
 */
export function acceptCanonicalValue(
  def: CanonicalObdSignalDef,
  raw: number | undefined | null,
): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  // 1. Sentinel — TAM DEĞER kıyası. `< 0` DEĞİL: gerçek negatifler geçmeli.
  if (def.minusOneIsSentinel && raw === -1) return null;
  // 2. Fiziksel bant — adaptör glitch'i / bozuk decode buradan geçemez.
  if (raw < def.physMin || raw > def.physMax) return null;
  return raw;
}

/* ── Slot dağıtımı (SAF · test edilebilir) ───────────────────────────────── */

/**
 * Sürekli izlemeye alınacak PID'leri ÖNCELİK SIRASINDA seçer — `obdService`in
 * `_watchAllSupportedPids` fonksiyonunun kararı buradan gelir.
 *
 * NEDEN AYRI VE SAF: seçim kuralı `obdService`in içinde gömülüyken KİLİTLENEMİYOR,
 * dolayısıyla sessizce geri dönebiliyordu. Ölçülen iki kusur (öncelik yok · tele
 * hiç gitmeyecek PID slot harcıyor) tam olarak böyle görünmez kalmıştı.
 *
 * KURALLAR (sırayla):
 *  1. Katalog önceliği — karar üreten sinyaller ÖNCE.
 *  2. Kalan destekli PID'ler — artan numarayla (eski davranışın korunan kuyruğu;
 *     kataloga girmemiş ama araçta VAR olan sinyaller kaybolmasın).
 *  3. ELENENLER: çekirdek poll PID'leri · blok bayrakları (0x20/0x40…) ·
 *     `StandardPidRegistry`de TANIMSIZ PID'ler (tele zaten gitmezler → slot
 *     harcatmaları saf kayıptır).
 *
 * @param supported Handshake/bitmap kanıtıyla DESTEKLİ olduğu bilinen PID numaraları.
 * @param corePollPids `obdService`in FAST/SLOW grubunda ZATEN okuduğu PID numaraları.
 * @param cap Tavan (`ELM_WATCH_CAP`).
 * @returns 2 hane büyük-harf hex PID listesi, öncelik sırasında, uzunluk ≤ cap.
 */
export function selectPrioritizedExtendedPids(
  supported: ReadonlySet<number>,
  corePollPids: ReadonlySet<number>,
  cap: number,
  isDecodable: (pidHex: string) => boolean,
): string[] {
  const out: string[] = [];
  const seen = new Set<number>();

  const take = (num: number): boolean => {
    if (out.length >= cap) return false;                 // tavan doldu → dur
    if (seen.has(num)) return true;
    if (!supported.has(num)) return true;                // kanıt yok → sorma
    if (corePollPids.has(num)) return true;              // core zaten FAST poll'da
    if (num % 0x20 === 0) return true;                   // 0x20/0x40… blok bayrağı, veri değil
    const hex = num.toString(16).toUpperCase().padStart(2, '0');
    if (!isDecodable(hex)) return true;                  // tele gitmez → slot harcatma
    seen.add(num);
    out.push(hex);
    return true;
  };

  for (const pidHex of CANONICAL_EXTENDED_PID_ORDER) {
    const num = parseInt(pidHex, 16);
    if (Number.isNaN(num)) continue;
    if (!take(num)) return out;
  }
  for (const num of supported) {
    if (!take(num)) return out;
  }
  return out;
}
