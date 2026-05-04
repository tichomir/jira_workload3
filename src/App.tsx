import { useEffect, useState } from 'react';
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
  const [hasConnections, setHasConnections] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/connections')
      .then((r) => r.ok ? r.json() : Promise.resolve([]))
      .then((data: unknown[]) => setHasConnections(data.length > 0))
      .catch(() => setHasConnections(false));
  }, []);

  return (
    <main style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '32px', padding: '48px 16px' }}>
      {hasConnections === false && <WorkloadCard />}
      <ConnectionsList />
    </main>
  );
}
