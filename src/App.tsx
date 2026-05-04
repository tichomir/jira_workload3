import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { WorkloadCard } from './ui/components/WorkloadCard';
import { ConnectionsList } from './ui/pages/ConnectionsList';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/connections" element={<ConnectionsPage />} />
        <Route path="*" element={<Navigate to="/connections" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

function ConnectionsPage() {
  return (
    <main style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '32px', padding: '48px 16px' }}>
      <WorkloadCard />
      <ConnectionsList />
    </main>
  );
}
