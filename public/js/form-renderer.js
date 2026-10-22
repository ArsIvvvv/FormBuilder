'use strict';

// Рендер формы по схеме. Используется и в публичной форме, и в предпросмотре админки.
(function (global) {
  const { h } = global.UI;

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const NUMBER_RE = /^-?\d+([.,]\d+)?$/;

  function isEmptyValue(v) {
    return Array.isArray(v) ? v.length === 0 : String(v || '').trim() === '';
  }

  // opts: { preview: boolean, submitLabel: string, onSubmit: async (answers) => void }
  function renderForm(form, opts = {}) {
    const fields = []; // { q, get, errEl, wrapper }

    const body = form.questions.map((q, i) => {
      const inputId = `field-${i}`;
      const errEl = h('div', { className: 'field-error', role: 'alert' });
      let control;
      let get;

      if (q.type === 'text' || q.type === 'email' || q.type === 'number' || q.type === 'date') {
        const input = h('input', {
          id: inputId,
          type: q.type === 'email' ? 'email' : q.type === 'number' ? 'number' : q.type === 'date' ? 'date' : 'text',
          step: q.type === 'number' ? 'any' : null,
          maxlength: q.type === 'text' ? 1000 : q.type === 'email' ? 254 : null,
          autocomplete: q.type === 'email' ? 'email' : 'off',
        });
        control = input;
        get = () => input.value;
      } else if (q.type === 'textarea') {
        const ta = h('textarea', { id: inputId, rows: 4, maxlength: 10000 });
        control = ta;
        get = () => ta.value;
      } else if (q.type === 'select') {
        const sel = h(
          'select',
          { id: inputId },
          h('option', { value: '' }, '— Выберите —'),
          q.options.map((o) => h('option', { value: o }, o))
        );
        control = sel;
        get = () => sel.value;
      } else if (q.type === 'radio') {
        const name = `radio-${i}`;
        const inputs = q.options.map((o) => h('input', { type: 'radio', name }));
        control = h(
          'div',
          { className: 'options', role: 'radiogroup' },
          q.options.map((o, j) => h('label', { className: 'option' }, inputs[j], h('span', null, o)))
        );
        get = () => {
          const idx = inputs.findIndex((x) => x.checked);
          return idx >= 0 ? q.options[idx] : '';
        };
      } else if (q.type === 'checkbox') {
        const inputs = q.options.map(() => h('input', { type: 'checkbox' }));
        control = h(
          'div',
          { className: 'options' },
          q.options.map((o, j) => h('label', { className: 'option' }, inputs[j], h('span', null, o)))
        );
        get = () => q.options.filter((_, j) => inputs[j].checked);
      }

      const wrapper = h(
        'div',
        { className: 'field' },
        h(
          q.type === 'radio' || q.type === 'checkbox' ? 'div' : 'label',
          { className: 'field-label', for: q.type === 'radio' || q.type === 'checkbox' ? null : inputId },
          q.label,
          q.required ? h('span', { className: 'req', title: 'Обязательное поле' }, ' *') : null
        ),
        q.hint ? h('div', { className: 'field-hint' }, q.hint) : null,
        control,
        errEl
      );
      fields.push({ q, get, errEl, wrapper });
      return wrapper;
    });

    function getAnswers() {
      const answers = {};
      for (const f of fields) answers[f.q.id] = f.get();
      return answers;
    }

    function setErrors(errors) {
      let first = null;
      for (const f of fields) {
        const msg = errors[f.q.id] || '';
        f.errEl.textContent = msg;
        f.wrapper.classList.toggle('has-error', Boolean(msg));
        if (msg && !first) first = f.wrapper;
      }
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Клиентская проверка (сервер всё равно проверяет повторно)
    function validate() {
      const errors = {};
      for (const f of fields) {
        const v = f.get();
        if (isEmptyValue(v)) {
          if (f.q.required) errors[f.q.id] = 'Обязательное поле';
          continue;
        }
        if (f.q.type === 'email' && !EMAIL_RE.test(String(v).trim())) errors[f.q.id] = 'Введите корректный email';
        if (f.q.type === 'number' && !NUMBER_RE.test(String(v).trim())) errors[f.q.id] = 'Введите число';
        if (f.q.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) errors[f.q.id] = 'Введите корректную дату';
      }
      return errors;
    }

    const submitBtn = h(
      'button',
      { type: 'submit', className: 'btn primary', disabled: opts.preview ? true : null },
      opts.submitLabel || 'Отправить'
    );
    const formError = h('div', { className: 'form-error', role: 'alert' });

    const el = h(
      'form',
      {
        className: 'card public-form',
        novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          if (opts.preview || !opts.onSubmit) return;
          formError.textContent = '';
          const errors = validate();
          setErrors(errors);
          if (Object.keys(errors).length) return;
          submitBtn.disabled = true;
          try {
            await opts.onSubmit(getAnswers());
          } catch (err) {
            if (err.details && err.details.errors) setErrors(err.details.errors);
            formError.textContent = err.message;
            submitBtn.disabled = false;
          }
        },
      },
      h('h1', null, form.title || 'Без названия'),
      form.description ? h('p', { className: 'form-desc' }, form.description) : null,
      body,
      formError,
      h('div', { className: 'form-actions' }, submitBtn),
      opts.preview ? h('p', { className: 'muted small' }, 'Это предпросмотр: отправка отключена.') : null
    );

    return { el, getAnswers, validate, setErrors };
  }

  global.FormRenderer = { renderForm };
})(window);
