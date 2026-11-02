// jobs/recurring.js
// Detects recurring expense patterns (e.g. Netflix every ~30 days)
// Runs daily and notifies users via chat

const cron = require('node-cron');
const { getDb } = require('../db/schema');
const { v4: uuidv4 } = require('uuid');

function startRecurringJob() {
  // Run daily at midnight
  cron.schedule('0 0 * * *', () => {
    console.log('[Recurring] Running pattern detection...');
    detectRecurringForAllUsers();
  });
  console.log('[Recurring] Pattern detection job scheduled (daily midnight)');
}

function detectRecurringForAllUsers() {
  const db = getDb();
  const users = db.prepare('SELECT id FROM users').all();
  for (const user of users) {
    try { detectRecurringForUser(user.id); } catch (e) { }
  }
}

function detectRecurringForUser(userId) {
  const db = getDb();

  // Get all expenses from last 90 days
  const expenses = db.prepare(`
    SELECT description, amount, date FROM expenses
    WHERE user_id=? AND deleted_at IS NULL AND date >= date('now', '-90 days')
    ORDER BY description, date
  `).all(userId);

  // Group by normalized description (lowercase, first 3 words)
  const groups = {};
  for (const exp of expenses) {
    const key = exp.description.toLowerCase().split(' ').slice(0, 3).join(' ');
    if (!groups[key]) groups[key] = [];
    groups[key].push(exp);
  }

  for (const [key, items] of Object.entries(groups)) {
    if (items.length < 2) continue;

    // Check if amounts are similar (within 10%)
    const amounts = items.map(i => i.amount);
    const avgAmount = amounts.reduce((a, b) => a + b) / amounts.length;
    const allSimilar = amounts.every(a => Math.abs(a - avgAmount) / avgAmount < 0.1);

    if (!allSimilar) continue;

    // Check interval between occurrences
    const dates = items.map(i => new Date(i.date)).sort((a, b) => a - b);
    const intervals = [];
    for (let i = 1; i < dates.length; i++) {
      intervals.push((dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24));
    }
    const avgInterval = intervals.reduce((a, b) => a + b) / intervals.length;

    // If roughly monthly (25-35 days)
    if (avgInterval >= 25 && avgInterval <= 35) {
      const existing = db.prepare(`
        SELECT id FROM recurring_patterns WHERE user_id=? AND description LIKE ?
      `).get(userId, `%${items[0].description.split(' ')[0]}%`);

      if (!existing) {
        const nextExpected = new Date(dates[dates.length - 1]);
        nextExpected.setDate(nextExpected.getDate() + Math.round(avgInterval));

        db.prepare(`
          INSERT INTO recurring_patterns (id, user_id, description, amount, detected_interval_days, next_expected)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(uuidv4(), userId, items[0].description, avgAmount, Math.round(avgInterval), nextExpected.toISOString().split('T')[0]);

        // Notify user in chat
        const msg = `💡 I noticed **${items[0].description}** (₹${Math.round(avgAmount)}) appears every ~${Math.round(avgInterval)} days. Want me to auto-log it going forward? Just say "yes, auto-log ${items[0].description.split(' ')[0]}".`;
        db.prepare(`INSERT INTO conversation_history (id, user_id, role, content) VALUES (?, ?, 'model', ?)`).run(uuidv4(), userId, msg);
      }
    }
  }
}

module.exports = { startRecurringJob, detectRecurringForUser };
