// routes/expenses.js
// CRUD for expenses — also used by quick-add form directly

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { executeTool, categorize } = require('../agent/executor');
const { getDb } = require('../db/schema');
const { CATEGORIES } = require('../agent/tools');

const router = express.Router();

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateExpense({ description, amount, category, date }) {
  if (typeof description !== 'string' || !description.trim() || description.trim().length > 200) {
    return 'Description is required and must be 200 characters or fewer.';
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 100000000) {
    return 'Amount must be a positive number below 100,000,000.';
  }
  if (category && !CATEGORIES.includes(category)) return 'Category is invalid.';
  if (date && !validDate(date)) return 'Date must use the YYYY-MM-DD format.';
  return null;
}

// GET /api/expenses — list all expenses for the user
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { category, from, to, sort = 'date', order = 'DESC', limit = 100, offset = 0 } = req.query;

  let query = `SELECT id, description, amount, full_amount, split_count, split_note,
    category, date, ai_confidence, created_at
    FROM expenses WHERE user_id=? AND deleted_at IS NULL`;
  const params = [req.user.id];

  if (category) { query += ' AND category=?'; params.push(category); }
  if (from) { query += ' AND date >= ?'; params.push(from); }
  if (to) { query += ' AND date <= ?'; params.push(to); }

  const sortCol = ['date', 'amount', 'description', 'category', 'created_at'].includes(sort) ? sort : 'date';
  const sortDir = order === 'ASC' ? 'ASC' : 'DESC';
  query += ` ORDER BY ${sortCol} ${sortDir}, created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), parseInt(offset));

  const expenses = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as c FROM expenses WHERE user_id=? AND deleted_at IS NULL').get(req.user.id);

  res.json({ expenses, total: total.c });
});

// POST /api/expenses — quick-add: same logic as add_expense tool
router.post('/', requireAuth, (req, res) => {
  const { description, amount, category, date } = req.body;

  const validationError = validateExpense({ description, amount, category, date });
  if (validationError) return res.status(400).json({ error: validationError });

  // Use the categorize tool if no category given
  let finalCategory = category;
  let confidence = 1.0;
  if (!category) {
    const catResult = categorize(req.user.id, { description });
    finalCategory = catResult.category;
    confidence = catResult.confidence;
  }

  const result = executeTool(req.user.id, 'add_expense', {
    description, amount: parseFloat(amount), category: finalCategory, date
  });

  if (result.error) return res.status(400).json(result);

  // Apply confidence from categorizer
  if (!category) {
    const db = getDb();
    db.prepare('UPDATE expenses SET ai_confidence=? WHERE id=?').run(confidence, result.expense.id);
    result.expense.ai_confidence = confidence;
  }

  res.json(result);
});

// PUT /api/expenses/:id — update an expense
router.put('/:id', requireAuth, (req, res) => {
  const validationError = validateExpense({
    description: req.body.description || 'valid',
    amount: req.body.amount === undefined ? 1 : req.body.amount,
    category: req.body.category,
    date: req.body.date
  });
  if (validationError) return res.status(400).json({ error: validationError });
  const result = executeTool(req.user.id, 'update_expense', {
    expense_id: req.params.id,
    ...req.body
  });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// DELETE /api/expenses/:id
router.delete('/:id', requireAuth, (req, res) => {
  const result = executeTool(req.user.id, 'delete_expense', { expense_id: req.params.id });
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

// POST /api/expenses/undo/:logId — undo a specific action
router.post('/undo/:logId', requireAuth, (req, res) => {
  const db = getDb();
  const log = db.prepare('SELECT * FROM action_log WHERE id=? AND user_id=? AND undone=0').get(req.params.logId, req.user.id);

  if (!log || !log.undo_payload) {
    return res.status(404).json({ error: 'Nothing to undo for this action.' });
  }

  const undoData = JSON.parse(log.undo_payload);

  if (undoData.action === 'delete') {
    // Undo an add: soft-delete the expense
    db.prepare("UPDATE expenses SET deleted_at=datetime('now') WHERE id=? AND user_id=?").run(undoData.expense_id, req.user.id);
  } else if (undoData.action === 'restore') {
    // Undo a delete: restore the expense
    db.prepare("UPDATE expenses SET deleted_at=NULL, description=?, amount=?, category=?, date=? WHERE id=? AND user_id=?")
      .run(undoData.description, undoData.amount, undoData.category, undoData.date, undoData.expense_id, req.user.id);
  }

  db.prepare('UPDATE action_log SET undone=1 WHERE id=?').run(log.id);
  res.json({ success: true, undone: log.description });
});

// GET /api/expenses/action-log — get audit trail
router.get('/action-log', requireAuth, (req, res) => {
  const db = getDb();
  const logs = db.prepare(`
    SELECT id, action_type, description, undone, created_at
    FROM action_log WHERE user_id=? ORDER BY created_at DESC LIMIT 50
  `).all(req.user.id);
  res.json({ logs });
});

module.exports = router;
