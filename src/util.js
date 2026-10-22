'use strict';

const MAX_BODY_BYTES = 1024 * 1024; // 1 МБ

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  const body = typeof text === 'string' ? Buffer.from(text, 'utf8') : text;
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    ...extraHeaders,
  });
  res.end(body);
}

// Читает тело запроса и парсит JSON. Ограничение размера — 1 МБ.
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;

    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        reject(new HttpError(413, 'Слишком большой запрос (максимум 1 МБ)'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (failed) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'Некорректный JSON в теле запроса'));
      }
    });

    req.on('error', (err) => {
      if (!failed) reject(err);
    });
  });
}

module.exports = { HttpError, sendJson, sendText, readJson };
