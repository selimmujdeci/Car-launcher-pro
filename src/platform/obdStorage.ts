import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../utils/safeStorage';
import { useVidStore, type VidObdAdapterInfo } from '../store/useVidStore';

/**
 * VID aynalama (Sprint 2 Mirror Layer, fail-soft): OBD adaptör son-bilinen
 * alanlarını VID store'a yansıtır. localStorage TEK doğru kaynaktır; aynalama
 * hiçbir yazma/okuma yolunu değiştirmez ve hataları kendi try/catch'inde yutulur.
 */
function mirrorObdToVid(info: Partial<VidObdAdapterInfo>): void {
  try { useVidStore.getState().updateObdAdapterInfo(info); } catch { /* fail-soft */ }
}

export const OBD_ADDRESS_KEY = 'obd:lastAddress';
export const OBD_PROFILE_KEY = 'obd:detectedProfile';
export const OBD_TRANSPORT_KEY = 'obd:lastTransport';
// A-fix: transport'un GERÇEKTEN doğrulandığı (canlı PID verisi akan) bilgisi. Yalnız veri
// akınca '1' yazılır → boot'ta persisted+verified transport doğrudan denenir (BLE turu atlanır).
// Dual-mod adaptör TAHMİNİ (henüz veri akmamış) verified sayılmaz → yanlış yönlendirme olmaz.
export const OBD_TRANSPORT_VERIFIED_KEY = 'obd:transportVerified';
export const OBD_PROTOCOL_KEY = 'obd:lastProtocol';
// Keşif kanıt defteri: bu adreslerden GERÇEK OBD verisi aktı (canlı PID doğrulandı).
// Tarama listesinde 'verified' rozetini bunlar alır — tahmin değil, kanıt.
export const OBD_VERIFIED_ADDRESSES_KEY = 'obd:verifiedAddresses';

/** Kanıt defterinde tutulan en fazla adres sayısı (bounded — sınırsız büyümez). */
const MAX_VERIFIED_ADDRESSES = 8;

export type ObdTransport = 'classic' | 'ble' | 'tcp';

/**
 * WiFi ELM327 (AP modu) adres biçimi: "ip:port" (ör. 192.168.0.10:35000).
 * Host: IPv4 dotted-quad veya hostname karakter seti. Port: 1-65535.
 */
const TCP_ADDRESS_RE = /^([a-zA-Z0-9.-]+):(\d{1,5})$/;

/** Patch 10: girilen adresin "ip:port" biçiminde ve port aralığının geçerli olup olmadığını doğrular. */
export function isValidTcpAddress(address: string): boolean {
  const m = TCP_ADDRESS_RE.exec(address.trim());
  if (!m) return false;
  const host = m[1];
  const port = Number(m[2]);
  return !!host && port >= 1 && port <= 65535;
}

/**
 * Son bilinen BT MAC adresini okur.
 *
 * SAHA KANITI (2026-07-27): adres YALNIZ `localStorage`'da tutuluyordu. localStorage
 * WebView ORIGIN'ine bağlıdır; uygulama şeması değişince (https://localhost →
 * http://localhost) veya WebView verisi temizlenince adres SESSİZCE kaybolur.
 * Diğer tüm ayarlar `safeStorage` (dosya sistemi) üzerinden origin'den BAĞIMSIZ
 * hayatta kaldığı için ortaya tutarsız bir durum çıkıyordu: kullanıcının profili
 * duruyor ama "Kayıtlı OBD adresi yok — cihaz seçin" hatası alıyordu.
 *
 * ÇÖZÜM: localStorage BİRİNCİL (hızlı, senkron), `safeStorage` YEDEK. Yalnız
 * okuma tarafında yedeğe düşülür ve bulunan değer localStorage'a geri yazılır
 * (self-healing). Yeni bir depolama biçimi getirmez — mevcut kayıtlar çalışır.
 */
export function loadObdAddress(): string | null {
  try {
    const local = localStorage.getItem(OBD_ADDRESS_KEY);
    if (local) return local;
  } catch { /* localStorage erişilemez — yedeğe düş */ }

  // Yedek: origin'den bağımsız kalıcı katman.
  try {
    const backup = safeGetRaw(OBD_ADDRESS_KEY);
    // FAIL-CLOSED: yedek katman diskten gelir; bozuk/şişmiş kayıt bağlantı yoluna
    // SOKULMAZ ve birincil katmana geri yazılmaz — adres yok sayılır (tam scan'e düşer).
    if (backup && isPlausibleObdAddress(backup)) {
      // Self-healing: birincil katmana geri yaz ki sonraki okumalar hızlı olsun.
      try { localStorage.setItem(OBD_ADDRESS_KEY, backup); } catch { /* quota */ }
      return backup;
    }
  } catch { /* yedek de yok */ }

  return null;
}

/**
 * Yedek katmandan gelen adres "makul" mü? BİÇİM DAYATMAZ (BT MAC · ip:port · üretici
 * kimlikleri hep farklı yazılır) — yalnız bozulmayı eler: boş, aşırı uzun, boşluk veya
 * kontrol karakteri içeren değer kabul edilmez. Geriye uyumluluk: bugüne kadar yazılmış
 * her gerçek adres (MAC/ip:port) bu kapıdan geçer.
 */
/** Adres uzunluk tavanı — BT MAC (17) ve hostname:port için fazlasıyla yeterli. */
const MAX_ADDRESS_LEN = 64;

export function isPlausibleObdAddress(value: string): boolean {
  if (!value || value.length > MAX_ADDRESS_LEN) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c <= 32 || c === 127) return false;   // boşluk/sekme/yeni satır + tüm kontrol karakterleri
  }
  return true;
}

/**
 * BT MAC adresini yazar — HER İKİ katmana (localStorage + safeStorage).
 * Kota/erişim hataları sessizce yok sayılır (fail-soft).
 *
 * Yedek katman ANINDA yazılır (`immediate`): `obd:lastAddress` kritik anahtar
 * listesinde olmadığı için varsayılan yol 5 sn debounce + idle kuyruğudur —
 * araçta kontak kapanması/process kill o pencerede olursa yedek HİÇ oluşmaz ve
 * bu düzeltmenin tek amacı (origin değişse de adres kalsın) son adres için
 * çalışmazdı. Frekans düşüktür (bağlantı başına 1 yazma) → eMMC bütçesi korunur.
 */
export function saveObdAddress(address: string): void {
  try { localStorage.setItem(OBD_ADDRESS_KEY, address); } catch { /* quota */ }
  try { safeSetRaw(OBD_ADDRESS_KEY, address, undefined, true); } catch { /* fail-soft */ }
  mirrorObdToVid({ lastAddress: address });
}

/**
 * Kayıtlı BT MAC adresini siler (adaptör değişimi: stale MAC temizliği → tam scan'e düşer).
 * İKİ katmandan da silinir — yoksa yedek katman silinen adresi geri diriltirdi.
 *
 * ⚠️ `safeRemoveRaw` KULLANILIR, boş string YAZILMAZ: native'de `_fsWriteAtomic`
 * boş içeriği `stat.size === 0` ile REDDEDER (throw) → mezar taşı yazımı sessizce
 * düşer, `.json` dosyası ve `_fsCache` ESKİ ADRESİ tutmaya devam ederdi; bir
 * sonraki `loadObdAddress()` silinmiş adresi yedekten diriltip localStorage'a geri
 * yazardı. `safeRemoveRaw` bekleyen yazımları da iptal eder (yarış yok).
 */
export function clearObdAddress(): void {
  try { localStorage.removeItem(OBD_ADDRESS_KEY); } catch { /* ignore */ }
  try { safeRemoveRaw(OBD_ADDRESS_KEY); } catch { /* ignore */ }
  mirrorObdToVid({ lastAddress: null });
}

/** Son kullanılan taşıma katmanını localStorage'dan okur ('classic' | 'ble' | 'tcp'). */
export function loadObdTransport(): ObdTransport | null {
  try {
    const v = localStorage.getItem(OBD_TRANSPORT_KEY);
    return v === 'classic' || v === 'ble' || v === 'tcp' ? v : null;
  } catch { return null; }
}

/** Taşıma katmanını localStorage'a yazar. Kota hatalarını sessizce yok sayar.
 *  YENİ transport yazımı verified'ı SIFIRLAR — bu transport henüz veri akıtmadı;
 *  gerçek PID verisi gelince saveObdTransportVerified(true) ile doğrulanır. */
export function saveObdTransport(transport: ObdTransport): void {
  try {
    localStorage.setItem(OBD_TRANSPORT_KEY, transport);
    localStorage.removeItem(OBD_TRANSPORT_VERIFIED_KEY); // yeni transport = doğrulanmamış
  } catch { /* quota */ }
  mirrorObdToVid({ lastTransport: transport, isTransportVerified: false });
}

/** A-fix: transport'un canlı-veri ile doğrulandığını persist eder. */
export function saveObdTransportVerified(verified: boolean): void {
  try {
    if (verified) localStorage.setItem(OBD_TRANSPORT_VERIFIED_KEY, '1');
    else localStorage.removeItem(OBD_TRANSPORT_VERIFIED_KEY);
  } catch { /* quota */ }
  mirrorObdToVid({ isTransportVerified: verified });
}

/** A-fix: persisted transport'un daha önce canlı-veri ile doğrulanıp doğrulanmadığı. */
export function loadObdTransportVerified(): boolean {
  try { return localStorage.getItem(OBD_TRANSPORT_VERIFIED_KEY) === '1'; } catch { return false; }
}

/** Kayıtlı taşıma katmanını siler (adaptör değişimi temizliği ile birlikte). Verified de silinir. */
export function clearObdTransport(): void {
  try {
    localStorage.removeItem(OBD_TRANSPORT_KEY);
    localStorage.removeItem(OBD_TRANSPORT_VERIFIED_KEY);
  } catch { /* ignore */ }
  mirrorObdToVid({ lastTransport: null, isTransportVerified: false });
}

/* ── Keşif kanıt defteri (doğrulanmış OBD adresleri) ──────────────────────── */

/**
 * Bu adreslerden daha önce GERÇEK OBD verisi aktı. Tarama listesi bu defteri
 * okuyup 'verified' rozetini basar → kullanıcı tahmin ile kanıtı ayırt eder.
 * Adresler büyük harfe normalize edilir (BT MAC karşılaştırması büyük/küçük duyarsız).
 */
export function loadVerifiedObdAddresses(): Set<string> {
  try {
    const raw = localStorage.getItem(OBD_VERIFIED_ADDRESSES_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((a): a is string => typeof a === 'string').map((a) => a.toUpperCase()),
    );
  } catch { return new Set(); }  // bozuk kayıt → boş defter (fail-soft)
}

/**
 * Bir adresi "gerçek OBD verisi aktı" olarak mühürler. En yeni adres başa gelir,
 * defter MAX_VERIFIED_ADDRESSES ile sınırlıdır (LRU).
 * Canlı PID verisi doğrulandığında çağrılır — bağlantı kurulduğunda DEĞİL
 * (bağlanmak veri akıtmak demek değildir).
 */
export function markObdAddressVerified(address: string): void {
  const addr = address.trim().toUpperCase();
  if (!addr) return;
  try {
    const existing = [...loadVerifiedObdAddresses()].filter((a) => a !== addr);
    const next = [addr, ...existing].slice(0, MAX_VERIFIED_ADDRESSES);
    localStorage.setItem(OBD_VERIFIED_ADDRESSES_KEY, JSON.stringify(next));
  } catch { /* quota / bozuk JSON → sessiz geç, rozet düşer ama akış bozulmaz */ }
}

/** Kanıt defterini temizler (adaptör değişimi / fabrika ayarları). */
export function clearVerifiedObdAddresses(): void {
  try { localStorage.removeItem(OBD_VERIFIED_ADDRESSES_KEY); } catch { /* ignore */ }
}

/**
 * Patch 3: ElmInitSequencer'ın ATDPN ile okuduğu ELM327 ATSP protokol numarasını
 * (ör. '6' = ISO 15765-4 CAN 11/500) okur. Varsa sonraki bağlantı bu protokolü
 * ATSP<n> ile ZORLAR — ATSP0 otomatik arama YOK, aramasız/hızlı bağlanır.
 */
export function loadObdProtocol(): string | null {
  try { return localStorage.getItem(OBD_PROTOCOL_KEY); } catch { return null; }
}

/** Öğrenilen protokolü kalıcılaştırır. Kota hatalarını sessizce yok sayar. */
export function saveObdProtocol(protocol: string): void {
  try { localStorage.setItem(OBD_PROTOCOL_KEY, protocol); } catch { /* quota */ }
  mirrorObdToVid({ lastProtocolNum: protocol });
}

/** Öğrenilen protokolü siler (adaptör/araç değişimi temizliği ile birlikte kullanılabilir). */
export function clearObdProtocol(): void {
  try { localStorage.removeItem(OBD_PROTOCOL_KEY); } catch { /* ignore */ }
  mirrorObdToVid({ lastProtocolNum: null });
}

/* ── Araç-bazlı yakıt kalibrasyonu (PID 0x2F sensör eğrisi düzeltmesi) ──────────
 * Bazı araçlarda (Fiat/PSA/Renault) OBD PID 2F'nin bildirdiği yüzde, gösterge
 * panelindeki yakıt seviyesiyle UYUŞMAZ (doğrusal-olmayan şamandıra + üretici
 * kalibrasyon eğrisi). Örn. saha 2026-07-16 Doblo: 2F=%26 iken gerçek ~%48.
 * Ölçek adaptör MAC'ine göre saklanır (adaptör+araç ikilisi); varsayılan 1.0
 * (kalibrasyonsuz → hiçbir aracı etkilemez). displayFuel = clamp(raw2F × scale). */
const OBD_FUEL_CALIB_PREFIX = 'obd:fuelCalib:';
/* ⚠️ VIN ANAHTARI (saha 2026-08-01, Trafic): Kalibrasyon ARACIN şamandıra eğrisidir,
 * ADAPTÖRÜN değil. Anahtar yalnız MAC iken dongle değişimi kalibrasyonu SESSİZCE
 * kaybediyordu: eski adaptörde 1.85 duruyor, yeni adaptörde ölçek 1.0'a düşüyor ve
 * gösterge ham 2F'yi (%24) gerçek seviye (~%47) yerine gösteriyordu. VIN varsa ona
 * yazılır; adaptör değişse de kalır. MAC anahtarı OKUMADA korunur (geriye dönük). */
const OBD_FUEL_CALIB_VIN_PREFIX = 'obd:fuelCalib:vin:';

function _readCalibKey(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    const n = parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch { return null; }
}

function _vinCalibKey(vin: string | null | undefined): string | null {
  const n = vin?.trim().toUpperCase() ?? '';
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(n) ? OBD_FUEL_CALIB_VIN_PREFIX + n : null;
}

/**
 * Yakıt ölçek katsayısı. ÖNCELİK: VIN → adaptör MAC → 1.0 (kalibrasyonsuz).
 *
 * VIN öncelikli çünkü eğri araca aittir; MAC yolu yalnız VIN okunamadığında ve
 * eski kayıtlar için vardır.
 */
export function loadObdFuelCalib(address: string, vin?: string | null): number {
  const vinKey = _vinCalibKey(vin);
  if (vinKey) {
    const byVin = _readCalibKey(vinKey);
    if (byVin !== null) return byVin;
  }
  if (!address) return 1;
  return _readCalibKey(OBD_FUEL_CALIB_PREFIX + address) ?? 1;
}

/**
 * Yakıt ölçek katsayısını kalıcılaştırır (1.0 → kalibrasyon temizle).
 *
 * VIN biliniyorsa VIN'e yazılır (adaptör değişimine dayanıklı); bilinmiyorsa
 * eski MAC davranışı korunur.
 */
export function saveObdFuelCalib(address: string, scale: number, vin?: string | null): void {
  const vinKey = _vinCalibKey(vin);
  const key = vinKey ?? (address ? OBD_FUEL_CALIB_PREFIX + address : null);
  if (!key) return;
  try {
    if (Number.isFinite(scale) && scale > 0 && scale !== 1) {
      localStorage.setItem(key, String(scale));
    } else {
      localStorage.removeItem(key);
    }
  } catch { /* quota */ }
}

/** Kalıcı OBD profil kimliğini safeStorage'dan okur. */
export function loadObdProfileId(): string | null {
  return safeGetRaw(OBD_PROFILE_KEY) ?? null;
}

/** OBD profil kimliğini safeStorage'a yazar (4s debounce safeStorage katmanında). */
export function saveObdProfileId(id: string): void {
  safeSetRaw(OBD_PROFILE_KEY, id);
}
