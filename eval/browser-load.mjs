import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outDir = path.join(root, 'eval/runs/browser-load');
const outFile = path.join(outDir, 'latest.json');
const profile = path.join(root, '.scratch/chrome-browser-load');
const port = Number(process.env.BOSES_PORT || 0);
const timeoutMs = Number(process.env.BOSES_LOAD_TIMEOUT_MS || 420000);

const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.wav', 'audio/wav'],
  ['.json', 'application/json'],
]);

function send(res, status, body, type) {
  res.writeHead(status, { 'content-type': type || 'text/plain; charset=utf-8' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
  if (req.method === 'POST' && url.pathname === '/__report') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        await mkdir(outDir, { recursive: true });
        await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`);
        send(res, 204, '');
        finish(report);
      } catch (err) {
        send(res, 400, err instanceof Error ? err.message : String(err));
      }
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'method');
    return;
  }
  const rel = decodeURIComponent(url.pathname);
  const file = path.resolve(root, `.${rel}`);
  if (!file.startsWith(root + path.sep) && file !== root) {
    send(res, 403, 'forbidden');
    return;
  }
  stat(file)
    .then((info) => {
      if (!info.isFile()) {
        send(res, 404, 'not a file');
        return;
      }
      res.writeHead(200, {
        'content-type': types.get(path.extname(file)) || 'application/octet-stream',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      createReadStream(file).pipe(res);
    })
    .catch(() => send(res, 404, 'missing'));
});

let chromeProc = null;
let timer = null;
let closed = false;

function finish(report) {
  if (closed) return;
  closed = true;
  clearTimeout(timer);
  if (chromeProc) chromeProc.kill('SIGTERM');
  server.close();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  const ok = report && !report.error && report.device && report.runs?.length === 2;
  process.exit(ok ? 0 : 1);
}

await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
const bound = server.address();
const livePort = typeof bound === 'object' && bound ? bound.port : port;
await mkdir(profile, { recursive: true });

chromeProc = spawn(chrome, [
  '--headless=new',
  '--enable-unsafe-webgpu',
  '--enable-features=WebGPU',
  '--use-angle=metal',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  `--user-data-dir=${profile}`,
  `http://127.0.0.1:${livePort}/eval/browser-load.html`,
], { stdio: 'ignore' });

chromeProc.on('exit', (code) => {
  if (!closed) finish({ error: `chrome exited ${code} before the report`, device: null, runs: [] });
});

timer = setTimeout(() => {
  finish({ error: `no report within ${timeoutMs} ms`, device: null, runs: [] });
}, timeoutMs);
