import React, { useState } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { apiClient } from '../../api/client';

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

  const handleCopyPassword = (password: string) => {
    if (!password) return;
    navigator.clipboard.writeText(password)
      .then(() => alert('Password copied to clipboard!'))
      .catch((err) => console.error('Failed to copy password: ', err));
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 px-4 py-2">
      <h1 className="text-2xl font-bold mb-4 text-textMain">Bulk User Provisioning</h1>
      
      <Card>
        <div className="mb-4">
          <p className="text-textMuted mb-2 text-xs">Upload a CSV file with columns: <code className="text-primary bg-black/30 px-1.5 py-0.5 rounded font-mono">name,email</code></p>
          <input 
            type="file" 
            accept=".csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block w-full text-xs text-textMuted file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
          />
        </div>
        <Button onClick={handleUpload} disabled={!file || loading} isLoading={loading} className="w-full">
          Upload and Provision
        </Button>
      </Card>

      {results.length > 0 && (
        <Card title="Provisioning Results" className="p-0 overflow-hidden">
          <div className="p-4 border-b border-white/5 bg-black/20 flex justify-between items-center">
            <span className="text-success font-medium text-xs">Successfully created {results.length} users</span>
          </div>
          <div className="p-4 space-y-3">
            {results.map((r, i) => (
              <div key={i} className="p-3 bg-black/40 border border-white/5 rounded-lg space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-textMuted">Email</span>
                  <span className="text-textMain font-medium font-mono truncate max-w-[200px]">{r.email}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-textMuted">Temp Password</span>
                  <div className="flex items-center gap-1.5">
                    <code className="text-primary font-mono bg-black/40 px-2 py-0.5 rounded font-semibold">{r.temp_password}</code>
                    <button
                      onClick={() => handleCopyPassword(r.temp_password)}
                      className="px-2 py-0.5 rounded bg-white/5 hover:bg-primary/20 hover:text-primary transition-all text-textMuted font-medium text-[10px]"
                    >
                      Copy
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-textMuted">Status</span>
                  <span className="text-success font-semibold capitalize">{r.status}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};
