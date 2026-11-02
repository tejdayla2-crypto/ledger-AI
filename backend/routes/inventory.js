const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/schema');

const router = express.Router();
const MAX_VALUE = 100000000;

function text(value, maxLength = 120) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function positiveNumber(value, { allowZero = false, integer = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number > MAX_VALUE || (allowZero ? number < 0 : number <= 0)) return null;
  if (integer && !Number.isInteger(number)) return null;
  return number;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function reportRange(query) {
  const today = new Date().toISOString().slice(0, 10);
  const from = query.from || `${today.slice(0, 7)}-01`;
  const to = query.to || today;
  return validDate(from) && validDate(to) && from <= to ? { from, to } : null;
}

function getInventory(db, userId) {
  const products = db.prepare(`
    SELECT p.*, c.name AS category_name, s.name AS supplier_name
    FROM inventory_products p
    LEFT JOIN inventory_categories c ON c.id=p.category_id AND c.user_id=p.user_id
    LEFT JOIN inventory_suppliers s ON s.id=p.supplier_id AND s.user_id=p.user_id
    WHERE p.user_id=? ORDER BY p.name COLLATE NOCASE
  `).all(userId);
  const categories = db.prepare(
    'SELECT id, name FROM inventory_categories WHERE user_id=? ORDER BY name COLLATE NOCASE'
  ).all(userId);
  const suppliers = db.prepare(
    'SELECT id, name, email, phone FROM inventory_suppliers WHERE user_id=? ORDER BY name COLLATE NOCASE'
  ).all(userId);
  const movements = db.prepare(`
    SELECT m.id, m.product_id, p.name AS product_name, m.type, m.quantity, m.note, m.created_at
    FROM inventory_movements m
    JOIN inventory_products p ON p.id=m.product_id AND p.user_id=m.user_id
    WHERE m.user_id=? ORDER BY m.created_at DESC LIMIT 12
  `).all(userId);
  const summary = db.prepare(`
    SELECT COUNT(*) AS product_count,
      COALESCE(SUM(quantity), 0) AS units_in_stock,
      COALESCE(SUM(quantity * cost_price), 0) AS stock_value,
      COALESCE(SUM(CASE WHEN quantity <= reorder_level THEN 1 ELSE 0 END), 0) AS low_stock_count
    FROM inventory_products WHERE user_id=?
  `).get(userId);

  return { products, categories, suppliers, movements, summary };
}

router.get('/', requireAuth, (req, res) => {
  res.json(getInventory(getDb(), req.user.id));
});

router.get('/movements', requireAuth, (req, res) => {
  const { from, to, limit = 100, offset = 0 } = req.query;
  if ((from || to) && (!validDate(from) || !validDate(to) || from > to)) {
    return res.status(400).json({ error: 'Use a valid date range with from and to in YYYY-MM-DD format.' });
  }
  const parsedLimit = Number(limit);
  const parsedOffset = Number(offset);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 500 || !Number.isInteger(parsedOffset) || parsedOffset < 0) {
    return res.status(400).json({ error: 'Movement limit must be between 1 and 500 and offset must be zero or greater.' });
  }
  const db = getDb();
  const params = [req.user.id];
  let dateFilter = '';
  if (from && to) {
    dateFilter = " AND date(m.created_at) BETWEEN ? AND ?";
    params.push(from, to);
  }
  params.push(parsedLimit, parsedOffset);
  const movements = db.prepare(`
    SELECT m.id, m.product_id, p.name AS product_name, p.quantity AS current_quantity,
      p.unit, m.type, m.quantity, m.note, m.created_at
    FROM inventory_movements m
    JOIN inventory_products p ON p.id=m.product_id AND p.user_id=m.user_id
    WHERE m.user_id=?${dateFilter}
    ORDER BY m.created_at DESC, m.rowid DESC LIMIT ? OFFSET ?
  `).all(...params);
  return res.json({ movements });
});

router.get('/reports', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.user.id;
  const range = reportRange(req.query);
  if (!range) return res.status(400).json({ error: 'Use a valid date range with from and to in YYYY-MM-DD format.' });
  const inventory = getInventory(db, userId);
  const categoryReport = db.prepare(`
    SELECT COALESCE(c.name, 'Uncategorized') AS category,
      COUNT(p.id) AS product_count,
      COALESCE(SUM(p.quantity), 0) AS units,
      COALESCE(SUM(p.quantity * p.cost_price), 0) AS stock_value
    FROM inventory_products p
    LEFT JOIN inventory_categories c ON c.id=p.category_id AND c.user_id=p.user_id
    WHERE p.user_id=? GROUP BY c.id, c.name ORDER BY stock_value DESC
  `).all(userId);
  const movements = db.prepare(`
    SELECT m.id, m.product_id, p.name AS product_name, p.quantity AS current_quantity,
      p.unit, m.type, m.quantity, m.note, m.created_at
    FROM inventory_movements m
    JOIN inventory_products p ON p.id=m.product_id AND p.user_id=m.user_id
    WHERE m.user_id=? AND date(m.created_at) BETWEEN ? AND ?
    ORDER BY m.created_at DESC, m.rowid DESC LIMIT 500
  `).all(userId, range.from, range.to);
  const products = db.prepare(`
    SELECT p.id, p.name, p.sku, p.quantity, p.unit, p.cost_price, p.selling_price,
      p.reorder_level, c.name AS category_name, s.name AS supplier_name,
      COALESCE((SELECT SUM(i.quantity) FROM business_purchase_items i
        JOIN business_purchases purchase ON purchase.id=i.purchase_id
        WHERE i.product_id=p.id AND purchase.user_id=p.user_id AND purchase.date BETWEEN ? AND ?), 0) AS purchased_quantity,
      COALESCE((SELECT SUM(i.quantity) FROM business_sale_items i
        JOIN business_sales sale ON sale.id=i.sale_id
        WHERE i.product_id=p.id AND sale.user_id=p.user_id AND sale.date BETWEEN ? AND ?), 0) AS sold_quantity
    FROM inventory_products p
    LEFT JOIN inventory_categories c ON c.id=p.category_id AND c.user_id=p.user_id
    LEFT JOIN inventory_suppliers s ON s.id=p.supplier_id AND s.user_id=p.user_id
    WHERE p.user_id=? ORDER BY p.name COLLATE NOCASE
  `).all(range.from, range.to, range.from, range.to, userId);
  const purchases = db.prepare(`
    SELECT purchase.id, purchase.reference, purchase.date, purchase.total,
      purchase.expense_id, supplier.name AS supplier_name, expense.amount AS expense_amount,
      (SELECT COUNT(*) FROM business_purchase_items item WHERE item.purchase_id=purchase.id) AS item_count
    FROM business_purchases purchase
    LEFT JOIN inventory_suppliers supplier ON supplier.id=purchase.supplier_id AND supplier.user_id=purchase.user_id
    JOIN expenses expense ON expense.id=purchase.expense_id AND expense.user_id=purchase.user_id
    WHERE purchase.user_id=? AND purchase.date BETWEEN ? AND ? AND expense.deleted_at IS NULL
    ORDER BY purchase.date DESC, purchase.created_at DESC
  `).all(userId, range.from, range.to);
  const purchaseItems = db.prepare(`
    SELECT item.purchase_id, item.product_id, item.name, item.quantity, item.unit_cost,
      item.line_total, purchase.date, supplier.name AS supplier_name
    FROM business_purchase_items item
    JOIN business_purchases purchase ON purchase.id=item.purchase_id
    LEFT JOIN inventory_suppliers supplier ON supplier.id=purchase.supplier_id AND supplier.user_id=purchase.user_id
    WHERE purchase.user_id=? AND purchase.date BETWEEN ? AND ?
    ORDER BY purchase.date DESC, purchase.created_at DESC
  `).all(userId, range.from, range.to);
  const lowStock = products.filter(product => product.quantity <= product.reorder_level);
  return res.json({
    range,
    summary: inventory.summary,
    categories: categoryReport,
    movements,
    products,
    low_stock: lowStock,
    purchases,
    purchase_items: purchaseItems,
    expenses: purchases.map(purchase => ({
      expense_id: purchase.expense_id,
      purchase_id: purchase.id,
      date: purchase.date,
      description: `Inventory purchase${purchase.reference ? ` ${purchase.reference}` : ''}`,
      amount: purchase.expense_amount,
      supplier_name: purchase.supplier_name
    }))
  });
});

router.post('/products', requireAuth, (req, res) => {
  const name = text(req.body.name);
  const sku = text(req.body.sku, 80) || null;
  const unit = text(req.body.unit, 30) || 'pcs';
  const quantity = positiveNumber(req.body.quantity ?? 0, { allowZero: true, integer: true });
  const reorderLevel = positiveNumber(req.body.reorder_level ?? 5, { allowZero: true, integer: true });
  const costPrice = positiveNumber(req.body.cost_price ?? 0, { allowZero: true });
  const sellingPrice = positiveNumber(req.body.selling_price ?? 0, { allowZero: true });
  if (!name || name.length > 120 || quantity === null || reorderLevel === null || costPrice === null || sellingPrice === null) {
    return res.status(400).json({ error: 'Provide a product name and valid stock, price, and reorder values.' });
  }

  const db = getDb();
  const categoryId = text(req.body.category_id, 64) || null;
  const supplierId = text(req.body.supplier_id, 64) || null;
  const userId = req.user.id;
  if (categoryId && !db.prepare('SELECT id FROM inventory_categories WHERE id=? AND user_id=?').get(categoryId, userId)) {
    return res.status(400).json({ error: 'Selected category was not found.' });
  }
  if (supplierId && !db.prepare('SELECT id FROM inventory_suppliers WHERE id=? AND user_id=?').get(supplierId, userId)) {
    return res.status(400).json({ error: 'Selected supplier was not found.' });
  }

  try {
    const id = uuidv4();
    const createProduct = db.transaction(() => {
      db.prepare(`
        INSERT INTO inventory_products (id, user_id, name, sku, category_id, supplier_id, quantity, unit, cost_price, selling_price, reorder_level)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, userId, name, sku, categoryId, supplierId, quantity, unit, costPrice, sellingPrice, reorderLevel);
      if (quantity > 0) {
        db.prepare(`
          INSERT INTO inventory_movements (id, user_id, product_id, type, quantity, note)
          VALUES (?, ?, ?, 'stock_in', ?, 'Opening stock')
        `).run(uuidv4(), userId, id, quantity);
      }
    });
    createProduct();
    return res.status(201).json({ product: getInventory(db, userId).products.find(product => product.id === id) });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'A product with this SKU already exists.' });
    throw error;
  }
});

router.put('/products/:id', requireAuth, (req, res) => {
  const name = text(req.body.name);
  const sku = text(req.body.sku, 80) || null;
  const unit = text(req.body.unit, 30) || 'pcs';
  const reorderLevel = positiveNumber(req.body.reorder_level, { allowZero: true, integer: true });
  const costPrice = positiveNumber(req.body.cost_price, { allowZero: true });
  const sellingPrice = positiveNumber(req.body.selling_price, { allowZero: true });
  if (!name || reorderLevel === null || costPrice === null || sellingPrice === null) {
    return res.status(400).json({ error: 'Provide a product name and valid price and reorder values.' });
  }

  const db = getDb();
  const userId = req.user.id;
  const categoryId = text(req.body.category_id, 64) || null;
  const supplierId = text(req.body.supplier_id, 64) || null;
  if (categoryId && !db.prepare('SELECT id FROM inventory_categories WHERE id=? AND user_id=?').get(categoryId, userId)) {
    return res.status(400).json({ error: 'Selected category was not found.' });
  }
  if (supplierId && !db.prepare('SELECT id FROM inventory_suppliers WHERE id=? AND user_id=?').get(supplierId, userId)) {
    return res.status(400).json({ error: 'Selected supplier was not found.' });
  }
  try {
    const result = db.prepare(`
      UPDATE inventory_products SET name=?, sku=?, category_id=?, supplier_id=?, unit=?,
        cost_price=?, selling_price=?, reorder_level=?, updated_at=datetime('now')
      WHERE id=? AND user_id=?
    `).run(name, sku, categoryId, supplierId, unit, costPrice, sellingPrice, reorderLevel, req.params.id, userId);
    if (!result.changes) return res.status(404).json({ error: 'Product not found.' });
    return res.json({ product: getInventory(db, userId).products.find(product => product.id === req.params.id) });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'A product with this SKU already exists.' });
    throw error;
  }
});

router.delete('/products/:id', requireAuth, (req, res) => {
  const db = getDb();
  const product = db.prepare('SELECT id FROM inventory_products WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  if (db.prepare('SELECT 1 FROM inventory_movements WHERE product_id=? LIMIT 1').get(product.id)) {
    return res.status(409).json({ error: 'Products with stock history cannot be deleted. Set their stock to zero and keep the record for reporting.' });
  }
  db.prepare('DELETE FROM inventory_products WHERE id=? AND user_id=?').run(product.id, req.user.id);
  return res.json({ success: true });
});

router.post('/categories', requireAuth, (req, res) => {
  const name = text(req.body.name);
  if (!name) return res.status(400).json({ error: 'Category name is required.' });
  try {
    const id = uuidv4();
    getDb().prepare('INSERT INTO inventory_categories (id, user_id, name) VALUES (?, ?, ?)').run(id, req.user.id, name);
    return res.status(201).json({ category: { id, name } });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'That category already exists.' });
    throw error;
  }
});

router.delete('/categories/:id', requireAuth, (req, res) => {
  const db = getDb();
  if (db.prepare('SELECT 1 FROM inventory_products WHERE category_id=? AND user_id=? LIMIT 1').get(req.params.id, req.user.id)) {
    return res.status(409).json({ error: 'Move products to another category before deleting this one.' });
  }
  const result = db.prepare('DELETE FROM inventory_categories WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Category not found.' });
  return res.json({ success: true });
});

router.post('/suppliers', requireAuth, (req, res) => {
  const name = text(req.body.name);
  const email = text(req.body.email, 180) || null;
  const phone = text(req.body.phone, 50) || null;
  if (!name) return res.status(400).json({ error: 'Supplier name is required.' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid supplier email.' });
  try {
    const id = uuidv4();
    getDb().prepare('INSERT INTO inventory_suppliers (id, user_id, name, email, phone) VALUES (?, ?, ?, ?, ?)')
      .run(id, req.user.id, name, email, phone);
    return res.status(201).json({ supplier: { id, name, email, phone } });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'That supplier already exists.' });
    throw error;
  }
});

router.put('/suppliers/:id', requireAuth, (req, res) => {
  const db = getDb();
  const supplier = db.prepare('SELECT id, name, email, phone FROM inventory_suppliers WHERE id=? AND user_id=?')
    .get(req.params.id, req.user.id);
  if (!supplier) return res.status(404).json({ error: 'Supplier not found.' });
  const name = text(req.body.name ?? supplier.name);
  const email = text(req.body.email ?? supplier.email, 180) || null;
  const phone = text(req.body.phone ?? supplier.phone, 50) || null;
  if (!name) return res.status(400).json({ error: 'Supplier name is required.' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid supplier email.' });
  try {
    db.prepare('UPDATE inventory_suppliers SET name=?, email=?, phone=? WHERE id=? AND user_id=?')
      .run(name, email, phone, supplier.id, req.user.id);
    return res.json({ supplier: { ...supplier, name, email, phone } });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'That supplier already exists.' });
    throw error;
  }
});

router.delete('/suppliers/:id', requireAuth, (req, res) => {
  const db = getDb();
  if (db.prepare('SELECT 1 FROM business_purchases WHERE supplier_id=? AND user_id=? LIMIT 1').get(req.params.id, req.user.id)) {
    return res.status(409).json({ error: 'Suppliers with purchase history cannot be deleted. Edit the supplier details to keep purchase records linked.' });
  }
  if (db.prepare('SELECT 1 FROM inventory_products WHERE supplier_id=? AND user_id=? LIMIT 1').get(req.params.id, req.user.id)) {
    return res.status(409).json({ error: 'Reassign products before deleting this supplier.' });
  }
  const result = db.prepare('DELETE FROM inventory_suppliers WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Supplier not found.' });
  return res.json({ success: true });
});

router.post('/adjustments', requireAuth, (req, res) => {
  const productId = text(req.body.product_id, 64);
  const actualQuantity = positiveNumber(req.body.actual_quantity, { allowZero: true, integer: true });
  const note = text(req.body.note, 240) || 'Physical stock count';
  if (!productId || actualQuantity === null) {
    return res.status(400).json({ error: 'Provide a product and a non-negative whole-number actual stock count.' });
  }
  const db = getDb();
  const userId = req.user.id;
  const recordAdjustment = db.transaction(() => {
    const product = db.prepare('SELECT id, quantity FROM inventory_products WHERE id=? AND user_id=?').get(productId, userId);
    if (!product) return { error: 'Product not found.', status: 404 };
    const difference = actualQuantity - product.quantity;
    if (difference === 0) return { error: 'The actual stock count matches current stock; no adjustment was recorded.', status: 400 };
    const type = difference > 0 ? 'stock_in' : 'stock_out';
    const quantity = Math.abs(difference);
    const update = db.prepare("UPDATE inventory_products SET quantity=?, updated_at=datetime('now') WHERE id=? AND user_id=?");
    if (!update.run(actualQuantity, productId, userId).changes) {
      return { error: 'Product stock changed before the adjustment completed. Refresh and try again.', status: 409 };
    }
    const id = uuidv4();
    db.prepare('INSERT INTO inventory_movements (id, user_id, product_id, type, quantity, note) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, userId, productId, type, quantity, `Adjustment: ${note}`);
    return { id };
  });
  const result = recordAdjustment.immediate();
  if (result.error) return res.status(result.status).json({ error: result.error });
  return res.status(201).json({
    movement: db.prepare(`
      SELECT id, product_id, type, quantity, note, created_at
      FROM inventory_movements WHERE id=?
    `).get(result.id)
  });
});

router.post('/movements', requireAuth, (req, res) => {
  const productId = text(req.body.product_id, 64);
  const type = req.body.type;
  const quantity = positiveNumber(req.body.quantity, { integer: true });
  const note = text(req.body.note, 240) || null;
  if (!productId || !['stock_in', 'stock_out'].includes(type) || quantity === null) {
    return res.status(400).json({ error: 'Provide a product, movement type, and positive whole-number quantity.' });
  }

  const db = getDb();
  const userId = req.user.id;
  const product = db.prepare('SELECT id, quantity FROM inventory_products WHERE id=? AND user_id=?').get(productId, userId);
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  if (type === 'stock_out' && product.quantity < quantity) {
    return res.status(400).json({ error: `Only ${product.quantity} units are currently available.` });
  }

  const recordMovement = db.transaction(() => {
    const update = type === 'stock_in'
      ? db.prepare("UPDATE inventory_products SET quantity=quantity+?, updated_at=datetime('now') WHERE id=? AND user_id=?")
      : db.prepare("UPDATE inventory_products SET quantity=quantity-?, updated_at=datetime('now') WHERE id=? AND user_id=? AND quantity>=?");
    const result = type === 'stock_in'
      ? update.run(quantity, productId, userId)
      : update.run(quantity, productId, userId, quantity);
    if (!result.changes) throw new Error('INSUFFICIENT_STOCK');
    const id = uuidv4();
    db.prepare('INSERT INTO inventory_movements (id, user_id, product_id, type, quantity, note) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, userId, productId, type, quantity, note);
    return id;
  });
  let movementId;
  try {
    movementId = recordMovement();
  } catch (error) {
    if (error.message === 'INSUFFICIENT_STOCK') return res.status(400).json({ error: 'There is not enough stock for this stock-out.' });
    throw error;
  }
  return res.status(201).json({
    movement: db.prepare('SELECT id, product_id, type, quantity, note, created_at FROM inventory_movements WHERE id=?').get(movementId)
  });
});

module.exports = router;
