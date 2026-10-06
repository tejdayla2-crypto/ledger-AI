// src/components/dashboard/SpendChart.jsx
import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../../lib/api';

export default function SpendChart({ period, refreshTrigger }) {
  const [data, setData] = useState([]);

  useEffect(() => {
    // Fetch all expenses for the period, then aggregate by day on the client
    // (A real production app would do this in SQL, but this keeps the backend simpler)
    api.get(`/expenses?limit=1000`).then(res => {
      const expenses = res.data.expenses;
      
      // Get current month
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const daysInMonth = new Date(year, now.getMonth() + 1, 0).getDate();
      
      const daily = {};
      for (let i = 1; i <= daysInMonth; i++) {
        daily[`${year}-${month}-${String(i).padStart(2, '0')}`] = 0;
      }
      
      expenses.forEach(exp => {
        if (daily[exp.date] !== undefined) {
          daily[exp.date] += exp.amount;
        }
      });
      
      const chartData = Object.entries(daily).map(([date, amount]) => ({
        day: parseInt(date.split('-')[2]),
        amount: amount
      }));
      
      setData(chartData);
    });
  }, [period, refreshTrigger]);

  return (
    <div className="chart-card">
      <h3>Daily Spend (This Month)</h3>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fill:'var(--ink-faint)', fontSize:12}} />
            <YAxis axisLine={false} tickLine={false} tick={{fill:'var(--ink-faint)', fontSize:12}} />
            <Tooltip 
              cursor={{fill:'var(--paper-warm)'}}
              formatter={(value) => ['₹' + value.toLocaleString('en-IN'), 'Spent']}
              labelFormatter={(day) => `Day ${day}`}
              contentStyle={{borderRadius:'8px', border:'none', boxShadow:'var(--shadow-md)'}}
            />
            <Bar dataKey="amount" fill="var(--ledger)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
