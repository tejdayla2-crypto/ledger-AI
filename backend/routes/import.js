// routes/import.js
// POST /api/import — bulk CSV import
// Frontend sends parsed rows, we validate and insert each one

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { executeTool, categorize } = require('../agent/executor');
const { CATEGORIES } = require('../agent/tools');

const router = express.Router();
const MAX_IMPORT_ROWS = 5000;

function validateRow(row) {
  const description = typeof row.description === 'string' ? row.description.trim() : '';
  const date = typeof row.date === 'string' ? row.date.trim() : '';
  const amount = Number(row.amount);
  const parsedDate = new Date(`${date}T00:00:00Z`);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(parsedDate.getTime())
    && parsedDate.toISOString().slice(0, 10) === date;

  if (!description || description.length > 200) return 'Description is required and must be 200 characters or fewer.';
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) return 'Amount must be a positive number below 100,000,000.';
  if (!validDate) return 'Date must use the YYYY-MM-DD format.';
  if (row.category && !CATEGORIES.includes(row.category)) return 'Category is invalid.';
  return null;
}

function duplicateKey(row) {
  return `${row.date}|${row.description.toLowerCase()}|${Number(row.amount).toFixed(2)}`;
}

// POST /api/import/preview — validate rows before committing
router.post('/preview', requireAuth, (req, res) => {
  const { rows } = req.body; // Array of { date, description, amount }

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No rows provided.' });
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return res.status(413).json({ error: `Import cannot contain more than ${MAX_IMPORT_ROWS} rows.` });
  }

  const seen = new Set();
  const previewed = rows.map((row, i) => {
    const amount = Number(row.amount);
    const validationError = validateRow(row);
    const isDuplicate = !validationError && seen.has(duplicateKey(row));
    if (!validationError) seen.add(duplicateKey(row));

    let category = 'Other';
    let confidence = 0.5;

    if (!validationError && !isDuplicate) {
      const catResult = categorize(req.user.id, { description: row.description });
      category = catResult.category;
      confidence = catResult.confidence;
    }

    return {
      index: i,
      description: row.description || '',
      amount: Number.isFinite(amount) ? amount : null,
      date: row.date || '',
      category,
      confidence,
      error: validationError || (isDuplicate ? 'Duplicate row.' : null)
    };
  });

  const valid = previewed.filter(r => !r.error).length;
  const invalid = previewed.filter(r => r.error).length;

  const duplicates = previewed.filter(row => row.error === 'Duplicate row.').length;
  res.json({ rows: previewed, valid, invalid, duplicates, total: rows.length });
});

// POST /api/import/commit — actually insert the rows
router.post('/commit', requireAuth, (req, res) => {
  const { rows } = req.body;

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No rows to import.' });
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return res.status(413).json({ error: `Import cannot contain more than ${MAX_IMPORT_ROWS} rows.` });
  }

  const results = { success: [], failed: [] };

  for (const row of rows) {
    const validationError = validateRow(row);
    if (validationError) {
      results.failed.push({ row, reason: validationError });
      continue;
    }

    try {
      const result = executeTool(req.user.id, 'add_expense', {
        description: row.description,
        amount: Number(row.amount),
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
