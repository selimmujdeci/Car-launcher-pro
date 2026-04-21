import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
  tr: {
    translation: {
      "common": {
        "speed": "HIZ",
        "rpm": "RPM",
        "temp": "SICAKLIK",
        "fuel": "YAKIT",
        "range": "MENZİL",
        "limit": "LİMİT",
        "eta": "VARIŞ",
        "dist": "MESAFE",
        "apps": "UYGULAMALAR",
        "settings": "AYARLAR",
        "phone": "TELEFON",
        "music": "MÜZİK",
        "weather": "HAVA DURUMU",
        "search_placeholder": "Nereye gidiyorsunuz?",
        "no_signal": "Sinyal yok",
        "not_playing": "Müzik çalınmıyor",
        "connected": "Bağlı",
        "not_connected": "Bağlı değil",
        "battery": "BATARYA",
        "ext_temp": "DIŞ SICAKLIK",
        "go": "GİT",
        "map_open": "Harita açık",
        "target_search": "Hedef ara...",
        "motor": "MOTOR",
        "torque": "TORK",
        "mmi_music": "MMI MÜZİK",
        "mmi_apps": "MMI UYGULAMALAR",
        "no_selection": "Seçilmedi",
        "no_track": "Seçili şarkı yok",
        "play": "ÇAL",
        "virtual_cockpit": "AUDI VIRTUAL COCKPIT",
        "engine": "MOTOR",
        "temp_short": "ISIL"
      }
    }
  },
  en: {
    translation: {
      "common": {
        "speed": "SPEED",
        "rpm": "RPM",
        "temp": "TEMP",
        "fuel": "FUEL",
        "range": "RANGE",
        "limit": "LIMIT",
        "eta": "ETA",
        "dist": "DIST",
        "apps": "APPS",
        "settings": "SETTINGS",
        "phone": "PHONE",
        "music": "MUSIC",
        "weather": "WEATHER",
        "search_placeholder": "Where to?",
        "no_signal": "No signal",
        "not_playing": "Not playing",
        "connected": "Connected",
        "not_connected": "Disconnected",
        "battery": "BATTERY",
        "ext_temp": "EXT TEMP",
        "go": "GO",
        "map_open": "Map open",
        "target_search": "Search destination...",
        "motor": "MOTOR",
        "torque": "TORQUE",
        "mmi_music": "MMI MUSIC",
        "mmi_apps": "MMI APPS",
        "no_selection": "None",
        "no_track": "No track selected",
        "play": "PLAY",
        "virtual_cockpit": "AUDI VIRTUAL COCKPIT",
        "engine": "ENGINE",
        "temp_short": "TEMP"
      }
    }
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
