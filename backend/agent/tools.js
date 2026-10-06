// agent/tools.js
// This defines all the "tools" the AI agent can call.
// Think of tools as the agent's hands — it can't do anything except what's listed here.
//
// When the user says "I spent 350 on lunch", the AI doesn't just chat back.
// It calls add_expense({ description: "lunch", amount: 350 }) and we execute it for real.
//
// CATEGORIES: Fixed list — the AI MUST choose one of these, it cannot make up categories
const CATEGORIES = [
  'Food', 'Transport', 'Entertainment', 'Health',
  'Shopping', 'Utilities', 'Education', 'Travel', 'Housing', 'Other'
];

// Tool definitions in the format Gemini expects
const TOOL_DEFINITIONS = [
  {
    name: 'add_expense',
    description: 'Log a new expense. Use this when the user mentions spending money on something. Always categorize the expense.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What was the expense for? e.g. "Lunch at Café", "Uber to airport"' },
        amount: { type: 'number', description: 'Amount spent in Indian Rupees (INR). Must be a positive number.' },
        date: { type: 'string', description: 'Date of expense in YYYY-MM-DD format. Defaults to today if not specified.' },
        category: {
          type: 'string',
          enum: CATEGORIES,
          description: 'Category of the expense. Choose the most appropriate from the list.'
        },
        split_count: { type: 'number', description: 'If the bill was split, total number of people sharing. e.g. 3 means bill split 3 ways, user pays 1/3.' },
        split_note: { type: 'string', description: 'Optional note about the split e.g. "split with 2 roommates"' }
      },
      required: ['description', 'amount', 'category']
    }
  },
  {
    name: 'update_expense',
    description: 'Edit an existing expense — change description, amount, category, or date.',
    parameters: {
      type: 'object',
      properties: {
        expense_id: { type: 'string', description: 'The ID of the expense to update.' },
        description: { type: 'string' },
        amount: { type: 'number' },
        category: { type: 'string', enum: CATEGORIES },
        date: { type: 'string' }
      },
      required: ['expense_id']
    }
  },
  {
    name: 'delete_expense',
    description: 'Delete an expense. Only call this after user has explicitly confirmed they want to delete.',
    parameters: {
      type: 'object',
      properties: {
        expense_id: { type: 'string', description: 'The ID of the expense to delete.' }
      },
      required: ['expense_id']
    }
  },
  {
    name: 'get_summary',
    description: 'Get spending totals, breakdowns, and optionally a forecast. Use this to answer questions like "how much did I spend on food?" or "what is my total spending this month?"',
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['today', 'this_week', 'this_month', 'last_month', 'last_7_days', 'last_30_days', 'all_time'],
          description: 'Time period to summarize.'
        },
        category: { type: 'string', enum: CATEGORIES, description: 'Filter by category. Omit for all categories.' },
        include_forecast: { type: 'boolean', description: 'Include a spending forecast for the rest of the month.' }
      },
      required: ['period']
    }
  },
  {
    name: 'get_recent_expenses',
    description: 'Get the most recent expenses. Use when user asks "what did I spend on recently?" or "show my last few expenses".',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of expenses to return. Default 5.' },
        category: { type: 'string', enum: CATEGORIES, description: 'Filter by category.' }
      }
    }
  },
  {
    name: 'search_expenses',
    description: 'Search expenses by keyword or date range.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term to look for in descriptions.' },
        date_from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        date_to: { type: 'string', description: 'End date YYYY-MM-DD' }
      }
    }
  },
  {
    name: 'set_budget',
    description: 'Set a monthly spending limit for a category.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: CATEGORIES },
        monthly_limit: { type: 'number', description: 'Monthly limit in INR.' }
      },
      required: ['category', 'monthly_limit']
    }
  },
  {
    name: 'get_budget_status',
    description: 'Check how much has been spent vs. the budget for one or all categories this month.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: CATEGORIES, description: 'Specific category, or omit for all.' }
      }
    }
  },
  {
    name: 'categorize',
    description: 'Determine the best category for a given expense description. Returns one category from the fixed list.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'The expense description to categorize.' }
      },
      required: ['description']
    }
  },
  {
    name: 'get_recurring_patterns',
    description: 'Get list of detected recurring expenses (e.g. Netflix every month).',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'undo_last_action',
    description: 'Undo the most recent action (add/edit/delete) the agent performed.',
    parameters: { type: 'object', properties: {} }
  }
];

module.exports = { TOOL_DEFINITIONS, CATEGORIES };
