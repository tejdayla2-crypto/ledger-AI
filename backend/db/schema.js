// db/schema.js
// This file creates all the database tables when the app starts for the first time.
// Think of each "CREATE TABLE" like creating a new spreadsheet with specific columns.

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../ledger.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL'); // Makes the database faster and safer
    db.pragma('foreign_keys = ON');  // Enforces relationships between tables
    
    // MONKEY PATCH: Cache prepared statements forever.
    // This prevents V8 Garbage Collection from running the Statement destructor,
    // which avoids the notorious RemoveEnvironmentCleanupHook assertion crash in Node 24.
    const originalPrepare = db.prepare.bind(db);
    const stmtCache = {};
    db.prepare = (sql) => {
      if (!stmtCache[sql]) stmtCache[sql] = originalPrepare(sql);
      return stmtCache[sql];
    };

    
    // Close the database gracefully when the process exits to prevent 
    // better-sqlite3 from causing V8 assertion failures during garbage collection
    process.on('exit', () => {
      try { if (db) db.close(); } catch(e) {}
    });
    process.on('SIGHUP', () => process.exit(128 + 1));
    process.on('SIGINT', () => process.exit(128 + 2));
    process.on('SIGTERM', () => process.exit(128 + 15));

    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    -- USERS TABLE: stores login info for each person
    -- Each row = one user account
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,          -- unique ID like "abc-123"
      email       TEXT UNIQUE NOT NULL,      -- login email
      password_hash TEXT NOT NULL,           -- bcrypt-hashed password (never plain text!)
      currency    TEXT DEFAULT 'INR',        -- currency preference
      demo_account INTEGER DEFAULT 0,        -- 1 if this is the demo account
      created_at  TEXT DEFAULT (datetime('now'))
    );

    -- EXPENSES TABLE: every single expense ever logged
    -- This is the core of the app
    CREATE TABLE IF NOT EXISTS expenses (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id),
      description   TEXT NOT NULL,           -- e.g. "Lunch at Café"
      amount        REAL NOT NULL,           -- e.g. 350.00 (user's share)
      full_amount   REAL,                    -- original amount before split
      split_count   INTEGER DEFAULT 1,       -- how many people split it
      split_note    TEXT,                    -- e.g. "Split with 2 roommates"
      category      TEXT NOT NULL DEFAULT 'Other',
      date          TEXT NOT NULL,           -- YYYY-MM-DD format
      ai_confidence REAL DEFAULT 1.0,        -- 0-1: how sure AI was about category
      deleted_at    TEXT,                    -- soft delete: null = active, date = deleted
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    -- BUDGETS TABLE: monthly spending limits per category
    -- e.g. "Food: ₹5000/month"
    CREATE TABLE IF NOT EXISTS budgets (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id),
      category      TEXT NOT NULL,
      monthly_limit REAL NOT NULL,
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, category)              -- one budget per category per user
    );

    -- CATEGORY_MAPPINGS TABLE: correction memory
    -- When a user re-tags "Swiggy" from Food to Other, we remember that
    -- Next time, we use this table BEFORE asking the AI
    CREATE TABLE IF NOT EXISTS category_mappings (
      id                  TEXT PRIMARY KEY,
      user_id             TEXT NOT NULL REFERENCES users(id),
      description_pattern TEXT NOT NULL,     -- e.g. "swiggy"
      category            TEXT NOT NULL,
      created_at          TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, description_pattern)
    );

    -- ACTION_LOG TABLE: audit trail of everything the agent did
    -- Used for: showing the user what happened + powering the Undo feature
    CREATE TABLE IF NOT EXISTS action_log (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id),
      action_type  TEXT NOT NULL,            -- e.g. "add_expense", "delete_expense"
      description  TEXT NOT NULL,            -- human-readable: "Added: Lunch ₹350"
      payload      TEXT NOT NULL,            -- JSON: what was done
      undo_payload TEXT,                     -- JSON: how to reverse it
      undone       INTEGER DEFAULT 0,        -- 1 if already undone
      created_at   TEXT DEFAULT (datetime('now'))
    );

    -- CONVERSATION_HISTORY TABLE: stores chat messages per user
    -- This lets the AI remember context ("delete THAT one" knows what "that" refers to)
    CREATE TABLE IF NOT EXISTS conversation_history (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id),
      role       TEXT NOT NULL,             -- "user" or "model"
      content    TEXT,                      -- the actual message text
      tool_calls TEXT,                      -- JSON: any tool calls made in this turn
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- RECURRING_PATTERNS TABLE: detected repeating expenses
    -- e.g. Netflix ₹199 every ~30 days
    CREATE TABLE IF NOT EXISTS recurring_patterns (
      id                    TEXT PRIMARY KEY,
      user_id               TEXT NOT NULL REFERENCES users(id),
      description           TEXT NOT NULL,
      amount                REAL NOT NULL,
      detected_interval_days INTEGER DEFAULT 30,
      auto_log              INTEGER DEFAULT 0,  -- 1 = auto-log it
      next_expected         TEXT,               -- YYYY-MM-DD
      notified              INTEGER DEFAULT 0,  -- 1 = user already told about this
      created_at            TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_expenses_user_active ON expenses(user_id, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_budgets_user_category ON budgets(user_id, category);
    CREATE INDEX IF NOT EXISTS idx_history_user_created ON conversation_history(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_action_log_user_created ON action_log(user_id, created_at);
  `);

  try {
    db.exec('ALTER TABLE users ADD COLUMN firebase_uid TEXT;');
  } catch (_) {
    // Column already exists
  }
}

module.exports = { getDb };
