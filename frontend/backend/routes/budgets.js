// routes/budgets.js
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { executeTool } = require('../agent/executor');
const { getDb } = require('../db/schema');

const router = express.Router();

// GET /api/budgets
router.get('/', requireAuth, (req, res) => {
  const result = executeTool(req.user.id, 'get_budget_status', {});
  res.json(result);
});

// POST /api/budgets
router.post('/', requireAuth, (req, res) => {
  const { category, monthly_limit } = req.body;
  if (!category || !monthly_limit) return res.status(400).json({ error: 'Category and monthly_limit required.' });
  const result = executeTool(req.user.id, 'set_budget', { category, monthly_limit: parseFloat(monthly_limit) });
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
