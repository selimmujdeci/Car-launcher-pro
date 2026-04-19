import MainLayout from './components/layout/MainLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { InAppBrowser } from './components/common/InAppBrowser';
import { EditController } from './components/edit/EditController';

function App() {


  return (
    <ErrorBoundary>
      <EditController>
        <MainLayout />
        <InAppBrowser />
      </EditController>
    </ErrorBoundary>
  );
}

export default App;


