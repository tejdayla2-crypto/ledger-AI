const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/schema');
const {
  createMonthlyReportPdf,
  isValidMonth,
  reportMonth,
  saveMonthlySnapshot,
  shiftMonth
} = require('../lib/monthlyReports');

const router = express.Router();
const currentMonth = () => new Date().toISOString().slice(0, 7);

router.get('/monthly/:month/pdf', requireAuth, (req, res) => {
  const { month } = req.params;
  if (!isValidMonth(month)) return res.status(400).json({ error: 'Month must use the YYYY-MM format.' });
  const report = reportMonth(req.user.id, month);
  if (month < currentMonth()) saveMonthlySnapshot(req.user.id, month);
  const pdf = createMonthlyReportPdf(report);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="ledger-monthly-report-${month}.pdf"`);
  return res.send(pdf);
});

router.get('/monthly', requireAuth, (req, res) => {
  const month = req.query.month || currentMonth();
  if (!isValidMonth(month)) return res.status(400).json({ error: 'Month must use the YYYY-MM format.' });
  const report = reportMonth(req.user.id, month);
  if (month < currentMonth()) {
    const snapshot = saveMonthlySnapshot(req.user.id, month);
    report.generated_at = snapshot?.generated_at || null;
  }
  const availableMonths = getDb().prepare(`SELECT month FROM (
    SELECT DISTINCT strftime('%Y-%m', date) AS month FROM expenses
      WHERE user_id=? AND deleted_at IS NULL
    UNION
    SELECT DISTINCT strftime('%Y-%m', date) AS month FROM income_records
      WHERE user_id=? AND deleted_at IS NULL
    UNION
    SELECT month FROM monthly_report_snapshots WHERE user_id=?
    UNION SELECT ?
  ) WHERE month IS NOT NULL ORDER BY month DESC`)
    .all(req.user.id, req.user.id, req.user.id, currentMonth())
    .map(row => row.month);
  return res.json({ ...report, available_months: availableMonths, previous_month: shiftMonth(month, -1) });
});

module.exports = router;
