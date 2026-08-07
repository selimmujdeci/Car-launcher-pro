'use client';

/**
 * AiGatewayAccessCard — Fleet Dashboard · AI ERİŞİM YÖNETİMİ.
 *
 * ── GÜVENLİK MODELİ ────────────────────────────────────────────────────
 *   ETKİN = global ANA ŞALTER  VE  (şirket izni VEYA araç izni)
 *
 * Global bayrak (`feature_flags.mavi_ai_gateway`) tek başına kimseyi AÇMAZ —
 * o tablonun şirket kapsamı yoktur ve oradan açmak herkesi açardı. Bu kart
 * yalnız ŞİRKET KAPSAMLI izni yönetir; ana şalter operatör kararıdır ve
 * buradan DEĞİŞTİRİLEMEZ.
 *
 * Yetki SUNUCUDA zorlanır (owner/admin). Buradaki gizleme yalnız görsel
 * kolaylıktır; güvenlik ona DAYANMAZ. Reddedilen deneme sunucuda DENETİM
 * KÜTÜĞÜNE yazılır.
 *
 * "İzin var" ≠ "AI hazır": sağlayıcı anahtarı yoksa zincir ilk çağrıda düşer.
 * Bu kart bunu AÇIKÇA söyler.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  readAiGatewayAccess, setAiGatewayAccess, aiGatewayResultLabel,
  type AiGatewayAccessRow,
} from '@/lib/fleet/aiGatewayAdmin';

export interface AiGatewayAccessCardProps {
  /** Yönetici mi — buton yalnız görsel olarak gizlenir (güvenlik sunucuda). */
  readonly canManage: boolean;
  /**
   * Kademeli açılış için araç listesi. Boşsa araç bölümü hiç render edilmez
   * (boş bir seçici göstermek "araç yok" ile "liste okunamadı"yı karıştırırdı).
   */
  readonly vehicles?: readonly { readonly id: string; readonly name: string }[];
}

export function AiGatewayAccessCard({ canManage, vehicles = [] }: AiGatewayAccessCardProps) {
  const [row, setRow] = useState<AiGatewayAccessRow | null>(null);
  const [readable, setReadable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const r = await readAiGatewayAccess();
    if (!alive.current) return;
    setRow(r.row);
    setReadable(r.readable);
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => { alive.current = false; };
  }, [refresh]);

  /* ── ARAC KAPSAMLI IZIN ─────────────────────────────────────────────
     Arac izni sirket iznini SESSIZCE GLOBALLESTIRMEZ: ayri bir kayittir ve
     `get_ai_gateway_access` onu ayri sayar. */
  const [vehicleId, setVehicleId] = useState<string>('');

  const toggleVehicle = useCallback(async (next: boolean) => {
    if (vehicleId === '') return;
    setBusy(true);
    setMsg(null);
    const res = await setAiGatewayAccess(
      next, vehicleId, next ? 'fleet_admin_vehicle_grant' : 'fleet_admin_vehicle_revoke');
    if (!alive.current) return;
    setMsg(aiGatewayResultLabel(res));
    setBusy(false);
    if (res === 'GRANTED' || res === 'REVOKED') void refresh();
  }, [vehicleId, refresh]);

  const toggle = useCallback(async (next: boolean) => {
    setBusy(true);
    setMsg(null);
    // Şirket geneli izin (araç kapsamı ayrı bir akıştır).
    const res = await setAiGatewayAccess(next, null, next ? 'fleet_admin_grant' : 'fleet_admin_revoke');
    if (!alive.current) return;
    setMsg(aiGatewayResultLabel(res));
    setBusy(false);
    if (res === 'GRANTED' || res === 'REVOKED') void refresh();
  }, [refresh]);

  const killSwitch = row?.kill_switch_on === true;
  const granted    = row?.company_granted === true;
  const effective  = row?.effective === true;
  const vGrants    = typeof row?.vehicle_grant_count === 'number' ? row.vehicle_grant_count : 0;

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4" data-testid="ai-gateway-access-card">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">AI Erişimi</h3>
        <span className="text-[11px] text-white/40">Şirket kapsamlı · varsayılan kapalı</span>
      </div>

      {readable === null ? (
        <p className="text-sm text-white/40">Okunuyor…</p>
      ) : !readable ? (
        <p className="text-sm text-amber-300/80">
          AI erişim durumu OKUNAMADI — bu &quot;kapalı&quot; demek değildir.
          Oturum veya yetki eksik olabilir.
        </p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Cell label="Etkin" value={effective ? 'EVET' : 'HAYIR'} tone={effective ? 'good' : 'off'} />
            <Cell label="Ana şalter" value={killSwitch ? 'AÇIK' : 'KAPALI'} tone={killSwitch ? 'good' : 'off'} />
            <Cell label="Şirket izni" value={granted ? 'VAR' : 'YOK'} tone={granted ? 'good' : 'off'} />
            <Cell label="Araç izni" value={String(vGrants)} tone="off" />
          </div>

          {/* Ana şalter kapalıysa şirket izni TEK BAŞINA yetmez — dürüstçe söylenir. */}
          {!killSwitch && granted && (
            <p className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/80">
              Şirket izni verilmiş ama <b>global ana şalter kapalı</b> — AI zinciri
              çalışmaz. Ana şalter operatör tarafından açılır; buradan değiştirilemez.
            </p>
          )}

          <p className="mb-3 text-[11px] leading-relaxed text-white/40">
            İzin vermek <b>AI&apos;yı hazır yapmaz</b>: sağlayıcı anahtarı yoksa zincir ilk
            çağrıda düşer. Araç içi CAROS LAB → <i>Yetenek Kapıları</i> ekranı
            &quot;izin&quot; ile &quot;hazır&quot; durumlarını ayrı gösterir.
          </p>

          {canManage ? (
            <button
              type="button"
              data-testid="ai-gateway-toggle"
              disabled={busy}
              onClick={() => void toggle(!granted)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${
                granted
                  ? 'border-red-500/30 bg-red-500/10 text-red-300'
                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              }`}
            >
              {busy ? 'İşleniyor…' : granted ? 'Şirket iznini kaldır' : 'Şirket iznini ver'}
            </button>
          ) : (
            <p className="text-[11px] text-white/30">
              Bu ayarı yalnız şirket sahibi veya yöneticisi değiştirebilir.
            </p>
          )}

          {/* ── ARAC KAPSAMLI IZIN (kademeli acilis) ── */}
          {canManage && vehicles.length > 0 && (
            <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="mb-2 text-[11px] text-white/50">
                Araç bazlı izin — sırayla açmak için (şirket geneli iznini değiştirmez)
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  data-testid="ai-gateway-vehicle-select"
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                  className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white/80"
                >
                  <option value="">Araç seçin…</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  data-testid="ai-gateway-vehicle-grant"
                  disabled={busy || vehicleId === ''}
                  onClick={() => void toggleVehicle(true)}
                  className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 disabled:opacity-40"
                >
                  İzin ver
                </button>
                <button
                  type="button"
                  data-testid="ai-gateway-vehicle-revoke"
                  disabled={busy || vehicleId === ''}
                  onClick={() => void toggleVehicle(false)}
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 disabled:opacity-40"
                >
                  Kaldır
                </button>
              </div>
              <p className="mt-2 text-[10px] text-white/30">
                Araç izni yalnız bu şirketin araçlarına verilebilir; başka şirketin
                aracı sunucu tarafından reddedilir.
              </p>
            </div>
          )}

          {msg && <p className="mt-2 text-[11px] text-white/60">{msg}</p>}
        </>
      )}
    </section>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone: 'good' | 'off' }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${
      tone === 'good'
        ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
        : 'border-white/10 bg-white/5 text-white/70'
    }`}>
      <div className="text-[10px] uppercase tracking-wide opacity-60">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}
