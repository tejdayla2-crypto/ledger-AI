// server.js
// The entry point for our Express backend.
// This file:
// 1. Loads environment variables (.env file)
// 2. Sets up the database
// 3. Registers all routes
// 4. Starts listening for requests
// 5. Kicks off background jobs

require('dotenv').config(); // Load .env variables FIRST

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

process.on('uncaughtException', err => {
  console.error('UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', err => {
  console.error('UNHANDLED REJECTION:', err);
});

const { getDb } = require('./db/schema');
const { seedDatabase } = require('./db/seed');

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const expenseRoutes = require('./routes/expenses');
const summaryRoutes = require('./routes/summary');
const budgetRoutes = require('./routes/budgets');
const importRoutes = require('./routes/import');

const { startDigestJob } = require('./jobs/digest');
const { startRecurringJob } = require('./jobs/recurring');

const app = express();
const PORT = process.env.PORT || 3001;

// ── MIDDLEWARE ──
// CORS: allows the React frontend (port 5173) to talk to this server
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true // Required for cookies to work cross-origin
}));

app.use(express.json({ limit: '10mb' })); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // Parse cookies (for JWT)

// ── ROUTES ──
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/summary', summaryRoutes);
app.use('/api/budgets', budgetRoutes);
app.use('/api/import', importRoutes);

// Health check — useful to verify the server is running
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── 404 HANDLER ──
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// ── ERROR HANDLER ──
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'An unexpected error occurred.' });
});

// ── START ──
app.listen(PORT, () => {
  console.log(`\n🚀 Ledger backend running at http://localhost:${PORT}`);

  // Initialize database and seed demo data
  try {
    getDb(); // Creates the DB file and tables if they don't exist
    seedDatabase(); // Creates demo account if it doesn't exist
    console.log('✅ Database ready');
  } catch (err) {
    console.error('❌ Database error:', err.message);
  }

  // Start background jobs
  startDigestJob();
  startRecurringJob();

  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
    console.log('\n⚠️  GEMINI_API_KEY not set in .env — AI chat will show a helpful message.');
    console.log('   Get a free key at: https://aistudio.google.com/app/apikey\n');
  } else {
    console.log('✅ Gemini AI connected');
  }
});

module.exports = app;
