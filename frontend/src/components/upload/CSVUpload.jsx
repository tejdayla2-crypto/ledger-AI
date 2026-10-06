// src/components/upload/CSVUpload.jsx
import { useState, useRef, useEffect } from 'react';
import Papa from 'papaparse';
import api from '../../lib/api';

export default function CSVUpload({ onClose, onImported }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    const handleEscape = (event) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setError(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        // Need to map columns to: date, description, amount
        // Guess columns if possible, or just use the first 3
        const rows = results.data.map(row => {
          const keys = Object.keys(row);
          // Very naive mapping for demo purposes
          const dateKey = keys.find(k => k.toLowerCase().includes('date')) || keys[0];
          const descKey = keys.find(k => k.toLowerCase().includes('desc') || k.toLowerCase().includes('narration')) || keys[1];
          const amtKey = keys.find(k => k.toLowerCase().includes('amount') || k.toLowerCase().includes('debit')) || keys[2];

          return {
            date: row[dateKey],
            description: row[descKey],
            amount: parseFloat(row[amtKey]?.replace(/[^0-9.-]+/g, '')) || 0
          };
        });

        if (rows.length === 0) {
          setError("No data found in CSV");
          return;
        }

        setLoading(true);
        try {
          const res = await api.post('/import/preview', { rows });
          setPreview(res.data);
        } catch (err) {
          setError("Failed to generate preview");
        } finally {
          setLoading(false);
        }
      },
      error: () => setError("Failed to parse CSV file.")
    });
  };

  const handleCommit = async () => {
    if (!preview || preview.valid === 0 || loading) return;
    
    setLoading(true);
    try {
      const validRows = preview.rows.filter(r => !r.error);
      const res = await api.post('/import/commit', { rows: validRows });
      alert(`Imported ${res.data.imported} expenses.`);
      onImported();
    } catch (err) {
      setError("Failed to import rows.");
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content fade-in" role="dialog" aria-modal="true" aria-labelledby="csv-modal-title">
        <div className="modal-header">
          <h2 id="csv-modal-title">Import CSV</h2>
          <button className="btn-icon btn-ghost" onClick={onClose} aria-label="Close CSV import">×</button>
        </div>
        
        <div className="modal-body">
          {error && <div className="form-global-error" style={{marginBottom:'1rem'}}>{error}</div>}

          {!preview ? (
            <div
              className="upload-zone"
              role="button"
              tabIndex="0"
              onClick={() => fileRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') fileRef.current?.click();
              }}
              aria-label="Select a CSV file"
            >
              <h4>Click to select CSV</h4>
              <p>Needs 3 columns: Date, Description, Amount</p>
              <input type="file" accept=".csv" ref={fileRef} onChange={handleFileChange} />
              {loading && <p style={{marginTop:'1rem'}} className="thinking">Analysing file</p>}
            </div>
          ) : (
            <div>
              <div style={{marginBottom:'1rem', display:'flex', gap:'1rem'}}>
                <span className="badge" style={{background:'var(--ledger-tint)', color:'var(--ledger)'}}>
                  {preview.valid} valid rows
                </span>
                {preview.invalid > 0 && (
                  <span className="badge" style={{background:'var(--rust-lt)', color:'var(--rust)'}}>
                    {preview.invalid} errors (will be skipped)
                  </span>
                )}
              </div>
              
              <div style={{maxHeight:'400px', overflowY:'auto', border:'1px solid var(--mist)', borderRadius:'var(--radius)'}}>
                <table className="import-preview-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Amount</th>
                      <th>Assigned Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r, i) => (
                      <tr key={i} className={r.error ? 'error' : ''} title={r.error}>
                        <td>{r.date}</td>
                        <td>{r.description}</td>
                        <td>{r.amount}</td>
                        <td>{r.category} {r.confidence < 0.7 && '?'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        
        {preview && (
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={() => setPreview(null)}>Cancel</button>
            <button 
              className="btn btn-primary" 
              onClick={handleCommit} 
              disabled={loading || preview.valid === 0}
            >
              {loading ? 'Importing...' : `Import ${preview.valid} rows`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
