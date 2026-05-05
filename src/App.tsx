import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { WorkloadCard } from './ui/components/WorkloadCard';
import { ConnectionsList } from './ui/pages/ConnectionsList';
import { InventorySidebar, type SidebarObjectType } from './ui/components/InventorySidebar';
import { ObjectExplorer } from './ui/components/ObjectExplorer';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/connections" element={<ConnectionsPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
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

interface ConnectionSummary {
  connectionId: string;
  siteName: string;
}

function InventoryPage() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [siteName, setSiteName] = useState<string>('');
  const [selectedType, setSelectedType] = useState<SidebarObjectType>('Issue');
  const [backupPointId, setBackupPointId] = useState<string | null>(null);
  const [loadingConn, setLoadingConn] = useState(true);

  useEffect(() => {
    fetch('/api/connections')
      .then((r) => r.ok ? r.json() : Promise.resolve([]))
      .then((data: ConnectionSummary[]) => {
        if (data.length > 0) {
          setConnectionId(data[0].connectionId);
          setSiteName(data[0].siteName);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingConn(false));
  }, []);

  if (loadingConn) {
    return (
      <main style={{ padding: '48px 16px', color: '#6b778c', fontSize: '14px' }}>
        Loading…
      </main>
    );
  }

  if (!connectionId) {
    return (
      <main style={{ padding: '48px 16px' }}>
        <p style={{ color: '#6b778c', fontSize: '14px' }}>
          No connection found.{' '}
          <a href="/connections" style={{ color: '#0052cc' }}>Connect a Jira site</a> first.
        </p>
      </main>
    );
  }

  return (
    <main style={{ display: 'flex', gap: '24px', padding: '32px 24px', alignItems: 'flex-start' }}>
      <InventorySidebar
        connectionId={connectionId}
        selectedType={selectedType}
        onSelect={setSelectedType}
        onInventoryLoad={(d) => setBackupPointId(d.backupPointId)}
      />
      <ObjectExplorer
        connectionId={connectionId}
        backupPointId={backupPointId}
        selectedType={selectedType}
        siteName={siteName}
      />
    </main>
  );
}

