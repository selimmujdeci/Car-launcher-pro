/**
 * CapabilityGatesScreen — CAROS LAB · RUNTIME · YETENEK KAPILARI.
 *
 * İki "uyuyan yetenek"in dürüst durumu:
 *   1. AI Gateway — izin var mı · kaynağı ne · sağlayıcı anahtarı var mı
 *   2. Çevrimdışı rota — grafik artefaktı var mı
 *
 * ── NEDEN BU EKRAN VAR ─────────────────────────────────────────────────
 * Bu iki yetenek de kodda TAM yazılmış ama kullanıcıya kapalıydı ve
 * KAPALI OLDUKLARI HİÇBİR YERDE GÖRÜNMÜYORDU. "Neden AI çalışmıyor" ve
 * "neden çevrimdışı rota yok" soruları yalnız kaynak okuyarak
 * yanıtlanabiliyordu. Bu ekran o körlüğü kapatır.
 *
 * YAPMADIKLARI: izin VERMEZ · bayrak ÇEVİRMEZ · ağ çağrısı YAPMAZ ·
 * timer KURMAZ. Açılışta tek okuma + elle YENİLE.
 *
 * GİZLİLİK: API anahtarı GÖSTERİLMEZ — yalnız VAR/YOK.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, KeyRound, ShieldCheck, Route, HelpCircle } from 'lucide-react';
import {
  getGatewayStatus, getGatewayAccessReadAt, getProviderReadinessInfo,
} from '../../../platform/ai/gateway/aiGatewayAccessRuntime';
import {
  gatewaySourceLabel, providerReadinessLabel, providerFailureLabel,
  type AiGatewayStatus, type AiProviderReadinessInfo,
} from '../../../platform/ai/gateway/aiGatewayAccess';
import {
  getOfflineRoutingStatus, offlineGraphStateLabel, offlineRoutingUserMessage,
  type OfflineRoutingStatus,
} from '../../../platform/navigation/offlineRoutingStatus';

const OK   = 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]';
const WARN = 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]';
const NONE = 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]';

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>
      {children}
    </span>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-[color:var(--oem-ink-2)]">{label}</span>
        <span className="font-mono text-[11px] font-semibold">{value}</span>
      </div>
      {note && (
        <p className="mt-0.5 text-[10px] leading-snug text-[color:var(--oem-ink-3)]">{note}</p>
      )}
    </div>
  );
}

export default function CapabilityGatesScreen() {
  const [ai, setAi]     = useState<AiGatewayStatus | null>(null);
  const [readAt, setReadAt] = useState<number | null>(null);
  const [nav, setNav]   = useState<OfflineRoutingStatus | null>(null);
  const [prov, setProv] = useState<AiProviderReadinessInfo | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    let a: AiGatewayStatus | null = null;
    let r: number | null = null;
    let n: OfflineRoutingStatus | null = null;
    try { a = getGatewayStatus(); }        catch { a = null; }
    try { r = getGatewayAccessReadAt(); }  catch { r = null; }
    try { n = getOfflineRoutingStatus(); } catch { n = null; }
    let pv: AiProviderReadinessInfo | null = null;
    try { pv = getProviderReadinessInfo(); } catch { pv = null; }
    if (!mountedRef.current) return;
    setAi(a); setReadAt(r); setNav(n); setProv(pv);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();                       // tek okuma — timer YOK
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const navMsg = nav ? offlineRoutingUserMessage(nav.state) : null;

  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-2 text-[12px] text-[color:var(--oem-ink)]">

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold tracking-wide">
          <ShieldCheck size={13} /> YETENEK KAPILARI
          <span className="text-[10px] font-normal text-[color:var(--oem-ink-3)]">
            · SALT-OKUNUR · KAPI ÇEVİRMEZ
          </span>
        </div>
        <button
          onClick={refresh}
          className="inline-flex items-center gap-1 rounded border border-[var(--oem-line-strong)]
                     bg-[var(--oem-surface-2)] px-2 py-1 text-[11px]"
        >
          <RefreshCw size={11} /> YENİLE
        </button>
      </div>

      {/* ── AI GATEWAY ── */}
      <div className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        <div className="flex items-center gap-1.5 border-b border-[var(--oem-line)] px-2 py-1 text-[11px] font-medium">
          <KeyRound size={11} /> AI GATEWAY
        </div>

        {ai === null ? (
          <div className="px-2 py-3 text-[11px] text-[color:var(--oem-ink-3)]">Okunamadı.</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1 px-2 py-2">
              <Chip tone={ai.ready ? OK : NONE}>
                {ai.ready ? 'HAZIR' : 'HAZIR DEĞİL'}
              </Chip>
              <Chip tone={ai.accessGranted ? OK : NONE}>
                İZİN {ai.accessGranted ? 'VAR' : 'YOK'}
              </Chip>
              <Chip tone={ai.provider === 'CONFIGURED' ? OK : WARN}>
                {providerReadinessLabel(ai.provider)}
              </Chip>
            </div>

            {/* "Açık" ile "hazır" AYRI gösterilir — görev şartı. */}
            {ai.accessGranted && ai.provider !== 'CONFIGURED' && (
              <p className="mx-2 mb-2 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)]
                            px-2 py-1.5 text-[10px] leading-snug text-[color:var(--oem-warn)]">
                İzin VERİLMİŞ ama sağlayıcı anahtarı YOK — sistem <b>AKTİF DEĞİLDİR</b>.
                Zincir ilk çağrıda düşer.
              </p>
            )}

            <Row label="kaynak" value={gatewaySourceLabel(ai.source)}
                 note="İzin nereden geliyor — gizli açılış yoktur." />
            <Row label="ana şalter" value={ai.snapshot.killSwitchOn ? 'AÇIK' : 'KAPALI'}
                 note="feature_flags.mavi_ai_gateway — tek başına kimseyi AÇMAZ." />
            <Row label="şirket izni" value={ai.snapshot.companyGranted ? 'VAR' : 'YOK'} />
            <Row label="araç izni (adet)" value={String(ai.snapshot.vehicleGrantCount)}
                 note="Kademeli açılış: yalnız seçili araçlar." />
            <Row label="sunucu okuması"
                 value={readAt === null ? 'HİÇ OKUNMADI' : new Date(readAt).toLocaleTimeString('tr-TR')}
                 note="Okunmadıysa kapı KAPALIDIR (fail-closed)." />

            {/* SAĞLAYICI HAZIRLIĞI — kaynak · yaş · son hata AYRI görünür. */}
            <Row label="sağlayıcı ölçüm kaynağı"
                 value={prov === null ? 'OKUNAMADI' : prov.source}
                 note="CONFIG_ONLY = yalnız anahtar bakıldı, erişim DENENMEDİ." />
            <Row label="sağlayıcı ölçüm yaşı"
                 value={prov === null || prov.measuredAt === null
                   ? 'ÖLÇÜLMEDİ'
                   : `${Math.max(0, Math.round((Date.now() - prov.measuredAt) / 1000))} sn önce`} />
            <Row label="sağlayıcı son hata"
                 value={prov === null ? 'OKUNAMADI' : providerFailureLabel(prov.lastFailure)}
                 note="Bounded sınıf — ham hata, anahtar veya adres TAŞINMAZ." />
          </>
        )}
      </div>

      {/* ── ÇEVRİMDIŞI ROTA ── */}
      <div className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        <div className="flex items-center gap-1.5 border-b border-[var(--oem-line)] px-2 py-1 text-[11px] font-medium">
          <Route size={11} /> ÇEVRİMDIŞI ROTA
        </div>

        {nav === null ? (
          <div className="px-2 py-3 text-[11px] text-[color:var(--oem-ink-3)]">Okunamadı.</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1 px-2 py-2">
              <Chip tone={nav.usable ? OK : nav.state === 'UNKNOWN' ? NONE : WARN}>
                {offlineGraphStateLabel(nav.state)}
              </Chip>
              <Chip tone={nav.usable ? OK : NONE}>
                {nav.usable ? 'KULLANILABİLİR' : 'KULLANILAMAZ'}
              </Chip>
            </div>

            {navMsg && (
              <p className="mx-2 mb-2 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)]
                            px-2 py-1.5 text-[10px] leading-snug text-[color:var(--oem-warn)]">
                {navMsg}
              </p>
            )}

            <Row label="deneme sayısı" value={String(nav.attemptCount)}
                 note="Kalıcı hatada yeniden denenmez — boşuna worker açılmaz." />
            <Row label="son deneme"
                 value={nav.lastAttemptAt === null ? 'HİÇ' : new Date(nav.lastAttemptAt).toLocaleTimeString('tr-TR')} />
            <Row label="beklenen artefakt" value="/maps/routing-graph.bin"
                 note="Yoksa düz-hat yedeği devreye girer ve AÇIKÇA 'düz hat' diye etiketlenir." />
          </>
        )}
      </div>

      <p className="flex items-start gap-1 px-1 text-[10px] leading-relaxed text-[color:var(--oem-ink-3)]">
        <HelpCircle size={11} className="mt-0.5 shrink-0" />
        <span>
          Bu ekran <b>hiçbir kapıyı çevirmez</b>. AI izni yalnız yetkili yöneticinin
          Filo panosundan verilebilir; çevrimdışı rota grafiği ise bir <b>derleme
          artefaktıdır</b> — uygulama içinden üretilemez. <b>Sahte çevrimdışı
          başarı üretilmez.</b>
        </span>
      </p>
    </div>
  );
}
