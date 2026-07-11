/**
 * index.mjs — Cihaz katmanı girişi + `device.json` üreticisi.
 *
 * KULLANIM
 *   node qa/device/index.mjs            → cihazı yokla, device.json yaz (qa:oem:device-info)
 *
 * KAPSAM (PR-2): transport + yetenek yoklaması + kimlik. **Performans ÖLÇÜLMEZ**,
 * uygulamaya dokunulmaz (install/başlatma yok), sensör/OBD okunmaz. Bunlar
 * PR-3/4/5/6'nın işi.
 *
 * ADB YOKSA: null transport → `device.json` yine üretilir, `status: "SKIPPED_NA"`
 * ile. Hiçbir şey çökmez; hiçbir eksik kanıt "geçti" sayılmaz.
 *
 * İMPORT YAN ETKİSİZ: bu dosyayı import etmek hiçbir komut çalıştırmaz.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTransport } from './interfaces/transport.mjs';
import { probeCapabilities } from './transport/capability-probe.mjs';
import { collectDeviceInfo } from './transport/device-info.mjs';
import { redactDeep } from '../core/redact.mjs';
import { TRANSPORT_KIND } from './types/device-types.mjs';

const DEVICE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = resolve(DEVICE_DIR, '..', '..');

export const DEVICE_SCHEMA_VERSION = 1;

/** Koşu klasörü adı (PR-1 ile aynı biçim: sıralanabilir, dosya-sistemi güvenli). */
export function deviceRunId(date) {
  return date.toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
}

/**
 * Cihazı tara ve device.json gövdesini üret. **Throw etmez.**
 *
 * @param {{env?:object, exec?:Function, exists?:Function, now?:Function,
 *          transport?:object, repoRoot?:string}} opts (hepsi enjekte edilebilir)
 */
export async function scanDevice(opts = {}) {
  const now      = opts.now ?? (() => new Date());
  const repoRoot = opts.repoRoot ?? REPO_ROOT;

  const transport    = opts.transport ?? await createTransport({ env: opts.env, exec: opts.exec, exists: opts.exists });
  const capabilities = await probeCapabilities(transport, { env: opts.env, exists: opts.exists, now });
  const info         = await collectDeviceInfo(transport, capabilities, { now });

  const usable = transport.kind === TRANSPORT_KIND.ADB && transport.available;

  const document = {
    schemaVersion: DEVICE_SCHEMA_VERSION,
    generatedAt:   now().toISOString(),
    // PR-2 yalnız iletişim katmanıdır — tüketiciler bunu açıkça görsün.
    scope: {
      transportOnly:      true,
      performanceMeasured: false,
      sensorsAnalyzed:     false,
      vehicleHalVerified:  false,
    },
    status:    usable ? 'OK' : 'SKIPPED_NA',
    reason:    usable ? null : (transport.reason ?? 'cihaz yok'),
    transport: transport.describe(),
    capabilities,
    device:    info,
  };

  // Son kapı: sır + kişisel/makine yolu redaksiyonu (seri no zaten redakte).
  return Object.freeze(redactDeep(document, repoRoot));
}

/** device.json'u koşu klasörüne yazar; yazılan yolu döner. */
export function writeDeviceJson(outDir, document) {
  mkdirSync(outDir, { recursive: true });
  const target = join(outDir, 'device.json');
  writeFileSync(target, JSON.stringify(document, null, 2), 'utf8');
  return target;
}

/* ── CLI ──────────────────────────────────────────────────────────────────── */

async function main() {
  const now = new Date();
  const doc = await scanDevice({ now: () => now });

  const outDir = join(REPO_ROOT, 'docs-local', 'qa-runs', deviceRunId(now));
  const path   = writeDeviceJson(outDir, doc);

  const d = doc.device;
  if (doc.status === 'OK') {
    console.log(`📱 Cihaz: ${d.manufacturer ?? '—'} ${d.model ?? '—'} · Android ${d.androidRelease ?? '—'} (SDK ${d.sdk ?? '—'})`);
    console.log(`   CPU: ${d.cpu.hardware ?? '—'} (${d.cpu.cores ?? '—'} çekirdek) · GPU: ${d.gpu.renderer ?? '—'}`);
    console.log(`   RAM: ${d.ramMb ?? '—'} MB · Ekran: ${d.display.width ?? '—'}×${d.display.height ?? '—'} @${d.display.density ?? '—'}dpi`);
    console.log(`   Yetenekler eksik: ${doc.capabilities.missing.length > 0 ? doc.capabilities.missing.join(', ') : 'yok'}`);
  } else {
    console.log(`⏭️  SKIPPED_NA — ${doc.reason}`);
    console.log('   (ADB yok → cihaz katmanı kullanılamıyor. Bu bir ÇÖKÜŞ DEĞİL: kanıt boşluğu.)');
  }
  console.log(`\n📄 ${path.replace(REPO_ROOT, 'repo:')}`);

  // Cihaz yokluğu HATA DEĞİLDİR (host-only makinede de koşabilmeli) → exit 0.
  return 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      // Buraya düşülmemeli (public API throw etmez) — düşülürse yine de sessiz ölmeyelim.
      console.error(`💥 Cihaz taraması beklenmedik hata: ${err?.message ?? err}`);
      process.exitCode = 2;
    });
}
