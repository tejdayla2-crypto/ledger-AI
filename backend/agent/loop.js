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
const SYSTEM_PROMPT = `You are Ledger, an AI financial assistant embedded in a personal expense management app.
You help users track expenses, understand their spending, and manage budgets through conversation.

CORE RULES:
1. You have access to tools — use them for ANY expense-related action. Never make up numbers.
2. When a user adds an expense, ALWAYS call add_expense. Never just acknowledge it without logging.
3. For money totals, ALWAYS call get_summary. Never calculate totals yourself — your math may differ from the database.
4. For deletions or large changes, confirm once before proceeding if the request is ambiguous.
5. If a user says "delete that" or "remove the last one" without clarity, ask which expense they mean. Use get_recent_expenses to show them options.
6. After adding an expense, confirm with the exact amount and category you logged.
7. Be concise and friendly. Users are busy — don't be verbose.
8. Currency is Indian Rupees (₹). Always format amounts as ₹X,XXX.
9. If the user's message is completely unrelated to personal finance, politely redirect them.
10. When unsure about a category, pick the best one but mention the user can change it by clicking the category in the transaction list.

PERSONALITY: Professional but warm. Like a sharp, reliable accountant who's also good at explaining things simply.
Use plain language. Avoid jargon. Be direct about what you did.

EXAMPLES OF GOOD RESPONSES:
- "Got it — logged ₹350 for Lunch at Café under Food. Your food spending this month is ₹3,420."
- "You spent ₹8,230 on Food last month — that's your highest category."
- "I see 3 recent transport expenses. Which one did you want to delete? [lists them]"
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
    tools: [{ functionDeclarations: TOOL_DEFINITIONS }],
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
