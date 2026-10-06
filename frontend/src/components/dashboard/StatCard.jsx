// src/components/dashboard/StatCard.jsx
import { formatINR } from '../../lib/parse';

export default function StatCard({ label, value, subtext, isTextValue = false }) {
  const displayValue = value === undefined || value === null 
    ? '—' 
    : isTextValue 
      ? value 
      : formatINR(value);

  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{displayValue}</div>
      <div className="stat-sub">{subtext}</div>
    </div>
  );
}
