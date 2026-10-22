'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

let db = { forms: [], responses: [] };

function persist() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE); // атомарная замена файла
}

function init() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db = {
        forms: Array.isArray(parsed.forms) ? parsed.forms : [],
        responses: Array.isArray(parsed.responses) ? parsed.responses : [],
      };
    } catch (err) {
      // Файл повреждён: сохраняем копию и начинаем с чистой базы, чтобы сервис не падал
      const backup = `${DB_FILE}.corrupt-${Date.now()}`;
      fs.renameSync(DB_FILE, backup);
      console.error(`db.json повреждён, копия сохранена: ${backup}`);
      persist();
    }
  } else {
    persist();
  }
}

function newId() {
  return crypto.randomUUID();
}

function newSlug() {
  for (;;) {
    const slug = crypto.randomBytes(6).toString('base64url'); // 8 символов
    if (!db.forms.some((f) => f.slug === slug)) return slug;
  }
}

const clone = (x) => JSON.parse(JSON.stringify(x));

function listForms() {
  return db.forms
    .map((f) => ({ ...clone(f), responsesCount: countResponses(f.id) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function getForm(id) {
  const f = db.forms.find((x) => x.id === id);
  return f ? clone(f) : null;
}

function getFormBySlug(slug) {
  const f = db.forms.find((x) => x.slug === slug);
  return f ? clone(f) : null;
}

function createForm(data) {
  const now = new Date().toISOString();
  const form = {
    id: newId(),
    title: data.title,
    description: data.description,
    questions: data.questions,
    status: 'draft',
    slug: null,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
  };
  db.forms.push(form);
  persist();
  return clone(form);
}

function updateForm(id, data) {
  const f = db.forms.find((x) => x.id === id);
  if (!f) return null;
  f.title = data.title;
  f.description = data.description;
  f.questions = data.questions;
  f.updatedAt = new Date().toISOString();
  persist();
  return clone(f);
}

function deleteForm(id) {
  const idx = db.forms.findIndex((x) => x.id === id);
  if (idx === -1) return false;
  db.forms.splice(idx, 1);
  db.responses = db.responses.filter((r) => r.formId !== id);
  persist();
  return true;
}

function setPublished(id, published) {
  const f = db.forms.find((x) => x.id === id);
  if (!f) return null;
  if (published) {
    if (!f.slug) f.slug = newSlug(); // ссылка остаётся прежней при повторной публикации
    f.status = 'published';
    f.publishedAt = new Date().toISOString();
  } else {
    f.status = 'draft';
  }
  f.updatedAt = new Date().toISOString();
  persist();
  return clone(f);
}

function addResponse(formId, answers) {
  const response = {
    id: newId(),
    formId,
    submittedAt: new Date().toISOString(),
    answers, // снимок: [{questionId, label, type, value}]
  };
  db.responses.push(response);
  persist();
  return clone(response);
}

function listResponses(formId) {
  return clone(db.responses.filter((r) => r.formId === formId));
}

function countResponses(formId) {
  return db.responses.reduce((n, r) => (r.formId === formId ? n + 1 : n), 0);
}

module.exports = {
  init,
  newId,
  listForms,
  getForm,
  getFormBySlug,
  createForm,
  updateForm,
  deleteForm,
  setPublished,
  addResponse,
  listResponses,
  countResponses,
  DB_FILE,
};
