/** Lightweight local preview of the already-built Admin and Customer apps. No Angular build watchers. */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

const configs = [
  { port: 4200, name: 'Customer', root: path.resolve(process.cwd(), '../my-client/dist/my-client/browser') },
  { port: 4300, name: 'Admin', root: path.resolve(process.cwd(), '../my-admin/dist/my-admin/browser') },
];
for (const config of configs) {
  const index = ['index.csr.html', 'index.html'].map(name => path.join(config.root, name)).find(p => fs.existsSync(p));
  if (!index) throw new Error(`Build ${config.name} trước khi chạy preview.`);
  const app = express();
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use(express.static(config.root));
  app.get('*', (_req, res) => res.sendFile(index));
  const server = app.listen(config.port, '127.0.0.1', () => console.log(`${config.name}: http://localhost:${config.port}`));
  server.on('error', (error: any) => console.error(`${config.name}: ${error.code || 'Không khởi chạy được'}`));
}
