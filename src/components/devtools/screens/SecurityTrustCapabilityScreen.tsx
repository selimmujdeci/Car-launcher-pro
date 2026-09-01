import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, RefreshCw } from 'lucide-react';
import { getSecurityTrustCapabilityLabModel } from '../../../platform/devtools/securityTrustCapabilityModel';

type Model = ReturnType<typeof getSecurityTrustCapabilityLabModel>;

const CARD = 'rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]';
const HEAD = 'flex items-center gap-2 font-mono text-[11px] font-bold text-[var(--oem-info)]';
const ROW = 'border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[9px] last:border-b-0';

/** Karar sınıfına göre renk — hüküm ÜRETİLMEZ, yalnız mevcut karar boyanır. */
function decisionTone(decision: string): string {
  if (decision === 'ALLOW') return 'text-[var(--oem-ok)]';
  if (decision === 'UNAVAILABLE' || decision === 'NOT_SUPPORTED') return 'text-[var(--oem-ink-3)]';
  return 'text-[var(--oem-warn)]';
}

/**
 * ARCH-05 gözlem yüzeyi — SALT OKUNUR.
 *
 * Yetki VERMEZ, eşleştirme YAPMAZ, komut GÖNDERMEZ, politika EZMEZ. Açılışta
 * TEK okuma yapar; yenileme ELLEDİR (timer ve abonelik YOK). Gösterilen her
 * değer kanonik güvenlik otoritesinden gelir; bu ekran kendi gerçeğini
 * ÜRETMEZ.
 */
export const SecurityTrustCapabilityScreen = memo(function SecurityTrustCapabilityScreen() {
  const mountedRef = useRef(true);
  const [model, setModel] = useState<Model>(() => getSecurityTrustCapabilityLabModel());

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    const next = getSecurityTrustCapabilityLabModel();
    if (mountedRef.current) setModel(next);
  }, []);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="security-trust-capability">
      <div className={`${CARD} px-3 py-2`}>
        <div className="flex items-center justify-between">
          <div className={HEAD}><ShieldCheck size={13} /> SECURITY / TRUST / CAPABILITY — ARCH-05</div>
          <button
            type="button" onClick={refresh} data-testid="security-refresh"
            className="flex items-center gap-1 rounded border border-[var(--oem-line)] px-2 py-0.5 font-mono text-[9px] text-[var(--oem-ink-2)]"
          >
            <RefreshCw size={10} /> YENİLE
          </button>
        </div>
        <p className="mt-1 font-mono text-[9px] text-[var(--oem-ink-3)]">
          SALT OKUNUR. Kimlik, token, VIN, ham telefon verisi veya ham PDU GÖSTERİLMEZ;
          bu ekran hiçbir yetki ÜRETEMEZ ve hiçbir kararı GERİ BESLEMEZ.
        </p>
      </div>

      <div className={`${CARD} px-3 py-2 font-mono text-[9px]`} data-testid="security-context">
        <b>KARAR BAĞLAMI</b>
        <div className="mt-1">
          araç kapsamı: {model.context.vehicleRef ?? 'KAYNAK YOK'} · doğrulanmış hareket: {model.context.motion}
        </div>
        <div className="mt-1 text-[var(--oem-ink-3)]">
          Hareket kanıtı OBD ölçümünden gelir; GPS hızı doğrulanmış hareket YERİNE GEÇMEZ.
          BİLİNMİYOR asla PARK EDİLMİŞ sayılmaz.
        </div>
      </div>

      <div className={CARD} data-testid="security-capabilities">
        <div className={`${ROW} font-bold text-[var(--oem-ink-1)]`}>YETENEK SÖZLEŞMESİ VE ÜRÜN DURUMU</div>
        {model.capabilities.map((c) => (
          <div key={c.id} className={ROW}>
            <b>{c.id}</b> · <span className="text-[var(--oem-info)]">{c.status}</span> · owner: {c.owner} · risk: {c.riskClass}
            <div className="text-[var(--oem-ink-3)]">
              auth: {String(c.requiresAuthenticatedPrincipal)} · session: {String(c.requiresAttachedSession)} ·
              vehicle: {String(c.requiresVehicleScope)} · parked: {String(c.parkedOnly)} · native: {String(c.requiresNativePermission)}
            </div>
          </div>
        ))}
        {model.unmodelled.map((u) => (
          <div key={u.id} className={`${ROW} text-[var(--oem-ink-3)]`}>
            <b>{u.id}</b> · {u.status} — sözleşmede karşılığı YOK (uydurulmadı)
          </div>
        ))}
      </div>

      <div className={CARD} data-testid="security-grants">
        <div className={`${ROW} font-bold text-[var(--oem-ink-1)]`}>ÇAĞIRAN SINIFI → YETKİ</div>
        {model.grants.map((g) => (
          <div key={g.principal} className={ROW}>
            <b>{g.principal}</b>: {g.capabilities.length === 0 ? 'YETKİ YOK' : g.capabilities.join(' · ')}
          </div>
        ))}
      </div>

      <div className={CARD} data-testid="security-decisions">
        <div className={`${ROW} font-bold text-[var(--oem-ink-1)]`}>
          SON ÜRETİM KARARLARI ({model.decisions.length}/40)
        </div>
        {model.decisions.length === 0 && (
          <div className={`${ROW} text-[var(--oem-ink-3)]`}>KAYNAK YOK — bu oturumda güvenlik kararı ölçülmedi.</div>
        )}
        {model.decisions.map((d) => (
          <div key={d.decisionId} className={ROW}>
            <b>{d.capability}</b> · <span className={decisionTone(d.decision)}>{d.decision}</span> · {d.reason}
            <div className="text-[var(--oem-ink-3)]">
              principal: {d.principalRef ?? '—'} · hedef: {d.targetRef ?? '—'} · op: {d.correlationId ?? '—'} ·
              gen: {d.generation ?? '—'} · araç: {d.vehicleRef ?? '—'} · hareket: {d.motionClass} · kaynak: {d.provenance}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
