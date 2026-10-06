const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

process.env.JWT_SECRET = 'test-secret-that-is-long-and-random-123456789';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';

const app = require('../server');

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

async function signup(email) {
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'test-password-123' })
  });
  assert.equal(response.status, 200);
  return { cookie: response.headers.get('set-cookie'), body: await response.json() };
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

