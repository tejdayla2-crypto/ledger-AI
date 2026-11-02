// routes/summary.js
// GET /api/summary — dashboard stats, same logic the agent uses

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { get_summary } = require('../agent/executor');
const { getBudgetStatus } = require('../lib/budgetAlerts');

const router = express.Router();

// GET /api/summary?period=this_month&forecast=true
router.get('/', requireAuth, (req, res) => {
  const { period = 'this_month', category, forecast } = req.query;
  const result = get_summary(req.user.id, {
    period,
    category: category || undefined,
    include_forecast: forecast === 'true'
  });
  res.json(result);
});

// GET /api/summary/budgets
router.get('/budgets', requireAuth, (req, res) => {
  res.json(getBudgetStatus(req.user.id));
});

module.exports = router;
