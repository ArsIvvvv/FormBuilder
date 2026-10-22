'use strict';

const { HttpError } = require('./util');
const crypto = require('crypto');

const TYPES = ['text', 'textarea', 'number', 'email', 'radio', 'checkbox', 'select', 'date'];
const CHOICE_TYPES = ['radio', 'checkbox', 'select'];

const LIMITS = {
  title: 200,
  description: 2000,
  questions: 100,
  label: 500,
  hint: 500,
  options: 50,
  option: 200,
  text: 1000,
  textarea: 10000,
  email: 254,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMBER_RE = /^-?\d+([.,]\d+)?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// ---------- Схема формы ----------

function normalizeFormInput(body) {
  if (!isObj(body)) throw new HttpError(400, 'Тело запроса должно быть JSON-объектом');

  const title = str(body.title);
  if (!title) throw new HttpError(400, 'Укажите название формы');
  if (title.length > LIMITS.title) {
    throw new HttpError(400, `Название формы не длиннее ${LIMITS.title} символов`);
  }

  const description = str(body.description);
  if (description.length > LIMITS.description) {
    throw new HttpError(400, `Описание не длиннее ${LIMITS.description} символов`);
  }

  const rawQuestions = body.questions === undefined ? [] : body.questions;
  if (!Array.isArray(rawQuestions)) throw new HttpError(400, 'Поле questions должно быть массивом');
  if (rawQuestions.length > LIMITS.questions) {
    throw new HttpError(400, `Вопросов не больше ${LIMITS.questions}`);
  }

  const usedIds = new Set();
  const questions = rawQuestions.map((q, i) => {
    const n = i + 1;
    if (!isObj(q)) throw new HttpError(400, `Вопрос ${n}: некорректные данные`);

    if (!TYPES.includes(q.type)) throw new HttpError(400, `Вопрос ${n}: неизвестный тип поля`);

    const label = str(q.label);
    if (!label) throw new HttpError(400, `Вопрос ${n}: введите текст вопроса`);
    if (label.length > LIMITS.label) {
      throw new HttpError(400, `Вопрос ${n}: текст не длиннее ${LIMITS.label} символов`);
    }

    const hint = str(q.hint);
    if (hint.length > LIMITS.hint) {
      throw new HttpError(400, `Вопрос ${n}: подсказка не длиннее ${LIMITS.hint} символов`);
    }

    // id вопроса: сохраняем присланный, если он корректный и уникальный
    let id = typeof q.id === 'string' && ID_RE.test(q.id) && !usedIds.has(q.id) ? q.id : null;
    while (!id || usedIds.has(id)) id = 'q' + crypto.randomBytes(4).toString('hex');
    usedIds.add(id);

    let options = [];
    if (CHOICE_TYPES.includes(q.type)) {
      if (!Array.isArray(q.options)) {
        throw new HttpError(400, `Вопрос ${n}: добавьте варианты ответа`);
      }
      const seen = new Set();
      for (const o of q.options) {
        const text = str(o);
        if (!text) continue;
        if (text.length > LIMITS.option) {
          throw new HttpError(400, `Вопрос ${n}: вариант не длиннее ${LIMITS.option} символов`);
        }
        if (seen.has(text)) throw new HttpError(400, `Вопрос ${n}: варианты не должны повторяться`);
        seen.add(text);
        options.push(text);
      }
      if (options.length < 1) throw new HttpError(400, `Вопрос ${n}: добавьте хотя бы один вариант ответа`);
      if (options.length > LIMITS.options) {
        throw new HttpError(400, `Вопрос ${n}: вариантов не больше ${LIMITS.options}`);
      }
    }

    return { id, type: q.type, label, hint, required: q.required === true, options };
  });

  return { title, description, questions };
}

// ---------- Ответы студента ----------

function isEmpty(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

// Возвращает { errors: {questionId: message}, answers: [{questionId,label,type,value}] }
function validateAnswers(form, input) {
  const errors = {};
  const answers = [];
  const given = isObj(input) ? input : {};

  for (const q of form.questions) {
    const raw = given[q.id];

    if (isEmpty(raw)) {
      if (q.required) errors[q.id] = 'Обязательное поле';
      answers.push({ questionId: q.id, label: q.label, type: q.type, value: null });
      continue;
    }

    let value = null;
    switch (q.type) {
      case 'text':
      case 'textarea': {
        const max = LIMITS[q.type];
        if (typeof raw !== 'string') errors[q.id] = 'Ожидается текст';
        else if (raw.trim().length > max) errors[q.id] = `Не длиннее ${max} символов`;
        else value = raw.trim();
        break;
      }
      case 'email': {
        if (typeof raw !== 'string') errors[q.id] = 'Ожидается текст';
        else if (raw.trim().length > LIMITS.email || !EMAIL_RE.test(raw.trim())) {
          errors[q.id] = 'Введите корректный email';
        } else value = raw.trim();
        break;
      }
      case 'number': {
        const s = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
        if (!NUMBER_RE.test(s)) errors[q.id] = 'Введите число';
        else {
          const num = Number(s.replace(',', '.'));
          if (!Number.isFinite(num)) errors[q.id] = 'Введите число';
          else value = num;
        }
        break;
      }
      case 'date': {
        const m = typeof raw === 'string' ? DATE_RE.exec(raw.trim()) : null;
        let ok = false;
        if (m) {
          const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
          const dt = new Date(Date.UTC(y, mo - 1, d));
          ok = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
        }
        if (!ok) errors[q.id] = 'Введите корректную дату';
        else value = raw.trim();
        break;
      }
      case 'radio':
      case 'select': {
        if (typeof raw !== 'string' || !q.options.includes(raw)) errors[q.id] = 'Выберите один из предложенных вариантов';
        else value = raw;
        break;
      }
      case 'checkbox': {
        if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string' || !q.options.includes(x))) {
          errors[q.id] = 'Выберите из предложенных вариантов';
        } else {
          value = q.options.filter((o) => raw.includes(o)); // в порядке вариантов, без дублей
        }
        break;
      }
    }
    answers.push({ questionId: q.id, label: q.label, type: q.type, value });
  }

  return { errors, answers };
}

module.exports = { normalizeFormInput, validateAnswers, TYPES, CHOICE_TYPES };
