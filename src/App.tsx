import MainLayout from './components/layout/MainLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { InAppBrowser } from './components/common/InAppBrowser';
import { EditController } from './components/edit/EditController';
import { LayoutProvider } from './context/LayoutContext';

function App() {
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


