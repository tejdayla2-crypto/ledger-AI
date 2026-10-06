// src/components/dashboard/CategoryChart.jsx
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { CATEGORY_COLORS } from '../../lib/parse';

export default function CategoryChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="chart-card">
        <h3>Spending by Category</h3>
        <div style={{height:'260px', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--ink-muted)'}}>
          No data this month
        </div>
      </div>
    );
  }

  // Filter out tiny slivers (< 2% of total) and group into "Other"
  const total = data.reduce((s, d) => s + d.total, 0);
  let chartData = [];
  let otherTotal = 0;

  data.forEach(d => {
    if (d.total / total < 0.02 && d.category !== 'Other') {
      otherTotal += d.total;
    } else {
      chartData.push(d);
    }
  });

  if (otherTotal > 0) {
    const existingOther = chartData.find(d => d.category === 'Other');
    if (existingOther) existingOther.total += otherTotal;
    else chartData.push({ category: 'Other', total: otherTotal });
  }

  return (
    <div className="chart-card">
      <h3>Spending by Category</h3>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={65}
              outerRadius={95}
              paddingAngle={2}
              dataKey="total"
              nameKey="category"
              stroke="none"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={CATEGORY_COLORS[entry.category] || CATEGORY_COLORS.Other} />
              ))}
            </Pie>
            <Tooltip 
              formatter={(value) => ['₹' + value.toLocaleString('en-IN'), 'Spent']}
              contentStyle={{borderRadius:'8px', border:'none', boxShadow:'var(--shadow-md)'}}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
