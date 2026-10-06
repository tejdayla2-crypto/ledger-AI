// src/lib/parse.js
// Quick-add natural language parser.
// Turns "350 lunch" or "lunch 350" into { amount: 350, description: "lunch" }
// Used by the QuickAdd component BEFORE calling the API.

export function parseQuickAdd(input) {
  if (!input || !input.trim()) return null;

  const text = input.trim();

  // Pattern 1: amount first — "350 lunch" or "₹350 lunch"
  const amountFirst = text.match(/^[₹]?(\d+(?:\.\d{1,2})?)\s+(.+)$/);
  if (amountFirst) {
    const amount = parseFloat(amountFirst[1]);
    const description = amountFirst[2].trim();
    if (amount > 0 && description.length > 0) {
      return { amount, description, confidence: 'high' };
    }
  }

  // Pattern 2: description first — "lunch 350" or "lunch ₹350"
  const descFirst = text.match(/^(.+?)\s+[₹]?(\d+(?:\.\d{1,2})?)$/);
  if (descFirst) {
    const description = descFirst[1].trim();
    const amount = parseFloat(descFirst[2]);
    if (amount > 0 && description.length > 0) {
      return { amount, description, confidence: 'high' };
    }
  }

  // Pattern 3: just a number — ambiguous, needs description
  if (/^[₹]?\d+(?:\.\d{1,2})?$/.test(text)) {
    return { amount: parseFloat(text.replace('₹', '')), description: '', confidence: 'low' };
  }

  // Pattern 4: just text — ambiguous, needs amount
  if (/^[a-zA-Z\s]+$/.test(text)) {
    return { amount: null, description: text, confidence: 'low' };
  }

  return null;
}

// Format amount as Indian Rupees: ₹1,23,456.00
export function formatINR(amount) {
  if (amount === null || amount === undefined) return '₹0';
  return '₹' + Number(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

// Format date as "2 Sep 2024"
export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00'); // avoid timezone shift
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Get category CSS class
export function catClass(category) {
  return 'cat-' + (category || 'other').toLowerCase().replace(/\s+/g, '-');
}

// Category display names and colors for charts
export const CATEGORY_COLORS = {
  Food:          '#D97706',
  Transport:     '#2563EB',
  Entertainment: '#7C3AED',
  Health:        '#059669',
  Shopping:      '#DB2777',
  Utilities:     '#0284C7',
  Education:     '#B45309',
  Travel:        '#EA580C',
  Housing:       '#16A34A',
  Other:         '#64748B',
};

export const CATEGORIES = [
  'Food', 'Transport', 'Entertainment', 'Health',
  'Shopping', 'Utilities', 'Education', 'Travel', 'Housing', 'Other'
];

// Periods for summary filter
export const PERIODS = [
  { value: 'today',       label: 'Today' },
  { value: 'this_week',   label: 'This week' },
  { value: 'this_month',  label: 'This month' },
  { value: 'last_month',  label: 'Last month' },
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_30_days',label: 'Last 30 days' },
  { value: 'all_time',    label: 'All time' },
];
