'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const storage = require('./src/storage');
const { handleApi } = require('./src/api');
const { HttpError, sendJson, sendText } = require('./src/util');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'same-origin',
};

storage.init();

function serveFile(res, filePath, status = 200) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendText(res, 404, notFoundPage('Страница не найдена'), 'text/html; charset=utf-8');
      return;
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    sendText(res, status, data, type, { 'Cache-Control': 'no-cache' });
  });
}

function notFoundPage(message) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Не найдено</title><link rel="stylesheet" href="/static/css/style.css"></head>
<body><main class="container narrow"><div class="card center"><h1>404</h1><p>${message}</p><a class="btn" href="/admin">В админку</a></div></main></body></html>`;
}

function serveStatic(res, pathname) {
  const rel = pathname.replace(/^\/static\//, '');
  const filePath = path.resolve(PUBLIC_DIR, rel);
  // защита от выхода за пределы public (../)
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  serveFile(res, filePath);
}

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);

  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    sendText(res, 400, 'Bad request');
    return;
  }
  const pathname = url.pathname;

  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new HttpError(405, 'Метод не поддерживается');
    }

    if (pathname === '/') {
      res.writeHead(302, { Location: '/admin' });
      res.end();
    } else if (pathname === '/admin' || pathname === '/admin/') {
      serveFile(res, path.join(PUBLIC_DIR, 'admin', 'index.html'));
    } else if (/^\/f\/[^/]+\/?$/.test(pathname)) {
      // Публичная форма. Если ссылка недоступна, отдаём ту же страницу со статусом 404:
      // скрипт покажет понятное сообщение «Форма недоступна».
      let slug = pathname.split('/')[2];
      try {
        slug = decodeURIComponent(slug);
      } catch {
        /* оставляем как есть: форма просто не найдётся */
      }
      const form = storage.getFormBySlug(slug);
      const available = form && form.status === 'published';
      serveFile(res, path.join(PUBLIC_DIR, 'form', 'index.html'), available ? 200 : 404);
    } else if (pathname.startsWith('/static/')) {
      serveStatic(res, pathname);
    } else {
      sendText(res, 404, notFoundPage('Страница не найдена'), 'text/html; charset=utf-8');
    }
  } catch (err) {
    if (err instanceof HttpError) {
      sendJson(res, err.status, { error: err.message, ...(err.details ? { details: err.details } : {}) });
    } else {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Внутренняя ошибка сервера' });
    }
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Порт ${PORT} уже занят. Запустите с другим портом: PORT=3001 npm start`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Сервис запущен: http://localhost:${PORT}`);
  console.log(`Админка:        http://localhost:${PORT}/admin`);
});
