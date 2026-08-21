/**
 * FleetDriverAuthenticationScreen — CAROS LAB · Vehicle · DRIVER AUTHENTICATION.
 *
 * Kimlik doğrulama otoritesinin SALT-OKUNUR gözlemi.
 *
 * ── HANGİ SORUYU CEVAPLAR ──────────────────────────────────────────────
 * `Presence History` "varlık nasıl değişti?" der, `Fleet Driver Identity`
 * "şu an kim atandı?" der. Bu ekran farklı bir soruyu cevaplar:
 * **"bu kişi KİMLİĞİNİ doğruladı mı — hangi kanıtla, ne kadar süreyle?"**
 *
 * Bir NFC kartın okunması KARTI kanıtlar, KİŞİYİ değil. Bu yüzden varlık
 * (presence) tek başına `VERY_HIGH` üretemez; `VERY_HIGH` yalnız kimlik
 * doğrulaması + fiziksel varlık birlikteyken mümkündür.
 *
 * YAPMADIKLARI (aktif komut YOK):
 *   · doğrulama üretme/kaydetme · oturum açma/kapatma · PIN sorma
 *   · sürücü seçme · ağ çağrısı · timer/abonelik kurma
 * Açılışta TEK okuma + elle YENİLE.
 *
 * ── GİZLİLİK (BAĞLAYICI) ───────────────────────────────────────────────
 *   · sürücü ADI GÖSTERİLMEZ — yalnız `drv:a1b2c3d4`
 *   · araç kimliği KISALTILIR — `veh:a1b2c3d4`
 *   · **PIN/kart numarası/token/oturum kimliği TAM GÖSTERİLMEZ** (`ses:xxxxxxxx`)
 *   · MUTLAK zaman damgası YOK (yalnız yaş ve kalan süre)
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { FleetScopeNotice } from './FleetScopeNotice';
import {
  RefreshCw, ShieldCheck, ShieldAlert, KeyRound, Clock, Link2, AlertTriangle,
} from 'lucide-react';
import {
  readDriverAuthentication,
  authenticationSourceLabel, authenticationLevelLabel, authenticationDecisionLabel,
  type AuthorityState,
} from '../../../platform/fleet/driverAuthentication';

/* ── OEM tokenlar ──────────────────────────────────────────────────────── */

const OK   = 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]';
const WARN = 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]';
const NONE = 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]';
const INFO = 'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]';

const UNAVAILABLE = 'UNAVAILABLE';

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>
      {children}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--oem-line)] py-1.5 last:border-b-0">
      <span className="text-[12px] text-[var(--oem-ink-3)]">{label}</span>
      <span className="text-[12px] font-mono text-[var(--oem-ink-1)] text-right">{children}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--oem-line)] bg-[var(--oem-surface-1)] p-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--oem-ink-2)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Kimlik referansı — **AD DEĞİL** (ekran görüntüsü paylaşılabilir). */
function shortRef(prefix: string, id: string | null): string {
  if (id === null || id.length === 0) return UNAVAILABLE;
  return `${prefix}:${id.slice(0, 8)}`;
}

/** Süre metni — bilinmiyorsa `UNAVAILABLE` (sahte `0 sn` YOK). */
function durationText(ms: number | null): string {
  if (ms === null) return UNAVAILABLE;
  if (ms < 1_000) return '<1 sn';
  if (ms < 60_000) return `${Math.floor(ms / 1_000)} sn`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} dk`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return m === 0 ? `${h} sa` : `${h} sa ${m} dk`;
}

/** Kalan süre — geçmişse "doldu" (negatif süre GÖSTERİLMEZ). */
function remainingText(expiresAt: number | null, nowMs: number): string {
  if (expiresAt === null) return UNAVAILABLE;
  const left = expiresAt - nowMs;
  return left <= 0 ? 'doldu' : durationText(left);
}

function authorityTone(s: AuthorityState): string {
  switch (s) {
    case 'ACTIVE':   return OK;
    case 'EXPIRED':  return WARN;
    case 'DEGRADED': return WARN;
    case 'UNBOUND':  return NONE;
    case 'IDLE':     return NONE;
  }
}

type Snap = {
  readonly data: ReturnType<typeof readDriverAuthentication> | null;
  readonly readAtMs: number;
};

/** Okuma fail-soft: otorite düşse bile ekran çökmez. */
function readSnap(): Snap {
  const now = Date.now();
  try {
    return { data: readDriverAuthentication(now), readAtMs: now };
  } catch {
    return { data: null, readAtMs: now };
  }
}

function FleetDriverAuthenticationScreenBase() {
  const [snap, setSnap] = useState<Snap | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    const s = readSnap();
    if (!mountedRef.current) return;   // unmount sonrası setState YOK
    setSnap(s);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();                          // açılışta TEK okuma; timer YOK
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const d = snap?.data ?? null;
  const now = snap?.readAtMs ?? 0;
  const auth = d?.authentication ?? null;
  const res = d?.resolution ?? null;

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* YETKİ KAPSAMI: bu ekranın boş olması BEKLENEN mi yoksa KUSUR mu —
          ölçülmüş GRANT gerçeğinden (fleetScopeModel) okunur. */}
      <FleetScopeNotice surface="fleet-driver-authentication" />
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--oem-ink-1)]">
            Driver Authentication
          </h2>
          <p className="text-[11px] text-[var(--oem-ink-3)]">
            Salt-okunur. Doğrulama üretmez, oturum açmaz, ağ çağrısı yapmaz.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex items-center gap-1.5 rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] px-2 py-1 text-[11px] text-[var(--oem-ink-2)]"
        >
          <RefreshCw size={12} /> YENİLE
        </button>
      </div>

      {/* 1 · OTORİTE DURUMU */}
      <Section title="Authority State">
        <div className="flex flex-col">
          <Row label="authorityState">
            {d === null ? <Chip tone={NONE}>{UNAVAILABLE}</Chip> : (
              <Chip tone={authorityTone(d.authorityState)}>
                {d.authorityState === 'ACTIVE'
                  ? <ShieldCheck size={11} className="mr-1" />
                  : <ShieldAlert size={11} className="mr-1" />}
                {d.authorityState}
              </Chip>
            )}
          </Row>
          <Row label="decision">
            {res === null ? UNAVAILABLE : (
              <Chip tone={res.decision === 'AUTHENTICATED' ? OK
                : res.decision === 'NO_AUTHENTICATION' ? NONE : WARN}>
                {authenticationDecisionLabel(res.decision)}
              </Chip>
            )}
          </Row>
          <Row label="reason">{res?.reason ?? UNAVAILABLE}</Row>
          {/* Araç bağı olmadan HİÇBİR doğrulama kabul edilemez. */}
          <Row label="vehicleBinding">
            {d === null ? <Chip tone={NONE}>{UNAVAILABLE}</Chip> : (
              <Chip tone={d.boundVehicleId === null ? NONE : OK}>
                <Link2 size={11} className="mr-1" />
                {d.boundVehicleId === null ? 'UNBOUND' : 'BOUND'}
              </Chip>
            )}
          </Row>
          <Row label="boundVehicleRef">{shortRef('veh', d?.boundVehicleId ?? null)}</Row>
        </div>
      </Section>

      {/* 2 · AKTİF DOĞRULAMA */}
      <Section title="Active Authentication">
        <div className="flex flex-col">
          {/* Sürücü ADI DEĞİL — bounded referans. */}
          <Row label="driverRef">{shortRef('drv', auth?.driverId ?? null)}</Row>
          <Row label="source">
            {auth === null ? UNAVAILABLE : (
              <Chip tone={auth.authenticationSource === 'UNKNOWN' ? NONE : INFO}>
                <KeyRound size={11} className="mr-1" />
                {authenticationSourceLabel(auth.authenticationSource)}
              </Chip>
            )}
          </Row>
          <Row label="level">
            {auth === null ? UNAVAILABLE : (
              <Chip tone={auth.authenticationLevel === 'VERIFIED' ? OK
                : auth.authenticationLevel === 'PARTIAL' ? INFO : NONE}>
                {authenticationLevelLabel(auth.authenticationLevel)}
              </Chip>
            )}
          </Row>
          <Row label="validity">
            {res === null ? UNAVAILABLE : (
              <Chip tone={res.validity === 'VALID' ? OK
                : res.validity === 'UNKNOWN' ? NONE : WARN}>
                {res.validity}
              </Chip>
            )}
          </Row>
          {/* Oturum kimliği TAM GÖSTERİLMEZ — token sızıntısı olurdu. */}
          <Row label="sessionRef">{shortRef('ses', auth?.sessionId ?? null)}</Row>
          <Row label="sessionAge">
            <Chip tone={d?.sessionAgeMs == null ? NONE : INFO}>
              <Clock size={11} className="mr-1" />
              {durationText(d?.sessionAgeMs ?? null)}
            </Chip>
          </Row>
          <Row label="expiresIn">{remainingText(auth?.expiresAt ?? null, now)}</Row>
        </div>
      </Section>

      {/* 3 · KABUL / RET SAYAÇLARI */}
      <Section title="Gate Counters">
        <div className="flex flex-col">
          <Row label="acceptedCount">{d?.acceptedCount ?? UNAVAILABLE}</Row>
          <Row label="rejectedCount">
            {d === null ? UNAVAILABLE : (
              <Chip tone={d.rejectedCount > 0 ? WARN : NONE}>{d.rejectedCount}</Chip>
            )}
          </Row>
          {/* Ret gerekçesi bounded KOD — serbest metin/PII yok. */}
          <Row label="lastRejectReason">
            {d === null || d.lastRejectReason === null ? UNAVAILABLE : (
              <Chip tone={WARN}>
                <AlertTriangle size={11} className="mr-1" />{d.lastRejectReason}
              </Chip>
            )}
          </Row>
          {/* Tekrar (replay) kilidinin hafızası. */}
          <Row label="knownSessionCount">{d?.knownSessionCount ?? UNAVAILABLE}</Row>
          <Row label="lastUpdate">
            {d?.lastUpdateAtMs == null ? UNAVAILABLE
              : `${durationText(Math.max(0, now - d.lastUpdateAtMs))} önce`}
          </Row>
        </div>
      </Section>

      <p className="text-[10px] text-[var(--oem-ink-3)]">
        <strong>Presence ≠ Authentication.</strong> Bir NFC kartın okunması
        <em> kartı</em> kanıtlar, <em>kişiyi</em> değil (kart ödünç verilebilir,
        kopyalanabilir). Bu yüzden fiziksel varlık <strong>tek başına
        VERY_HIGH üretemez</strong>; en yüksek güven yalnız
        <strong> kimlik doğrulaması + fiziksel varlık</strong> birlikteyken
        mümkündür ve iki katman farklı kişiyi gösteriyorsa sonuç
        <strong> fail-closed</strong> olur (sürücü yazılmaz). Nihai hüküm
        <strong> sunucudadır</strong>; bu ekran yalnız cihazdaki otoritenin
        durumunu gösterir ve hiçbir karar vermez.
        <strong> PIN, kart numarası, token ve tam oturum kimliği bu ekrana
        TAŞINMAZ.</strong> NFC/PIN/Bluetooth/telefon üreticisi bağlanmadığı için
        bu cihazda doğrulama <strong>hiç üretilmez</strong> — bu bir eksiklik
        değil, katmanın güvenlik tasarımıdır.
      </p>
    </div>
  );
}

export default memo(FleetDriverAuthenticationScreenBase);
