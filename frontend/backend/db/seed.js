// db/seed.js
// This creates:
// 1. A demo account (demo@ledger.app / demo1234)
// 2. 60 days of realistic Indian expense data across all categories
// 3. Some budgets, so the budget panel looks populated
//
// Run this file once to populate the database: node db/seed.js

const { getDb } = require('./schema');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

function seedDatabase() {
  const db = getDb();

  // Check if demo account already exists — don't seed twice
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get('demo@ledger.app');
  if (existing) {
    console.log('Demo account already exists. Skipping seed.');
    return existing.id;
  }

  console.log('Seeding database with demo data...');

  // --- CREATE DEMO USER ---
  const demoId = uuidv4();
  const hash = bcrypt.hashSync('demo1234', 10); // 10 = bcrypt "cost" (higher = slower = safer)
  db.prepare(`
    INSERT INTO users (id, email, password_hash, demo_account)
    VALUES (?, ?, ?, 1)
  `).run(demoId, 'demo@ledger.app', hash);

  // --- SAMPLE EXPENSES (60 days of data) ---
  // Each item: [description, amount, category, daysAgo, confidence]
  const sampleExpenses = [
    // Food
    ['Lunch at Café Coffee Day', 380, 'Food', 1, 0.95],
    ['Swiggy - Biryani', 299, 'Food', 2, 0.97],
    ['Zomato - Pizza', 450, 'Food', 4, 0.96],
    ['Kirana grocery store', 1240, 'Food', 5, 0.88],
    ['McDonald\'s breakfast', 185, 'Food', 7, 0.98],
    ['Chai & snacks office', 60, 'Food', 8, 0.72],
    ['Big Basket monthly order', 2100, 'Food', 10, 0.91],
    ['Dinner with friends - Barbeque Nation', 890, 'Food', 12, 0.85],
    ['Swiggy Instamart', 560, 'Food', 14, 0.93],
    ['Tea stall', 30, 'Food', 15, 0.65],
    ['Zomato - Pasta', 320, 'Food', 18, 0.94],
    ['Dunzo grocery run', 780, 'Food', 20, 0.89],
    ['Office lunch', 150, 'Food', 22, 0.80],
    ['Swiggy - Dosa', 199, 'Food', 25, 0.96],
    ['Reliance Smart grocery', 1680, 'Food', 28, 0.87],
    ['Starbucks coffee', 420, 'Food', 30, 0.91],
    ['Zomato - Butter chicken', 480, 'Food', 33, 0.95],
    ['Swiggy - Idli', 149, 'Food', 35, 0.97],
    ['Bakery - bread and eggs', 95, 'Food', 38, 0.76],
    ['Restaurant anniversary dinner', 2400, 'Food', 40, 0.82],
    ['Maggi & Kurkure', 78, 'Food', 42, 0.70],
    ['Big Basket reorder', 1890, 'Food', 45, 0.90],
    ['Swiggy - Chinese', 380, 'Food', 48, 0.95],
    ['Chai biscuits meeting', 45, 'Food', 50, 0.62],
    ['Lunch dal roti', 80, 'Food', 52, 0.75],
    ['Zomato weekend order', 650, 'Food', 55, 0.93],
    ['Grocery near office', 340, 'Food', 58, 0.84],

    // Transport
    ['Ola cab to airport', 890, 'Transport', 1, 0.97],
    ['Metro monthly pass', 500, 'Transport', 3, 0.92],
    ['Rapido bike ride', 49, 'Transport', 5, 0.95],
    ['Uber to mall', 180, 'Transport', 8, 0.96],
    ['BMTC bus pass', 200, 'Transport', 10, 0.88],
    ['Petrol fill up', 1500, 'Transport', 13, 0.94],
    ['Ola cab home', 220, 'Transport', 16, 0.97],
    ['Auto rickshaw', 75, 'Transport', 19, 0.91],
    ['Rapido to office', 38, 'Transport', 22, 0.95],
    ['Uber outstation', 1200, 'Transport', 26, 0.92],
    ['Metro card recharge', 500, 'Transport', 30, 0.93],
    ['Petrol station', 1000, 'Transport', 35, 0.94],
    ['Ola mini', 145, 'Transport', 40, 0.97],
    ['Auto to metro', 60, 'Transport', 45, 0.89],
    ['Uber pool', 95, 'Transport', 50, 0.96],
    ['Rapido to gym', 42, 'Transport', 55, 0.94],

    // Entertainment
    ['Netflix subscription', 649, 'Entertainment', 2, 0.98],
    ['BookMyShow - Kalki 2898 AD', 480, 'Entertainment', 7, 0.95],
    ['Spotify premium', 119, 'Entertainment', 10, 0.97],
    ['Amazon Prime annual', 1499, 'Entertainment', 15, 0.96],
    ['Cricket match tickets', 1200, 'Entertainment', 20, 0.87],
    ['Steam game purchase', 899, 'Entertainment', 25, 0.84],
    ['Escape room with friends', 600, 'Entertainment', 32, 0.90],
    ['BookMyShow - concert', 1800, 'Entertainment', 40, 0.92],
    ['YouTube Premium', 189, 'Entertainment', 42, 0.96],

    // Health
    ['Apollo pharmacy', 580, 'Health', 3, 0.93],
    ['Gym membership March', 1200, 'Health', 5, 0.96],
    ['Doctor consultation', 500, 'Health', 12, 0.95],
    ['HealthKart supplements', 1400, 'Health', 18, 0.88],
    ['Blood test lab', 850, 'Health', 25, 0.93],
    ['Gym membership April', 1200, 'Health', 35, 0.96],
    ['Medicine - Dolo 650', 45, 'Health', 38, 0.91],
    ['Yoga class', 600, 'Health', 42, 0.87],
    ['Dentist visit', 2000, 'Health', 50, 0.94],

    // Shopping
    ['Myntra - kurtas', 1299, 'Shopping', 4, 0.89],
    ['Amazon - earphones', 1799, 'Shopping', 9, 0.86],
    ['Decathlon - shoes', 2499, 'Shopping', 15, 0.92],
    ['Nykaa skincare', 890, 'Shopping', 22, 0.88],
    ['Amazon - phone case', 349, 'Shopping', 28, 0.84],
    ['Flipkart - book set', 799, 'Shopping', 35, 0.91],
    ['H&M t-shirts', 1799, 'Shopping', 42, 0.90],
    ['Croma - USB hub', 599, 'Shopping', 50, 0.87],

    // Utilities
    ['Electricity bill', 1840, 'Utilities', 5, 0.97],
    ['Airtel broadband', 999, 'Utilities', 8, 0.98],
    ['Mobile recharge Jio', 299, 'Utilities', 10, 0.97],
    ['Water bill', 180, 'Utilities', 15, 0.95],
    ['Gas cylinder refill', 903, 'Utilities', 20, 0.96],
    ['Airtel broadband', 999, 'Utilities', 38, 0.98],
    ['Mobile recharge', 299, 'Utilities', 40, 0.97],
    ['Electricity bill', 1620, 'Utilities', 35, 0.97],

    // Education
    ['Udemy course - React', 399, 'Education', 6, 0.93],
    ['Coursera month sub', 2499, 'Education', 15, 0.91],
    ['Physical notebook set', 299, 'Education', 22, 0.80],
    ['Pen drive for college', 450, 'Education', 30, 0.82],
    ['LeetCode premium', 1700, 'Education', 45, 0.90],

    // Housing
    ['Rent March', 18000, 'Housing', 30, 1.0],
    ['Rent April', 18000, 'Housing', 60, 1.0],
    ['Society maintenance', 1200, 'Housing', 32, 0.95],
    ['Society maintenance', 1200, 'Housing', 62, 0.95],
    ['Cleaning supplies', 320, 'Housing', 10, 0.78],
    ['Light bulbs replacement', 180, 'Housing', 20, 0.75],

    // Travel
    ['IndiGo flight Bangalore-Mumbai', 4200, 'Travel', 14, 0.96],
    ['Hotel Oyo 2 nights', 2800, 'Travel', 13, 0.93],
    ['Makemytrip train booking', 750, 'Travel', 45, 0.94],
    ['Goa trip Airbnb', 6500, 'Travel', 55, 0.91],
  ];

  // Helper: get a date N days ago in YYYY-MM-DD format
  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
  }

  const insertExpense = db.prepare(`
    INSERT INTO expenses (id, user_id, description, amount, full_amount, category, date, ai_confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertActionLog = db.prepare(`
    INSERT INTO action_log (id, user_id, action_type, description, payload, undo_payload)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // Insert all sample expenses in a transaction (faster, all-or-nothing)
  const insertMany = db.transaction(() => {
    for (const [desc, amount, cat, ago, confidence] of sampleExpenses) {
      const expId = uuidv4();
      const date = daysAgo(ago);
      insertExpense.run(expId, demoId, desc, amount, amount, cat, date, confidence);

      // Log each expense so action log looks populated
      const logId = uuidv4();
      insertActionLog.run(
        logId, demoId, 'add_expense',
        `Added: ${desc} — ₹${amount} (${cat})`,
        JSON.stringify({ expense_id: expId, description: desc, amount, category: cat, date }),
        JSON.stringify({ action: 'delete', expense_id: expId })
      );
    }
  });

  insertMany();

  // --- SAMPLE BUDGETS ---
  const budgets = [
    ['Food', 8000],
    ['Transport', 3000],
    ['Entertainment', 3000],
    ['Health', 3000],
    ['Shopping', 5000],
    ['Utilities', 5000],
    ['Housing', 20000],
  ];

  const insertBudget = db.prepare(`
    INSERT OR IGNORE INTO budgets (id, user_id, category, monthly_limit)
    VALUES (?, ?, ?, ?)
  `);

  for (const [cat, limit] of budgets) {
    insertBudget.run(uuidv4(), demoId, cat, limit);
  }

  // --- CORRECTION MEMORY: a few pre-learned mappings ---
  const mappings = [
    ['swiggy', 'Food'],
    ['zomato', 'Food'],
    ['netflix', 'Entertainment'],
    ['spotify', 'Entertainment'],
    ['airtel', 'Utilities'],
    ['jio', 'Utilities'],
    ['ola', 'Transport'],
    ['uber', 'Transport'],
    ['rapido', 'Transport'],
    ['apollo', 'Health'],
    ['gym', 'Health'],
  ];

  const insertMapping = db.prepare(`
    INSERT OR IGNORE INTO category_mappings (id, user_id, description_pattern, category)
    VALUES (?, ?, ?, ?)
  `);

  for (const [pattern, cat] of mappings) {
    insertMapping.run(uuidv4(), demoId, pattern, cat);
  }

  // --- RECURRING PATTERNS: Netflix and Airtel are obvious recurring ---
  const recurringInsert = db.prepare(`
    INSERT INTO recurring_patterns (id, user_id, description, amount, detected_interval_days, next_expected)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const nextMonthStr = nextMonth.toISOString().split('T')[0];

  recurringInsert.run(uuidv4(), demoId, 'Netflix subscription', 649, 30, nextMonthStr);
  recurringInsert.run(uuidv4(), demoId, 'Airtel broadband', 999, 30, nextMonthStr);
  recurringInsert.run(uuidv4(), demoId, 'Gym membership', 1200, 30, nextMonthStr);

  console.log(`✅ Demo account created: demo@ledger.app / demo1234`);
  console.log(`✅ Inserted ${sampleExpenses.length} sample expenses`);
  console.log(`✅ Inserted ${budgets.length} budgets`);
  console.log(`✅ Inserted ${mappings.length} category mappings`);
  console.log(`✅ Detected 3 recurring patterns`);

  return demoId;
}

module.exports = { seedDatabase };

// Allow running directly: node db/seed.js
if (require.main === module) {
  seedDatabase();
  process.exit(0);
}
