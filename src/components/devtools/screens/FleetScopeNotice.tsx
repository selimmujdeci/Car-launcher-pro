/**
 * FleetScopeNotice — filo ekranlarının YETKİ KAPSAMI bildirimi.
 *
 * SALT-OKUNUR ve VERİSİZ: hiçbir şey okumaz, çağırmaz, başlatmaz. Yalnız
 * `fleetScopeModel`deki ÖLÇÜLMÜŞ olguyu basar.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Beş filo ekranı head unit'te DAİMA boş görünüyordu ve bu "bozuk ekran" gibi
 * okunuyordu. Kök neden ölçülünce başka çıktı: cihazın kullanıcı oturumu yok,
 * ilgili RPC'ler `authenticated` istiyor (biri `anon`'u açıkça REVOKE ediyor).
 * Boşluk BEKLENEN sonuçtur. Bu bileşen o farkı görünür kılar — böylece ekran
 * her turda yeniden "acaba bozuk mu" diye araştırılmaz.
 *
 * ÖNEMLİ: bu bir MAZERET kutusu değildir. `DEVICE_READABLE` yüzeylerde ton
 * YEŞİLDİR ve orada boşluk GERÇEKTEN kusurdur — bileşen bunu da söyler.
 */

import { memo } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import {
  getFleetScope, isEmptinessExpected, fleetScopeTone,
  FLEET_SCOPE_VERDICT_LABEL, type FleetScopeTone,
} from '../../../platform/devtools/fleetScopeModel';

const TONE_STYLE: Record<FleetScopeTone, string> = {
  ok:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  muted: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  warn:  'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

export const FleetScopeNotice = memo(function FleetScopeNotice(
  { surface }: { surface: string },
) {
  const fact = getFleetScope(surface);
  if (fact === null) return null;

  const expected = isEmptinessExpected(fact);
  const tone = fleetScopeTone(fact.verdict);

  return (
    <div
      data-testid={`fleet-scope-${fact.surface}`}
      data-verdict={fact.verdict}
      className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
        <span className={`flex items-center gap-1 rounded border px-1.5 py-0.5 ${TONE_STYLE[tone]}`}>
          {expected ? <Lock size={11} /> : <ShieldCheck size={11} />}
          {FLEET_SCOPE_VERDICT_LABEL[fact.verdict]}
        </span>
        <span className="text-[var(--oem-ink-3)]">OTORİTE: {fact.audience}</span>
      </div>

      <div className="mt-1 grid gap-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
        <span>UÇ: {fact.endpoint ?? '— (public okuma RPC\'si yok)'}</span>
        <span>YETKİ: {fact.grant ?? '—'}</span>
      </div>

      <p className="mt-1 text-[9px] leading-relaxed text-[var(--oem-ink-2)]">{fact.note}</p>

      <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        {expected
          ? 'BU EKRANIN BOŞ OLMASI BEKLENEN SONUÇTUR — kusur değildir. Aşağıdaki alanlar yine de gerçek okunur; veri gelmiyorsa sebebi yetki sınırıdır, sahte değer ÜRETİLMEZ.'
          : 'BU EKRAN BU CİHAZDA VERİ GÖSTERMELİDİR — aşağısı boşsa bu GERÇEK bir kusurdur ve araştırılmalıdır.'}
      </p>
    </div>
  );
});
