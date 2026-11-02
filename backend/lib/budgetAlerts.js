const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');

const ALERT_THRESHOLDS = [50, 75, 90, 100];

function getBudgetStatus(userId) {
  const db = getDb();
  const month = new Date().toISOString().slice(0, 7);
  const monthStart = `${month}-01`;
  const today = new Date().toISOString().slice(0, 10);
  const budgets = db.prepare('SELECT * FROM budgets WHERE user_id=? ORDER BY category').all(userId);
  const newAlerts = [];

  const results = budgets.map(budget => {
    const spent = budget.category === 'Overall'
      ? db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
          WHERE user_id=? AND date>=? AND date<=? AND deleted_at IS NULL`).get(userId, monthStart, today).total
      : db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
          WHERE user_id=? AND category=? AND date>=? AND date<=? AND deleted_at IS NULL`)
        .get(userId, budget.category, monthStart, today).total;
    const percentage = +(spent / budget.monthly_limit * 100).toFixed(1);

    for (const threshold of ALERT_THRESHOLDS) {
      if (percentage < threshold) continue;
      const id = uuidv4();
      const inserted = db.prepare(`INSERT OR IGNORE INTO budget_alerts
        (id, user_id, budget_id, month, threshold, spent, monthly_limit)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(id, userId, budget.id, month, threshold, spent, budget.monthly_limit);
      if (inserted.changes) {
        newAlerts.push({
          id,
          category: budget.category,
          threshold,
          spent: +spent.toFixed(2),
          monthly_limit: budget.monthly_limit,
          percentage
        });
      }
    }

    return {
      category: budget.category,
      monthly_limit: budget.monthly_limit,
      spent: +spent.toFixed(2),
      remaining: +(budget.monthly_limit - spent).toFixed(2),
      percentage,
      status: percentage >= 100 ? 'exceeded' : percentage >= 90 ? 'critical' : percentage >= 75 ? 'warning' : 'ok'
    };
  });

  return { budgets: results, new_alerts: newAlerts };
}

module.exports = { ALERT_THRESHOLDS, getBudgetStatus };
