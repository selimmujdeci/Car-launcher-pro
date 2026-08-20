'use client';

/**
 * AYARLAR — Kanıt Konsolu dili (#663).
 *
 * ── SÖKÜLEN TİYATRO ───────────────────────────────────────────────────────
 * Bu ekran baştan sona SAHTEYDİ: "Ad Soyad / E-posta / Şirket" alanları
 * sabit yer tutucu metinlerle önceden doldurulmuştu, "Kaydet" düğmesinin
 * hiçbir `onClick`i yoktu, dört bildirim anahtarı `div` idi (tıklanmıyordu
 * bile) ve "Zaman Dilimi / Dil / Sürüm" satırları sabit yazıydı. Kullanıcı
 * kaydettiğini sanıp hiçbir şey kaydetmiyordu.
 *
 * Yerine konan: yalnız GERÇEK olan yollar. Saklanmayan bir tercih için
 * anahtar KONMAZ; nereye gitmesi gerektiği söylenir.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import ConsoleThemeToggle from '@/components/console/ConsoleThemeToggle';
import { PushNotificationWidget } from '@/components/dashboard/PushNotificationWidget';
import { Panel, PanelHead } from '@/components/console/primitives';

export default function SettingsPage() {
  /* Zaman dilimi TARAYICIDAN okunur — sabit "Europe/Istanbul" yazmak,
     başka saat diliminde çalışan kullanıcıya yanlış bilgi vermekti. */
  const [timeZone, setTimeZone] = useState<string | null>(null);
  useEffect(() => {
    try {
      setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone ?? null);
    } catch {
      setTimeZone(null);
    }
  }, []);

  return (
    <div className="flex flex-col gap-3 lg:gap-4 max-w-3xl">
      <Panel>
        <PanelHead title="Görünüm" meta="tercih bu cihazda saklanır" />
        <div className="p-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] text-t1">Gece / Gündüz teması</div>
            <div className="text-[11px] text-t3 mt-1 leading-relaxed">
              Panelin tamamı için geçerlidir. Tarayıcı deposunda tutulur, hesaba
              bağlı DEĞİLDİR — başka cihazda tekrar seçilmesi gerekir.
            </div>
          </div>
          <ConsoleThemeToggle />
        </div>
      </Panel>

      <Panel>
        <PanelHead title="Bildirimler" meta="push kaydı · gerçek" />
        <div className="p-4 flex flex-col gap-3">
          <PushNotificationWidget />
          <p className="cn-num text-[10px] text-t3 leading-relaxed border-t border-hair-soft pt-3">
            AÇIK BORÇ: bildirim türü tercihleri (hız aşımı, yakıt, günlük özet)
            sunucuda saklanmıyor. Saklanmadığı için burada anahtar GÖSTERİLMİYOR —
            kaydetmiyormuş gibi görünen bir anahtar koymak yanlış olurdu.
          </p>
        </div>
      </Panel>

      <Panel>
        <PanelHead title="Hesap ve organizasyon" />
        <div className="p-4 flex flex-col gap-3">
          <p className="text-[12px] text-t2 leading-relaxed">
            Organizasyon adı, üyeler, roller ve yetkiler filo yönetimi altındadır;
            hepsi sunucuda saklanır ve rol matrisine tabidir.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/fleet/settings"
              className="cn-num text-[10px] uppercase tracking-[0.16em] px-3 py-2 border border-hair text-t2 hover:text-t1"
              style={{ borderRadius: 2 }}
            >
              Filo ayarları →
            </Link>
            <Link
              href="/dashboard/fleet/members"
              className="cn-num text-[10px] uppercase tracking-[0.16em] px-3 py-2 border border-hair text-t2 hover:text-t1"
              style={{ borderRadius: 2 }}
            >
              Rol ve yetkiler →
            </Link>
          </div>
          <p className="cn-num text-[10px] text-t3 leading-relaxed border-t border-hair-soft pt-3">
            AÇIK BORÇ: profil alanları (ad soyad, e-posta) için bir yazma ucu YOK.
            Bu ekranda daha önce sahte bir profil formu ve çalışmayan bir
            &quot;Kaydet&quot; düğmesi vardı; sökülmüştür.
          </p>
        </div>
      </Panel>

      <Panel>
        <PanelHead title="Bölge ve sürüm" />
        <dl className="divide-y" style={{ borderColor: 'var(--cn-line-soft)' }}>
          <Row label="Zaman dilimi" value={timeZone} />
          <Row label="Arayüz dili" value="Türkçe" />
          <Row
            label="Uygulama sürümü"
            value={process.env.NEXT_PUBLIC_APP_VERSION ?? null}
            missing="derleme sürümü gömülmedi"
          />
        </dl>
      </Panel>
    </div>
  );
}

function Row({
  label,
  value,
  missing = 'bilinmiyor',
}: {
  label: string;
  value: string | null;
  missing?: string;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <dt className="cn-eyebrow">{label}</dt>
      <dd
        className="cn-num text-[12px]"
        style={{ color: value ? 'var(--cn-text-1)' : 'var(--cn-unknown)' }}
      >
        {value ?? missing}
      </dd>
    </div>
  );
}
