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
      },
      "navigation": {
        "home_starting": "Ev için rota başlatılıyor.",
        "work_starting": "İş için rota başlatılıyor.",
        "home_missing": "Ev adresi kayıtlı değil. Navigasyon ayarlarından ekleyebilirsin.",
        "work_missing": "İş adresi kayıtlı değil. Navigasyon ayarlarından ekleyebilirsin.",
        "destination_invalid": "Kayıtlı konum geçersiz. Lütfen adresi yeniden kaydet.",
        "settings_title": "Ev / İş Adresi",
        "settings_sub": "Sesle \"eve git\" / \"işe git\" için hedef kaydet",
        "settings_home_label": "Ev adresi",
        "settings_work_label": "İş adresi",
        "settings_placeholder": "Adres ara…",
        "settings_use_current_location": "Konumumu kullan",
        "settings_save": "Kaydet",
        "settings_delete": "Sil",
        "settings_not_set": "Ayarlanmadı",
        "settings_saved": "Kaydedildi",
        "settings_saving": "Kaydediliyor…",
        "settings_no_results": "Sonuç bulunamadı",
        "settings_location_unavailable": "Konum alınamadı",
        "nearby_hospital_starting": "En yakın hastane için rota başlatılıyor.",
        "nearby_hospital_none": "Yakınında uygun bir hastane bulunamadı.",
        "nearby_hospital_error": "Hastane araması şu anda tamamlanamadı. Lütfen tekrar dene.",
        "nearby_gps_unavailable": "Konumun alınamadığı için yakındaki hastaneler aranamadı.",
        "nearby_gas_starting": "En yakın benzinlik için rota başlatılıyor.",
        "nearby_gas_none": "Yakınında uygun bir benzinlik bulunamadı.",
        "nearby_gas_error": "Benzinlik araması şu anda tamamlanamadı. Lütfen tekrar dene.",
        "nearby_parking_starting": "En yakın otopark için rota başlatılıyor.",
        "nearby_parking_none": "Yakınında uygun bir otopark bulunamadı.",
        "nearby_parking_error": "Otopark araması şu anda tamamlanamadı. Lütfen tekrar dene.",
        "nearby_rest_area_starting": "En yakın dinlenme tesisi için rota başlatılıyor.",
        "nearby_rest_area_none": "Yakınında bilinen bir dinlenme tesisi bulunamadı.",
        "nearby_rest_area_error": "Dinlenme tesisi araması şu anda tamamlanamadı. Lütfen tekrar dene."
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
      },
      "navigation": {
        "home_starting": "Starting route to home.",
        "work_starting": "Starting route to work.",
        "home_missing": "Home address is not saved. You can add it in navigation settings.",
        "work_missing": "Work address is not saved. You can add it in navigation settings.",
        "destination_invalid": "Saved location is invalid. Please save the address again.",
        "settings_title": "Home / Work Address",
        "settings_sub": "Save a destination for \"go home\" / \"go to work\" by voice",
        "settings_home_label": "Home address",
        "settings_work_label": "Work address",
        "settings_placeholder": "Search address…",
        "settings_use_current_location": "Use my location",
        "settings_save": "Save",
        "settings_delete": "Delete",
        "settings_not_set": "Not set",
        "settings_saved": "Saved",
        "settings_saving": "Saving…",
        "settings_no_results": "No results",
        "settings_location_unavailable": "Location unavailable",
        "nearby_hospital_starting": "Starting navigation to the nearest hospital.",
        "nearby_hospital_none": "No suitable hospital was found nearby.",
        "nearby_hospital_error": "The hospital search could not be completed right now. Please try again.",
        "nearby_gps_unavailable": "Nearby hospitals could not be searched because your location is unavailable.",
        "nearby_gas_starting": "Starting navigation to the nearest gas station.",
        "nearby_gas_none": "No suitable gas station was found nearby.",
        "nearby_gas_error": "The gas station search could not be completed right now. Please try again.",
        "nearby_parking_starting": "Starting navigation to the nearest parking.",
        "nearby_parking_none": "No suitable parking was found nearby.",
        "nearby_parking_error": "The parking search could not be completed right now. Please try again.",
        "nearby_rest_area_starting": "Starting navigation to the nearest rest area.",
        "nearby_rest_area_none": "No known rest area was found nearby.",
        "nearby_rest_area_error": "The rest area search could not be completed right now. Please try again."
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
