const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const backendDirectory = path.join(root, 'backend');
const backendPort = process.env.PORT || (() => {
  try {
    const portLine = fs.readFileSync(path.join(backendDirectory, '.env'), 'utf8')
      .split(/\r?\n/)
      .find(line => /^\s*PORT\s*=/.test(line));
    return portLine ? portLine.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '') || '3001' : '3001';
  } catch {
    return '3001';
  }
})();
const commands = [
  {
    name: 'backend',
    cwd: backendDirectory,
    entry: path.join(backendDirectory, 'node_modules', 'nodemon', 'bin', 'nodemon.js'),
    args: ['server.js']
  },
  {
    name: 'frontend',
    cwd: path.join(root, 'frontend'),
    entry: path.join(root, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'),
    args: []
  }
];

const children = [];
let stopping = false;

function backendIsHealthy() {
  return new Promise(resolve => {
    const request = http.get({
      hostname: 'localhost',
      port: backendPort,
      path: '/api/health',
      timeout: 1200
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try {
          resolve(response.statusCode === 200 && JSON.parse(body).status === 'ok');
        } catch {
          resolve(false);
        }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

function frontendIsHealthy() {
  return new Promise(resolve => {
    const request = http.get({
      hostname: 'localhost',
      port: 5173,
      path: '/',
      timeout: 1200
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        resolve(response.statusCode === 200 && body.includes('/@vite/client') && body.includes('Ledger'));
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

function stopAll(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

function startCommand(command) {
  const child = spawn(process.execPath, [command.entry, ...command.args], {
    cwd: command.cwd,
    stdio: 'inherit'
  });
  children.push(child);
  child.on('error', error => {
    console.error(`Could not start ${command.name}: ${error.message}`);
    stopAll(1);
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    if (signal) console.error(`${command.name} stopped after ${signal}.`);
    else if (code !== 0) console.error(`${command.name} exited with code ${code}.`);
    stopAll(code || 1);
  });
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

async function startDevelopmentServers() {
  const [backendHealthy, frontendHealthy] = await Promise.all([
    backendIsHealthy(),
    frontendIsHealthy()
  ]);
  if (backendHealthy) {
    console.log(`Ledger backend is already healthy on port ${backendPort}; reusing it.`);
  } else {
    startCommand(commands[0]);
  }
  if (frontendHealthy) {
    console.log('Ledger frontend is already healthy on port 5173; reusing it.');
  } else {
    startCommand(commands[1]);
  }
}

startDevelopmentServers().catch(error => {
  console.error(`Could not start development servers: ${error.message}`);
  stopAll(1);
});
