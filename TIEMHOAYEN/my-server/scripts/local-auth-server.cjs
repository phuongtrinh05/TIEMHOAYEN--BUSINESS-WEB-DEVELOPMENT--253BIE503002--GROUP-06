// Isolated local database. Never loads the production connection string.
const { spawn } = require('node:child_process');
const { mkdirSync, openSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, '.local-auth');
mkdirSync(path.join(dir, 'db'), { recursive: true });
const mongo = spawn('C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe', [
  '--dbpath', path.join(dir, 'db'), '--port', '27018', '--bind_ip', '127.0.0.1',
  '--logpath', path.join(dir, 'mongo.log'), '--logappend'
], { windowsHide: true, stdio: 'ignore' });
const env = { ...process.env, MONGO_URI: 'mongodb://127.0.0.1:27018', MONGO_DATABASE: 'TIEM_HOA_YEN_LOCAL_TEST',
  PORT: '3001', AUTH_OTP_DELIVERY: 'test', AUTH_OTP_SECRET: randomBytes(32).toString('hex'),
  NODE_ENV: 'development', CORS_ORIGINS: 'http://localhost:4200,http://localhost:4300',
  RESEND_API_KEY: '', AUTH_EMAIL_FROM: '', N8N_WEBHOOK_URL: '' };
const server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { cwd: root, env, windowsHide: true,
  stdio: ['ignore', openSync(path.join(dir, 'server.log'), 'a'), openSync(path.join(dir, 'server-error.log'), 'a')] });
writeFileSync(path.join(dir, 'processes.json'), JSON.stringify({ mongo: mongo.pid, server: server.pid }));
console.log('Local API: http://localhost:3001; database: TIEM_HOA_YEN_LOCAL_TEST');
server.on('exit', code => { mongo.kill(); process.exitCode = code || 0; });
process.on('SIGINT', () => { server.kill(); mongo.kill(); });
