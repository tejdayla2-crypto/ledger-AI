// routes/chat.js
// POST /api/chat — the main agent endpoint
// Receives the user's message, runs the agent loop, returns the reply

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { runAgentLoop } = require('../agent/loop');
const { getDb } = require('../db/schema');

const router = express.Router();

// POST /api/chat
router.post('/', requireAuth, async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message cannot be empty.' });
    }

    if (message.length > 2000) {
      return res.status(400).json({ error: 'Message too long. Keep it under 2000 characters.' });
    }

    // Check if API key is configured
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
      return res.status(503).json({
        error: 'Gemini API key not configured.',
        reply: "⚠️ The AI agent isn't connected yet. Add your Gemini API key to the .env file to activate it. Your quick-add form and all other features still work!"
      });
    }

    const result = await runAgentLoop(req.user.id, message.trim());

    res.json({
      reply: result.reply,
      tool_calls: result.tool_calls,
      action_log: result.action_log
    });

  } catch (err) {
    console.error('Chat error:', err);

    // Give a useful error message, not a generic one
    if (err.message?.includes('API_KEY_INVALID') || err.message?.includes('API key')) {
      return res.status(503).json({
        reply: "Couldn't reach the AI — the API key may be invalid. Check your .env file.",
        error: 'api_key_invalid'
      });
    }

    res.status(503).json({
      reply: "AI is temporarily unavailable because the Gemini quota has been reached. Your data is safe; please try again later.",
      error: 'ai_unavailable',
      tool_calls: [],
      action_log: []
    });
  }
});

// GET /api/chat/history — load previous messages
router.get('/history', requireAuth, (req, res) => {
  const db = getDb();
  const messages = db.prepare(`
    SELECT id, role, content, created_at FROM conversation_history
    WHERE user_id=? ORDER BY created_at ASC LIMIT 100
  `).all(req.user.id);
  res.json({ messages });
});

// DELETE /api/chat/history — clear conversation
router.delete('/history', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM conversation_history WHERE user_id=?').run(req.user.id);
  res.json({ success: true });
});

module.exports = router;
