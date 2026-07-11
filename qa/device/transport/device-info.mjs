/**
 * device-info.mjs — Cihaz kimlik kartı (device.json'un gövdesi).
 *
 * PR-2 kapsamı: **yalnız kimlik**. Hiçbir performans ölçümü yok (FPS/jank/PSS →
 * PR-4), sensör analizi yok (PR-5), Vehicle HAL doğrulaması yok (PR-6).
 *
 * Bilinmeyen alan `null` kalır — asla 0/"" ile doldurulmaz (yalancı kesinlik,
 * sonraki fazların yanlış bütçe seçmesine yol açar: Mali-400'ü Adreno sanmak gibi).
 *
 * Ham seri no dışarı ÇIKMAZ (redactSerial). Fail-soft: her yoklama ayrı; biri
 * düşerse alan `null` kalır, toplama devam eder.
 */
import { OP_STATUS } from '../types/device-types.mjs';
import {
  createDeviceInfo, computeScreenInches,
  parseGetpropDump, parseWmSize, parseWmDensity, parseMemTotalMb,
  parseCpuinfo, parseBattery, parseGlesRenderer, parseDfData,
} from '../types/device-types.mjs';

/** Yoklama başarılıysa stdout, değilse null (throw YOK). */
function out(res) {
  return res && res.status === OP_STATUS.OK ? res.stdout : null;
}

/**
 * Cihaz bilgisi toplar. Transport yoksa/kopuksa **boş ama geçerli** DeviceInfo döner
 * (`adbSupport: false`) — çağıran bunu SKIPPED_NA olarak yorumlar.
 *
 * @param {object} transport  createTransport() çıktısı
 * @param {object} capabilities probeCapabilities() çıktısı (hangi servis var)
 */
export async function collectDeviceInfo(transport, capabilities, { now = () => new Date() } = {}) {
  const collectedAt = now().toISOString();

  if (!transport || !transport.available) {
    return createDeviceInfo({ adbSupport: false, collectedAt });
  }

  // ── getprop tam dökümü: kimlik alanlarının ÇOĞU buradan gelir (tek çağrı) ──
  const propsRes = await transport.shell(['getprop']);
  const props    = parseGetpropDump(out(propsRes) ?? '');

  const p = (key) => props[key] ?? null;

  // ── ekran ──
  const sizeRes    = await transport.shell(['wm', 'size']);
  const densityRes = await transport.shell(['wm', 'density']);
  const size    = parseWmSize(out(sizeRes) ?? '');
  const density = parseWmDensity(out(densityRes) ?? '');

  // ── RAM / CPU / depolama ──
  const memRes = capabilities?.dumpsys !== false
    ? await transport.shell(['cat', '/proc/meminfo'])
    : null;
  const cpuRes = await transport.shell(['cat', '/proc/cpuinfo']);
  const dfRes  = await transport.shell(['df', '/data']);

  const ramMb   = parseMemTotalMb(out(memRes) ?? '');
  const cpu     = parseCpuinfo(out(cpuRes) ?? '');
  const storage = parseDfData(out(dfRes) ?? '');

  // ── GPU (Mali-400 tespiti — düşük-uç bütçe kararlarının temeli) ──
  const sfRes = capabilities?.dumpsys
    ? await transport.shell(['dumpsys', 'SurfaceFlinger'], { timeoutMs: 25_000 })
    : null;
  const gpu = parseGlesRenderer(out(sfRes) ?? '');

  // ── batarya ──
  const batRes = capabilities?.battery
    ? await transport.shell(['dumpsys', 'battery'])
    : null;
  const battery = parseBattery(out(batRes) ?? '');

  const abiList = (p('ro.product.cpu.abilist') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  return createDeviceInfo({
    serial:         transport.serial,              // zaten REDAKTE
    model:          p('ro.product.model'),
    manufacturer:   p('ro.product.manufacturer'),
    brand:          p('ro.product.brand'),
    device:         p('ro.product.device'),
    androidRelease: p('ro.build.version.release') ?? capabilities?.androidRelease ?? null,
    sdk:            Number(p('ro.build.version.sdk')) || capabilities?.sdk || null,
    buildType:      p('ro.build.type'),
    abi:            p('ro.product.cpu.abi'),
    abiList,
    cpu: {
      cores:    cpu.cores,
      hardware: cpu.hardware ?? p('ro.hardware'),
      model:    cpu.model,
      board:    p('ro.product.board') ?? p('ro.board.platform'),
    },
    gpu: {
      vendor:   gpu.vendor,
      renderer: gpu.renderer,
      version:  gpu.version,
    },
    ramMb,
    storage,
    display: {
      width:      size.width,
      height:     size.height,
      density,
      sizeInches: computeScreenInches(size.width, size.height, density),
    },
    battery,
    thermalSupport: Boolean(capabilities?.thermal),
    adbSupport:     true,
    collectedAt,
  });
}
