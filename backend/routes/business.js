const express = require('express');
const { createHash } = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/schema');

const router = express.Router();
const MAX_VALUE = 100000000;

function cleanText(value, maxLength = 240) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function numberValue(value, { integer = false, allowZero = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number > MAX_VALUE || (allowZero ? number < 0 : number <= 0)) return null;
  return integer && !Number.isInteger(number) ? null : number;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateRange(query) {
  const today = new Date().toISOString().slice(0, 10);
  const from = query.from || `${today.slice(0, 7)}-01`;
  const to = query.to || today;
  return validDate(from) && validDate(to) && from <= to ? { from, to } : null;
}

function monthMetrics(db, userId, from, to) {
  const sales = db.prepare(`
    SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS count
    FROM business_sales WHERE user_id=? AND date BETWEEN ? AND ?
  `).get(userId, from, to);
  const expenses = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
    FROM expenses WHERE user_id=? AND deleted_at IS NULL AND date BETWEEN ? AND ?
  `).get(userId, from, to);
  const purchases = db.prepare(`
    SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS count
    FROM business_purchases WHERE user_id=? AND date BETWEEN ? AND ?
  `).get(userId, from, to);
  return { sales: sales.total, purchases: purchases.total, expenses: expenses.total, estimated_net_profit: sales.total - expenses.total, sales_count: sales.count, purchase_count: purchases.count, expense_count: expenses.count };
}

router.get('/overview', requireAuth, (req, res) => {
  const range = dateRange(req.query);
  if (!range) return res.status(400).json({ error: 'Use a valid date range with from and to in YYYY-MM-DD format.' });
  const db = getDb();
  const userId = req.user.id;
  const finance = monthMetrics(db, userId, range.from, range.to);
  const stock = db.prepare(`
    SELECT COUNT(*) AS total_products, COALESCE(SUM(quantity),0) AS available_stock,
      COALESCE(SUM(quantity * cost_price),0) AS stock_value,
      COALESCE(SUM(CASE WHEN quantity <= reorder_level THEN 1 ELSE 0 END),0) AS low_stock_count
    FROM inventory_products WHERE user_id=?
  `).get(userId);
  const lowStock = db.prepare(`
    SELECT id, name, sku, quantity, unit, reorder_level
    FROM inventory_products WHERE user_id=? AND quantity <= reorder_level
    ORDER BY quantity ASC, name COLLATE NOCASE LIMIT 8
  `).all(userId);
  const receivables = db.prepare(`
    SELECT COALESCE(SUM(total - amount_paid),0) AS pending_amount,
      COALESCE(SUM(CASE WHEN total > amount_paid THEN 1 ELSE 0 END),0) AS pending_invoice_count
    FROM business_sales WHERE user_id=?
  `).get(userId);
  return res.json({ range, finance, stock, low_stock: lowStock, receivables });
});

router.get('/sales', requireAuth, (req, res) => {
  const sales = getDb().prepare(`
    SELECT s.id, s.total, s.amount_paid, s.total-s.amount_paid AS balance_due, s.date, s.notes, s.created_at, c.name AS customer_name,
      (SELECT COUNT(*) FROM business_sale_items i WHERE i.sale_id=s.id) AS item_count
    FROM business_sales s
    LEFT JOIN business_customers c ON c.id=s.customer_id AND c.user_id=s.user_id
    WHERE s.user_id=? ORDER BY s.date DESC, s.created_at DESC LIMIT 100
  `).all(req.user.id);
  return res.json({ sales });
});

router.get('/sales/:id', requireAuth, (req, res) => {
  const db = getDb();
  const sale = db.prepare(`
    SELECT s.id, s.total, s.amount_paid, s.total-s.amount_paid AS balance_due, s.date, s.notes, s.created_at, c.name AS customer_name,
      c.email AS customer_email, c.phone AS customer_phone, c.address AS customer_address
    FROM business_sales s
    LEFT JOIN business_customers c ON c.id=s.customer_id AND c.user_id=s.user_id
    WHERE s.id=? AND s.user_id=?
  `).get(req.params.id, req.user.id);
  if (!sale) return res.status(404).json({ error: 'Sale or invoice not found.' });
  sale.items = db.prepare(`
    SELECT product_id, name, quantity, unit_price, line_total
    FROM business_sale_items WHERE sale_id=? ORDER BY rowid
  `).all(sale.id);
  return res.json({ sale });
});

router.post('/sales', requireAuth, (req, res) => {
  const userId = req.user.id;
  const customerId = cleanText(req.body.customer_id, 64) || null;
  const date = req.body.date || new Date().toISOString().slice(0, 10);
  const lines = req.body.items;
  if (!validDate(date) || !Array.isArray(lines) || lines.length < 1 || lines.length > 100) {
    return res.status(400).json({ error: 'Provide a valid sale date and between 1 and 100 sale items.' });
  }
  const db = getDb();
  if (customerId && !db.prepare('SELECT id FROM business_customers WHERE id=? AND user_id=?').get(customerId, userId)) {
    return res.status(400).json({ error: 'Selected customer was not found.' });
  }

  const saleItems = [];
  for (const line of lines) {
    const productId = cleanText(line?.product_id, 64);
    const quantity = numberValue(line?.quantity, { integer: true });
    const product = productId ? db.prepare('SELECT id, name, quantity, selling_price FROM inventory_products WHERE id=? AND user_id=?').get(productId, userId) : null;
    if (!product || quantity === null) return res.status(400).json({ error: 'Each sale line must contain an existing product and positive whole-number quantity.' });
    if (product.quantity < quantity) return res.status(400).json({ error: `Only ${product.quantity} ${product.name} available; cannot sell ${quantity}.` });
    const unitPrice = line.unit_price === undefined || line.unit_price === '' ? product.selling_price : numberValue(line.unit_price, { allowZero: true });
    if (unitPrice === null) return res.status(400).json({ error: `Enter a valid unit price for ${product.name}.` });
    const lineTotal = Math.round(unitPrice * quantity * 100) / 100;
    if (!Number.isFinite(lineTotal) || lineTotal > MAX_VALUE) return res.status(400).json({ error: `Sale total for ${product.name} is too large.` });
    saleItems.push({ ...product, quantity, unit_price: unitPrice, line_total: lineTotal });
  }

  const total = Math.round(saleItems.reduce((sum, item) => sum + item.line_total, 0) * 100) / 100;
  if (!Number.isFinite(total) || total > MAX_VALUE) return res.status(400).json({ error: 'Sale total is too large.' });
  const amountPaid = numberValue(req.body.amount_paid ?? 0, { allowZero: true });
  if (amountPaid === null || amountPaid > total) return res.status(400).json({ error: 'Amount paid must be between zero and the sale total.' });
  const id = uuidv4();
  const recordSale = db.transaction(() => {
    db.prepare('INSERT INTO business_sales (id, user_id, customer_id, total, amount_paid, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, userId, customerId, total, amountPaid, date, cleanText(req.body.notes) || null);
    for (const item of saleItems) {
      const update = db.prepare("UPDATE inventory_products SET quantity=quantity-?, updated_at=datetime('now') WHERE id=? AND user_id=? AND quantity>=?");
      if (!update.run(item.quantity, item.id, userId, item.quantity).changes) throw new Error('INSUFFICIENT_STOCK');
      db.prepare(`
        INSERT INTO business_sale_items (id, sale_id, product_id, name, quantity, unit_price, line_total)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), id, item.id, item.name, item.quantity, item.unit_price, item.line_total);
      db.prepare(`
        INSERT INTO inventory_movements (id, user_id, product_id, type, quantity, note)
        VALUES (?, ?, ?, 'stock_out', ?, ?)
      `).run(uuidv4(), userId, item.id, item.quantity, `Sale ${id.slice(0, 8)}`);
    }
    return db.prepare('SELECT id, total, amount_paid, total-amount_paid AS balance_due, date, customer_id FROM business_sales WHERE id=?').get(id);
  });
  try {
    const sale = recordSale();
    return res.status(201).json({ sale, items: saleItems.map(({ id: productId, name, quantity, unit_price, line_total }) => ({ product_id: productId, name, quantity, unit_price, line_total })) });
  } catch (error) {
    if (error.message === 'INSUFFICIENT_STOCK') return res.status(400).json({ error: 'Stock changed before the sale completed. Refresh inventory and try again.' });
    throw error;
  }
});

router.post('/sales/:id/payment', requireAuth, (req, res) => {
  const amount = numberValue(req.body.amount, { allowZero: false });
  if (amount === null) return res.status(400).json({ error: 'Payment amount must be a positive number.' });
  const db = getDb();
  const applyPayment = db.transaction(() => {
    const result = db.prepare(`
      UPDATE business_sales SET amount_paid=amount_paid+?
      WHERE id=? AND user_id=? AND amount_paid+? <= total
    `).run(amount, req.params.id, req.user.id, amount);
    if (!result.changes) {
      const sale = db.prepare('SELECT total, amount_paid FROM business_sales WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
      if (!sale) return { error: 'Sale not found.', status: 404 };
      return { error: `Payment exceeds the remaining balance of ₹${(sale.total - sale.amount_paid).toFixed(2)}.`, status: 400 };
    }
    return db.prepare('SELECT id, total, amount_paid, total-amount_paid AS balance_due FROM business_sales WHERE id=?').get(req.params.id);
  });
  const sale = applyPayment();
  if (sale.error) return res.status(sale.status).json({ error: sale.error });
  return res.json({ sale });
});

router.get('/purchases', requireAuth, (req, res) => {
  const purchases = getDb().prepare(`
    SELECT p.id, p.reference, p.total, p.date, p.notes, p.created_at, s.name AS supplier_name,
      (SELECT COUNT(*) FROM business_purchase_items i WHERE i.purchase_id=p.id) AS item_count
    FROM business_purchases p
    LEFT JOIN inventory_suppliers s ON s.id=p.supplier_id AND s.user_id=p.user_id
    WHERE p.user_id=? ORDER BY p.date DESC, p.created_at DESC LIMIT 100
  `).all(req.user.id);
  return res.json({ purchases });
});

router.post('/purchases', requireAuth, (req, res) => {
  const userId = req.user.id;
  const supplierId = cleanText(req.body.supplier_id, 64) || null;
  const reference = cleanText(req.body.reference, 100) || null;
  const idempotencyKey = req.get('Idempotency-Key') || null;
  const date = req.body.date || new Date().toISOString().slice(0, 10);
  const lines = req.body.items;
  if (idempotencyKey && (idempotencyKey.length > 128 || !/^[a-zA-Z0-9._:-]+$/.test(idempotencyKey))) {
    return res.status(400).json({ error: 'Idempotency-Key must contain 1 to 128 letters, numbers, periods, underscores, colons, or hyphens.' });
  }
  if (!validDate(date) || !Array.isArray(lines) || lines.length < 1 || lines.length > 100) {
    return res.status(400).json({ error: 'Provide a valid purchase date and between 1 and 100 purchase items.' });
  }
  const db = getDb();
  if (supplierId && !db.prepare('SELECT id FROM inventory_suppliers WHERE id=? AND user_id=?').get(supplierId, userId)) {
    return res.status(400).json({ error: 'Selected supplier was not found.' });
  }
  const purchaseItems = [];
  for (const line of lines) {
    const productId = cleanText(line?.product_id, 64);
    const quantity = numberValue(line?.quantity, { integer: true });
    const unitCost = numberValue(line?.unit_cost, { allowZero: true });
    const product = productId ? db.prepare('SELECT id, name FROM inventory_products WHERE id=? AND user_id=?').get(productId, userId) : null;
    if (!product || quantity === null || unitCost === null) {
      return res.status(400).json({ error: 'Each purchase line must contain an existing product, positive whole-number quantity, and valid unit cost.' });
    }
    const lineTotal = Math.round(quantity * unitCost * 100) / 100;
    if (!Number.isFinite(lineTotal) || lineTotal > MAX_VALUE) return res.status(400).json({ error: `Purchase total for ${product.name} is too large.` });
    purchaseItems.push({ ...product, quantity, unit_cost: unitCost, line_total: lineTotal });
  }
  const total = Math.round(purchaseItems.reduce((sum, item) => sum + item.line_total, 0) * 100) / 100;
  if (!Number.isFinite(total) || total > MAX_VALUE) return res.status(400).json({ error: 'Purchase total is too large.' });
  const notes = cleanText(req.body.notes) || null;
  const requestHash = createHash('sha256').update(JSON.stringify({
    supplier_id: supplierId,
    reference,
    date,
    notes,
    items: purchaseItems.map(item => ({ product_id: item.id, quantity: item.quantity, unit_cost: item.unit_cost }))
  })).digest('hex');
  if (idempotencyKey) {
    const existing = db.prepare(`
      SELECT p.id, p.reference, p.total, p.date, p.expense_id, s.name AS supplier_name, p.request_hash
      FROM business_purchases p
      LEFT JOIN inventory_suppliers s ON s.id=p.supplier_id AND s.user_id=p.user_id
      WHERE p.user_id=? AND p.idempotency_key=?
    `).get(userId, idempotencyKey);
    if (existing) {
      if (existing.request_hash !== requestHash) {
        return res.status(409).json({ error: 'This Idempotency-Key was already used for a different purchase.' });
      }
      return res.status(200).json({
        purchase: {
          id: existing.id,
          reference: existing.reference,
          total: existing.total,
          date: existing.date,
          supplier_name: existing.supplier_name || 'Supplier',
          expense_id: existing.expense_id
        },
        replayed: true
      });
    }
  }
  const id = uuidv4();
  const expenseId = uuidv4();
  const supplierName = supplierId ? db.prepare('SELECT name FROM inventory_suppliers WHERE id=? AND user_id=?').get(supplierId, userId).name : 'Supplier';
  const createPurchase = db.transaction(() => {
    db.prepare(`
      INSERT INTO expenses (id, user_id, description, amount, category, date)
      VALUES (?, ?, ?, ?, 'Purchases', ?)
    `).run(expenseId, userId, `Purchase${reference ? ` ${reference}` : ''} - ${supplierName}`, total, date);
    db.prepare(`
      INSERT INTO business_purchases (id, user_id, supplier_id, reference, total, date, notes, expense_id, idempotency_key, request_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, supplierId, reference, total, date, notes, expenseId, idempotencyKey, requestHash);
    for (const item of purchaseItems) {
      db.prepare(`
        INSERT INTO business_purchase_items (id, purchase_id, product_id, name, quantity, unit_cost, line_total)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), id, item.id, item.name, item.quantity, item.unit_cost, item.line_total);
      db.prepare("UPDATE inventory_products SET quantity=quantity+?, cost_price=?, updated_at=datetime('now') WHERE id=? AND user_id=?")
        .run(item.quantity, item.unit_cost, item.id, userId);
      db.prepare(`
        INSERT INTO inventory_movements (id, user_id, product_id, type, quantity, note)
        VALUES (?, ?, ?, 'stock_in', ?, ?)
      `).run(uuidv4(), userId, item.id, item.quantity, `Purchase ${reference || id.slice(0, 8)}`);
    }
  });
  try {
    createPurchase();
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' && reference) return res.status(409).json({ error: 'A purchase with this reference already exists.' });
    throw error;
  }
  return res.status(201).json({ purchase: { id, reference, total, date, supplier_name: supplierName, expense_id: expenseId } });
});

router.get('/customers', requireAuth, (req, res) => {
  const customers = getDb().prepare(`
    SELECT c.id, c.name, c.email, c.phone, c.address, c.created_at,
      COUNT(s.id) AS purchase_count, COALESCE(SUM(s.total),0) AS total_spent,
      COALESCE(SUM(s.total-s.amount_paid),0) AS pending_amount,
      MAX(s.date) AS last_purchase_date
    FROM business_customers c
    LEFT JOIN business_sales s ON s.customer_id=c.id AND s.user_id=c.user_id
    WHERE c.user_id=? GROUP BY c.id ORDER BY c.name COLLATE NOCASE
  `).all(req.user.id);
  return res.json({ customers });
});

router.get('/customers/:id/history', requireAuth, (req, res) => {
  const db = getDb();
  const customer = db.prepare('SELECT id FROM business_customers WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });
  const history = db.prepare(`
    SELECT id, total, amount_paid, total-amount_paid AS balance_due, date, notes
    FROM business_sales WHERE customer_id=? AND user_id=? ORDER BY date DESC, created_at DESC
  `).all(customer.id, req.user.id).map(sale => ({
    ...sale,
    items: db.prepare(`
      SELECT name, quantity, unit_price, line_total FROM business_sale_items
      WHERE sale_id=? ORDER BY rowid
    `).all(sale.id)
  }));
  return res.json({ history });
});

router.get('/suppliers', requireAuth, (req, res) => {
  const suppliers = getDb().prepare(`
    SELECT s.id, s.name, s.email, s.phone, s.created_at,
      COUNT(p.id) AS purchase_count, COALESCE(SUM(p.total),0) AS total_purchased,
      MAX(p.date) AS last_purchase_date
    FROM inventory_suppliers s
    LEFT JOIN business_purchases p ON p.supplier_id=s.id AND p.user_id=s.user_id
    WHERE s.user_id=? GROUP BY s.id ORDER BY s.name COLLATE NOCASE
  `).all(req.user.id);
  return res.json({ suppliers });
});

router.get('/suppliers/:id/history', requireAuth, (req, res) => {
  const db = getDb();
  const supplier = db.prepare('SELECT id FROM inventory_suppliers WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!supplier) return res.status(404).json({ error: 'Supplier not found.' });
  const history = db.prepare(`
    SELECT id, reference, total, date, notes
    FROM business_purchases WHERE supplier_id=? AND user_id=? ORDER BY date DESC, created_at DESC
  `).all(supplier.id, req.user.id).map(purchase => ({
    ...purchase,
    items: db.prepare(`
      SELECT name, quantity, unit_cost, line_total FROM business_purchase_items
      WHERE purchase_id=? ORDER BY rowid
    `).all(purchase.id)
  }));
  return res.json({ history });
});

router.post('/customers', requireAuth, (req, res) => {
  const name = cleanText(req.body.name, 120);
  const email = cleanText(req.body.email, 180).toLowerCase() || null;
  const phone = cleanText(req.body.phone, 50) || null;
  const address = cleanText(req.body.address, 300) || null;
  if (!name) return res.status(400).json({ error: 'Customer name is required.' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid customer email.' });
  try {
    const id = uuidv4();
    getDb().prepare('INSERT INTO business_customers (id, user_id, name, email, phone, address) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, req.user.id, name, email, phone, address);
    return res.status(201).json({ customer: { id, name, email, phone, address, purchase_count: 0, total_spent: 0 } });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'A customer with this email already exists.' });
    throw error;
  }
});

router.put('/customers/:id', requireAuth, (req, res) => {
  const db = getDb();
  const customer = db.prepare('SELECT id, name, email, phone, address FROM business_customers WHERE id=? AND user_id=?')
    .get(req.params.id, req.user.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });
  const name = cleanText(req.body.name ?? customer.name, 120);
  const email = cleanText(req.body.email ?? customer.email, 180).toLowerCase() || null;
  const phone = cleanText(req.body.phone ?? customer.phone, 50) || null;
  const address = cleanText(req.body.address ?? customer.address, 300) || null;
  if (!name) return res.status(400).json({ error: 'Customer name is required.' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid customer email.' });
  try {
    db.prepare('UPDATE business_customers SET name=?, email=?, phone=?, address=? WHERE id=? AND user_id=?')
      .run(name, email, phone, address, customer.id, req.user.id);
    return res.json({ customer: { ...customer, name, email, phone, address } });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'A customer with this email already exists.' });
    throw error;
  }
});

router.delete('/customers/:id', requireAuth, (req, res) => {
  if (getDb().prepare('SELECT 1 FROM business_sales WHERE customer_id=? AND user_id=? LIMIT 1').get(req.params.id, req.user.id)) {
    return res.status(409).json({ error: 'Customers with sales history cannot be deleted. Edit the customer details to keep invoices linked.' });
  }
  const result = getDb().prepare('DELETE FROM business_customers WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Customer not found.' });
  return res.json({ success: true });
});

router.get('/reports', requireAuth, (req, res) => {
  const range = dateRange(req.query);
  if (!range) return res.status(400).json({ error: 'Use a valid date range with from and to in YYYY-MM-DD format.' });
  const db = getDb();
  const userId = req.user.id;
  const finance = monthMetrics(db, userId, range.from, range.to);
  const sales = db.prepare(`
    SELECT s.id, s.date, s.total, c.name AS customer_name,
      (SELECT COUNT(*) FROM business_sale_items i WHERE i.sale_id=s.id) AS item_count
    FROM business_sales s LEFT JOIN business_customers c ON c.id=s.customer_id AND c.user_id=s.user_id
    WHERE s.user_id=? AND s.date BETWEEN ? AND ? ORDER BY s.date DESC
  `).all(userId, range.from, range.to);
  const purchases = db.prepare(`
    SELECT p.id, p.date, p.total, p.reference, s.name AS supplier_name,
      (SELECT COUNT(*) FROM business_purchase_items i WHERE i.purchase_id=p.id) AS item_count
    FROM business_purchases p LEFT JOIN inventory_suppliers s ON s.id=p.supplier_id AND s.user_id=p.user_id
    WHERE p.user_id=? AND p.date BETWEEN ? AND ? ORDER BY p.date DESC
  `).all(userId, range.from, range.to);
  const expenses = db.prepare(`
    SELECT category, COALESCE(SUM(amount),0) AS total, COUNT(*) AS count
    FROM expenses WHERE user_id=? AND deleted_at IS NULL AND date BETWEEN ? AND ?
    GROUP BY category ORDER BY total DESC
  `).all(userId, range.from, range.to);
  const products = db.prepare(`
    SELECT p.id, p.name, p.quantity, p.unit, p.cost_price, p.selling_price, p.reorder_level,
      COALESCE((SELECT SUM(i.quantity) FROM business_sale_items i JOIN business_sales s ON s.id=i.sale_id
        WHERE i.product_id=p.id AND s.user_id=p.user_id AND s.date BETWEEN ? AND ?),0) AS units_sold
    FROM inventory_products p WHERE p.user_id=? ORDER BY units_sold DESC
  `).all(range.from, range.to, userId);
  return res.json({ range, finance, sales, purchases, expenses, products });
});

router.get('/assistant', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.user.id;
  const lowStock = db.prepare(`
    SELECT name, quantity, unit, reorder_level FROM inventory_products
    WHERE user_id=? AND quantity <= reorder_level ORDER BY quantity ASC LIMIT 5
  `).all(userId);
  const spend = db.prepare(`
    SELECT category, SUM(amount) AS total FROM expenses
    WHERE user_id=? AND deleted_at IS NULL AND date >= date('now', 'start of month')
    GROUP BY category ORDER BY total DESC LIMIT 3
  `).all(userId);
  const insights = [];
  if (lowStock.length) {
    insights.push({
      type: 'stock',
      title: `${lowStock.length} product${lowStock.length === 1 ? '' : 's'} need a restock review`,
      detail: lowStock.map(item => `${item.name} (${item.quantity} ${item.unit}, reorder at ${item.reorder_level})`).join('; ')
    });
  } else {
    insights.push({ type: 'positive', title: 'Stock levels are healthy', detail: 'No products are currently at or below their reorder points.' });
  }
  if (spend.length) {
    insights.push({
      type: 'saving',
      title: `Review ${spend[0].category.toLowerCase()} spending`,
      detail: `${spend[0].category} is your highest tracked expense this month at ₹${Number(spend[0].total).toLocaleString('en-IN')}. Compare recent supplier prices and recurring costs for savings.`
    });
  } else {
    insights.push({ type: 'saving', title: 'Start tracking costs', detail: 'Record purchases and expenses to get data-based cost-saving suggestions here.' });
  }
  const margin = db.prepare(`
    SELECT COALESCE(SUM(s.total),0) AS sales,
      COALESCE((SELECT SUM(amount) FROM expenses WHERE user_id=? AND deleted_at IS NULL AND date >= date('now','start of month')),0) AS expenses
    FROM business_sales s WHERE s.user_id=? AND s.date >= date('now','start of month')
  `).get(userId, userId);
  if (margin.sales > 0 && margin.expenses > margin.sales) {
    insights.push({ type: 'attention', title: 'Expenses exceed sales this month', detail: 'Review discretionary spending, purchase quantities, and product pricing to improve your estimated net profit.' });
  }
  return res.json({ insights, source: 'Current inventory, sales, and expense records' });
});

router.post('/assistant', requireAuth, async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    return res.status(503).json({ error: 'Configure GEMINI_API_KEY on the backend to enable AI-generated business analysis. Data-based insights remain available.' });
  }

  const db = getDb();
  const userId = req.user.id;
  const metrics = monthMetrics(db, userId, new Date().toISOString().slice(0, 8) + '01', new Date().toISOString().slice(0, 10));
  const stock = db.prepare(`
    SELECT COUNT(*) AS products, COALESCE(SUM(quantity),0) AS available_units,
      COALESCE(SUM(quantity * cost_price),0) AS stock_value
    FROM inventory_products WHERE user_id=?
  `).get(userId);
  const lowStock = db.prepare(`
    SELECT name, quantity, unit, reorder_level FROM inventory_products
    WHERE user_id=? AND quantity <= reorder_level ORDER BY quantity LIMIT 10
  `).all(userId);
  const expenseCategories = db.prepare(`
    SELECT category, SUM(amount) AS total FROM expenses
    WHERE user_id=? AND deleted_at IS NULL AND date >= date('now', 'start of month')
    GROUP BY category ORDER BY total DESC LIMIT 5
  `).all(userId);

  try {
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: 'gemini-3.6-flash' });
    const result = await model.generateContent([
      'You are Ledger, a concise small-business operations assistant.',
      'Analyze only the verified business data below. Do not invent figures, claim actions were taken, or present general guidance as a fact about this business.',
      'Give up to three practical observations, including stock reorders and cost-saving ideas when supported by the data. Use Indian rupees and plain language. If data is sparse, say so. Keep the response under 180 words.',
      JSON.stringify({ period: 'current month to date', finance: metrics, inventory: stock, low_stock_products: lowStock, expense_categories: expenseCategories })
    ].join('\n\n'));
    return res.json({ reply: result.response.text() });
  } catch {
    console.error('Business AI analysis request failed.');
    return res.status(503).json({ error: 'AI business analysis is temporarily unavailable. Your inventory and financial data are unchanged.' });
  }
});

module.exports = router;
