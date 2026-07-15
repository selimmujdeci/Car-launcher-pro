#!/usr/bin/env node
/**
 * fetch-reports.mjs — Destek raporu okuma kapısı (SUPPORT-READ-1 RPC istemcisi).
 *
 * "rapor geldi, kontrol et" → bu script son support_snapshot raporlarını çeker
 * (get_support_reports RPC, token-kapılı) ve OBD/transport/olay-izi/handshake +
 * (varsa) rootCause/verdict bölümlerini formatlı basar.
 *
 * SIR YOK: token bu dosyada DEĞİL. Yerel gitignored `.env.support.local`'dan okunur:
 *   SUPPORT_SECRET=... (SEN koyarsın; sohbete/committe ASLA girmez)
 * SUPABASE URL + anon key `.env`'den okunur.
 *
 * Kullanım:
 *   node scripts/support/fetch-reports.mjs               # son 5 rapor (özet)
 *   node scripts/support/fetch-reports.mjs --limit 3
 *   node scripts/support/fetch-reports.mjs --full        # tüm ham metadata
 *   node scripts/support/fetch-reports.mjs <reportId>    # id (substring) filtre
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function parseEnv(file) {
  const out = {};
  try {
    for (const line of readFileSync(resolve(ROOT, file), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  } catch { /* dosya yoksa boş */ }
  return out;
}

const env    = { ...parseEnv('.env'), ...parseEnv('.env.support.local') };
const URL_   = env.VITE_SUPABASE_URL;
const ANON   = env.VITE_SUPABASE_ANON_KEY;
const SECRET = env.SUPPORT_SECRET;

if (!URL_ || !ANON) { console.error('HATA: .env içinde VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY yok'); process.exit(2); }
if (!SECRET) { console.error('HATA: .env.support.local içinde SUPPORT_SECRET yok (token\'ı oraya koy — sohbete değil).'); process.exit(2); }

const args    = process.argv.slice(2);
const full    = args.includes('--full');
const limIdx  = args.indexOf('--limit');
const limit   = limIdx >= 0 ? parseInt(args[limIdx + 1], 10) || 5 : 5;
const idFilter = args.find((a) => !a.startsWith('--') && a !== String(limit));

function pick(o, path) { return path.split('.').reduce((x, k) => (x == null ? x : x[k]), o); }

function fmtReport(row) {
  const m = row.metadata || {};
  const L = [];
  L.push(`\n╔══ ${row.created_at}  ·  id=${String(row.id).slice(0, 12)}  ·  araç=${row.vehicle_id ?? '?'}`);
  L.push(`║ sürüm=${m.appVersion ?? '?'} (build ${m.versionCode ?? '?'}) · bootId=${m.bootId ?? '?'}`);
  // OBD
  const obd = m.obd || {};
  L.push(`║ OBD: state=${obd.connectionState ?? '?'} · source=${obd.source ?? '?'} · lastSeen=${obd.lastSeenMs ?? '?'}`);
  // Transport
  const tp = m.transport || {};
  L.push(`║ TRANSPORT: ${tp.transport ?? '?'} · connected=${tp.connected ?? '?'} · reconnect=${tp.reconnectAttempts ?? '?'} · lastDisc=${tp.lastDisconnectReason ?? '-'}`);
  // OBD DERİN + handshake (PR-1a yeni APK'da)
  const od = m.obdDeep || {};
  if (od.adapter) L.push(`║ OBD DERİN: source=${od.adapter.source} · quality=${pick(od, 'health.connectionQuality')}% · extended.discovered=${pick(od, 'extended.discovered')}`);
  const hs = od.handshake;
  if (hs) {
    L.push(`║ HANDSHAKE: outcome=${hs.outcome} · timeoutStage=${hs.timeoutStage ?? '-'} · protocolTried=${hs.protocolTried ?? '-'} · protocolActive=${hs.protocolActive ?? '-'}`);
    if (hs.reconnectReason || (hs.reconnectHistory || []).length)
      L.push(`║            reconnectReason=${hs.reconnectReason ?? '-'} · history=[${(hs.reconnectHistory || []).map((r) => r.reason).join(',')}]`);
    // PR-OBD-DIAG-2: PID keşif kanıtı (per-blok outcome + continuation + durma nedeni)
    const de = hs.discoveryEvidence;
    if (de && Array.isArray(de.blocks)) {
      L.push(`║ PID KEŞİF KANITI: durma=${de.finalStopReason} · kanıt=${de.evidenceComplete ? 'TAM' : 'EKSİK'}`);
      for (const b of de.blocks) {
        if (b.outcome === 'NOT_ATTEMPTED') { L.push(`║   ${b.command} · sorgulanmadı (${b.stopReason})`); continue; }
        const bm = b.bitmapBytes ? ` ${b.bitmapBytes}` : (b.responseLength ? ` (${b.responseLength} hane)` : '');
        L.push(`║   ${b.command} · ${b.outcome} · devam ${b.continuation}${bm} · ${b.stopReason}`);
      }
      if (!de.evidenceComplete) L.push(`║   ⚠ Kanıt EKSİK — "desteklenmiyor" sonucu çıkarılamaz`);
    }
  }
  // PR-OBD-DIAG-3: EXTENDED PID POLL KANITI — samples boşsa "neden" (H1/H2/H3 hükmü).
  const epe = od.extendedPollEvidence;
  if (epe) {
    const c = epe.counters || {};
    const j = epe.js || {};
    const dec = epe.decision || {};
    L.push(`║ EXTENDED PID POLL KANITI: ${epe.transport} · Burst ${epe.burstEnabled ? 'AÇIK' : 'KAPALI'} · karar=${dec.code ?? '?'}`);
    L.push(`║   Yapılandırılan: ${epe.configuredPidCount} · Denenen: ${c.attempted ?? '?'} · Başarılı: ${c.success ?? '?'} · Callback: ${c.callbackEmitted ?? '?'}`);
    L.push(`║   NO_DATA: ${c.noData ?? '?'} · Timeout 0/part: ${c.timeoutNoBytes ?? '?'}/${c.timeoutPartial ?? '?'} · Neg: ${c.negativeResponse ?? '?'} · Err: ${c.error ?? '?'} · Busy: ${c.busy ?? '?'}`);
    L.push(`║   Kadans: poll=${c.pollCycles ?? '?'} burst=${c.burstCycles ?? '?'} rr=${c.roundRobinCycles ?? '?'} · maxBurst=${c.maxBurstSizeObserved ?? '?'}`);
    L.push(`║   JS: olay=${j.eventsReceived ?? '?'} · decodeFail=${j.decodeFailures ?? '?'} · saklanan=${j.valuesStored ?? '?'} · cache=${j.valuesCached ?? '?'}`);
    L.push(`║   ⟹ ${dec.label ?? '?'} · Kanıt=${epe.evidenceComplete ? 'TAM' : 'YOK/EKSİK'}`);
    if (Array.isArray(epe.lastAttempts) && epe.lastAttempts.length) {
      const tail = epe.lastAttempts.slice(-4).map((a) => `${a.pid}:${a.outcome}${a.callbackEmitted ? '✓' : ''}`).join(' ');
      L.push(`║   Son denemeler: ${tail}`);
    }
  }
  // PR-OBD-CONN-1: bağlantı yaşam-döngüsü — "Bağlantıyı Sıfırla gerçekten çalıştı mı".
  const cl = od.connLifecycle;
  if (cl) {
    L.push(`║ BAĞLANTI LIFECYCLE: state=${cl.connectionState} · sonPaket=${cl.lastPacketAgeMs < 0 ? '-' : cl.lastPacketAgeMs + 'ms'}`);
    L.push(`║   reset istendi/bitti: ${cl.resetRequestedCount}/${cl.resetCompletedCount} · disconnect: ${cl.disconnectCalledCount} · reconnect: ${cl.reconnectRequestedCount} · sonSebep=${cl.lastResetReason ?? '-'}`);
  }
  // PR-OBD-DATA-1: Mode-22 acquisition — gerçek üretici değeri mi, fail-closed unsupported mu.
  const m22 = od.mode22;
  if (m22) {
    L.push(`║ MODE-22 ACQUISITION: profil=${m22.profileLoaded ? 'YÜKLÜ' : 'YOK'} · izlenen=${m22.watchedCount} · karar=${m22.decision}`);
    L.push(`║   Sorgulanan: ${m22.probed} · Değer: ${m22.supported} · 7F-desteksiz: ${m22.unsupported} · NO_DATA: ${m22.noData} · decodeFail: ${m22.decodeFail} · commErr: ${m22.commError}`);
    if (m22.lastSupportedDid) L.push(`║   ✓ Son gerçek değer: DID ${m22.lastSupportedDid}`);
    if (Array.isArray(m22.lastAttempts) && m22.lastAttempts.length) {
      const tail = m22.lastAttempts.slice(-4).map((a) => `${a.did}@${a.tx}:${a.outcome}${a.valuePresent ? '✓' : ''}`).join(' ');
      L.push(`║   Son denemeler: ${tail}`);
    }
    L.push(`║   ⟹ Kanıt=${m22.evidenceComplete ? 'TAM' : 'EKSİK'}`);
  }
  // DTC
  const dtc = od.dtc || {};
  if (dtc.count != null) L.push(`║ DTC: count=${dtc.count} · lastReadAt=${dtc.lastReadAt ?? '-'}`);
  // Olay izi (lastErrors)
  const errs = Array.isArray(m.lastErrors) ? m.lastErrors : [];
  if (errs.length) {
    L.push(`║ OLAY İZİ (${errs.length}):`);
    errs.slice(0, 12).forEach((e) => L.push(`║   [${e.severity}] ${e.ctx} — ${(e.msg || '').slice(0, 80)}`));
  }
  // errorLedger (yeni)
  if (m.errorLedger) L.push(`║ HATA DEFTERİ: aktif=${m.errorLedger.activeNowCount} · bayat=${m.errorLedger.previousBootCount}`);
  // Root Cause / Verdict (yeni APK)
  if (m.diagnosticVerdict) {
    L.push(`║ ⭐ VERDİKT: ${m.diagnosticVerdict.headline}`);
    (m.diagnosticVerdict.topRootCauses || []).slice(0, 5).forEach((h, i) =>
      L.push(`║   ${i + 1}. [%${h.confidence}] ${h.problem} → ${pick(h, 'codePointer.file') ?? '-'}`));
  } else if (m.triage) {
    L.push(`║ TRİYAJ: ${(m.triage.findings || []).map((f) => `${f.severity}:${f.code}`).join(' · ')}`);
  }
  L.push('╚' + '═'.repeat(70));
  return L.join('\n');
}

const res = await fetch(`${URL_}/rest/v1/rpc/get_support_reports`, {
  method: 'POST',
  headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_secret: SECRET, p_limit: limit }),
});
if (!res.ok) {
  const t = await res.text();
  console.error(`HATA ${res.status}: ${t.slice(0, 300)}`);
  console.error('(401/403 → token yanlış; boş → migration uygulanmadı veya rapor yok)');
  process.exit(1);
}
let rows = await res.json();
if (!Array.isArray(rows)) rows = [];
if (idFilter) rows = rows.filter((r) => String(r.id).includes(idFilter));
if (rows.length === 0) { console.log('Rapor bulunamadı (henüz gönderilmemiş olabilir).'); process.exit(0); }

if (full) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  console.log(`${rows.length} rapor:`);
  for (const r of rows) console.log(fmtReport(r));
  console.log('\n(ham tam metadata için: --full)');
}
