'use strict';

// Сквозной тест ключевого сценария. Запуск: npm test
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const assert = require('assert');

const PORT = 3100 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forms-test-'));

const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'inherit'],
});

async function waitReady() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(BASE + '/admin');
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Сервер не запустился');
}

const j = async (method, url, body) => {
  const res = await fetch(BASE + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, res };
};

let passed = 0;
const ok = (name) => { passed++; console.log('  ✓ ' + name); };

(async () => {
  try {
    await waitReady();
    console.log('Тесты:');

    // 1. Менеджер собирает форму
    let r = await j('POST', '/api/forms', { title: '' });
    assert.strictEqual(r.status, 400); ok('пустое название отклоняется');

    r = await j('POST', '/api/forms', {
      title: 'Отклик <b>на стажировку</b>',
      description: 'Описание',
      questions: [
        { id: 'name', type: 'text', label: 'Имя', required: true },
        { id: 'mail', type: 'email', label: 'Email', required: true },
        { id: 'age', type: 'number', label: 'Возраст' },
        { id: 'about', type: 'textarea', label: 'О себе' },
        { id: 'lang', type: 'radio', label: 'Язык', options: ['JS', 'C#'] },
        { id: 'skills', type: 'checkbox', label: 'Навыки', options: ['SQL', 'Git', 'Docker'] },
        { id: 'city', type: 'select', label: 'Город', options: ['Москва', 'Казань'] },
        { id: 'dob', type: 'date', label: 'Дата рождения' },
      ],
    });
    assert.strictEqual(r.status, 201);
    const form = r.data;
    assert.strictEqual(form.status, 'draft');
    ok('форма создана (черновик)');

    // 2. Черновик по ссылке недоступен
    r = await j('POST', '/api/forms', { title: 'Пустая', questions: [] });
    r = await j('POST', `/api/forms/${r.data.id}/publish`);
    assert.strictEqual(r.status, 400); ok('пустую форму опубликовать нельзя');

    r = await j('POST', `/api/forms/${form.id}/publish`);
    assert.strictEqual(r.status, 200);
    const slug = r.data.slug;
    assert.ok(slug && r.data.url === `/f/${slug}`);
    ok('форма опубликована, ссылка: ' + r.data.url);

    // 3. Студент открывает ссылку
    r = await j('GET', `/f/${slug}`);
    assert.strictEqual(r.status, 200); assert.ok(String(r.data).includes('<html'));
    ok('страница /f/<slug> открывается');

    r = await j('GET', '/f/unknown123');
    assert.strictEqual(r.status, 404); ok('неизвестная ссылка → 404');

    r = await j('GET', `/api/public/forms/${slug}`);
    assert.strictEqual(r.status, 200); assert.strictEqual(r.data.questions.length, 8);
    ok('схема формы доступна студенту');

    // 4. Валидация
    r = await j('POST', `/api/public/forms/${slug}/responses`, { answers: { mail: 'bad' } });
    assert.strictEqual(r.status, 400);
    assert.ok(r.data.details.errors.name && r.data.details.errors.mail);
    ok('обязательные поля и email проверяются на сервере');

    r = await j('POST', `/api/public/forms/${slug}/responses`, {
      answers: { name: 'Иван', mail: 'a@b.co', lang: 'PHP' },
    });
    assert.strictEqual(r.status, 400); assert.ok(r.data.details.errors.lang);
    ok('недопустимый вариант отклоняется');

    r = await j('POST', `/api/public/forms/${slug}/responses`, {
      answers: { name: 'Иван', mail: 'a@b.co', age: 'abc' },
    });
    assert.strictEqual(r.status, 400); assert.ok(r.data.details.errors.age);
    ok('нечисловое значение отклоняется');

    // 5. Корректный ответ
    r = await j('POST', `/api/public/forms/${slug}/responses`, {
      answers: {
        name: 'Иван "Тест"; =cmd', mail: 'ivan@example.com', age: '21', about: 'Строка1\nСтрока2',
        lang: 'C#', skills: ['SQL', 'Docker'], city: 'Казань', dob: '2003-05-17',
      },
    });
    assert.strictEqual(r.status, 201); ok('ответ принят');

    // 6. Менеджер видит ответы
    r = await j('GET', `/api/forms/${form.id}/responses`);
    assert.strictEqual(r.data.total, 1);
    assert.deepStrictEqual(r.data.rows[0].values.skills, ['SQL', 'Docker']);
    assert.strictEqual(r.data.rows[0].values.age, 21);
    ok('ответ виден в админке');

    r = await j('GET', '/api/forms');
    assert.strictEqual(r.data.find((f) => f.id === form.id).responsesCount, 1);
    ok('счётчик ответов в списке форм');

    // 7. CSV
    r = await j('GET', `/api/forms/${form.id}/responses.csv`);
    assert.ok(r.res.headers.get('content-type').startsWith('text/csv'));
    const raw = Buffer.from(await (await fetch(BASE + `/api/forms/${form.id}/responses.csv`)).arrayBuffer());
    assert.deepStrictEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]); // BOM в байтах (text() его скрывает)
    assert.ok(r.data.includes('"Иван ""Тест""; =cmd"'));
    ok('CSV: BOM, UTF-8, экранирование кавычек');

    // 8. Редактирование схемы не ломает старые ответы
    r = await j('PUT', `/api/forms/${form.id}`, {
      title: 'Отклик v2',
      questions: [{ id: 'name', type: 'text', label: 'ФИО', required: true }],
    });
    assert.strictEqual(r.status, 200);
    r = await j('GET', `/api/forms/${form.id}/responses`);
    assert.ok(r.data.columns.some((c) => c.removed));
    assert.strictEqual(r.data.total, 1);
    ok('после правки формы старые ответы сохраняются (снимок вопросов)');

    // 9. Снятие с публикации
    await j('POST', `/api/forms/${form.id}/unpublish`);
    r = await j('GET', `/api/public/forms/${slug}`);
    assert.strictEqual(r.status, 404);
    r = await j('GET', `/f/${slug}`);
    assert.strictEqual(r.status, 404);
    ok('снятая с публикации форма недоступна');

    await j('POST', `/api/forms/${form.id}/publish`);
    r = await j('GET', `/api/forms/${form.id}`);
    assert.strictEqual(r.data.slug, slug);
    ok('при повторной публикации ссылка не меняется');

    // 10. Безопасность и граничные случаи
    r = await j('GET', '/static/../server.js');
    assert.notStrictEqual(r.status, 200);
    r = await fetch(BASE + '/static/%2e%2e/server.js');
    assert.notStrictEqual(r.status, 200);
    ok('обход каталога через /static закрыт');

    const big = await fetch(BASE + '/api/forms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x', description: 'y'.repeat(1100000) }),
    }).catch(() => ({ status: 413 }));
    assert.strictEqual(big.status, 413); ok('слишком большое тело → 413');

    r = await fetch(BASE + '/api/forms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
    assert.strictEqual(r.status, 400); ok('битый JSON → 400');

    // 11. Удаление
    r = await j('DELETE', `/api/forms/${form.id}`);
    assert.strictEqual(r.status, 200);
    r = await j('GET', `/api/forms/${form.id}`);
    assert.strictEqual(r.status, 404); ok('форма удаляется');

    console.log(`\nВсе проверки пройдены: ${passed}`);
    process.exitCode = 0;
  } catch (err) {
    console.error('\nТЕСТ ПРОВАЛЕН:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    server.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})();
