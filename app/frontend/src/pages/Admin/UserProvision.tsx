import React, { useState } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { apiClient } from '../../api/client';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/Table';

export const UserProvision: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const { data } = await apiClient.post('/users/bulk-provision', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setResults(data.results);
    } catch (e) {
      console.error(e);
      alert('Upload failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold mb-6">Bulk User Provisioning</h1>
      
      <Card>
        <div className="mb-4">
          <p className="text-textMuted mb-2">Upload a CSV file with columns: <code className="text-primary bg-black/30 px-1 rounded">name,email</code></p>
          <input 
            type="file" 
            accept=".csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-textMuted file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
          />
        </div>
        <Button onClick={handleUpload} disabled={!file || loading} isLoading={loading}>
          Upload and Provision
        </Button>
      </Card>

      {results.length > 0 && (
        <Card title="Provisioning Results" className="p-0 overflow-hidden">
          <div className="p-4 border-b border-white/5 bg-black/20 flex justify-between items-center">
            <span className="text-success font-medium">Successfully created {results.length} users</span>
          </div>
          <Table>
            <Thead>
              <Tr>
                <Th>Email</Th>
                <Th>Temporary Password</Th>
                <Th>Status</Th>
              </Tr>
            </Thead>
            <Tbody>
              {results.map((r, i) => (
                <Tr key={i}>
                  <Td>{r.email}</Td>
                  <Td><code className="text-primary font-mono bg-black/40 px-2 py-1 rounded">{r.temp_password}</code></Td>
                  <Td><span className="text-success capitalize">{r.status}</span></Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
      )}
    </div>
  );
};
