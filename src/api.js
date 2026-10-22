'use strict';

const storage = require('./storage');
const { HttpError, sendJson, sendText, readJson } = require('./util');
const { normalizeFormInput, validateAnswers } = require('./validation');

// ---------- Вспомогательные функции ----------

function presentForm(form) {
  return { ...form, url: form.slug ? `/f/${form.slug}` : null };
}

function getFormOr404(id) {
  const form = storage.getForm(id);
  if (!form) throw new HttpError(404, 'Форма не найдена');
  return form;
}

// Таблица ответов: колонки = вопросы формы (+ вопросы, удалённые из формы позже)
function buildTable(form, responses) {
  const columns = form.questions.map((q) => ({ id: q.id, label: q.label, type: q.type }));
  const known = new Set(columns.map((c) => c.id));

  for (const r of responses) {
    for (const a of r.answers) {
      if (!known.has(a.questionId)) {
        known.add(a.questionId);
        columns.push({ id: a.questionId, label: `${a.label} (вопрос удалён)`, type: a.type, removed: true });
      }
    }
  }

  const rows = responses.map((r) => {
    const values = {};
    for (const a of r.answers) values[a.questionId] = a.value;
    return { id: r.id, submittedAt: r.submittedAt, values };
  });

  return { columns, rows };
}

function csvCell(value) {
  let s;
  if (value === null || value === undefined) s = '';
  else if (Array.isArray(value)) s = value.join(', ');
  else s = String(value);

  // Защита от формульных инъекций в Excel (=, +, -, @ в начале строки), числа не трогаем
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) {
    s = "'" + s;
  }
  return `"${s.replace(/"/g, '""')}"`;
}

function buildCsv(form, responses) {
  const sorted = [...responses].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  const { columns, rows } = buildTable(form, sorted);
  const header = ['Дата отправки', ...columns.map((c) => c.label)].map(csvCell).join(';');
  const lines = rows.map((row) =>
    [new Date(row.submittedAt).toLocaleString('ru-RU', { timeZone: 'UTC' }) + ' UTC', ...columns.map((c) => row.values[c.id])]
      .map(csvCell)
      .join(';')
  );
  return '\uFEFF' + [header, ...lines].join('\r\n') + '\r\n'; // BOM для Excel
}

function safeFileName(title) {
  const base = title.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'responses';
  return base;
}

// ---------- Таблица маршрутов ----------

const routes = [];
function route(method, pattern, handler) {
  routes.push({ method, regex: new RegExp(`^${pattern}$`), handler });
}

const ID = '([^/]+)';

// Админ-API
route('GET', '/api/forms', ({ res }) => {
  sendJson(res, 200, storage.listForms().map(presentForm));
});

route('POST', '/api/forms', async ({ req, res }) => {
  const data = normalizeFormInput(await readJson(req));
  sendJson(res, 201, presentForm(storage.createForm(data)));
});

route('GET', `/api/forms/${ID}`, ({ res, params }) => {
  sendJson(res, 200, presentForm(getFormOr404(params[0])));
});

route('PUT', `/api/forms/${ID}`, async ({ req, res, params }) => {
  getFormOr404(params[0]);
  const data = normalizeFormInput(await readJson(req));
  sendJson(res, 200, presentForm(storage.updateForm(params[0], data)));
});

route('DELETE', `/api/forms/${ID}`, ({ res, params }) => {
  getFormOr404(params[0]);
  storage.deleteForm(params[0]);
  sendJson(res, 200, { ok: true });
});

route('POST', `/api/forms/${ID}/publish`, ({ res, params }) => {
  const form = getFormOr404(params[0]);
  if (form.questions.length === 0) {
    throw new HttpError(400, 'Добавьте хотя бы один вопрос, чтобы опубликовать форму');
  }
  sendJson(res, 200, presentForm(storage.setPublished(params[0], true)));
});

route('POST', `/api/forms/${ID}/unpublish`, ({ res, params }) => {
  getFormOr404(params[0]);
  sendJson(res, 200, presentForm(storage.setPublished(params[0], false)));
});

route('GET', `/api/forms/${ID}/responses`, ({ res, params }) => {
  const form = getFormOr404(params[0]);
  const responses = storage.listResponses(form.id).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  const { columns, rows } = buildTable(form, responses);
  sendJson(res, 200, {
    form: { id: form.id, title: form.title, status: form.status, slug: form.slug, url: form.slug ? `/f/${form.slug}` : null },
    total: rows.length,
    columns,
    rows,
  });
});

route('GET', `/api/forms/${ID}/responses\\.csv`, ({ res, params }) => {
  const form = getFormOr404(params[0]);
  const csv = buildCsv(form, storage.listResponses(form.id));
  const name = safeFileName(form.title);
  sendText(res, 200, csv, 'text/csv; charset=utf-8', {
    'Content-Disposition': `attachment; filename="responses.csv"; filename*=UTF-8''${encodeURIComponent(name)}.csv`,
    'Cache-Control': 'no-store',
  });
});

// Публичное API (для студента)
route('GET', `/api/public/forms/${ID}`, ({ res, params }) => {
  const form = storage.getFormBySlug(params[0]);
  if (!form || form.status !== 'published') throw new HttpError(404, 'Форма недоступна');
  sendJson(res, 200, { title: form.title, description: form.description, questions: form.questions });
});

route('POST', `/api/public/forms/${ID}/responses`, async ({ req, res, params }) => {
  const form = storage.getFormBySlug(params[0]);
  if (!form || form.status !== 'published') throw new HttpError(404, 'Форма недоступна');

  const body = await readJson(req);
  const { errors, answers } = validateAnswers(form, body && body.answers);
  if (Object.keys(errors).length > 0) {
    throw new HttpError(400, 'Проверьте правильность заполнения формы', { errors });
  }
  storage.addResponse(form.id, answers);
  sendJson(res, 201, { ok: true });
});

// Возвращает true, если запрос обработан
async function handleApi(req, res, pathname) {
  let pathMatched = false;
  for (const r of routes) {
    const m = r.regex.exec(pathname);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== req.method) continue;
    const params = m.slice(1).map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
    await r.handler({ req, res, params });
    return;
  }
  if (pathMatched) throw new HttpError(405, 'Метод не поддерживается');
  throw new HttpError(404, 'Маршрут не найден');
}

module.exports = { handleApi };
