/**
 * device-types.mjs — Cihaz katmanının durum sözlüğü + SAF parser'lar.
 *
 * Buradaki her fonksiyon **saf**tır: metin girer, yapı çıkar. Hiçbiri komut
 * çalıştırmaz, dosya okumaz, throw ETMEZ. Böylece cihaz olmadan test edilebilir
 * (adb çıktıları fixture olarak verilir).
 *
 * V8 (CLAUDE.md §V8): DeviceInfo / DeviceCapabilities şablon literalidir — tüm
 * alanlar her zaman aynı sırada, bilinmeyen alan `null`. Dinamik property yok.
 */

/** Transport türü — PR-2'de yalnız iki değer vardır. */
export const TRANSPORT_KIND = Object.freeze({
  ADB:  'adb',
  NONE: 'none',
});

/** Bir cihaz işleminin sonucu. Public API ASLA throw etmez → durum burada taşınır. */
export const OP_STATUS = Object.freeze({
  OK:         'ok',           // komut koştu, exit 0
  FAILED:     'failed',       // komut koştu, exit != 0 (cihaz "hayır" dedi)
  SKIPPED_NA: 'skipped_na',   // transport yok / desteklenmiyor → koşulamadı
  TIMEOUT:    'timeout',      // zaman sınırı aşıldı (bounded)
  BROKEN:     'broken',       // transport koptu (broken pipe / device offline)
});

/** Geçici (retry edilebilir) transport hatası desenleri — en fazla 1 retry. */
const TRANSIENT_PATTERNS = [
  /broken pipe/i,
  /device offline/i,
  /device (?:still )?(?:un)?authorized/i,
  /protocol fault/i,
  /connection reset/i,
  /closed/i,
  /error: no devices?\/emulators? found/i,
  /adb server .*(?:out of date|killed|starting)/i,
];

/** Çıktı "geçici transport hatası" mı? (broken pipe → fail-soft + 1 retry) */
export function isTransientTransportError(text) {
  const s = String(text ?? '');
  return TRANSIENT_PATTERNS.some((re) => re.test(s));
}

/** Operasyon sonucu zarfı (sabit şekil). */
export function createOpResult({
  status = OP_STATUS.SKIPPED_NA,
  stdout = '',
  stderr = '',
  code = null,
  reason = null,
  attempts = 0,
  durationMs = 0,
}) {
  return Object.freeze({
    ok: status === OP_STATUS.OK,
    status,
    stdout,
    stderr,
    code,
    reason,
    attempts,
    durationMs,
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * SAF PARSER'LAR — adb çıktısı → yapı
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * `adb devices -l` çıktısı → cihaz listesi.
 * Yalnız `device` durumundakiler "hazır"dır; `offline` / `unauthorized` raporlanır
 * ama kullanılmaz (sessizce "cihaz yok" demek yanlış teşhise yol açar).
 */
export function parseAdbDevices(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/);
  const devices = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^list of devices/i.test(trimmed) || /^\*/.test(trimmed)) continue;
    const m = trimmed.match(/^(\S+)\s+(device|offline|unauthorized|bootloader|recovery)\b(.*)$/);
    if (!m) continue;
    const props = {};
    for (const kv of (m[3] ?? '').trim().split(/\s+/)) {
      const [k, v] = kv.split(':');
      if (k && v) props[k] = v;
    }
    devices.push(Object.freeze({
      serial: m[1],
      state:  m[2],
      ready:  m[2] === 'device',
      model:  props.model ?? null,
      device: props.device ?? null,
      transportId: props.transport_id ?? null,
    }));
  }
  return devices;
}

/** `adb shell getprop` tam dökümü → { key: value } (bilinmeyen/boş değer atlanır). */
export function parseGetpropDump(stdout) {
  const props = {};
  const re = /^\[([^\]]+)\]:\s*\[([^\]]*)\]$/;
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const m = line.trim().match(re);
    if (!m) continue;
    const value = m[2].trim();
    if (value.length > 0) props[m[1]] = value;
  }
  return props;
}

/** `wm size` → { width, height } (Override varsa o kazanır — gerçek görünen çözünürlük). */
export function parseWmSize(stdout) {
  const text = String(stdout ?? '');
  const override = text.match(/Override size:\s*(\d+)x(\d+)/i);
  const physical = text.match(/Physical size:\s*(\d+)x(\d+)/i);
  const m = override ?? physical;
  if (!m) return { width: null, height: null };
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** `wm density` → yoğunluk (Override öncelikli). */
export function parseWmDensity(stdout) {
  const text = String(stdout ?? '');
  const override = text.match(/Override density:\s*(\d+)/i);
  const physical = text.match(/Physical density:\s*(\d+)/i);
  const m = override ?? physical;
  return m ? Number(m[1]) : null;
}

/** `/proc/meminfo` → toplam RAM (MB). */
export function parseMemTotalMb(stdout) {
  const m = String(stdout ?? '').match(/MemTotal:\s*(\d+)\s*kB/i);
  return m ? Math.round(Number(m[1]) / 1024) : null;
}

/** `/proc/cpuinfo` → { cores, hardware, model } (ARM'da model adı satırı değişkendir). */
export function parseCpuinfo(stdout) {
  const text = String(stdout ?? '');
  const cores = (text.match(/^processor\s*:/gim) ?? []).length || null;
  const hardware = text.match(/^Hardware\s*:\s*(.+)$/im)?.[1]?.trim() ?? null;
  // DİKKAT: çekirdek indeksi satırları ("processor : 0") model adı DEĞİLDİR.
  // Büyük-küçük harfe duyarsız bir /Processor/ eşleşmesi onları yakalar ve modeli
  // "0" yapar (gerçek cihazda görüldü). → yalnız "model name", ya da SAYI OLMAYAN
  // değerli "Processor" satırı kabul edilir.
  const model = (
    text.match(/^model name\s*:\s*(.+)$/im)?.[1] ??
    text.match(/^Processor\s*:\s*(?!\d+\s*$)(.+)$/m)?.[1] ??
    null
  );
  return { cores, hardware, model: model ? model.trim() : null };
}

/** `dumpsys battery` → { level, status, temperatureC, plugged }. */
export function parseBattery(stdout) {
  const text = String(stdout ?? '');
  const num = (re) => {
    const m = text.match(re);
    return m ? Number(m[1]) : null;
  };
  const tempRaw = num(/^\s*temperature:\s*(-?\d+)/im);   // 1/10 °C
  return {
    level:        num(/^\s*level:\s*(\d+)/im),
    scale:        num(/^\s*scale:\s*(\d+)/im),
    plugged:      num(/^\s*plugged:\s*(\d+)/im),
    voltageMv:    num(/^\s*voltage:\s*(\d+)/im),
    temperatureC: tempRaw === null ? null : tempRaw / 10,
  };
}

/** `dumpsys SurfaceFlinger` → GLES satırından GPU renderer (Mali-400 tespiti buradan). */
export function parseGlesRenderer(stdout) {
  const m = String(stdout ?? '').match(/GLES:\s*([^\n\r]+)/i);
  if (!m) return { vendor: null, renderer: null, version: null };
  const parts = m[1].split(',').map((s) => s.trim());
  return {
    vendor:   parts[0] ?? null,
    renderer: parts[1] ?? null,
    version:  parts[2] ?? null,
  };
}

/** `df /data` → { totalMb, availableMb } (hem 1K-blocks hem -h çıktısına dayanıklı değil: 1K varsayılır). */
export function parseDfData(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/).filter(Boolean);
  for (const line of lines.slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    const total = Number(cols[1]);
    const avail = Number(cols[3]);
    if (!Number.isFinite(total) || !Number.isFinite(avail)) continue;
    return { totalMb: Math.round(total / 1024), availableMb: Math.round(avail / 1024) };
  }
  return { totalMb: null, availableMb: null };
}

/** `service list` / `dumpsys -l` → servis adı kümesi (küçük harf). */
export function parseServiceList(stdout) {
  const names = new Set();
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    // "12  sensorservice: [android.hardware.ISensorServer]"  |  "  sensorservice"
    const m = line.trim().match(/^(?:\d+\s+)?([A-Za-z0-9_.\-]+)(?::|$)/);
    if (m && m[1] && !/^(found|currently)$/i.test(m[1])) names.add(m[1].toLowerCase());
  }
  return names;
}

/** `id` çıktısı → root mu? (uid=0) */
export function parseIsRoot(stdout) {
  return /uid=0\(/.test(String(stdout ?? ''));
}

/* ────────────────────────────────────────────────────────────────────────────
 * ŞABLON NESNELER
 * ──────────────────────────────────────────────────────────────────────────── */

/** Cihaz yetenek haritası — hangi servis VAR, hangisi YOK (belirsizlik `null` DEĞİL, açıkça false). */
export function createDeviceCapabilities(overrides = {}) {
  return Object.freeze({
    transport:      TRANSPORT_KIND.NONE,
    adb:            false,
    fastboot:       false,
    root:           false,
    androidRelease: null,
    sdk:            null,
    getprop:        false,
    dumpsys:        false,
    logcat:         false,
    gfxinfo:        false,
    sensorservice:  false,
    thermal:        false,
    battery:        false,
    meminfo:        false,
    cpuinfo:        false,
    missing:        [],
    probedAt:       null,
    notes:          [],
    ...overrides,
  });
}

/** Cihaz kimlik kartı. Bilinmeyen alan `null` — "0" veya "" DEĞİL (yalancı kesinlik yok). */
export function createDeviceInfo(overrides = {}) {
  return Object.freeze({
    serial:         null,   // REDAKTE (redactSerial) — ham seri no rapora GİRMEZ
    model:          null,
    manufacturer:   null,
    brand:          null,
    device:         null,
    androidRelease: null,
    sdk:            null,
    buildType:      null,
    abi:            null,
    abiList:        [],
    cpu:            { cores: null, hardware: null, model: null, board: null },
    gpu:            { vendor: null, renderer: null, version: null },
    ramMb:          null,
    storage:        { totalMb: null, availableMb: null },
    display:        { width: null, height: null, density: null, sizeInches: null },
    battery:        { level: null, scale: null, plugged: null, voltageMv: null, temperatureC: null },
    thermalSupport: false,
    adbSupport:     false,
    collectedAt:    null,
    ...overrides,
  });
}

/**
 * Ekran köşegeni (inç) — yoğunluk + piksel biliniyorsa. Bilinmiyorsa null.
 * (density = dpi; inç = sqrt(w²+h²)/dpi)
 */
export function computeScreenInches(width, height, density) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(density) || density <= 0) return null;
  return Math.round((Math.sqrt(width * width + height * height) / density) * 10) / 10;
}
