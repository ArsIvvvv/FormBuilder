'use strict';

// Небольшие помощники для безопасной работы с DOM.
// Весь пользовательский текст попадает в страницу только через textContent / createTextNode,
// поэтому XSS через названия форм, вопросы или ответы невозможен.
(function (global) {
  const PROPS = ['value', 'checked', 'disabled', 'selected'];

  function append(el, children) {
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) append(el, child);
      else if (child instanceof Node) el.appendChild(child);
      else el.appendChild(document.createTextNode(String(child)));
    }
  }

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    const props = {};
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'className') el.className = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (PROPS.includes(k)) props[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    append(el, children);
    // свойства ставим после добавления детей (важно для <select value>)
    for (const [k, v] of Object.entries(props)) el[k] = v;
    return el;
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    if ((res.headers.get('content-type') || '').includes('json')) {
      data = await res.json().catch(() => null);
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Ошибка ${res.status}`);
      err.status = res.status;
      err.details = data && data.details;
      throw err;
    }
    return data;
  }

  let toastTimer = null;
  function toast(message, isError) {
    let el = document.getElementById('toast');
    if (!el) {
      el = h('div', { id: 'toast', className: 'toast', role: 'status' });
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = 'toast'), 3500);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = h('textarea', { value: text, style: 'position:fixed;opacity:0' });
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('Ссылка скопирована');
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
  }

  global.UI = { h, api, toast, copyText, formatDate };
})(window);
