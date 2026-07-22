/**
 * validationChecklist — gerçek araçta (Renault Trafic + iCar3 + telefon) izlenecek
 * saha kontrol listesi. SAF veri + saf yardımcılar; IO/saat/servis YOK.
 *
 * ⚠️ Bu liste bir ÖZELLİK DEĞİL, bir PROSEDÜRDÜR: uygulamanın davranışını
 * değiştirmez, hiçbir şey ölçmez, hiçbir komut göndermez. Yalnız teknisyenin
 * hangi adımı yaptığını işaretlemesini sağlar ve rapora dürüst bir "hangi
 * adımlar gerçekten uygulandı" kaydı ekler.
 *
 * NEDEN GEREKLİ: ölçüm otomatik toplanıyor ama ölçümün ANLAMI adımın gerçekten
 * uygulanıp uygulanmadığına bağlı. "0 DTC okundu" kontak açıkken mi, kapalıyken
 * mi? Bu liste olmadan rapor yanıltıcıdır (bkz. CLAUDE.md — sessiz varsayım yasağı).
 */

/** Testin akış fazı — UI gruplaması ve rapor sıralaması. */
export type ValidationPhase = 'hazirlik' | 'baglanti' | 'surus' | 'kapanis';

export interface ValidationChecklistItem {
  readonly id:    string;
  readonly phase: ValidationPhase;
  readonly label: string;
  /** Neden önemli / nasıl doğrulanır — kısa, sabit metin. */
  readonly hint:  string;
}

export const PHASE_LABEL: Readonly<Record<ValidationPhase, string>> = Object.freeze({
  hazirlik: '1 · Hazırlık (motor kapalı)',
  baglanti: '2 · Bağlantı (kontak açık)',
  surus:    '3 · Sürüş',
  kapanis:  '4 · Kapanış',
});

/**
 * Trafic + iCar3 saha doğrulama adımları — SIRALI.
 * Liste bilinçli olarak KISA tutuldu: sürüş sırasında okunabilir olmalı.
 */
export const FIELD_CHECKLIST: readonly ValidationChecklistItem[] = Object.freeze([
  /* ── 1. Hazırlık ─────────────────────────────────────────────────────── */
  {
    id: 'prep_adapter', phase: 'hazirlik',
    label: 'iCar3 OBD soketine takıldı',
    hint:  'Adaptör LED\'i yanmalı. Soket direksiyon altında.',
  },
  {
    id: 'prep_bt', phase: 'hazirlik',
    label: 'Telefonda Bluetooth ve konum izni verildi',
    hint:  'İzin yoksa tarama boş döner — "cihaz bulunamadı" bundan olur.',
  },
  {
    id: 'prep_validation_on', phase: 'hazirlik',
    label: 'Validation Mode açıldı ve KAYIT başlatıldı',
    hint:  'Kayıt başlamadan yapılan hiçbir şey rapora girmez.',
  },

  /* ── 2. Bağlantı ─────────────────────────────────────────────────────── */
  {
    id: 'conn_ignition', phase: 'baglanti',
    label: 'Kontak açıldı (motor çalışır konumda)',
    hint:  'Motor kapalıyken ECU susar — bu ARIZA DEĞİLDİR, rapor yanlış okunur.',
  },
  {
    id: 'conn_paired', phase: 'baglanti',
    label: 'OBD bağlantısı kuruldu (durum: connected)',
    hint:  'Bağlantı süresi ve protokol rapora otomatik yazılır.',
  },
  {
    id: 'conn_dtc_scan', phase: 'baglanti',
    label: 'Arıza kodu taraması çalıştırıldı (çoklu ECU)',
    hint:  'ECU sayısı YALNIZ bu tarama çalışınca rapora girer.',
  },

  /* ── 3. Sürüş ────────────────────────────────────────────────────────── */
  {
    id: 'drive_idle', phase: 'surus',
    label: 'Rölantide en az 2 dakika beklendi',
    hint:  'Polling kadansı ve veri boşluğu taban ölçümü.',
  },
  {
    id: 'drive_moving', phase: 'surus',
    label: 'En az 10 dakika gerçek sürüş yapıldı',
    hint:  'Hız/RPM göstergesi takılıyor mu, bağlantı kopuyor mu.',
  },
  {
    id: 'drive_mavi', phase: 'surus',
    label: 'Mavi\'ye en az bir araç sorusu soruldu',
    hint:  'Mavi bölümü boşsa "çağrı yapılmadı" olarak raporlanır.',
  },
  {
    id: 'drive_tunnel', phase: 'surus',
    label: 'Sinyalsiz/tünel veya park altı bölge denendi',
    hint:  'Çevrimdışı davranış ve yeniden bağlanma gözlemi.',
  },

  /* ── 4. Kapanış ──────────────────────────────────────────────────────── */
  {
    id: 'close_stop', phase: 'kapanis',
    label: 'Kontak kapatıldı, kopma davranışı gözlendi',
    hint:  'Kontak kapanınca ECU susar — sahte "arıza" raporlanmamalı.',
  },
  {
    id: 'close_export', phase: 'kapanis',
    label: 'Validation Summary üretildi ve rapor dışa aktarıldı',
    hint:  'Rapor alınmadan oturum kapatılırsa veriler kaybolur.',
  },
]);

/** Tüm adım kimlikleri (allowlist — bilinmeyen id kabul edilmez). */
const VALID_IDS: ReadonlySet<string> = new Set(FIELD_CHECKLIST.map((i) => i.id));

/** Verilen id listede var mı — fail-closed doğrulama. */
export function isChecklistId(id: string): boolean {
  return VALID_IDS.has(id);
}

/** Faza göre gruplanmış adımlar — SAF, UI sıralaması için. */
export function checklistByPhase(): ReadonlyArray<{
  phase: ValidationPhase;
  items: readonly ValidationChecklistItem[];
}> {
  const phases: ValidationPhase[] = ['hazirlik', 'baglanti', 'surus', 'kapanis'];
  return phases.map((phase) => ({
    phase,
    items: FIELD_CHECKLIST.filter((i) => i.phase === phase),
  }));
}

/** İlerleme özeti — SAF. Bilinmeyen id'ler sayılmaz (fail-closed). */
export function checklistProgress(doneIds: readonly string[]): {
  done: number; total: number; pct: number;
} {
  const total = FIELD_CHECKLIST.length;
  const seen = new Set<string>();
  for (const id of doneIds) if (VALID_IDS.has(id)) seen.add(id);
  const done = seen.size;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}
