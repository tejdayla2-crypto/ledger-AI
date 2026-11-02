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

    CREATE TABLE IF NOT EXISTS income_records (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id),
      description TEXT NOT NULL,
      amount      REAL NOT NULL CHECK(amount > 0),
      category    TEXT NOT NULL DEFAULT 'Other',
      date        TEXT NOT NULL,
      deleted_at  TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS monthly_report_snapshots (
      user_id      TEXT NOT NULL REFERENCES users(id),
      month        TEXT NOT NULL,
      report_json  TEXT NOT NULL,
      generated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, month)
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

    CREATE TABLE IF NOT EXISTS budget_alerts (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id),
      budget_id     TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
      month         TEXT NOT NULL,
      threshold     INTEGER NOT NULL,
      spent         REAL NOT NULL,
      monthly_limit REAL NOT NULL,
      created_at    TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, budget_id, month, threshold)
    );

    CREATE TABLE IF NOT EXISTS receipt_scans (
      id                   TEXT PRIMARY KEY,
      user_id              TEXT NOT NULL REFERENCES users(id),
      image_hash           TEXT NOT NULL,
      extracted_json       TEXT NOT NULL,
      status               TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed')),
      confirmed_expense_id TEXT REFERENCES expenses(id),
      created_at           TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, image_hash)
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

    CREATE TABLE IF NOT EXISTS inventory_categories (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id),
      name       TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS inventory_suppliers (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id),
      name       TEXT NOT NULL,
      email      TEXT,
      phone      TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS inventory_products (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id),
      name         TEXT NOT NULL,
      sku          TEXT,
      category_id  TEXT REFERENCES inventory_categories(id) ON DELETE SET NULL,
      supplier_id  TEXT REFERENCES inventory_suppliers(id) ON DELETE SET NULL,
      quantity     INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
      unit         TEXT NOT NULL DEFAULT 'pcs',
      cost_price   REAL NOT NULL DEFAULT 0 CHECK(cost_price >= 0),
      selling_price REAL NOT NULL DEFAULT 0 CHECK(selling_price >= 0),
      reorder_level INTEGER NOT NULL DEFAULT 5 CHECK(reorder_level >= 0),
      created_at   TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, sku)
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id),
      product_id TEXT NOT NULL REFERENCES inventory_products(id) ON DELETE RESTRICT,
      type       TEXT NOT NULL CHECK(type IN ('stock_in', 'stock_out')),
      quantity   INTEGER NOT NULL CHECK(quantity > 0),
      note       TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS business_customers (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id),
      name       TEXT NOT NULL,
      email      TEXT,
      phone      TEXT,
      address    TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, email)
    );

    CREATE TABLE IF NOT EXISTS business_sales (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id),
      customer_id TEXT REFERENCES business_customers(id) ON DELETE SET NULL,
      total       REAL NOT NULL CHECK(total >= 0),
      amount_paid REAL NOT NULL DEFAULT 0 CHECK(amount_paid >= 0 AND amount_paid <= total),
      date        TEXT NOT NULL,
      notes       TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS business_sale_items (
      id         TEXT PRIMARY KEY,
      sale_id    TEXT NOT NULL REFERENCES business_sales(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES inventory_products(id) ON DELETE RESTRICT,
      name       TEXT NOT NULL,
      quantity   INTEGER NOT NULL CHECK(quantity > 0),
      unit_price REAL NOT NULL CHECK(unit_price >= 0),
      line_total REAL NOT NULL CHECK(line_total >= 0)
    );

    CREATE TABLE IF NOT EXISTS business_purchases (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id),
      supplier_id TEXT REFERENCES inventory_suppliers(id) ON DELETE SET NULL,
      reference   TEXT,
      total       REAL NOT NULL CHECK(total >= 0),
      date        TEXT NOT NULL,
      notes       TEXT,
      expense_id  TEXT NOT NULL UNIQUE REFERENCES expenses(id),
      idempotency_key TEXT,
      request_hash TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, reference)
    );

    CREATE TABLE IF NOT EXISTS business_purchase_items (
      id          TEXT PRIMARY KEY,
      purchase_id TEXT NOT NULL REFERENCES business_purchases(id) ON DELETE CASCADE,
      product_id  TEXT NOT NULL REFERENCES inventory_products(id) ON DELETE RESTRICT,
      name        TEXT NOT NULL,
      quantity    INTEGER NOT NULL CHECK(quantity > 0),
      unit_cost   REAL NOT NULL CHECK(unit_cost >= 0),
      line_total  REAL NOT NULL CHECK(line_total >= 0)
    );

    CREATE INDEX IF NOT EXISTS idx_business_sales_user_date ON business_sales(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_business_purchases_user_date ON business_purchases(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_business_customers_user ON business_customers(user_id, name);
    CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_expenses_user_active ON expenses(user_id, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_income_user_date ON income_records(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_budgets_user_category ON budgets(user_id, category);
    CREATE INDEX IF NOT EXISTS idx_budget_alerts_user_month ON budget_alerts(user_id, month);
    CREATE INDEX IF NOT EXISTS idx_receipt_scans_user_created ON receipt_scans(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_history_user_created ON conversation_history(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_action_log_user_created ON action_log(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_inventory_products_user ON inventory_products(user_id, name);
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_user_created ON inventory_movements(user_id, created_at);
  `);

  try {
    db.exec('ALTER TABLE users ADD COLUMN firebase_uid TEXT;');
  } catch (_) {
    // Column already exists
  }
  try {
    db.exec('ALTER TABLE business_sales ADD COLUMN amount_paid REAL NOT NULL DEFAULT 0 CHECK(amount_paid >= 0 AND amount_paid <= total);');
  } catch (_) {
    // Column already exists
  }
  const purchaseColumns = db.prepare('PRAGMA table_info(business_purchases)').all();
  if (!purchaseColumns.some(column => column.name === 'idempotency_key')) {
    db.exec('ALTER TABLE business_purchases ADD COLUMN idempotency_key TEXT;');
  }
  if (!purchaseColumns.some(column => column.name === 'request_hash')) {
    db.exec('ALTER TABLE business_purchases ADD COLUMN request_hash TEXT;');
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_business_purchases_user_idempotency
    ON business_purchases(user_id, idempotency_key)
  `);
}

module.exports = { getDb };
