const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/schema');

const router = express.Router();
const CATEGORIES = ['Salary', 'Freelancing', 'Business', 'Investment Returns', 'Other'];

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validate({ description, amount, category, date }, existingCategory) {
  if (typeof description !== 'string' || !description.trim() || description.trim().length > 200) {
    return 'Description is required and must be 200 characters or fewer.';
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 100000000) {
    return 'Amount must be a positive number below 100,000,000.';
  }
  if (!CATEGORIES.includes(category) && category !== existingCategory) return 'Income source is invalid.';
  if (!validDate(date)) return 'Date must use the YYYY-MM-DD format.';
  return null;
}

router.get('/', requireAuth, (req, res) => {
  const { from, to, limit = 100, offset = 0 } = req.query;
  if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) {
    return res.status(400).json({ error: 'Use valid from and to dates in YYYY-MM-DD format.' });
  }
  const parsedLimit = Number(limit);
  const parsedOffset = Number(offset);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000 || !Number.isInteger(parsedOffset) || parsedOffset < 0) {
    return res.status(400).json({ error: 'Limit must be between 1 and 1000 and offset must be zero or greater.' });
  }

  const db = getDb();
  let query = `
    SELECT id, description, amount, category, date, created_at
    FROM income_records WHERE user_id=? AND deleted_at IS NULL
  `;
  const params = [req.user.id];
  if (from) { query += ' AND date >= ?'; params.push(from); }
  if (to) { query += ' AND date <= ?'; params.push(to); }
  query += ' ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?';
  params.push(parsedLimit, parsedOffset);
  const income = db.prepare(query).all(...params);
  let countQuery = 'SELECT COUNT(*) AS count FROM income_records WHERE user_id=? AND deleted_at IS NULL';
  const countParams = [req.user.id];
  if (from) { countQuery += ' AND date >= ?'; countParams.push(from); }
  if (to) { countQuery += ' AND date <= ?'; countParams.push(to); }
  const total = db.prepare(countQuery).get(...countParams).count;
  res.json({ income, total });
});

router.post('/', requireAuth, (req, res) => {
  const record = {
    description: req.body.description,
    amount: req.body.amount,
    category: req.body.category || 'Other',
    date: req.body.date
  };
  const error = validate(record);
  if (error) return res.status(400).json({ error });
  const id = uuidv4();
  getDb().prepare(`
    INSERT INTO income_records (id, user_id, description, amount, category, date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, req.user.id, record.description.trim(), Number(record.amount), record.category, record.date);
  return res.status(201).json({
    income: { id, ...record, description: record.description.trim(), amount: Number(record.amount) }
  });
});

router.put('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare(`
    SELECT id, description, amount, category, date
    FROM income_records WHERE id=? AND user_id=? AND deleted_at IS NULL
  `).get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Income record not found.' });
  const record = {
    description: req.body.description ?? existing.description,
    amount: req.body.amount ?? existing.amount,
    category: req.body.category ?? existing.category,
    date: req.body.date ?? existing.date
  };
  const error = validate(record, existing.category);
  if (error) return res.status(400).json({ error });
  db.prepare(`
    UPDATE income_records SET description=?, amount=?, category=?, date=?, updated_at=datetime('now')
    WHERE id=? AND user_id=? AND deleted_at IS NULL
  `).run(record.description.trim(), Number(record.amount), record.category, record.date, existing.id, req.user.id);
  return res.json({ income: { id: existing.id, ...record, description: record.description.trim(), amount: Number(record.amount) } });
});

router.delete('/:id', requireAuth, (req, res) => {
  const result = getDb().prepare(`
    UPDATE income_records SET deleted_at=datetime('now'), updated_at=datetime('now')
    WHERE id=? AND user_id=? AND deleted_at IS NULL
  `).run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Income record not found.' });
  return res.json({ success: true });
});

module.exports = router;
