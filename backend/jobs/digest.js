// jobs/digest.js
// Weekly digest: summarizes spending and "messages" the user in chat
// Runs every Monday at 9am

const cron = require('node-cron');
const { getDb } = require('../db/schema');
const { get_summary } = require('../agent/executor');
const { v4: uuidv4 } = require('uuid');

function startDigestJob() {
  // Run every Monday at 9:00 AM
  cron.schedule('0 9 * * 1', () => {
    console.log('[Digest] Running weekly digest...');
    generateDigestsForAllUsers();
  });

  console.log('[Digest] Weekly digest job scheduled (Mondays 9am)');
}

function generateDigestsForAllUsers() {
  const db = getDb();
  const users = db.prepare('SELECT id FROM users').all();

  for (const user of users) {
    try {
      generateDigestForUser(user.id);
    } catch (err) {
      console.error(`[Digest] Failed for user ${user.id}:`, err.message);
    }
  }
}

function generateDigestForUser(userId) {
  const db = getDb();

  const thisWeek = get_summary(userId, { period: 'this_week' });
  const lastWeek = get_summary(userId, { period: 'last_7_days' });

  // Build a summary message
  const change = lastWeek.total > 0
    ? (((thisWeek.total - lastWeek.total) / lastWeek.total) * 100).toFixed(0)
    : null;

  const topCat = thisWeek.breakdown[0];

  let message = `📊 **Your weekly spending digest:**\n\n`;
  message += `You spent **₹${thisWeek.total.toLocaleString('en-IN')}** this week`;

  if (change !== null) {
    const direction = change >= 0 ? 'more' : 'less';
    const abs = Math.abs(change);
    message += ` — that's ${abs}% ${direction} than last week (₹${lastWeek.total.toLocaleString('en-IN')}).`;
  } else {
    message += '.';
  }

  if (topCat) {
    message += `\n\nYour top category was **${topCat.category}** at ₹${topCat.total.toLocaleString('en-IN')}.`;
  }

  message += `\n\nAsk me anything about your spending — I'm here to help!`;

  // Insert as a model message in conversation history
  db.prepare(`
    INSERT INTO conversation_history (id, user_id, role, content)
    VALUES (?, ?, 'model', ?)
  `).run(uuidv4(), userId, message);
}

module.exports = { startDigestJob, generateDigestForUser };
