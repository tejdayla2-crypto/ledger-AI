const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/schema');
const { executeTool } = require('../agent/executor');
const { CATEGORIES } = require('../agent/tools');
const { forecastExpenses, weightedMovingAverage } = require('../lib/expenseForecast');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
      const error = new Error('Only JPG, JPEG, and PNG receipts are supported.');
      error.status = 400;
      return callback(error);
    }
    callback(null, true);
  }
});

function getModel(json = false) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === 'YOUR_GEMINI_API_KEY_HERE' || key === 'your_real_key_here') return null;
  return new GoogleGenerativeAI(key).getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
    ...(json ? { generationConfig: { responseMimeType: 'application/json' } } : {})
  });
}

function jsonResponse(response) {
  const text = response.response.text();
  return JSON.parse(text);
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateContext() {
  return new Date().toISOString().slice(0, 10);
}

function monthBounds(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const start = `${month}-01`;
  const end = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  return { start, end };
}

function financialSnapshot(userId) {
  const db = getDb();
  const currentMonth = dateContext().slice(0, 7);
  const [year, monthNumber] = currentMonth.split('-').map(Number);
  const previousMonth = new Date(Date.UTC(year, monthNumber - 2, 1)).toISOString().slice(0, 7);
  const current = monthBounds(currentMonth);
  const previous = monthBounds(previousMonth);
  const totalForRange = range => db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
    FROM expenses WHERE user_id=? AND deleted_at IS NULL AND date>=? AND date<=?`)
    .get(userId, range.start, range.end);
  const currentTotals = totalForRange({ start: current.start, end: dateContext() });
  const previousTotals = totalForRange(previous);
  const categoryBreakdown = db.prepare(`SELECT category, SUM(amount) AS total, COUNT(*) AS count
    FROM expenses WHERE user_id=? AND deleted_at IS NULL AND date>=? AND date<=?
    GROUP BY category ORDER BY total DESC`)
    .all(userId, current.start, dateContext());
  const previousCategories = db.prepare(`SELECT category, SUM(amount) AS total
    FROM expenses WHERE user_id=? AND deleted_at IS NULL AND date>=? AND date<=?
    GROUP BY category ORDER BY total DESC`)
    .all(userId, previous.start, previous.end);
  const recentPatterns = db.prepare(`SELECT description, category, COUNT(*) AS count, SUM(amount) AS total
    FROM expenses WHERE user_id=? AND deleted_at IS NULL AND date>=date('now', '-90 days')
    GROUP BY lower(description), category ORDER BY total DESC LIMIT 10`).all(userId);
  const budgetRows = db.prepare('SELECT category, monthly_limit FROM budgets WHERE user_id=?').all(userId);
  const currentIncome = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
    FROM income_records WHERE user_id=? AND deleted_at IS NULL AND date>=? AND date<=?`)
    .get(userId, current.start, dateContext());
  const previousIncome = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total
    FROM income_records WHERE user_id=? AND deleted_at IS NULL AND date>=? AND date<=?`)
    .get(userId, previous.start, previous.end);
  const historicalExpenses = db.prepare(`SELECT strftime('%Y-%m', date) AS month, SUM(amount) AS total
    FROM expenses WHERE user_id=? AND deleted_at IS NULL AND date>=? AND date<?
    GROUP BY month ORDER BY month`)
    .all(userId, new Date(Date.UTC(year, monthNumber - 13, 1)).toISOString().slice(0, 10), current.start);
  const historicalIncome = db.prepare(`SELECT strftime('%Y-%m', date) AS month, SUM(amount) AS total
    FROM income_records WHERE user_id=? AND deleted_at IS NULL AND date>=? AND date<?
    GROUP BY month ORDER BY month`)
    .all(userId, new Date(Date.UTC(year, monthNumber - 13, 1)).toISOString().slice(0, 10), current.start);
  const historyMonths = Array.from({ length: 12 }, (_, index) =>
    new Date(Date.UTC(year, monthNumber - 13 + index, 1)).toISOString().slice(0, 7));
  const expenseByMonth = new Map(historicalExpenses.map(row => [row.month, Number(row.total)]));
  const incomeByMonth = new Map(historicalIncome.map(row => [row.month, Number(row.total)]));
  const expenseHistory = historyMonths.map(month => ({ month, total: expenseByMonth.get(month) || 0 }));
  const incomeHistory = historyMonths.map(month => ({ month, total: incomeByMonth.get(month) || 0 }));
  const predictedExpenses = historicalExpenses.length >= 3
    ? forecastExpenses(expenseHistory, db.prepare(`SELECT strftime('%Y-%m', date) AS month, category, SUM(amount) AS total
        FROM expenses WHERE user_id=? AND deleted_at IS NULL AND date>=? AND date<?
        GROUP BY month, category ORDER BY month`)
      .all(userId, new Date(Date.UTC(year, monthNumber - 13, 1)).toISOString().slice(0, 10), current.start)).predicted_total
    : null;
  const predictedIncome = historicalIncome.length >= 3
    ? weightedMovingAverage(incomeHistory.map(row => row.total))
    : null;

  return {
    currency: 'INR',
    current_month: currentMonth,
    previous_month: previousMonth,
    current_month_expenses: +currentTotals.total.toFixed(2),
    current_month_transaction_count: currentTotals.count,
    current_month_income: +currentIncome.total.toFixed(2),
    current_month_income_transaction_count: currentIncome.count,
    previous_month_expenses: +previousTotals.total.toFixed(2),
    previous_month_income: +previousIncome.total.toFixed(2),
    change_from_previous_month: previousTotals.total
      ? +((currentTotals.total - previousTotals.total) / previousTotals.total * 100).toFixed(1)
      : null,
    current_month_categories: categoryBreakdown.map(row => ({
      category: row.category, total: +row.total.toFixed(2), count: row.count
    })),
    previous_month_categories: previousCategories.map(row => ({
      category: row.category, total: +row.total.toFixed(2)
    })),
    recurring_description_patterns_last_90_days: recentPatterns.map(row => ({
      description: row.description, category: row.category, count: row.count, total: +row.total.toFixed(2)
    })),
    budgets: budgetRows,
    next_month_expense_forecast: predictedExpenses,
    next_month_income_forecast: predictedIncome,
    next_month_projected_savings: predictedExpenses === null || predictedIncome === null
      ? null
      : +(predictedIncome - predictedExpenses).toFixed(2)
  };
}

function handleUpload(req, res, next) {
  upload.single('receipt')(req, res, error => {
    if (!error) return next();
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : (error.status || 400);
    return res.status(status).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Receipt image must be 5 MB or smaller.' : error.message });
  });
}

router.post('/voice', requireAuth, async (req, res) => {
  const transcript = req.body?.transcript;
  if (typeof transcript !== 'string' || !transcript.trim() || transcript.trim().length > 1000) {
    return res.status(400).json({ error: 'A voice transcript of 1–1,000 characters is required.' });
  }
  const language = req.body?.language || 'en-IN';
  if (!['en-IN', 'hi-IN'].includes(language)) {
    return res.status(400).json({ error: 'Voice assistance supports English and Hindi.' });
  }
  const model = getModel(true);
  if (!model) return res.status(503).json({ error: 'AI is not configured. Set GEMINI_API_KEY on the backend.' });

  try {
    const result = jsonResponse(await model.generateContent(
      `Today is ${dateContext()}. Classify this transcript as either "expense" or "query". It may be in English or Hindi.
For expense, extract amount in INR, an English category from ${JSON.stringify(CATEGORIES)}, a concise description, and date as YYYY-MM-DD. Translate the description to English only when needed. Never guess a missing amount; use null. Use today's date only when the speaker explicitly says today or uses an equivalent word.
For query, preserve the user's question in query and do not propose any transaction. The user's selected language is ${language === 'hi-IN' ? 'Hindi' : 'English'}.
Return only JSON with keys: intent, amount, category, description, date, query. Transcript: ${JSON.stringify(transcript.trim())}`
    ));

    if (result.intent === 'query') {
      const question = typeof result.query === 'string' && result.query.trim()
        ? result.query.trim()
        : transcript.trim();
      const advisor = await generateAdvice(req.user.id, question, language);
      return res.json({ intent: 'query', reply: advisor.answer, data: advisor.data });
    }

    const amount = Number(result.amount);
    if (result.intent !== 'expense' || !Number.isFinite(amount) || amount <= 0 || amount > 100000000) {
      return res.status(422).json({ error: 'I could not reliably identify an expense amount. Please try again or enter it manually.' });
    }
    const category = CATEGORIES.includes(result.category) ? result.category : 'Other';
    const description = typeof result.description === 'string' ? result.description.trim().slice(0, 200) : '';
    if (!description) return res.status(422).json({ error: 'I could not identify what the expense was for. Please add a description.' });
    const date = isValidDate(result.date) ? result.date : null;
    return res.json({
      intent: 'expense',
      needs_confirmation: true,
      expense: { description, amount, category, date }
    });
  } catch (error) {
    console.error('Voice assistant error:', error.message);
    return res.status(503).json({ error: 'The voice assistant could not process that request. Please try again.' });
  }
});

async function generateAdvice(userId, question, responseLanguage = 'en-IN') {
  const model = getModel();
  if (!model) {
    const error = new Error('AI is not configured. Set GEMINI_API_KEY on the backend.');
    error.status = 503;
    throw error;
  }
  const data = financialSnapshot(userId);
  const response = await model.generateContent(
    `You are a personal finance advisor. Answer in ${responseLanguage === 'hi-IN' ? 'Hindi' : 'English'} using only the supplied user's actual financial data. Never invent or estimate transaction totals, dates, or trends. If the records cannot answer a question, say so plainly. Give practical suggestions, label them as suggestions, and avoid investment/tax guarantees. Do not claim to change any data.
Actual database summary: ${JSON.stringify(data)}
User question: ${JSON.stringify(question)}`
  );
  return { answer: response.response.text().trim(), data };
}

router.post('/advisor', requireAuth, async (req, res) => {
  const question = req.body?.question;
  if (typeof question !== 'string' || !question.trim() || question.trim().length > 1000) {
    return res.status(400).json({ error: 'A question of 1–1,000 characters is required.' });
  }
  try {
    const result = await generateAdvice(req.user.id, question.trim());
    res.json(result);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Financial advisor error:', error.message);
    res.status(503).json({ error: 'The financial advisor is temporarily unavailable. Please try again.' });
  }
});

router.get('/prediction', requireAuth, (req, res) => {
  const db = getDb();
  const today = dateContext();
  const currentMonth = today.slice(0, 7);
  const [year, monthNumber] = currentMonth.split('-').map(Number);
  const previousMonth = new Date(Date.UTC(year, monthNumber - 2, 1)).toISOString().slice(0, 7);
  const firstForecastMonth = new Date(Date.UTC(year, monthNumber - 13, 1)).toISOString().slice(0, 10);
  const rawHistoricRows = db.prepare(`SELECT strftime('%Y-%m', date) AS month, SUM(amount) AS total
    FROM expenses WHERE user_id=? AND deleted_at IS NULL AND date>=? AND date<? GROUP BY month ORDER BY month`)
    .all(req.user.id, firstForecastMonth, `${currentMonth}-01`);
  const categoryRows = db.prepare(`SELECT strftime('%Y-%m', date) AS month, category, SUM(amount) AS total
    FROM expenses WHERE user_id=? AND deleted_at IS NULL AND date>=? AND date<?
    GROUP BY month, category ORDER BY month`)
    .all(req.user.id, firstForecastMonth, `${currentMonth}-01`);
  const rawIncomeRows = db.prepare(`SELECT strftime('%Y-%m', date) AS month, SUM(amount) AS total
    FROM income_records WHERE user_id=? AND deleted_at IS NULL AND date>=? AND date<? GROUP BY month ORDER BY month`)
    .all(req.user.id, firstForecastMonth, `${currentMonth}-01`);
  const monthKeys = Array.from({ length: 12 }, (_, index) =>
    new Date(Date.UTC(year, monthNumber - 13 + index, 1)).toISOString().slice(0, 7));
  const expensesByMonth = new Map(rawHistoricRows.map(row => [row.month, Number(row.total)]));
  const incomeByMonth = new Map(rawIncomeRows.map(row => [row.month, Number(row.total)]));
  const historicRows = monthKeys.map(month => ({ month, total: expensesByMonth.get(month) || 0 }));
  const incomeRows = monthKeys.map(month => ({ month, total: incomeByMonth.get(month) || 0 }));
  const activeMonths = rawHistoricRows.length;
  const currentRange = monthBounds(currentMonth);
  const previousRange = monthBounds(previousMonth);
  const currentTotal = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
    WHERE user_id=? AND deleted_at IS NULL AND date>=? AND date<=?`)
    .get(req.user.id, currentRange.start, today).total;
  const previousTotal = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
    WHERE user_id=? AND deleted_at IS NULL AND date>=? AND date<=?`)
    .get(req.user.id, previousRange.start, previousRange.end).total;

  if (activeMonths < 3) {
    return res.json({
      sufficient_history: false,
      message: `At least 3 months with recorded expenses are required. You currently have ${activeMonths}.`,
      history_months: activeMonths,
      current_month: currentMonth,
      current_month_total: +currentTotal.toFixed(2),
      previous_month: previousMonth,
      previous_month_total: +previousTotal.toFixed(2),
      predicted_savings: null,
      categories: [],
      monthly_history: historicRows.map(row => ({ month: row.month, total: +Number(row.total).toFixed(2) }))
    });
  }

  const forecast = forecastExpenses(historicRows, categoryRows);
  const predictedIncome = rawIncomeRows.length >= 3
    ? weightedMovingAverage(incomeRows.map(row => Number(row.total)))
    : null;
  return res.json({
    sufficient_history: true,
    forecast_month: new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 7),
    current_month: currentMonth,
    current_month_total: +currentTotal.toFixed(2),
    previous_month: previousMonth,
    previous_month_total: +previousTotal.toFixed(2),
    predicted_total: forecast.predicted_total,
    predicted_income: predictedIncome,
    predicted_savings: predictedIncome === null ? null : +(predictedIncome - forecast.predicted_total).toFixed(2),
    categories: forecast.categories,
    monthly_history: forecast.monthly_history,
    accuracy_pct: activeMonths >= 6 ? forecast.accuracy_pct : null,
    method: forecast.method,
    history_months: forecast.history_months,
    overspending_warning: forecast.predicted_total > previousTotal && previousTotal > 0
      ? 'The forecast is above last month’s recorded expenses.'
      : null
  });
});

router.post('/receipts', requireAuth, handleUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a JPG, JPEG, or PNG receipt image.' });
  const { buffer, mimetype } = req.file;
  const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const actualType = isPng ? 'image/png' : isJpeg ? 'image/jpeg' : null;
  if (!actualType || actualType !== mimetype) return res.status(400).json({ error: 'The uploaded file is not a valid JPG or PNG image.' });

  const imageHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const db = getDb();
  const existing = db.prepare('SELECT id, extracted_json, status FROM receipt_scans WHERE user_id=? AND image_hash=?')
    .get(req.user.id, imageHash);
  if (existing?.status === 'confirmed') {
    return res.status(409).json({ error: 'This receipt has already been added as a transaction.' });
  }
  if (existing) {
    return res.json({ scan_id: existing.id, ...JSON.parse(existing.extracted_json), resumed: true });
  }

  const model = getModel(true);
  if (!model) return res.status(503).json({ error: 'Receipt scanning requires GEMINI_API_KEY on the backend.' });
  try {
    const extracted = jsonResponse(await model.generateContent([
      { text: `Read this receipt image. Extract only details that are visibly present; do not infer missing values.
Return JSON with keys: amount (final total as number or null), date (YYYY-MM-DD or null), merchant (string or null), items (array of short strings), category (one of ${JSON.stringify(CATEGORIES)} or "Other"), readable (boolean).
Use the final amount paid, not a subtotal. If the image is too unclear to identify the total, set readable false.` },
      { inlineData: { mimeType: actualType, data: buffer.toString('base64') } }
    ]));
    const amount = Number(extracted.amount);
    const merchant = typeof extracted.merchant === 'string' ? extracted.merchant.trim().slice(0, 150) : '';
    if (extracted.readable === false || !Number.isFinite(amount) || amount <= 0 || amount > 100000000 || !merchant) {
      return res.status(422).json({
        readable: false,
        message: 'The receipt is unclear or its total/merchant could not be read. Try a sharper image or enter the expense manually.'
      });
    }

    const result = {
      readable: true,
      amount,
      date: isValidDate(extracted.date) ? extracted.date : null,
      merchant,
      description: merchant,
      items: Array.isArray(extracted.items)
        ? extracted.items.filter(item => typeof item === 'string').slice(0, 20).map(item => item.slice(0, 120))
        : [],
      category: CATEGORIES.includes(extracted.category) ? extracted.category : 'Other'
    };
    const scanId = uuidv4();
    db.prepare(`INSERT INTO receipt_scans (id, user_id, image_hash, extracted_json)
      VALUES (?, ?, ?, ?)`).run(scanId, req.user.id, imageHash, JSON.stringify(result));
    res.json({ scan_id: scanId, ...result });
  } catch (error) {
    console.error('Receipt extraction error:', error.message);
    res.status(503).json({ error: 'Receipt extraction failed. Try another image or enter the expense manually.' });
  }
});

router.post('/receipts/:scanId/confirm', requireAuth, (req, res) => {
  const { description, amount, category, date } = req.body || {};
  const value = Number(amount);
  if (typeof description !== 'string' || !description.trim() || description.trim().length > 200 ||
      !Number.isFinite(value) || value <= 0 || value > 100000000 ||
      !CATEGORIES.includes(category) || !isValidDate(date)) {
    return res.status(400).json({ error: 'Enter a valid description, amount, category, and date to confirm this receipt.' });
  }

  const db = getDb();
  const scan = db.prepare('SELECT * FROM receipt_scans WHERE id=? AND user_id=?').get(req.params.scanId, req.user.id);
  if (!scan) return res.status(404).json({ error: 'Receipt scan not found.' });
  if (scan.status !== 'pending') return res.status(409).json({ error: 'This receipt has already been confirmed.' });

  try {
    const result = db.transaction(() => {
      const expense = executeTool(req.user.id, 'add_expense', {
        description: description.trim(), amount: value, category, date
      });
      if (expense.error) throw new Error(expense.error);
      const updated = db.prepare(`UPDATE receipt_scans SET status='confirmed', confirmed_expense_id=?
        WHERE id=? AND user_id=? AND status='pending'`).run(expense.expense.id, scan.id, req.user.id);
      if (!updated.changes) throw new Error('This receipt has already been confirmed.');
      return expense;
    })();
    res.status(201).json(result);
  } catch (error) {
    const status = error.message.includes('already been confirmed') ? 409 : 400;
    res.status(status).json({ error: error.message });
  }
});

module.exports = router;
