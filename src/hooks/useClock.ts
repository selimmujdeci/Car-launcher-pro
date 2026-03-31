import { useState, useEffect } from 'react';

export const DAYS_TR   = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
export const MONTHS_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

function buildTimeStr(d: Date, use24Hour: boolean, showSeconds: boolean): string {
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  if (!use24Hour) {
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return showSeconds ? `${h}:${m}:${s} ${ampm}` : `${h}:${m} ${ampm}`;
  }
  return showSeconds
    ? `${h.toString().padStart(2, '0')}:${m}:${s}`
    : `${h.toString().padStart(2, '0')}:${m}`;
}

function buildDateStr(d: Date): string {
  return `${DAYS_TR[d.getDay()]}, ${d.getDate()} ${MONTHS_TR[d.getMonth()]}`;
}

export function useClock(use24Hour: boolean, showSeconds: boolean) {
  const [time, setTime] = useState(() => buildTimeStr(new Date(), use24Hour, showSeconds));
  const [date, setDate] = useState(() => buildDateStr(new Date()));

  useEffect(() => {
    function tick() {
      const now = new Date();
      setTime(buildTimeStr(now, use24Hour, showSeconds));
      setDate(buildDateStr(now));
    }
    tick();
    const id = setInterval(tick, showSeconds ? 1000 : 10000);
    return () => clearInterval(id);
  }, [use24Hour, showSeconds]);

  return { time, date };
}

export function useAnalogClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return {
    hours:   now.getHours() % 12,
    minutes: now.getMinutes(),
    seconds: now.getSeconds(),
  };
}
