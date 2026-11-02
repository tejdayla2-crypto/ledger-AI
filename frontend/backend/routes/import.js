// routes/import.js
// POST /api/import — bulk CSV import
// Frontend sends parsed rows, we validate and insert each one

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { executeTool, categorize } = require('../agent/executor');
const { getDb } = require('../db/schema');

const router = express.Router();

// POST /api/import/preview — validate rows before committing
router.post('/preview', requireAuth, (req, res) => {
  const { rows } = req.body; // Array of { date, description, amount }

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No rows provided.' });
  }

  const previewed = rows.slice(0, 200).map((row, i) => {
    const amount = parseFloat(row.amount);
    const hasError = !row.description || isNaN(amount) || amount <= 0 || !row.date;

    let category = 'Other';
    let confidence = 0.5;

    if (!hasError) {
      const catResult = categorize(req.user.id, { description: row.description });
      category = catResult.category;
      confidence = catResult.confidence;
    }

    return {
      index: i,
      description: row.description || '',
      amount: isNaN(amount) ? null : amount,
      date: row.date || '',
      category,
      confidence,
      error: hasError ? 'Missing or invalid description, amount, or date' : null
    };
  });

  const valid = previewed.filter(r => !r.error).length;
  const invalid = previewed.filter(r => r.error).length;

  res.json({ rows: previewed, valid, invalid, total: rows.length });
});

// POST /api/import/commit — actually insert the rows
router.post('/commit', requireAuth, (req, res) => {
  const { rows } = req.body;

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No rows to import.' });
  }

  const results = { success: [], failed: [] };

  for (const row of rows) {
    if (!row.description || !row.amount || !row.date) {
      results.failed.push({ row, reason: 'Missing fields' });
      continue;
    }

    try {
      const result = executeTool(req.user.id, 'add_expense', {
        description: row.description,
        amount: parseFloat(row.amount),
        date: row.date,
        category: row.category || 'Other'
      });

      if (result.error) {
        results.failed.push({ row, reason: result.error });
      } else {
        results.success.push(result.expense);
      }
    } catch (e) {
      results.failed.push({ row, reason: e.message });
    }
  }

  res.json({
    imported: results.success.length,
    failed: results.failed.length,
    success: results.success,
    errors: results.failed
  });
});

module.exports = router;
