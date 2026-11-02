// agent/executor.js
// This is where tool calls become REAL database actions.
//
// When Gemini says "call add_expense({description:'lunch', amount:350})"
// THIS FILE actually runs that against the database and returns the real result.
//
// The AI NEVER does math here. We do all calculations, the AI just reads results.

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const { CATEGORIES } = require('./tools');

// Helper: today's date as YYYY-MM-DD
function today() {
  return new Date().toISOString().split('T')[0];
}

// Helper: get start date of a period
function periodStart(period) {
  const now = new Date();
  switch (period) {
    case 'today':
      return today();
    case 'this_week': {
      const d = new Date(now);
      d.setDate(d.getDate() - d.getDay());
      return d.toISOString().split('T')[0];
    }
    case 'this_month':
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    case 'last_month': {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return d.toISOString().split('T')[0];
    }
    case 'last_7_days': {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return d.toISOString().split('T')[0];
    }
    case 'last_30_days': {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      return d.toISOString().split('T')[0];
    }
    case 'all_time':
      return '2000-01-01';
    default:
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  }
}

function periodEnd(period) {
  const now = new Date();
  if (period === 'last_month') {
    const d = new Date(now.getFullYear(), now.getMonth(), 0);
    return d.toISOString().split('T')[0];
  }
  return today();
}

// ─────────────────────────────────────────────
// Tool: add_expense
// ─────────────────────────────────────────────
function add_expense(userId, args) {
  const db = getDb();
  const { description, amount, date: d, category, split_count = 1, split_note = null } = args;

  if (!description || !amount || amount <= 0) {
    return { error: 'Description and a positive amount are required.' };
  }

  const expenseDate = d || today();
  const userAmount = split_count > 1 ? +(amount / split_count).toFixed(2) : amount;
  const expenseId = uuidv4();

  db.prepare(`
    INSERT INTO expenses (id, user_id, description, amount, full_amount, split_count, split_note, category, date, ai_confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(expenseId, userId, description, userAmount, amount, split_count, split_note, category || 'Other', expenseDate, 0.9);

  // Log the action for undo
  const logId = uuidv4();
  db.prepare(`
    INSERT INTO action_log (id, user_id, action_type, description, payload, undo_payload)
    VALUES (?, ?, 'add_expense', ?, ?, ?)
  `).run(
    logId, userId,
    `Added: ${description} — ₹${userAmount}${split_count > 1 ? ` (your share of ₹${amount})` : ''} · ${category}`,
    JSON.stringify({ expense_id: expenseId, description, amount: userAmount, category, date: expenseDate }),
    JSON.stringify({ action: 'delete', expense_id: expenseId })
  );

  // Check budget after adding
  const budgetWarning = checkBudget(userId, category);

  return {
    success: true,
    expense: { id: expenseId, description, amount: userAmount, full_amount: amount, category, date: expenseDate, split_count, split_note },
    action_log: { id: logId, description: `Added: ${description} — ₹${userAmount} · ${category}`, created_at: new Date().toISOString() },
    budget_warning: budgetWarning
  };
}

// ─────────────────────────────────────────────
// Tool: update_expense
// ─────────────────────────────────────────────
function update_expense(userId, args) {
  const db = getDb();
  const { expense_id, description, amount, category, date } = args;

  const existing = db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(expense_id, userId);
  if (!existing) return { error: 'Expense not found.' };

  // Save undo data before modifying
  const undoData = {
    action: 'restore',
    expense_id,
    description: existing.description,
    amount: existing.amount,
    category: existing.category,
    date: existing.date
  };

  const newDesc = description || existing.description;
  const newAmount = amount || existing.amount;
  const newCat = category || existing.category;
  const newDate = date || existing.date;

  db.prepare(`
    UPDATE expenses SET description=?, amount=?, category=?, date=?, updated_at=datetime('now')
    WHERE id=? AND user_id=?
  `).run(newDesc, newAmount, newCat, newDate, expense_id, userId);

  // Save correction memory if category changed
  if (category && category !== existing.category) {
    const pattern = existing.description.toLowerCase().split(' ')[0]; // first word
    db.prepare(`
      INSERT OR REPLACE INTO category_mappings (id, user_id, description_pattern, category)
      VALUES (?, ?, ?, ?)
    `).run(uuidv4(), userId, pattern, category);
  }

  const logId = uuidv4();
  db.prepare(`
    INSERT INTO action_log (id, user_id, action_type, description, payload, undo_payload)
    VALUES (?, ?, 'update_expense', ?, ?, ?)
  `).run(
    logId, userId,
    `Updated: ${newDesc} — ₹${newAmount} · ${newCat}`,
    JSON.stringify({ expense_id, description: newDesc, amount: newAmount, category: newCat }),
    JSON.stringify(undoData)
  );

  return {
    success: true,
    expense: { id: expense_id, description: newDesc, amount: newAmount, category: newCat, date: newDate },
    action_log: { id: logId, description: `Updated: ${newDesc} — ₹${newAmount} · ${newCat}` }
  };
}

// ─────────────────────────────────────────────
// Tool: delete_expense
// ─────────────────────────────────────────────
function delete_expense(userId, args) {
  const db = getDb();
  const { expense_id } = args;

  const existing = db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(expense_id, userId);
  if (!existing) return { error: 'Expense not found.' };

  // Soft delete: we set deleted_at instead of removing the row, so we can undo
  db.prepare(`UPDATE expenses SET deleted_at=datetime('now') WHERE id=? AND user_id=?`).run(expense_id, userId);

  const logId = uuidv4();
  db.prepare(`
    INSERT INTO action_log (id, user_id, action_type, description, payload, undo_payload)
    VALUES (?, ?, 'delete_expense', ?, ?, ?)
  `).run(
    logId, userId,
    `Deleted: ${existing.description} — ₹${existing.amount} · ${existing.category}`,
    JSON.stringify({ expense_id }),
    JSON.stringify({ action: 'restore', expense_id, description: existing.description, amount: existing.amount, category: existing.category, date: existing.date })
  );

  return {
    success: true,
    deleted: { id: expense_id, description: existing.description, amount: existing.amount },
    action_log: { id: logId, description: `Deleted: ${existing.description} — ₹${existing.amount}` }
  };
}

// ─────────────────────────────────────────────
// Tool: get_summary — ALL math is done HERE, never by the AI
// ─────────────────────────────────────────────
function get_summary(userId, args) {
  const db = getDb();
  const { period, category, include_forecast } = args;

  const start = periodStart(period);
  const end = periodEnd(period);

  let query = `SELECT category, SUM(amount) as total, COUNT(*) as count FROM expenses
    WHERE user_id=? AND deleted_at IS NULL AND date >= ? AND date <= ?`;
  const params = [userId, start, end];

  if (category) {
    query += ' AND category=?';
    params.push(category);
  }
  query += ' GROUP BY category ORDER BY total DESC';

  const rows = db.prepare(query).all(...params);

  const grandTotal = rows.reduce((s, r) => s + r.total, 0);
  const totalCount = rows.reduce((s, r) => s + r.count, 0);
  const topCategory = rows[0]?.category || 'None';

  let forecast = null;
  if (include_forecast && (period === 'this_month' || period === 'last_7_days' || period === 'last_30_days')) {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const daysRemaining = daysInMonth - dayOfMonth;

    if (dayOfMonth > 0 && grandTotal > 0) {
      const dailyRate = grandTotal / dayOfMonth;
      const projectedMonthly = dailyRate * daysInMonth;
      forecast = {
        daily_rate: +dailyRate.toFixed(2),
        projected_monthly: +projectedMonthly.toFixed(2),
        days_remaining: daysRemaining,
        days_elapsed: dayOfMonth
      };
    }
  }

  return {
    period, start, end,
    total: +grandTotal.toFixed(2),
    transaction_count: totalCount,
    top_category: topCategory,
    breakdown: rows.map(r => ({ category: r.category, total: +r.total.toFixed(2), count: r.count })),
    forecast
  };
}

// ─────────────────────────────────────────────
// Tool: get_recent_expenses
// ─────────────────────────────────────────────
function get_recent_expenses(userId, args) {
  const db = getDb();
  const { limit = 5, category } = args;

  let query = `SELECT id, description, amount, category, date, ai_confidence FROM expenses
    WHERE user_id=? AND deleted_at IS NULL`;
  const params = [userId];

  if (category) {
    query += ' AND category=?';
    params.push(category);
  }
  query += ' ORDER BY date DESC, created_at DESC LIMIT ?';
  params.push(Math.min(limit, 50));

  return { expenses: db.prepare(query).all(...params) };
}

// ─────────────────────────────────────────────
// Tool: search_expenses
// ─────────────────────────────────────────────
function search_expenses(userId, args) {
  const db = getDb();
  const { query: q, date_from, date_to } = args;

  let query = `SELECT id, description, amount, category, date FROM expenses
    WHERE user_id=? AND deleted_at IS NULL`;
  const params = [userId];

  if (q) { query += ' AND description LIKE ?'; params.push(`%${q}%`); }
  if (date_from) { query += ' AND date >= ?'; params.push(date_from); }
  if (date_to) { query += ' AND date <= ?'; params.push(date_to); }
  query += ' ORDER BY date DESC LIMIT 20';

  return { expenses: db.prepare(query).all(...params), query: q };
}

// ─────────────────────────────────────────────
// Tool: set_budget
// ─────────────────────────────────────────────
function set_budget(userId, args) {
  const db = getDb();
  const { category, monthly_limit } = args;

  if (monthly_limit <= 0) return { error: 'Budget must be a positive amount.' };

  db.prepare(`
    INSERT INTO budgets (id, user_id, category, monthly_limit)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, category) DO UPDATE SET monthly_limit=?, updated_at=datetime('now')
  `).run(uuidv4(), userId, category, monthly_limit, monthly_limit);

  const logId = uuidv4();
  db.prepare(`
    INSERT INTO action_log (id, user_id, action_type, description, payload, undo_payload)
    VALUES (?, ?, 'set_budget', ?, ?, ?)
  `).run(logId, userId, `Set budget: ${category} → ₹${monthly_limit}/month`,
    JSON.stringify({ category, monthly_limit }), null);

  return { success: true, category, monthly_limit };
}

// ─────────────────────────────────────────────
// Tool: get_budget_status
// ─────────────────────────────────────────────
function get_budget_status(userId, args) {
  const db = getDb();
  const { category } = args;

  const monthStart = periodStart('this_month');

  let budgetQuery = 'SELECT * FROM budgets WHERE user_id=?';
  const budgetParams = [userId];
  if (category) { budgetQuery += ' AND category=?'; budgetParams.push(category); }

  const budgets = db.prepare(budgetQuery).all(...budgetParams);

  const result = budgets.map(b => {
    const spent = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM expenses
      WHERE user_id=? AND category=? AND date >= ? AND deleted_at IS NULL
    `).get(userId, b.category, monthStart);

    const pct = +((spent.total / b.monthly_limit) * 100).toFixed(1);
    return {
      category: b.category,
      monthly_limit: b.monthly_limit,
      spent: +spent.total.toFixed(2),
      remaining: +(b.monthly_limit - spent.total).toFixed(2),
      percentage: pct,
      status: pct >= 100 ? 'exceeded' : pct >= 80 ? 'warning' : 'ok'
    };
  });

  return { budgets: result };
}

// ─────────────────────────────────────────────
// Tool: categorize
// Checks correction memory first, then falls back to a simple keyword match
// (The AI loop will have already used Gemini for categorization before calling this)
// ─────────────────────────────────────────────
function categorize(userId, args) {
  const db = getDb();
  const { description } = args;

  const desc = description.toLowerCase();

  // Check learned mappings (correction memory)
  const mappings = db.prepare('SELECT * FROM category_mappings WHERE user_id=?').all(userId);
  for (const m of mappings) {
    if (desc.includes(m.description_pattern.toLowerCase())) {
      return { category: m.category, confidence: 1.0, source: 'learned' };
    }
  }

  // Keyword fallback
  const rules = [
    [['swiggy', 'zomato', 'lunch', 'dinner', 'breakfast', 'restaurant', 'food', 'meal', 'cafe', 'chai', 'kirana', 'grocery', 'bigbasket', 'dunzo', 'tea', 'coffee', 'biscuit', 'maggi'], 'Food'],
    [['uber', 'ola', 'rapido', 'auto', 'metro', 'bus', 'train', 'petrol', 'diesel', 'cab', 'rickshaw', 'bmtc', 'fare', 'toll'], 'Transport'],
    [['netflix', 'spotify', 'amazon prime', 'prime', 'hotstar', 'movie', 'cinema', 'concert', 'game', 'steam', 'bookmyshow', 'youtube'], 'Entertainment'],
    [['doctor', 'hospital', 'pharmacy', 'medicine', 'gym', 'yoga', 'health', 'apollo', 'lab', 'blood test', 'dental', 'dentist', 'supplement'], 'Health'],
    [['amazon', 'flipkart', 'myntra', 'clothes', 'shoes', 'shopping', 'nykaa', 'decathlon', 'h&m', 'croma', 'mall'], 'Shopping'],
    [['electricity', 'water', 'gas', 'airtel', 'jio', 'bsnl', 'broadband', 'wifi', 'recharge', 'internet', 'bill', 'utility'], 'Utilities'],
    [['udemy', 'coursera', 'book', 'course', 'college', 'school', 'tuition', 'leetcode', 'education', 'class'], 'Education'],
    [['hotel', 'flight', 'indigo', 'spicejet', 'air india', 'airbnb', 'oyo', 'trip', 'travel', 'goa', 'booking'], 'Travel'],
    [['rent', 'maintenance', 'society', 'housing', 'apartment', 'flat'], 'Housing'],
  ];

  for (const [keywords, cat] of rules) {
    if (keywords.some(k => desc.includes(k))) {
      return { category: cat, confidence: 0.75, source: 'keyword' };
    }
  }

  return { category: 'Other', confidence: 0.5, source: 'fallback' };
}

// ─────────────────────────────────────────────
// Tool: get_recurring_patterns
// ─────────────────────────────────────────────
function get_recurring_patterns(userId) {
  const db = getDb();
  const patterns = db.prepare('SELECT * FROM recurring_patterns WHERE user_id=? ORDER BY created_at DESC').all(userId);
  return { patterns };
}

// ─────────────────────────────────────────────
// Tool: undo_last_action
// ─────────────────────────────────────────────
function undo_last_action(userId) {
  const db = getDb();
  const lastLog = db.prepare(`
    SELECT * FROM action_log
    WHERE user_id=? AND undone=0 AND undo_payload IS NOT NULL
    ORDER BY created_at DESC LIMIT 1
  `).get(userId);

  if (!lastLog) return { error: 'Nothing to undo.' };

  const undoData = JSON.parse(lastLog.undo_payload);

  if (undoData.action === 'delete') {
    db.prepare('UPDATE expenses SET deleted_at=datetime("now") WHERE id=?').run(undoData.expense_id);
  } else if (undoData.action === 'restore') {
    db.prepare(`UPDATE expenses SET deleted_at=NULL, description=?, amount=?, category=?, date=? WHERE id=?`)
      .run(undoData.description, undoData.amount, undoData.category, undoData.date, undoData.expense_id);
  }

  db.prepare('UPDATE action_log SET undone=1 WHERE id=?').run(lastLog.id);

  return { success: true, undone: lastLog.description };
}

// ─────────────────────────────────────────────
// Budget check helper (internal, not a tool)
// ─────────────────────────────────────────────
function checkBudget(userId, category) {
  const db = getDb();
  const budget = db.prepare('SELECT * FROM budgets WHERE user_id=? AND category=?').get(userId, category);
  if (!budget) return null;

  const monthStart = periodStart('this_month');
  const spent = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM expenses
    WHERE user_id=? AND category=? AND date >= ? AND deleted_at IS NULL
  `).get(userId, category, monthStart);

  const pct = (spent.total / budget.monthly_limit) * 100;
  if (pct >= 100) return { status: 'exceeded', category, spent: spent.total, limit: budget.monthly_limit, percentage: pct.toFixed(1) };
  if (pct >= 80) return { status: 'warning', category, spent: spent.total, limit: budget.monthly_limit, percentage: pct.toFixed(1) };
  return null;
}

// ─────────────────────────────────────────────
// Main dispatcher: routes tool name → function
// ─────────────────────────────────────────────
function executeTool(userId, toolName, args) {
  switch (toolName) {
    case 'add_expense': return add_expense(userId, args);
    case 'update_expense': return update_expense(userId, args);
    case 'delete_expense': return delete_expense(userId, args);
    case 'get_summary': return get_summary(userId, args);
    case 'get_recent_expenses': return get_recent_expenses(userId, args);
    case 'search_expenses': return search_expenses(userId, args);
    case 'set_budget': return set_budget(userId, args);
    case 'get_budget_status': return get_budget_status(userId, args);
    case 'categorize': return categorize(userId, args);
    case 'get_recurring_patterns': return get_recurring_patterns(userId);
    case 'undo_last_action': return undo_last_action(userId);
    default: return { error: `Unknown tool: ${toolName}` };
  }
}

module.exports = { executeTool, checkBudget, categorize, get_summary, get_budget_status };
