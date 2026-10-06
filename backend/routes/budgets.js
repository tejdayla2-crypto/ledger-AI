// routes/budgets.js
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { executeTool } = require('../agent/executor');
const { getDb } = require('../db/schema');
const { CATEGORIES } = require('../agent/tools');

const router = express.Router();

// GET /api/budgets
router.get('/', requireAuth, (req, res) => {
  const result = executeTool(req.user.id, 'get_budget_status', {});
  res.json(result);
});

// POST /api/budgets
router.post('/', requireAuth, (req, res) => {
  const { category, monthly_limit } = req.body;
  const limit = Number(monthly_limit);
  if (!CATEGORIES.includes(category) || !Number.isFinite(limit) || limit <= 0 || limit > 100000000) {
    return res.status(400).json({ error: 'A valid category and positive monthly_limit are required.' });
  }
  const result = executeTool(req.user.id, 'set_budget', { category, monthly_limit: limit });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// DELETE /api/budgets/:category
router.delete('/:category', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM budgets WHERE user_id=? AND category=?').run(req.user.id, req.params.category);
  res.json({ success: true });
});

module.exports = router;
