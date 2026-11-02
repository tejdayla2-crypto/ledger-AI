// agent/loop.js
// This is the AGENT LOOP — the core of the AI behaviour.
//
// What happens here, step by step:
// 1. Load the user's recent conversation history from the database
// 2. Send user's message + history + tool definitions to Gemini
// 3. If Gemini wants to call a tool → we run it (executor.js) → send result back to Gemini
// 4. Gemini composes a human-readable reply based on the REAL data we returned
// 5. Save everything to the conversation history for next time
//
// The AI never guesses numbers. It calls a tool, we return real DB results, it reads them back.

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { TOOL_DEFINITIONS } = require('./tools');
const { executeTool } = require('./executor');
const { getDb } = require('../db/schema');
const { v4: uuidv4 } = require('uuid');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// System prompt: tells the AI its personality, rules, and limitations
const FINANCIAL_TOOL_DEFINITIONS = TOOL_DEFINITIONS.filter(tool =>
  !['get_business_overview', 'get_inventory_status', 'get_business_transactions'].includes(tool.name)
);

const SYSTEM_PROMPT = `You are Ledger AI, a personal expense and budgeting assistant.
Help the authenticated user understand their actual expenses, income, budgets, and savings.

CORE RULES:
1. Never invent financial data. Use get_summary, get_recent_expenses, search_expenses, and get_budget_status for questions about actual recorded finances.
2. Only add an expense when the user clearly asks to record it. Confirm successful database writes accurately.
3. Only edit or delete an expense when the user clearly asks. Never claim to change income or budget data unless the corresponding action succeeds.
4. Be concise, warm, and practical. Currency is Indian Rupees (₹). Format amounts as ₹X,XXX.
5. Give realistic saving suggestions, clearly labeled as suggestions, and base them on records returned by tools.
6. If there is not enough recorded data to answer, say so plainly instead of guessing.

PERSONALITY: A trustworthy personal finance assistant. Use plain language and make the next step clear.
`;

async function runAgentLoop(userId, userMessage) {
  const db = getDb();

  // Load recent conversation history (last 20 messages for context)
  const historyRows = db.prepare(`
    SELECT role, content, tool_calls FROM conversation_history
    WHERE user_id=? ORDER BY created_at DESC LIMIT 20
  `).all(userId).reverse();

  // Convert DB rows to Gemini conversation format
  const history = [];
  for (const row of historyRows) {
    if (row.role === 'user') {
      history.push({ role: 'user', parts: [{ text: row.content }] });
    } else if (row.role === 'model' && row.content) {
      // Do not replay legacy function-call parts; current Gemini models reject them.
      history.push({ role: 'model', parts: [{ text: row.content }] });
    }
  }

  // Gemini chat history must always begin with a user message.
  const firstUserMessage = history.findIndex(message => message.role === 'user');
  if (firstUserMessage === -1) history.length = 0;
  else if (firstUserMessage > 0) history.splice(0, firstUserMessage);

  // Merge adjacent messages created by skipped legacy tool-call turns.
  for (let index = history.length - 1; index > 0; index--) {
    if (history[index].role === history[index - 1].role) {
      history[index - 1].parts[0].text += `\n${history[index].parts[0].text}`;
      history.splice(index, 1);
    }
  }

  // Set up the Gemini model with tools
  const model = genAI.getGenerativeModel({
    model: 'gemini-3.6-flash',
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: FINANCIAL_TOOL_DEFINITIONS }],
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } }
  });

  const chat = model.startChat({ history });

  // ── TURN 1: Send user message ──
  let result = await chat.sendMessage(userMessage);
  let response = result.response;

  const actionLogEntries = [];
  const toolCallsMade = [];
  let allModelParts = [...response.candidates[0].content.parts];
  const toolResults = [];
  let fallbackText = null;

  // ── TOOL CALLING LOOP ──
  // Keep executing tools until the model gives a text response
  let iterations = 0;
  while (response.functionCalls()?.length > 0 && iterations < 5) {
    iterations++;
    const calls = response.functionCalls();

    const functionResponseParts = [];

    for (const call of calls) {
      const toolName = call.name;
      const toolArgs = call.args || {};

      console.log(`[Agent] Tool call: ${toolName}`, JSON.stringify(toolArgs));

      // Execute the tool deterministically
      const toolResult = executeTool(userId, toolName, toolArgs);

      // Collect action log entries from tool results
      if (toolResult.action_log) {
        actionLogEntries.push(toolResult.action_log);
      }

      toolCallsMade.push({ tool: toolName, args: toolArgs, result: toolResult });

      functionResponseParts.push({
        functionResponse: {
          name: toolName,
          response: toolResult
        }
      });

      toolResults.push({
        functionResponse: { name: toolName, response: toolResult }
      });
    }

    const loggedExpenses = toolCallsMade
      .map(call => call.result.expense)
      .filter(Boolean);
    if (loggedExpenses.length > 0) {
      fallbackText = loggedExpenses
        .map(expense => `Logged ₹${expense.amount} for ${expense.description} under ${expense.category}.`)
        .join('\n');
      break;
    }

    // Send tool results as user text because newer Gemini models reject the legacy function role.
    try {
      result = await chat.sendMessage(
        `Tool results for the requested action:\n${JSON.stringify(toolResults)}`
      );
      response = result.response;
      allModelParts = [...allModelParts, ...response.candidates[0].content.parts];
    } catch (error) {
      const loggedExpenses = toolCallsMade
        .map(call => call.result.expense)
        .filter(Boolean);
      if (loggedExpenses.length > 0) {
        fallbackText = loggedExpenses
          .map(expense => `Logged ₹${expense.amount} for ${expense.description} under ${expense.category}.`)
          .join('\n');
        break;
      }
      throw error;
    }
  }

  const finalText = fallbackText || response.text() || 'Done.';

  // ── Save conversation to DB ──
  const userMsgId = uuidv4();
  db.prepare('INSERT INTO conversation_history (id, user_id, role, content) VALUES (?, ?, ?, ?)').run(
    userMsgId, userId, 'user', userMessage
  );

  const modelMsgId = uuidv4();
  db.prepare(`
    INSERT INTO conversation_history (id, user_id, role, content, tool_calls)
    VALUES (?, ?, 'model', ?, ?)
  `).run(
    modelMsgId, userId, finalText,
    toolCallsMade.length > 0 ? JSON.stringify({ model_parts: allModelParts, tool_results: toolResults }) : null
  );

  return {
    reply: finalText,
    tool_calls: toolCallsMade,
    action_log: actionLogEntries
  };
}

module.exports = { runAgentLoop };
