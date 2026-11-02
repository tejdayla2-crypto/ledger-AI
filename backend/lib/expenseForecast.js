function weightedMovingAverage(values) {
  const recent = values.slice(-3);
  if (!recent.length) return 0;
  const firstWeight = 4 - recent.length;
  let weightedTotal = 0;
  let totalWeight = 0;
  recent.forEach((value, index) => {
    const weight = firstWeight + index;
    weightedTotal += value * weight;
    totalWeight += weight;
  });
  return +(weightedTotal / totalWeight).toFixed(2);
}

function forecastExpenses(monthlyRows, categoryRows) {
  const monthMap = new Map(monthlyRows.map(row => [row.month, Number(row.total)]));
  const categories = [...new Set(categoryRows.map(row => row.category))];
  const categoryMap = new Map(categories.map(category => [
    category,
    new Map(categoryRows.filter(row => row.category === category).map(row => [row.month, Number(row.total)]))
  ]));
  const monthValues = monthlyRows.map(row => Number(row.total));
  const predictedCategories = categories.map(category => ({
    category,
    predicted: weightedMovingAverage(monthlyRows.map(row => categoryMap.get(category).get(row.month) || 0))
  })).sort((a, b) => b.predicted - a.predicted);

  let accuracy = null;
  if (monthValues.length >= 6) {
    const errors = [];
    for (let index = Math.max(3, monthValues.length - 3); index < monthValues.length; index++) {
      const predicted = weightedMovingAverage(monthValues.slice(0, index));
      if (monthValues[index] > 0) errors.push(Math.abs(monthValues[index] - predicted) / monthValues[index]);
    }
    if (errors.length) {
      accuracy = +Math.max(0, Math.min(100, 100 * (1 - errors.reduce((sum, error) => sum + error, 0) / errors.length))).toFixed(1);
    }
  }

  return {
    predicted_total: +predictedCategories.reduce((sum, row) => sum + row.predicted, 0).toFixed(2),
    categories: predictedCategories,
    accuracy_pct: accuracy,
    method: 'Three-month weighted moving average',
    history_months: monthlyRows.length,
    monthly_history: monthlyRows.map(row => ({ month: row.month, total: +Number(row.total).toFixed(2) })),
    month_totals: Object.fromEntries(monthMap)
  };
}

module.exports = { weightedMovingAverage, forecastExpenses };
