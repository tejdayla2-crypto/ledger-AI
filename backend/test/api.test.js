const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { v4: uuidv4 } = require('uuid');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getDb } = require('../db/schema');
const { executeTool } = require('../agent/executor');
const { shiftMonth } = require('../lib/monthlyReports');

process.env.JWT_SECRET = 'test-secret-that-is-long-and-random-123456789';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';

const app = require('../server');

let server;
let baseUrl;
const inventoryTestUserIds = [];
const expenseTestUserIds = [];

test.before(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  const db = getDb();
  if (inventoryTestUserIds.length > 0) {
    const cleanup = db.transaction(() => {
      for (const userId of inventoryTestUserIds) {
        const purchaseExpenses = db.prepare('SELECT expense_id FROM business_purchases WHERE user_id=?').all(userId);
        db.prepare('DELETE FROM business_sale_items WHERE sale_id IN (SELECT id FROM business_sales WHERE user_id=?)').run(userId);
        db.prepare('DELETE FROM business_purchase_items WHERE purchase_id IN (SELECT id FROM business_purchases WHERE user_id=?)').run(userId);
        db.prepare('DELETE FROM business_sales WHERE user_id=?').run(userId);
        db.prepare('DELETE FROM business_purchases WHERE user_id=?').run(userId);
        for (const { expense_id: expenseId } of purchaseExpenses) {
          db.prepare('DELETE FROM expenses WHERE id=?').run(expenseId);
        }
        db.prepare('DELETE FROM business_customers WHERE user_id=?').run(userId);
        db.prepare('DELETE FROM inventory_movements WHERE user_id=?').run(userId);
        db.prepare('DELETE FROM inventory_products WHERE user_id=?').run(userId);
        db.prepare('DELETE FROM inventory_categories WHERE user_id=?').run(userId);
        db.prepare('DELETE FROM inventory_suppliers WHERE user_id=?').run(userId);
        db.prepare('DELETE FROM users WHERE id=?').run(userId);
      }
    });
    cleanup();
  }
  const financialCleanup = db.transaction(() => {
    for (const userId of expenseTestUserIds) {
      db.prepare('DELETE FROM category_mappings WHERE user_id=?').run(userId);
      db.prepare('DELETE FROM action_log WHERE user_id=?').run(userId);
      db.prepare('DELETE FROM conversation_history WHERE user_id=?').run(userId);
      db.prepare('DELETE FROM recurring_patterns WHERE user_id=?').run(userId);
      db.prepare('DELETE FROM receipt_scans WHERE user_id=?').run(userId);
      db.prepare('DELETE FROM monthly_report_snapshots WHERE user_id=?').run(userId);
      db.prepare('DELETE FROM budgets WHERE user_id=?').run(userId);
      db.prepare('DELETE FROM income_records WHERE user_id=?').run(userId);
      db.prepare('DELETE FROM expenses WHERE user_id=?').run(userId);
      db.prepare('DELETE FROM users WHERE id=?').run(userId);
    }
  });
  financialCleanup();
});

async function signup(email) {
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'test-password-123' })
  });
  assert.equal(response.status, 200);
  return { cookie: response.headers.get('set-cookie'), body: await response.json() };
}

async function withGeminiMock(generateContent, operation) {
  const original = GoogleGenerativeAI.prototype.getGenerativeModel;
  GoogleGenerativeAI.prototype.getGenerativeModel = function getGenerativeModel(options) {
    return { generateContent: content => generateContent(content, options) };
  };
  try {
    await operation();
  } finally {
    GoogleGenerativeAI.prototype.getGenerativeModel = original;
  }
}

test('health endpoint responds', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
});

test('users can create expenses but cannot read another user data', async () => {
  const first = await signup(`test_${Date.now()}_one@example.com`);
  const second = await signup(`test_${Date.now()}_two@example.com`);

  const createResponse = await fetch(`${baseUrl}/api/expenses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: first.cookie },
    body: JSON.stringify({ description: 'Test lunch', amount: 250, date: '2026-09-04' })
  });
  assert.equal(createResponse.status, 200);

  const firstExpenses = await fetch(`${baseUrl}/api/expenses`, { headers: { cookie: first.cookie } });
  const secondExpenses = await fetch(`${baseUrl}/api/expenses`, { headers: { cookie: second.cookie } });
  assert.equal((await firstExpenses.json()).expenses.some(expense => expense.description === 'Test lunch'), true);
  assert.equal((await secondExpenses.json()).expenses.some(expense => expense.description === 'Test lunch'), false);
});

test('expense validation rejects invalid values', async () => {
  const account = await signup(`test_${Date.now()}_invalid@example.com`);
  const response = await fetch(`${baseUrl}/api/expenses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: account.cookie },
    body: JSON.stringify({ description: 'Invalid', amount: -10, date: 'not-a-date' })
  });
  assert.equal(response.status, 400);
});

test('expense tracking supports CRUD, income, budgets, and user isolation', async () => {
  const owner = await signup(`expense_${Date.now()}_owner@example.com`);
  const other = await signup(`expense_${Date.now()}_other@example.com`);
  expenseTestUserIds.push(owner.body.user.id, other.body.user.id);
  const headers = { 'content-type': 'application/json', cookie: owner.cookie };
  const date = new Date().toISOString().slice(0, 10);

  const createdExpenseResponse = await fetch(`${baseUrl}/api/expenses`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ description: 'Monthly expense test', amount: 27, category: 'Food', date })
  });
  assert.equal(createdExpenseResponse.status, 200);
  const createdExpense = (await createdExpenseResponse.json()).expense;
  assert.equal(createdExpense.amount, 27);

  const updatedExpenseResponse = await fetch(`${baseUrl}/api/expenses/${createdExpense.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ description: 'Updated expense test', amount: 30, category: 'Food', date })
  });
  assert.equal(updatedExpenseResponse.status, 200);
  assert.equal((await updatedExpenseResponse.json()).expense.amount, 30);

  const foreignExpensesResponse = await fetch(`${baseUrl}/api/expenses`, { headers: { cookie: other.cookie } });
  assert.equal((await foreignExpensesResponse.json()).expenses.some(expense => expense.id === createdExpense.id), false);

  const incomeResponse = await fetch(`${baseUrl}/api/income`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ description: 'Freelance project', amount: 300, category: 'Freelancing', date })
  });
  assert.equal(incomeResponse.status, 201);
  const createdIncome = (await incomeResponse.json()).income;
  assert.equal(createdIncome.category, 'Freelancing');
  const incomeListResponse = await fetch(`${baseUrl}/api/income?from=${date}`, { headers: { cookie: owner.cookie } });
  const incomeList = await incomeListResponse.json();
  assert.equal(incomeListResponse.status, 200);
  assert.equal(incomeList.total, 1);
  assert.equal(incomeList.income[0].id, createdIncome.id);

  const financialSummaryResponse = await fetch(`${baseUrl}/api/summary?period=this_month`, { headers: { cookie: owner.cookie } });
  const financialSummary = await financialSummaryResponse.json();
  assert.equal(financialSummary.total, 30);
  assert.equal(financialSummary.income_total, 300);
  assert.equal(financialSummary.income_transaction_count, 1);
  assert.equal(financialSummary.balance, 270);

  for (const source of ['Salary', 'Business', 'Investment Returns', 'Other']) {
    const sourceResponse = await fetch(`${baseUrl}/api/income`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ description: `${source} source test`, amount: 25, category: source, date })
    });
    assert.equal(sourceResponse.status, 201);
    const sourceRecord = (await sourceResponse.json()).income;
    assert.equal(sourceRecord.category, source);
    const sourceDeleteResponse = await fetch(`${baseUrl}/api/income/${sourceRecord.id}`, {
      method: 'DELETE',
      headers
    });
    assert.equal(sourceDeleteResponse.status, 200);
  }

  const invalidIncomeResponse = await fetch(`${baseUrl}/api/income`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ description: 'Invalid income', amount: -1, category: 'Salary', date })
  });
  assert.equal(invalidIncomeResponse.status, 400);
  const invalidSourceResponse = await fetch(`${baseUrl}/api/income`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ description: 'Unsupported source', amount: 50, category: 'Gift', date })
  });
  assert.equal(invalidSourceResponse.status, 400);
  const foreignIncomeResponse = await fetch(`${baseUrl}/api/income`, { headers: { cookie: other.cookie } });
  assert.equal((await foreignIncomeResponse.json()).income.some(record => record.id === createdIncome.id), false);

  const updatedIncomeResponse = await fetch(`${baseUrl}/api/income/${createdIncome.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ amount: 350 })
  });
  assert.equal(updatedIncomeResponse.status, 200);
  assert.equal((await updatedIncomeResponse.json()).income.amount, 350);
  const updatedSummaryResponse = await fetch(`${baseUrl}/api/summary?period=this_month`, { headers: { cookie: owner.cookie } });
  assert.equal((await updatedSummaryResponse.json()).balance, 320);
  const incomeDeleteResponse = await fetch(`${baseUrl}/api/income/${createdIncome.id}`, {
    method: 'DELETE',
    headers
  });
  assert.equal(incomeDeleteResponse.status, 200);
  assert.equal((await (await fetch(`${baseUrl}/api/income`, { headers: { cookie: owner.cookie } })).json()).income.length, 0);
  const deletedIncomeSummaryResponse = await fetch(`${baseUrl}/api/summary?period=this_month`, { headers: { cookie: owner.cookie } });
  const deletedIncomeSummary = await deletedIncomeSummaryResponse.json();
  assert.equal(deletedIncomeSummary.income_total, 0);
  assert.equal(deletedIncomeSummary.income_transaction_count, 0);
  assert.equal(deletedIncomeSummary.balance, -30);

  const budgetResponse = await fetch(`${baseUrl}/api/budgets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ category: 'Food', monthly_limit: 500 })
  });
  assert.equal(budgetResponse.status, 200);
  const updatedBudgetResponse = await fetch(`${baseUrl}/api/budgets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ category: 'Food', monthly_limit: 750 })
  });
  assert.equal(updatedBudgetResponse.status, 200);
  const budgetStatusResponse = await fetch(`${baseUrl}/api/summary/budgets`, { headers: { cookie: owner.cookie } });
  const budgetStatus = await budgetStatusResponse.json();
  assert.equal(budgetStatus.budgets.find(budget => budget.category === 'Food').monthly_limit, 750);
  assert.equal(budgetStatus.budgets.find(budget => budget.category === 'Food').spent, 30);
  const budgetDeleteResponse = await fetch(`${baseUrl}/api/budgets/Food`, { method: 'DELETE', headers });
  assert.equal(budgetDeleteResponse.status, 200);

  const expenseDeleteResponse = await fetch(`${baseUrl}/api/expenses/${createdExpense.id}`, {
    method: 'DELETE',
    headers
  });
  assert.equal(expenseDeleteResponse.status, 200);
  const finalExpenses = await fetch(`${baseUrl}/api/expenses`, { headers: { cookie: owner.cookie } });
  assert.equal((await finalExpenses.json()).expenses.some(expense => expense.id === createdExpense.id), false);
});

test('monthly reports summarize real user records, generate PDFs, and snapshot closed months', async () => {
  const unauthorized = await fetch(`${baseUrl}/api/reports/monthly`);
  assert.equal(unauthorized.status, 401);

  const owner = await signup(`monthly_report_${Date.now()}@example.com`);
  const other = await signup(`monthly_report_other_${Date.now()}@example.com`);
  expenseTestUserIds.push(owner.body.user.id, other.body.user.id);
  const headers = { 'content-type': 'application/json', cookie: owner.cookie };
  const date = new Date().toISOString().slice(0, 10);
  const month = date.slice(0, 7);

  for (const transaction of [
    { type: 'expense', description: 'Report groceries', amount: 40, category: 'Food' },
    { type: 'expense', description: 'Report commute', amount: 10, category: 'Transport' }
  ]) {
    const response = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...transaction, date })
    });
    assert.equal(response.status, 200);
  }
  const incomeResponse = await fetch(`${baseUrl}/api/income`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ description: 'Report salary', amount: 100, category: 'Salary', date })
  });
  assert.equal(incomeResponse.status, 201);

  const response = await fetch(`${baseUrl}/api/reports/monthly?month=${month}`, {
    headers: { cookie: owner.cookie }
  });
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.deepEqual(report.categories.map(category => category.category), [
    'Food', 'Travel', 'Shopping', 'Bills', 'Entertainment', 'Healthcare', 'Other'
  ]);
  assert.equal(report.summary.income, 100);
  assert.equal(report.summary.expenses, 50);
  assert.equal(report.summary.balance, 50);
  assert.equal(report.summary.savings, 50);
  assert.equal(report.summary.transaction_count, 3);
  assert.equal(report.categories.find(category => category.category === 'Travel').total, 10);
  assert.equal(report.categories.find(category => category.category === 'Food').percentage, 80);
  assert.equal(report.highest_spending_category.category, 'Food');
  assert.equal(report.most_expensive_transaction.description, 'Report groceries');
  assert.equal(report.daily_spending.find(day => day.date === date).total, 50);
  assert.equal(report.transactions.length, 3);

  const foreignReportResponse = await fetch(`${baseUrl}/api/reports/monthly?month=${month}`, {
    headers: { cookie: other.cookie }
  });
  const foreignReport = await foreignReportResponse.json();
  assert.equal(foreignReport.summary.transaction_count, 0);
  assert.deepEqual(foreignReport.transactions, []);

  const pdfResponse = await fetch(`${baseUrl}/api/reports/monthly/${month}/pdf`, {
    headers: { cookie: owner.cookie }
  });
  assert.equal(pdfResponse.status, 200);
  assert.match(pdfResponse.headers.get('content-type'), /application\/pdf/);
  const pdf = Buffer.from(await pdfResponse.arrayBuffer()).toString('latin1');
  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /Report groceries/);
  assert.match(pdf, /Food: INR 40\.00/);
  assert.equal((await fetch(`${baseUrl}/api/reports/monthly/2026-13/pdf`, {
    headers: { cookie: owner.cookie }
  })).status, 400);

  const closedMonth = shiftMonth(month, -1);
  const closedReportResponse = await fetch(`${baseUrl}/api/reports/monthly?month=${closedMonth}`, {
    headers: { cookie: owner.cookie }
  });
  const closedReport = await closedReportResponse.json();
  assert.equal(closedReportResponse.status, 200);
  assert.ok(closedReport.generated_at);
  const savedSnapshot = getDb().prepare('SELECT report_json FROM monthly_report_snapshots WHERE user_id=? AND month=?')
    .get(owner.body.user.id, closedMonth);
  assert.ok(savedSnapshot);
  assert.equal(JSON.parse(savedSnapshot.report_json).month, closedMonth);
});

test('business workflows keep sales, purchases, inventory, and finance in sync', async () => {
  const owner = await signup(`inventory_${Date.now()}_owner@example.com`);
  const otherUser = await signup(`inventory_${Date.now()}_other@example.com`);
  inventoryTestUserIds.push(owner.body.user.id, otherUser.body.user.id);
  const headers = { 'content-type': 'application/json', cookie: owner.cookie };

  const categoryResponse = await fetch(`${baseUrl}/api/inventory/categories`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Office supplies' })
  });
  assert.equal(categoryResponse.status, 201);
  const { category } = await categoryResponse.json();

  const supplierResponse = await fetch(`${baseUrl}/api/inventory/suppliers`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Paper Co.', email: 'orders@example.com' })
  });
  assert.equal(supplierResponse.status, 201);
  const { supplier } = await supplierResponse.json();
  const supplierHistoryResponse = await fetch(`${baseUrl}/api/business/suppliers`, { headers: { cookie: owner.cookie } });
  assert.equal(supplierHistoryResponse.status, 200);
  assert.equal((await supplierHistoryResponse.json()).suppliers.find(item => item.id === supplier.id).purchase_count, 0);

  const productResponse = await fetch(`${baseUrl}/api/inventory/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'A5 notebook',
      sku: `NOTEBOOK-${Date.now()}`,
      category_id: category.id,
      supplier_id: supplier.id,
      quantity: 8,
      unit: 'pcs',
      cost_price: 40,
      selling_price: 65,
      reorder_level: 3
    })
  });
  assert.equal(productResponse.status, 201);
  const { product } = await productResponse.json();
  assert.equal(product.quantity, 8);
  assert.equal(product.category_name, 'Office supplies');
  assert.equal(product.supplier_name, 'Paper Co.');
  const productUpdate = await fetch(`${baseUrl}/api/inventory/products/${product.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      name: product.name,
      sku: product.sku,
      category_id: category.id,
      supplier_id: supplier.id,
      unit: product.unit,
      cost_price: product.cost_price,
      selling_price: product.selling_price,
      reorder_level: product.reorder_level
    })
  });
  assert.equal(productUpdate.status, 200);
  assert.equal((await productUpdate.json()).product.quantity, 8);
  const usedCategoryDelete = await fetch(`${baseUrl}/api/inventory/categories/${category.id}`, { method: 'DELETE', headers });
  assert.equal(usedCategoryDelete.status, 409);

  const temporaryCategory = await fetch(`${baseUrl}/api/inventory/categories`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Temporary category' })
  });
  const { category: temporaryCategoryRecord } = await temporaryCategory.json();
  const categoryDelete = await fetch(`${baseUrl}/api/inventory/categories/${temporaryCategoryRecord.id}`, { method: 'DELETE', headers });
  assert.equal(categoryDelete.status, 200);
  const temporarySupplier = await fetch(`${baseUrl}/api/inventory/suppliers`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Temporary supplier' })
  });
  const { supplier: temporarySupplierRecord } = await temporarySupplier.json();
  const supplierDelete = await fetch(`${baseUrl}/api/inventory/suppliers/${temporarySupplierRecord.id}`, { method: 'DELETE', headers });
  assert.equal(supplierDelete.status, 200);

  const unsafeStockOut = await fetch(`${baseUrl}/api/inventory/movements`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ product_id: product.id, type: 'stock_out', quantity: 9 })
  });
  assert.equal(unsafeStockOut.status, 400);

  const stockOut = await fetch(`${baseUrl}/api/inventory/movements`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ product_id: product.id, type: 'stock_out', quantity: 3, note: 'Order fulfilled' })
  });
  assert.equal(stockOut.status, 201);
  assert.equal((await stockOut.json()).movement.quantity, 3);

  const stockIn = await fetch(`${baseUrl}/api/inventory/movements`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ product_id: product.id, type: 'stock_in', quantity: 4, note: 'Supplier delivery' })
  });
  assert.equal(stockIn.status, 201);
  assert.equal((await stockIn.json()).movement.type, 'stock_in');

  const otherInventory = await fetch(`${baseUrl}/api/inventory`, { headers: { cookie: otherUser.cookie } });
  assert.equal((await otherInventory.json()).products.some(item => item.id === product.id), false);

  const report = await fetch(`${baseUrl}/api/inventory/reports`, { headers: { cookie: owner.cookie } });
  assert.equal(report.status, 200);
  assert.equal((await report.json()).summary.units_in_stock, 9);

  const noOpAdjustment = await fetch(`${baseUrl}/api/inventory/adjustments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ product_id: product.id, actual_quantity: 9 })
  });
  assert.equal(noOpAdjustment.status, 400);
  const negativeAdjustment = await fetch(`${baseUrl}/api/inventory/adjustments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ product_id: product.id, actual_quantity: -1 })
  });
  assert.equal(negativeAdjustment.status, 400);
  const adjustment = await fetch(`${baseUrl}/api/inventory/adjustments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ product_id: product.id, actual_quantity: 10, note: 'Physical count' })
  });
  assert.equal(adjustment.status, 201);
  assert.equal((await adjustment.json()).movement.quantity, 1);
  const movementHistory = await fetch(`${baseUrl}/api/inventory/movements?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`, {
    headers: { cookie: owner.cookie }
  });
  assert.equal((await movementHistory.json()).movements.some(movement => movement.note === 'Adjustment: Physical count'), true);
  const invalidMovementRange = await fetch(`${baseUrl}/api/inventory/movements?from=bad&to=bad`, {
    headers: { cookie: owner.cookie }
  });
  assert.equal(invalidMovementRange.status, 400);

  const customerResponse = await fetch(`${baseUrl}/api/business/customers`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Anita Rao', email: `anita_${Date.now()}@example.com` })
  });
  assert.equal(customerResponse.status, 201);
  const { customer } = await customerResponse.json();

  const saleResponse = await fetch(`${baseUrl}/api/business/sales`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      customer_id: customer.id,
      date: new Date().toISOString().slice(0, 10),
      amount_paid: 20,
      items: [{ product_id: product.id, quantity: 2 }]
    })
  });
  assert.equal(saleResponse.status, 201);
  const { sale, items: saleItems } = await saleResponse.json();
  assert.equal(sale.total, 130);
  assert.equal(sale.balance_due, 110);
  assert.equal(saleItems[0].quantity, 2);
  const inventoryAfterSale = await fetch(`${baseUrl}/api/inventory`, { headers: { cookie: owner.cookie } });
  assert.equal((await inventoryAfterSale.json()).products.find(item => item.id === product.id).quantity, 8);

  const purchaseInput = {
    supplier_id: supplier.id,
    reference: `PO-${Date.now()}`,
    date: new Date().toISOString().slice(0, 10),
    items: [{ product_id: product.id, quantity: 4, unit_cost: 35 }]
  };
  const purchaseHeaders = { ...headers, 'Idempotency-Key': `purchase-${Date.now()}` };
  const purchaseResponse = await fetch(`${baseUrl}/api/business/purchases`, {
    method: 'POST',
    headers: purchaseHeaders,
    body: JSON.stringify(purchaseInput)
  });
  assert.equal(purchaseResponse.status, 201);
  const savedPurchase = (await purchaseResponse.json()).purchase;
  assert.equal(savedPurchase.total, 140);
  assert.ok(savedPurchase.expense_id);
  const retriedPurchase = await fetch(`${baseUrl}/api/business/purchases`, {
    method: 'POST',
    headers: purchaseHeaders,
    body: JSON.stringify(purchaseInput)
  });
  assert.equal(retriedPurchase.status, 200);
  assert.equal((await retriedPurchase.json()).purchase.id, savedPurchase.id);
  const changedRetry = await fetch(`${baseUrl}/api/business/purchases`, {
    method: 'POST',
    headers: purchaseHeaders,
    body: JSON.stringify({ ...purchaseInput, items: [{ product_id: product.id, quantity: 5, unit_cost: 35 }] })
  });
  assert.equal(changedRetry.status, 409);

  const blockedExpenseEdit = await fetch(`${baseUrl}/api/expenses/${savedPurchase.expense_id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ description: 'Unlinked expense', amount: 140 })
  });
  assert.equal(blockedExpenseEdit.status, 409);
  const blockedExpenseDelete = await fetch(`${baseUrl}/api/expenses/${savedPurchase.expense_id}`, {
    method: 'DELETE',
    headers
  });
  assert.equal(blockedExpenseDelete.status, 409);
  assert.match(executeTool(owner.body.user.id, 'delete_expense', { expense_id: savedPurchase.expense_id }).error, /linked to stock/i);
  const supplierHistoryAfterPurchase = await fetch(`${baseUrl}/api/business/suppliers`, { headers: { cookie: owner.cookie } });
  const savedSupplier = (await supplierHistoryAfterPurchase.json()).suppliers.find(item => item.id === supplier.id);
  assert.equal(savedSupplier.purchase_count, 1);
  assert.equal(savedSupplier.total_purchased, 140);
  const supplierPurchaseHistory = await fetch(`${baseUrl}/api/business/suppliers/${supplier.id}/history`, { headers: { cookie: owner.cookie } });
  const supplierHistory = await supplierPurchaseHistory.json();
  assert.equal(supplierPurchaseHistory.status, 200);
  assert.equal(supplierHistory.history.length, 1);
  assert.equal(supplierHistory.history[0].items[0].name, 'A5 notebook');
  const otherSupplierHistory = await fetch(`${baseUrl}/api/business/suppliers/${supplier.id}/history`, { headers: { cookie: otherUser.cookie } });
  assert.equal(otherSupplierHistory.status, 404);
  const deleteSupplierWithHistory = await fetch(`${baseUrl}/api/inventory/suppliers/${supplier.id}`, { method: 'DELETE', headers });
  assert.equal(deleteSupplierWithHistory.status, 409);
  const supplierUpdate = await fetch(`${baseUrl}/api/inventory/suppliers/${supplier.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ name: 'Paper Company', email: 'new-orders@example.com', phone: '555-0100' })
  });
  assert.equal(supplierUpdate.status, 200);
  assert.equal((await supplierUpdate.json()).supplier.name, 'Paper Company');

  const duplicatePurchase = await fetch(`${baseUrl}/api/business/purchases`, {
    method: 'POST',
    headers,
    body: JSON.stringify(purchaseInput)
  });
  assert.equal(duplicatePurchase.status, 409);

  const inventoryAfter = await fetch(`${baseUrl}/api/inventory`, { headers: { cookie: owner.cookie } });
  assert.equal((await inventoryAfter.json()).products.find(item => item.id === product.id).quantity, 12);
  const productDeleteWithHistory = await fetch(`${baseUrl}/api/inventory/products/${product.id}`, { method: 'DELETE', headers });
  assert.equal(productDeleteWithHistory.status, 409);

  const invoiceResponse = await fetch(`${baseUrl}/api/business/sales/${sale.id}`, { headers: { cookie: owner.cookie } });
  assert.equal(invoiceResponse.status, 200);
  const invoice = (await invoiceResponse.json()).sale;
  assert.equal(invoice.customer_name, 'Anita Rao');
  assert.equal(invoice.amount_paid, 20);
  const otherUserInvoice = await fetch(`${baseUrl}/api/business/sales/${sale.id}`, { headers: { cookie: otherUser.cookie } });
  assert.equal(otherUserInvoice.status, 404);

  const paymentResponse = await fetch(`${baseUrl}/api/business/sales/${sale.id}/payment`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ amount: 50 })
  });
  assert.equal(paymentResponse.status, 200);
  assert.equal((await paymentResponse.json()).sale.balance_due, 60);
  const customerPurchaseHistory = await fetch(`${baseUrl}/api/business/customers/${customer.id}/history`, { headers: { cookie: owner.cookie } });
  const customerHistoryData = await customerPurchaseHistory.json();
  assert.equal(customerPurchaseHistory.status, 200);
  assert.equal(customerHistoryData.history.length, 1);
  assert.equal(customerHistoryData.history[0].items[0].name, 'A5 notebook');
  assert.equal(customerHistoryData.history[0].balance_due, 60);
  const otherCustomerHistory = await fetch(`${baseUrl}/api/business/customers/${customer.id}/history`, { headers: { cookie: otherUser.cookie } });
  assert.equal(otherCustomerHistory.status, 404);
  const deleteCustomerWithHistory = await fetch(`${baseUrl}/api/business/customers/${customer.id}`, { method: 'DELETE', headers });
  assert.equal(deleteCustomerWithHistory.status, 409);

  const overpaymentResponse = await fetch(`${baseUrl}/api/business/sales/${sale.id}/payment`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ amount: 100 })
  });
  assert.equal(overpaymentResponse.status, 400);

  const customerHistory = await fetch(`${baseUrl}/api/business/customers`, { headers: { cookie: owner.cookie } });
  const savedCustomer = (await customerHistory.json()).customers.find(item => item.id === customer.id);
  assert.equal(savedCustomer.purchase_count, 1);
  assert.equal(savedCustomer.total_spent, 130);
  assert.equal(savedCustomer.pending_amount, 60);
  const customerUpdate = await fetch(`${baseUrl}/api/business/customers/${customer.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ name: 'Anita R.' })
  });
  assert.equal(customerUpdate.status, 200);

  const overview = await fetch(`${baseUrl}/api/business/overview?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`, {
    headers: { cookie: owner.cookie }
  });
  const businessSummary = await overview.json();
  assert.equal(businessSummary.finance.sales, 130);
  assert.equal(businessSummary.finance.expenses, 140);
  assert.equal(businessSummary.finance.estimated_net_profit, -10);

  const businessReports = await fetch(`${baseUrl}/api/business/reports?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`, {
    headers: { cookie: owner.cookie }
  });
  const reportData = await businessReports.json();
  assert.equal(businessReports.status, 200);
  assert.equal(reportData.sales.length, 1);
  assert.equal(reportData.purchases.length, 1);
  assert.equal(reportData.products.find(item => item.id === product.id).units_sold, 2);

  const inventoryReports = await fetch(`${baseUrl}/api/inventory/reports?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`, {
    headers: { cookie: owner.cookie }
  });
  const inventoryReportData = await inventoryReports.json();
  assert.equal(inventoryReports.status, 200);
  assert.equal(inventoryReportData.purchases.length, 1);
  assert.equal(inventoryReportData.expenses.length, 1);
  assert.equal(inventoryReportData.expenses[0].expense_id, savedPurchase.expense_id);
  assert.equal(inventoryReportData.products.find(item => item.id === product.id).purchased_quantity, 4);

  const assistantBusinessData = executeTool(owner.body.user.id, 'get_business_overview', { period: 'this_month' });
  assert.equal(assistantBusinessData.sales.total, 130);
  assert.equal(assistantBusinessData.purchases.total, 140);
  assert.equal(assistantBusinessData.customer_receivables.pending_amount, 60);
  const assistantInventory = executeTool(owner.body.user.id, 'get_inventory_status', { query: 'notebook' });
  assert.equal(assistantInventory.products.length, 1);
  assert.equal(assistantInventory.products[0].quantity, 12);
  assert.equal(assistantInventory.products[0].lifetime_purchased_quantity, 4);
  assert.equal(assistantInventory.products[0].last_purchase_unit_cost, 35);
  const assistantSales = executeTool(owner.body.user.id, 'get_business_transactions', { kind: 'sales' });
  assert.equal(assistantSales.transactions.length, 1);
  const assistantPurchaseHistory = executeTool(owner.body.user.id, 'get_business_transactions', { kind: 'purchases' });
  assert.equal(assistantPurchaseHistory.transactions[0].items[0].quantity, 4);
  assert.equal(assistantPurchaseHistory.transactions[0].items[0].unit_cost, 35);

  const lowStockProduct = await fetch(`${baseUrl}/api/inventory/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Low stock test item', sku: `LOW-${Date.now()}`, quantity: 0, reorder_level: 4 })
  });
  assert.equal(lowStockProduct.status, 201);
  const lowStockReport = await fetch(`${baseUrl}/api/inventory/reports?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`, {
    headers: { cookie: owner.cookie }
  });
  assert.equal((await lowStockReport.json()).low_stock.some(item => item.name === 'Low stock test item'), true);
  const inventorySummary = await fetch(`${baseUrl}/api/inventory`, { headers: { cookie: owner.cookie } });
  assert.equal((await inventorySummary.json()).summary.low_stock_count, 1);
  const lowStockAssistant = executeTool(owner.body.user.id, 'get_inventory_status', { low_stock_only: true });
  assert.equal(lowStockAssistant.products.some(item => item.name === 'Low stock test item'), true);
  const lowStockDelete = await fetch(`${baseUrl}/api/inventory/products/${(await lowStockProduct.json()).product.id}`, {
    method: 'DELETE',
    headers
  });
  assert.equal(lowStockDelete.status, 200);

  const assistant = await fetch(`${baseUrl}/api/business/assistant`, { headers: { cookie: owner.cookie } });
  assert.equal(assistant.status, 200);
  assert.equal((await assistant.json()).insights.length > 0, true);
  const geminiKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const unavailableAI = await fetch(`${baseUrl}/api/business/assistant`, {
    method: 'POST',
    headers,
    body: JSON.stringify({})
  });
  process.env.GEMINI_API_KEY = geminiKey;
  assert.equal(unavailableAI.status, 503);

  const expenseList = await fetch(`${baseUrl}/api/expenses?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`, {
    headers: { cookie: owner.cookie }
  });
  const purchaseExpenses = (await expenseList.json()).expenses.filter(expense => expense.description.includes(purchaseInput.reference));
  assert.equal(purchaseExpenses.length, 1);
  assert.equal(purchaseExpenses[0].id, savedPurchase.expense_id);
});

test('firebase-status endpoint reports configuration status', async () => {
  const response = await fetch(`${baseUrl}/api/auth/firebase-status`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(typeof data.configured, 'boolean');
});

test('firebase-login rejects missing token', async () => {
  const response = await fetch(`${baseUrl}/api/auth/firebase-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(response.status, 400);
  const data = await response.json();
  assert.match(data.error, /token is required/i);
});

test('budget alerts trigger at thresholds once and support overall budgets', async () => {
  const account = await signup(`budget_alert_${Date.now()}@example.com`);
  expenseTestUserIds.push(account.body.user.id);
  const headers = { 'content-type': 'application/json', cookie: account.cookie };
  const date = new Date().toISOString().slice(0, 10);
  const expenseResponse = await fetch(`${baseUrl}/api/expenses`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ description: 'Budget threshold test', amount: 8500, category: 'Food', date })
  });
  assert.equal(expenseResponse.status, 200);

  const budgetResponse = await fetch(`${baseUrl}/api/budgets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ category: 'Overall', monthly_limit: 10000 })
  });
  assert.equal(budgetResponse.status, 200);

  const firstStatus = await fetch(`${baseUrl}/api/budgets`, { headers: { cookie: account.cookie } });
  const firstBody = await firstStatus.json();
  assert.equal(firstBody.budgets[0].category, 'Overall');
  assert.equal(firstBody.budgets[0].percentage, 85);
  assert.deepEqual(firstBody.new_alerts.map(alert => alert.threshold), [50, 75]);

  const repeatedStatus = await fetch(`${baseUrl}/api/summary/budgets`, { headers: { cookie: account.cookie } });
  assert.deepEqual((await repeatedStatus.json()).new_alerts, []);

  const secondExpenseResponse = await fetch(`${baseUrl}/api/expenses`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ description: 'Budget reaches 100 percent', amount: 1500, category: 'Food', date })
  });
  assert.equal(secondExpenseResponse.status, 200);
  assert.equal((await secondExpenseResponse.json()).expense.amount, 1500);
  const thresholdStatus = await fetch(`${baseUrl}/api/budgets`, { headers: { cookie: account.cookie } });
  assert.deepEqual((await thresholdStatus.json()).new_alerts.map(alert => alert.threshold), [90, 100]);
});

test('prediction endpoint is authenticated and forecasts only recorded history', async () => {
  const unauthorized = await fetch(`${baseUrl}/api/ai/prediction`);
  assert.equal(unauthorized.status, 401);

  const account = await signup(`prediction_${Date.now()}@example.com`);
  expenseTestUserIds.push(account.body.user.id);
  const db = getDb();
  const now = new Date();
  const [year, month] = [now.getUTCFullYear(), now.getUTCMonth()];
  for (let offset = 1; offset <= 3; offset++) {
    const date = new Date(Date.UTC(year, month - offset, 15)).toISOString().slice(0, 10);
    db.prepare(`INSERT INTO expenses (id, user_id, description, amount, category, date)
      VALUES (?, ?, ?, ?, 'Food', ?)`)
      .run(uuidv4(), account.body.user.id, `Historical prediction ${offset}`, offset * 100, date);
  }

  const response = await fetch(`${baseUrl}/api/ai/prediction`, { headers: { cookie: account.cookie } });
  assert.equal(response.status, 200);
  const prediction = await response.json();
  assert.equal(prediction.sufficient_history, true);
  assert.equal(prediction.method, 'Three-month weighted moving average');
  assert.equal(prediction.predicted_total, 166.67);
  assert.equal(prediction.categories[0].category, 'Food');
  assert.equal(prediction.accuracy_pct, null);
});

test('receipt confirmation is authenticated, user-scoped, and idempotent', async () => {
  const owner = await signup(`receipt_owner_${Date.now()}@example.com`);
  const other = await signup(`receipt_other_${Date.now()}@example.com`);
  expenseTestUserIds.push(owner.body.user.id, other.body.user.id);
  const scanId = uuidv4();
  getDb().prepare(`INSERT INTO receipt_scans (id, user_id, image_hash, extracted_json)
    VALUES (?, ?, ?, ?)`).run(scanId, owner.body.user.id, 'a'.repeat(64), JSON.stringify({ amount: 42 }));
  const date = new Date().toISOString().slice(0, 10);
  const payload = { description: 'Receipt test merchant', amount: 42, category: 'Food', date };
  const confirm = (cookie, body = payload) => fetch(`${baseUrl}/api/ai/receipts/${scanId}/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body)
  });

  assert.equal((await confirm(other.cookie)).status, 404);
  const saved = await confirm(owner.cookie);
  assert.equal(saved.status, 201);
  assert.equal((await saved.json()).expense.description, payload.description);
  assert.equal((await confirm(owner.cookie)).status, 409);

  const unauthenticatedUpload = await fetch(`${baseUrl}/api/ai/receipts`, { method: 'POST' });
  assert.equal(unauthenticatedUpload.status, 401);
});

test('AI parsing and advice fail explicitly when Gemini is not configured', async () => {
  const account = await signup(`ai_unconfigured_${Date.now()}@example.com`);
  expenseTestUserIds.push(account.body.user.id);
  const geminiKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const voice = await fetch(`${baseUrl}/api/ai/voice`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: account.cookie },
      body: JSON.stringify({ transcript: 'I spent 500 rupees on petrol today.' })
    });
    assert.equal(voice.status, 503);

    const advisor = await fetch(`${baseUrl}/api/ai/advisor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: account.cookie },
      body: JSON.stringify({ question: 'Where am I spending the most?' })
    });
    assert.equal(advisor.status, 503);
  } finally {
    process.env.GEMINI_API_KEY = geminiKey;
  }
});

test('voice assistant parses an expense, requires confirmation, and answers real-data queries', async () => {
  const account = await signup(`voice_feature_${Date.now()}@example.com`);
  expenseTestUserIds.push(account.body.user.id);
  const today = new Date().toISOString().slice(0, 10);
  const db = getDb();

  await withGeminiMock(async content => {
    if (content.includes('Transcript: "What is my total expense?"')) {
      return { response: { text: () => JSON.stringify({
        intent: 'query', amount: null, category: null, description: null, date: null, query: 'What is my total expense?'
      }) } };
    }
    if (content.includes('Today is')) {
      return { response: { text: () => JSON.stringify({
        intent: 'expense', amount: 500, category: 'Transport', description: 'Petrol', date: today, query: null
      }) } };
    }
    assert.match(content, /"current_month_expenses":500/);
    return { response: { text: () => 'Your recorded expenses include ₹500 for petrol.' } };
  }, async () => {
    const voice = await fetch(`${baseUrl}/api/ai/voice`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: account.cookie },
      body: JSON.stringify({ transcript: 'I spent 500 rupees on petrol today.' })
    });
    assert.equal(voice.status, 200);
    const draft = await voice.json();
    assert.equal(draft.needs_confirmation, true);
    assert.deepEqual(draft.expense, { description: 'Petrol', amount: 500, category: 'Transport', date: today });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM expenses WHERE user_id=?').get(account.body.user.id).count, 0);

    const saved = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: account.cookie },
      body: JSON.stringify(draft.expense)
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).expense.description, 'Petrol');

    const query = await fetch(`${baseUrl}/api/ai/voice`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: account.cookie },
      body: JSON.stringify({ transcript: 'What is my total expense?' })
    });
    assert.equal(query.status, 200);
    assert.match((await query.json()).reply, /₹500/);
  });
});

test('voice assistant supports Hindi replies and rejects unsupported languages', async () => {
  const account = await signup(`voice_hindi_${Date.now()}@example.com`);
  expenseTestUserIds.push(account.body.user.id);

  const unsupported = await fetch(`${baseUrl}/api/ai/voice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: account.cookie },
    body: JSON.stringify({ transcript: 'मेरा खर्च कितना है?', language: 'mr-IN' })
  });
  assert.equal(unsupported.status, 400);

  await withGeminiMock(async content => {
    if (content.includes('Transcript: "मेरा खर्च कितना है?"')) {
      assert.match(content, /selected language is Hindi/);
      return { response: { text: () => JSON.stringify({
        intent: 'query', amount: null, category: null, description: null, date: null, query: 'मेरा खर्च कितना है?'
      }) } };
    }
    assert.match(content, /Answer in Hindi/);
    return { response: { text: () => 'आपका दर्ज खर्च उपलब्ध है।' } };
  }, async () => {
    const response = await fetch(`${baseUrl}/api/ai/voice`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: account.cookie },
      body: JSON.stringify({ transcript: 'मेरा खर्च कितना है?', language: 'hi-IN' })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reply, 'आपका दर्ज खर्च उपलब्ध है।');
  });
});

test('receipt scanner extracts details, confirms once, and rejects duplicate image uploads', async () => {
  const account = await signup(`receipt_scan_${Date.now()}@example.com`);
  expenseTestUserIds.push(account.body.user.id);
  const date = new Date().toISOString().slice(0, 10);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/r9sAAAAASUVORK5CYII=', 'base64');

  await withGeminiMock(async content => {
    assert.ok(Array.isArray(content));
    assert.equal(content[1].inlineData.mimeType, 'image/png');
    return { response: { text: () => JSON.stringify({
      amount: 89.5, date, merchant: 'Corner Cafe', items: ['Coffee', 'Sandwich'], category: 'Food', readable: true
    }) } };
  }, async () => {
    const form = new FormData();
    form.append('receipt', new Blob([png], { type: 'image/png' }), 'receipt.png');
    const response = await fetch(`${baseUrl}/api/ai/receipts`, {
      method: 'POST',
      headers: { cookie: account.cookie },
      body: form
    });
    assert.equal(response.status, 200);
    const scan = await response.json();
    assert.equal(scan.merchant, 'Corner Cafe');
    assert.deepEqual(scan.items, ['Coffee', 'Sandwich']);

    const confirm = await fetch(`${baseUrl}/api/ai/receipts/${scan.scan_id}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: account.cookie },
      body: JSON.stringify({
        description: scan.description, amount: scan.amount, category: scan.category, date: scan.date
      })
    });
    assert.equal(confirm.status, 201);

    const duplicateForm = new FormData();
    duplicateForm.append('receipt', new Blob([png], { type: 'image/png' }), 'receipt.png');
    const duplicate = await fetch(`${baseUrl}/api/ai/receipts`, {
      method: 'POST',
      headers: { cookie: account.cookie },
      body: duplicateForm
    });
    assert.equal(duplicate.status, 409);
  });
});
