const { getDb } = require('../db/schema');

const REPORT_CATEGORIES = ['Food', 'Travel', 'Shopping', 'Bills', 'Entertainment', 'Healthcare', 'Other'];

function isValidMonth(month) {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return false;
  const [year, monthNumber] = month.split('-').map(Number);
  return year >= 1000 && monthNumber >= 1 && monthNumber <= 12;
}

function monthRange(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return {
    start: `${month}-01`,
    end: new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10)
  };
}

function reportCategory(category) {
  const normalized = String(category || 'Other').toLowerCase();
  if (normalized === 'transport' || normalized === 'travel') return 'Travel';
  if (normalized === 'utilities' || normalized === 'housing' || normalized === 'bills') return 'Bills';
  if (normalized === 'health' || normalized === 'healthcare') return 'Healthcare';
  return REPORT_CATEGORIES.includes(category) ? category : 'Other';
}

function shiftMonth(month, offset) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + offset, 1)).toISOString().slice(0, 7);
}

function reportDate() {
  return new Date().toISOString().slice(0, 10);
}

function reportMonth(userId, month) {
  if (!isValidMonth(month)) throw new TypeError('Month must use the YYYY-MM format.');
  const db = getDb();
  const range = monthRange(month);
  const previousMonth = shiftMonth(month, -1);
  const previousRange = monthRange(previousMonth);
  const isCurrentMonth = month === reportDate().slice(0, 7);
  const comparisonRange = isCurrentMonth
    ? {
      start: previousRange.start,
      end: [previousRange.end, `${previousMonth}-${reportDate().slice(8, 10)}`].sort()[0]
    }
    : previousRange;
  const expenses = db.prepare(`SELECT id, description, amount, category, date, created_at
    FROM expenses WHERE user_id=? AND deleted_at IS NULL AND date>=? AND date<=?
    ORDER BY date DESC, created_at DESC`)
    .all(userId, range.start, range.end)
    .map(record => ({ ...record, type: 'Expense' }));
  const income = db.prepare(`SELECT id, description, amount, category, date, created_at
    FROM income_records WHERE user_id=? AND deleted_at IS NULL AND date>=? AND date<=?
    ORDER BY date DESC, created_at DESC`)
    .all(userId, range.start, range.end)
    .map(record => ({ ...record, type: 'Income' }));
  for (const expense of expenses) expense.report_category = reportCategory(expense.category);
  const transactions = [...expenses, ...income].sort((a, b) =>
    b.date.localeCompare(a.date) || String(b.created_at).localeCompare(String(a.created_at)));
  const expenseTotal = expenses.reduce((sum, record) => sum + Number(record.amount), 0);
  const incomeTotal = income.reduce((sum, record) => sum + Number(record.amount), 0);

  const categoriesByName = new Map(REPORT_CATEGORIES.map(category => [category, { category, total: 0, count: 0 }]));
  for (const expense of expenses) {
    const group = categoriesByName.get(expense.report_category);
    group.total += Number(expense.amount);
    group.count += 1;
  }
  const categories = REPORT_CATEGORIES.map(category => {
    const item = categoriesByName.get(category);
    return {
      ...item,
      total: +item.total.toFixed(2),
      percentage: expenseTotal ? +(item.total / expenseTotal * 100).toFixed(1) : 0
    };
  });

  const dailyMap = new Map();
  for (const expense of expenses) {
    const total = dailyMap.get(expense.date) || 0;
    dailyMap.set(expense.date, total + Number(expense.amount));
  }
  const dailySpending = Array.from(dailyMap, ([date, total]) => ({ date, total: +total.toFixed(2) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const previousExpenseTotal = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
    WHERE user_id=? AND deleted_at IS NULL AND date>=? AND date<=?`)
    .get(userId, comparisonRange.start, comparisonRange.end).total;
  const previousIncomeTotal = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM income_records
    WHERE user_id=? AND deleted_at IS NULL AND date>=? AND date<=?`)
    .get(userId, comparisonRange.start, comparisonRange.end).total;
  const mostExpensive = expenses.reduce((highest, record) =>
    !highest || Number(record.amount) > Number(highest.amount) ? record : highest, null);
  const highestCategory = categories.reduce((highest, category) =>
    category.total > highest.total ? category : highest, categories[0]);
  const currentMonthFinished = month < reportDate().slice(0, 7);
  const prepared = currentMonthFinished
    ? db.prepare('SELECT generated_at FROM monthly_report_snapshots WHERE user_id=? AND month=?').get(userId, month)
    : null;
  const suggestions = [];
  if (incomeTotal > 0 && incomeTotal < expenseTotal) {
    suggestions.push(`Expenses exceeded income by INR ${(expenseTotal - incomeTotal).toFixed(2)} this month. Review discretionary spending before the next month.`);
  }
  if (expenseTotal > 0 && highestCategory.total > 0) {
    suggestions.push(`${highestCategory.category} was your largest category at ${highestCategory.percentage}% of recorded expenses. Review transactions in this category for potential reductions.`);
  }

  return {
    month,
    previous_month: previousMonth,
    comparison_end: comparisonRange.end,
    range,
    summary: {
      income: +incomeTotal.toFixed(2),
      expenses: +expenseTotal.toFixed(2),
      balance: +(incomeTotal - expenseTotal).toFixed(2),
      savings: +(incomeTotal - expenseTotal).toFixed(2),
      transaction_count: transactions.length,
      income_transaction_count: income.length,
      expense_transaction_count: expenses.length
    },
    categories,
    highest_spending_category: expenseTotal ? highestCategory : null,
    most_expensive_transaction: mostExpensive
      ? { ...mostExpensive, type: 'Expense' }
      : null,
    daily_spending: dailySpending,
    comparison: {
      previous_month: previousMonth,
      previous_income: +previousIncomeTotal.toFixed(2),
      previous_expenses: +previousExpenseTotal.toFixed(2),
      income_change: previousIncomeTotal
        ? +((incomeTotal - previousIncomeTotal) / previousIncomeTotal * 100).toFixed(1)
        : null,
      expense_change: previousExpenseTotal
        ? +((expenseTotal - previousExpenseTotal) / previousExpenseTotal * 100).toFixed(1)
        : null
    },
    suggestions,
    transactions,
    generated_at: prepared?.generated_at || null
  };
}

function escapePdfText(value) {
  return String(value)
    .replaceAll('₹', 'INR ')
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '?')
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)');
}

function wrapPdfLines(lines, maxLength = 92) {
  const wrapped = [];
  for (const value of lines) {
    let remaining = String(value);
    while (remaining.length > maxLength) {
      let splitAt = remaining.lastIndexOf(' ', maxLength);
      if (splitAt < 1) splitAt = maxLength;
      wrapped.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    wrapped.push(remaining);
  }
  return wrapped;
}

function createPdf(lines) {
  lines = wrapPdfLines(lines);
  const pageLines = [];
  for (let index = 0; index < lines.length; index += 48) pageLines.push(lines.slice(index, index + 48));
  if (pageLines.length === 0) pageLines.push([]);
  const objects = [];
  const addObject = content => {
    objects.push(Buffer.from(content, 'binary'));
    return objects.length;
  };
  const catalogId = addObject('');
  const pagesId = addObject('');
  const fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = [];

  for (const rows of pageLines) {
    const commands = ['BT', '/F1 9 Tf', '50 790 Td'];
    rows.forEach((line, index) => {
      if (index > 0) commands.push('0 -15 Td');
      commands.push(`(${escapePdfText(line)}) Tj`);
    });
    commands.push('ET');
    const stream = Buffer.from(commands.join('\n'), 'ascii');
    const contentId = addObject(Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'ascii'),
      stream,
      Buffer.from('\nendstream', 'ascii')
    ]).toString('binary'));
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }

  objects[catalogId - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, 'ascii');
  objects[pagesId - 1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`, 'ascii');
  const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, 'ascii'),
      object,
      Buffer.from('\nendobj\n', 'ascii')
    ]);
    chunks.push(chunk);
    length += chunk.length;
  });
  const xrefOffset = length;
  const xref = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n'];
  for (let index = 1; index < offsets.length; index++) {
    xref.push(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`);
  }
  chunks.push(Buffer.from(`${xref.join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`, 'ascii'));
  return Buffer.concat(chunks);
}

function createMonthlyReportPdf(report) {
  const lines = [
    `Ledger AI - Monthly Financial Report - ${report.month}`,
    '',
    `Total income: INR ${report.summary.income.toFixed(2)}`,
    `Total expenses: INR ${report.summary.expenses.toFixed(2)}`,
    `Remaining balance / savings: INR ${report.summary.balance.toFixed(2)}`,
    `Transactions: ${report.summary.transaction_count} (${report.summary.income_transaction_count} income, ${report.summary.expense_transaction_count} expenses)`,
    '',
    'Expense breakdown',
    ...report.categories.map(category => `${category.category}: INR ${category.total.toFixed(2)} (${category.percentage}%, ${category.count} transactions)`),
    '',
    `Highest spending category: ${report.highest_spending_category?.category || 'None'}${report.highest_spending_category ? ` - INR ${report.highest_spending_category.total.toFixed(2)}` : ''}`,
    `Most expensive expense: ${report.most_expensive_transaction ? `${report.most_expensive_transaction.description} - INR ${Number(report.most_expensive_transaction.amount).toFixed(2)} on ${report.most_expensive_transaction.date}` : 'None'}`,
    '',
    `Comparison with ${report.comparison.previous_month}`,
    `Expenses: INR ${report.comparison.previous_expenses.toFixed(2)} previously; ${report.comparison.expense_change === null ? 'no prior baseline' : `${report.comparison.expense_change}% change`}`,
    `Income: INR ${report.comparison.previous_income.toFixed(2)} previously; ${report.comparison.income_change === null ? 'no prior baseline' : `${report.comparison.income_change}% change`}`,
    '',
    'Daily spending'
  ];
  lines.push(...(report.daily_spending.length
    ? report.daily_spending.map(day => `${day.date}: INR ${day.total.toFixed(2)}`)
    : ['No expense records.']));
  lines.push('', 'Savings review', ...(report.suggestions.length ? report.suggestions : ['No reduction suggestion based on this month’s recorded data.']), '', 'Complete transaction history');
  lines.push(...(report.transactions.length
    ? report.transactions.map(transaction =>
      `${transaction.date} | ${transaction.type} | ${transaction.description} | ${transaction.category} | INR ${Number(transaction.amount).toFixed(2)}`)
    : ['No income or expense transactions for this month.']));
  return createPdf(lines);
}

function saveMonthlySnapshot(userId, month) {
  if (!isValidMonth(month) || month >= reportDate().slice(0, 7)) return null;
  const report = reportMonth(userId, month);
  const db = getDb();
  report.generated_at = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO monthly_report_snapshots (user_id, month, report_json)
    VALUES (?, ?, ?)`).run(userId, month, JSON.stringify(report));
  return db.prepare('SELECT generated_at FROM monthly_report_snapshots WHERE user_id=? AND month=?')
    .get(userId, month);
}

function preparePreviousMonthForAllUsers() {
  const month = shiftMonth(reportDate().slice(0, 7), -1);
  const db = getDb();
  const users = db.prepare('SELECT id FROM users').all();
  for (const user of users) {
    try {
      saveMonthlySnapshot(user.id, month);
    } catch (error) {
      console.error(`[Monthly report] Could not prepare report for user ${user.id}:`, error.message);
    }
  }
  console.log(`[Monthly report] Prepared ${month} reports for ${users.length} users.`);
}

function backfillMonthlyReports() {
  const db = getDb();
  const currentMonth = reportDate().slice(0, 7);
  const users = db.prepare('SELECT id FROM users').all();
  for (const user of users) {
    const months = db.prepare(`SELECT month FROM (
      SELECT DISTINCT strftime('%Y-%m', date) AS month FROM expenses
        WHERE user_id=? AND deleted_at IS NULL AND date<?
      UNION
      SELECT DISTINCT strftime('%Y-%m', date) AS month FROM income_records
        WHERE user_id=? AND deleted_at IS NULL AND date<?
    ) WHERE month IS NOT NULL AND month < ? ORDER BY month`)
      .all(user.id, `${currentMonth}-01`, user.id, `${currentMonth}-01`, currentMonth);
    for (const { month } of months) {
      try {
        saveMonthlySnapshot(user.id, month);
      } catch (error) {
        console.error(`[Monthly report] Could not backfill ${month} for user ${user.id}:`, error.message);
      }
    }
  }
}

module.exports = {
  REPORT_CATEGORIES,
  backfillMonthlyReports,
  createMonthlyReportPdf,
  isValidMonth,
  preparePreviousMonthForAllUsers,
  reportMonth,
  saveMonthlySnapshot,
  shiftMonth
};
