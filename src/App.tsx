import MainLayout from './components/layout/MainLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SetupWizard } from './components/modals/SetupWizard';
import { useStore } from './store/useStore';

function App() {
  const { settings } = useStore();

  return (
    <ErrorBoundary>
      {!settings.hasCompletedSetup && <SetupWizard />}
      <MainLayout />
    </ErrorBoundary>
  );
}

export default App;
