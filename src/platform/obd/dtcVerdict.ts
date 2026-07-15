/**
 * dtcVerdict — Fail-Closed DTC tarama verdisi (OBD-OS-F0-1).
 *
 * KÖK NEDEN (denetim P0-1): DTCPanel'in büyük "SİSTEM TEMİZ" verdisi YALNIZ Mode 03
 * (onaylı/stored) kodlarına bakıyordu. Bekleyen (Mode 07), kalıcı (Mode 0A) kod veya
 * yanan MIL varken — ya da bir okuma hata/timeout verip tarama KISMİ kalmışken — kullanıcı
 * yine de "temiz" görüyordu (fail-OPEN). Car Scanner farkının doğrudan UI kaynağı buydu.
 *
 * SÖZLEŞME (fail-CLOSED): "temiz" ANCAK (a) tarama yapıldı, (b) denetlenen HİÇBİR modda
 * bulgu yok VE (c) denetlenen hiçbir mod hata/timeout ile düşmediyse söylenir. Kanıt eksikse
 * sonuç "temiz" DEĞİL, "belirsiz/kısmi"dir. Bu, CLAUDE.md fail-soft + zero-trust yasasının
 * teşhis verdisindeki karşılığıdır (kanıt tam değilse iyi deme).
 *
 * SAF: modül-durumu yok, yan-etki yok — tam unit-test edilebilir (regresyon kilidi).
 * NOT: 'unsupported' (araç/adaptör o modu HİÇ bildirmiyor — ör. Mode 0A 2010 öncesi) bir
 * hata DEĞİLDİR ve `failedModes`'a KONULMAZ; yalnız gerçek okuma hataları belirsizlik yapar.
 */

export type DtcVerdict = 'not_scanned' | 'clean' | 'issues' | 'inconclusive';

/** Denetlenen teşhis modları — 'status' = Mode 01 PID 01 (MIL/DTC sayısı/monitörler). */
export type DtcScanMode = 'stored' | 'pending' | 'permanent' | 'status';

export interface DtcVerdictInput {
  /** En az bir tarama çalıştı mı (dtc.lastReadAt karşılığı). */
  scanRan: boolean;
  /** Mode 03 onaylı/stored kod sayısı. */
  storedCount: number;
  /** Mode 07 bekleyen kod sayısı. */
  pendingCount: number;
  /** Mode 0A kalıcı kod sayısı. */
  permanentCount: number;
  /** Mode 01 PID 01 MIL durumu; null = PID01 okunamadı (bilinmiyor). */
  mil: boolean | null;
  /** Mode 01 PID 01 onaylı DTC sayısı; null = PID01 okunamadı. */
  pid01DtcCount: number | null;
  /** Okuması gerçek HATA/timeout ile düşen modlar (unsupported DEĞİL). */
  failedModes: DtcScanMode[];
}

/**
 * OBD-OS-F1-2 — MIL/DTC TUTARSIZLIĞI: ECU "arıza var" diyor (MIL yanıyor ve/veya PID01
 * onaylı kod sayısı > 0) ama denetlenen HİÇBİR standart modda (03/07/0A) kod YOK.
 *
 * Bu bir çelişki değil, bir BİLGİ: arıza büyük olasılıkla ÜRETİCİ-ÖZEL kod tabanında
 * (Renault DF…, UDS Mode 0x19) duruyor — standart OBD taraması onu GÖREMEZ. Kullanıcıya
 * "kod yok" demek yanlış güven olurdu; "standart tarama yetersiz" demek dürüst olandır.
 * Car Scanner farkının UI'daki ilk somut sinyali; FAZ 3'teki UDS 0x19 işine köprü.
 */
export type DtcAdvisory = 'mil_without_codes';

export interface DtcVerdictResult {
  verdict: DtcVerdict;
  /** UI alt satırı için kısa TR gerekçe. */
  reason: string;
  /** issues durumunda hangi kanıt(lar) tetikledi (UI vurgusu / teşhis için). */
  issueSources: string[];
  /** Bloke etmeyen ama kullanıcıya SÖYLENMESİ gereken tutarsızlıklar (F1-2). */
  advisories: DtcAdvisory[];
}

/**
 * Fail-closed verdi hesaplar. Öncelik: bulgu > belirsizlik > temiz.
 *  - Herhangi bir kanıt (kod/MIL/ECU sayısı) varsa → 'issues' (hata olsa da bulgu bulgudur).
 *  - Bulgu yok ama bir mod düştüyse → 'inconclusive' ("kısmi tarama, kesin değil").
 *  - Yalnız hepsi başarılı + hiç bulgu yoksa → 'clean'.
 */
export function computeDtcVerdict(input: DtcVerdictInput): DtcVerdictResult {
  if (!input.scanRan) {
    return { verdict: 'not_scanned', reason: 'OBD taraması için butona basın.', issueSources: [], advisories: [] };
  }

  const issueSources: string[] = [];
  if (input.storedCount > 0)    issueSources.push('onaylı kod');
  if (input.pendingCount > 0)   issueSources.push('bekleyen kod');
  if (input.permanentCount > 0) issueSources.push('kalıcı kod');
  if (input.mil === true)       issueSources.push('MIL (motor arıza lambası) yanıyor');
  // ECU N onaylı kod bildiriyor ama Mode 03 boş → üretici-özel kod olabilir (Car Scanner farkı).
  // storedCount>0 iken bu zaten "onaylı kod" ile sayıldığından tekrar eklenmez.
  if (input.storedCount === 0 && (input.pid01DtcCount ?? 0) > 0) {
    issueSources.push('ECU onaylı kod sayısı > 0 (üretici kodu olabilir)');
  }

  // F1-2: ECU arıza bildiriyor (MIL ve/veya PID01 sayacı) ama standart modların HİÇBİRİNDE
  // kod yok → kod üretici tabanındadır (UDS 0x19). Yalnız KANIT varken üretilir: MIL/sayaç
  // okunamadıysa (null) sessiz kalınır — uydurma tutarsızlık yok (zero-trust).
  const advisories: DtcAdvisory[] = [];
  const noStandardCodes = input.storedCount === 0 && input.pendingCount === 0 && input.permanentCount === 0;
  const ecuReportsFault = input.mil === true || (input.pid01DtcCount ?? 0) > 0;
  if (noStandardCodes && ecuReportsFault) advisories.push('mil_without_codes');

  if (issueSources.length > 0) {
    return { verdict: 'issues', reason: 'Bulgu: ' + issueSources.join(', ') + '.', issueSources, advisories };
  }

  if (input.failedModes.length > 0) {
    return {
      verdict: 'inconclusive',
      reason: 'Bazı okumalar tamamlanamadı (' + input.failedModes.join(', ') + ') — sonuç kesin değil.',
      issueSources: [],
      advisories,
    };
  }

  return { verdict: 'clean', reason: 'Denetlenen tüm modlar temiz.', issueSources: [], advisories };
}

/** F1-2 uyarısının kullanıcıya gösterilecek metni (UI'da tek kaynak). */
export const DTC_ADVISORY_TEXT: Record<DtcAdvisory, { title: string; body: string }> = {
  mil_without_codes: {
    title: 'Arıza lambası yanıyor ama standart kod yok',
    body: 'Motor ECU’su arıza bildiriyor, fakat standart OBD modlarında (03/07/0A) kod bulunamadı. '
      + 'Arıza büyük olasılıkla ÜRETİCİ-ÖZEL kod tabanındadır (ör. Renault DF…) ve standart tarama bunu göremez. '
      + '“Kod yok” sonucuna güvenmeyin — üretici protokolüyle derin tarama gerekir.',
  },
};
