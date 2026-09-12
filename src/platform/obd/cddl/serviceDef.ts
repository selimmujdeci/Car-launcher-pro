/**
 * cddl/serviceDef — P0-VDK-F3B · SERVİS TANIMI → PDU ÜRETİMİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── TEK İŞİ ───────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Bir `ServiceDef` + bir `EcuVariant` + (varsa) bir argümandan **F3-A
 * `DiagnosticPdu`su** üretir.
 *
 * ⚠️ **TAŞIMADAN HABERSİZDİR.** Bu dosya `CarLauncher`ı, ELM327'yi, DoIP'i ya
 * da herhangi bir köprüyü BİLMEZ ve import ETMEZ. Üretilen PDU'yu kimin
 * gönderebileceği `pduTransport`ın sorusudur. Bu ayrım F3'ün tüm amacıdır:
 * yeni bir servis tanımlamak için taşıma katmanına dokunmak GEREKMEZ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── DESTRUCTIVE VARSAYILAN OLARAK REDDEDİLİR ──────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `effect: 'destructive'` bir tanım PDU ÜRETMEZ. Bir tanımın "bu güvenlidir"
 * demesi yetmez: yazma · aktüatör · reset · security yolları ayrı bir Safety
 * Kernel'in işidir ve bu turda AÇILMAMIŞTIR. Reddin sebebi açıkça döner —
 * sessiz eleme, yarın birinin aynı satırı tekrar yazmasına yol açar.
 *
 * SAF: I/O yok · timer yok · `Date.now` yok · global durum yok.
 */

import {
  makePdu, pduTarget, FUNCTIONAL_TARGET,
  type DiagnosticPdu,
} from '../pdu';
import type { EcuVariant, ServiceDef, ServiceArgKind } from './schema';

/* ══════════════════════════════════════════════════════════════════════════
   1) SONUÇ
   ══════════════════════════════════════════════════════════════════════════ */

export type PduBuildRejection =
  /** Servis yazma/aktüatör sınıfında — Safety Kernel'in işi, bu turda KAPALI. */
  | 'DESTRUCTIVE_DENIED'
  /** Servisin gerektirdiği argüman VERİLMEDİ. */
  | 'ARGUMENT_REQUIRED'
  /** Argüman biçimi tanıma UYMUYOR (hex değil / uzunluk yanlış). */
  | 'ARGUMENT_MALFORMED'
  /** ECU bu servisi kullanılabilir servisleri arasında SAYMIYOR. */
  | 'SERVICE_NOT_ON_ECU'
  /** ECU adresi tanınmıyor — istek kurulamaz (uydurma adres YASAK). */
  | 'ECU_NOT_ADDRESSABLE'
  /** Aktif protokol servisin geçerli olduğu sınıflar arasında DEĞİL. */
  | 'PROTOCOL_NOT_APPLICABLE';

export const PDU_BUILD_REJECTION_LABEL: Readonly<Record<PduBuildRejection, string>> = {
  DESTRUCTIVE_DENIED:      'YAZMA/AKTÜATÖR servisi — varsayılan REDDEDİLDİ',
  ARGUMENT_REQUIRED:       'servis argüman İSTER ama verilmedi',
  ARGUMENT_MALFORMED:      'argüman biçimi tanıma UYMUYOR',
  SERVICE_NOT_ON_ECU:      'bu ECU tanımı servisi SAYMIYOR',
  ECU_NOT_ADDRESSABLE:     'ECU adresi tanınmıyor — istek kurulamaz',
  PROTOCOL_NOT_APPLICABLE: 'aktif protokol bu servis için tanımlı DEĞİL',
} as const;

export type PduBuildResult =
  | { readonly ok: true; readonly pdu: DiagnosticPdu }
  | { readonly ok: false; readonly rejection: PduBuildRejection; readonly detail: string };

/* ══════════════════════════════════════════════════════════════════════════
   2) ARGÜMAN KODLAMA
   ══════════════════════════════════════════════════════════════════════════ */

const HEX_RE = /^[0-9A-F]*$/;

/** Argüman biçim kuralları — her tür KENDİ uzunluğunu doğrular. */
function encodeArgument(
  kind: ServiceArgKind, literal: string, argument: string | null,
): { ok: true; payload: string } | { ok: false; rejection: PduBuildRejection; detail: string } {
  switch (kind) {
    case 'literal':
      /* Sabit gövde: çağıranın argümanı YOK SAYILMAZ, REDDEDİLİR — sessizce
         atılan bir argüman, çağıranın sandığından farklı bir istek demektir. */
      if (argument !== null && argument.length > 0) {
        return {
          ok: false, rejection: 'ARGUMENT_MALFORMED',
          detail: 'sabit gövdeli servis argüman KABUL ETMEZ',
        };
      }
      return { ok: true, payload: literal };

    case 'data_identifier': {
      if (argument === null || argument.length === 0) {
        return { ok: false, rejection: 'ARGUMENT_REQUIRED', detail: 'DID/LID kimliği gerekli' };
      }
      const a = argument.toUpperCase();
      /* Servis 22 → 4 hane (2 bayt), servis 21 → 2 hane (1 bayt). */
      if (!HEX_RE.test(a) || (a.length !== 2 && a.length !== 4)) {
        return {
          ok: false, rejection: 'ARGUMENT_MALFORMED',
          detail: `DID/LID 2 ya da 4 hex hane olmalı: "${argument}"`,
        };
      }
      return { ok: true, payload: a };
    }

    case 'status_mask': {
      const a = (argument ?? literal).toUpperCase();
      if (a.length === 0) {
        return { ok: false, rejection: 'ARGUMENT_REQUIRED', detail: 'durum maskesi gerekli' };
      }
      if (!HEX_RE.test(a) || a.length !== 2) {
        return {
          ok: false, rejection: 'ARGUMENT_MALFORMED',
          detail: `durum maskesi 2 hex hane olmalı: "${a}"`,
        };
      }
      return { ok: true, payload: a };
    }

    case 'dtc_record': {
      if (argument === null || argument.length === 0) {
        return { ok: false, rejection: 'ARGUMENT_REQUIRED', detail: 'DTC kaydı gerekli' };
      }
      const a = argument.toUpperCase();
      /* 3 baytlık DTC (6 hane) + 1 baytlık kayıt numarası (2 hane). */
      if (!HEX_RE.test(a) || a.length !== 8) {
        return {
          ok: false, rejection: 'ARGUMENT_MALFORMED',
          detail: `DTC kaydı 8 hex hane olmalı (3 bayt DTC + 1 bayt kayıt): "${a}"`,
        };
      }
      return { ok: true, payload: a };
    }

    default:
      return { ok: false, rejection: 'ARGUMENT_MALFORMED', detail: 'tanınmayan argüman türü' };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   3) PDU ÜRETİMİ
   ══════════════════════════════════════════════════════════════════════════ */

export interface BuildPduInput {
  readonly service: ServiceDef;
  readonly ecu: EcuVariant;
  /** Servise verilecek argüman; `argKind: 'literal'` ise `null`. */
  readonly argument?: string | null;
  /** Ölçülen aktif protokol; bilinmiyorsa `null` (uydurulmaz). */
  readonly protocol?: string | null;
  /** Aktif protokolün sınıfı — `protocolProfile.classifyProtocol` çıktısı. */
  readonly protocolClass?: 'can' | 'kwp' | 'iso9141' | 'j1850' | 'unknown' | null;
}

/**
 * `ServiceDef` + `EcuVariant` → `DiagnosticPdu`.
 *
 * ── SIRA BİLİNÇLİ (en kesin ret önce) ─────────────────────────────────────
 *  1. destructive        → hiçbir koşulda PDU üretilmez
 *  2. ECU servisi saymıyor
 *  3. protokol uygun değil
 *  4. ECU adreslenemez
 *  5. argüman biçimi
 *
 * Fonksiyonel adreslemede (`addressing: 'functional'`) başlıklar `null`dur ve
 * PDU `FUNCTIONAL_TARGET` alır — 7DF yayını tek ECU'ya ait DEĞİLDİR.
 */
export function buildPduFromServiceDef(input: BuildPduInput): PduBuildResult {
  const { service, ecu } = input;

  /* (1) DESTRUCTIVE — pazarlıksız. */
  if (service.effect === 'destructive') {
    return {
      ok: false, rejection: 'DESTRUCTIVE_DENIED',
      detail: `${service.id} (${service.service}) — ${PDU_BUILD_REJECTION_LABEL.DESTRUCTIVE_DENIED}`,
    };
  }

  /* (2) ECU bu servisi saymıyorsa istek KURULMAZ. Tanımın "her ECU her servisi
     destekler" varsayımına düşmesi, kör istek göndermenin veri hâlidir. */
  if (!ecu.serviceRefs.includes(service.id)) {
    return {
      ok: false, rejection: 'SERVICE_NOT_ON_ECU',
      detail: `${ecu.id} tanımı ${service.id} servisini saymıyor`,
    };
  }

  /* (3) Protokol kısıtı — boş liste "kısıt yok" demektir. */
  const pc = input.protocolClass ?? null;
  if (service.protocols.length > 0 && pc !== null && pc !== 'unknown') {
    if (!service.protocols.includes(pc)) {
      return {
        ok: false, rejection: 'PROTOCOL_NOT_APPLICABLE',
        detail: `${service.id} protokolleri [${service.protocols.join(',')}] — aktif: ${pc}`,
      };
    }
  }

  /* (4) Hedef. Fonksiyonel yayın tek ECU'ya ait değildir. */
  const target = ecu.addressing === 'functional'
    ? FUNCTIONAL_TARGET
    : pduTarget(ecu.txHeader.length === 0 ? null : ecu.txHeader,
      ecu.rxHeader.length === 0 ? null : ecu.rxHeader, ecu.name);

  /* `txHeader: ''` (varsayılan oturum adreslemesi) fonksiyonel hedefe düşer —
     native header'a HİÇ dokunmaz. Bu MEVCUT `VehicleEcuDef` davranışıdır. */
  if (target.addressing === 'unknown') {
    return {
      ok: false, rejection: 'ECU_NOT_ADDRESSABLE',
      detail: `${ecu.id} adresi tanınmıyor: "${ecu.txHeader}"`,
    };
  }

  /* (5) Argüman. */
  const arg = encodeArgument(service.argKind, service.literalPayload, input.argument ?? null);
  if (!arg.ok) {
    return { ok: false, rejection: arg.rejection, detail: `${service.id}: ${arg.detail}` };
  }

  return {
    ok: true,
    pdu: makePdu({
      service: service.service,
      subFunction: service.subFunction,
      payload: arg.payload,
      target,
      protocol: input.protocol ?? null,
      /* P0-VDK-F4A — yankı sayısı TANIMDAN gelir. Genel köprü bu sayede
         servis kimliğine göre dal seçmez; yeni servis eklemek VERİ işidir. */
      responseEchoBytes: service.responseEchoBytes,
    }),
  };
}
