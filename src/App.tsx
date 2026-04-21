import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from './store/useStore';
import MainLayout from './components/layout/MainLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { InAppBrowser } from './components/common/InAppBrowser';
import { EditController } from './components/edit/EditController';
import { LayoutProvider } from './context/LayoutContext';

function App() {
  const { i18n } = useTranslation();
  const language = useStore((s) => s.settings.language);

  // Dil ayarı değiştikçe i18next kütüphanesini tetikle
  useEffect(() => {
    if (i18n.language !== language) {
      i18n.changeLanguage(language);
    }
  }, [language, i18n]);

  return (
    <LayoutProvider>
      <ErrorBoundary>
        <EditController>
          <MainLayout />
          <InAppBrowser />
        </EditController>
      </ErrorBoundary>
    </LayoutProvider>
  );
}

export default App;
