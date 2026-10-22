'use strict';

(function () {
  const { h, api } = window.UI;
  const app = document.getElementById('app');
  const slug = decodeURIComponent(location.pathname.split('/')[2] || '');

  function show(...nodes) {
    app.replaceChildren(...nodes);
  }

  function unavailable() {
    document.title = 'Форма недоступна';
    show(
      h(
        'div',
        { className: 'card center' },
        h('h1', null, 'Форма недоступна'),
        h('p', null, 'Ссылка неверна, или форма ещё не опубликована, или приём ответов закрыт.')
      )
    );
  }

  function thanks(title) {
    show(
      h(
        'div',
        { className: 'card center' },
        h('div', { className: 'check' }, '✓'),
        h('h1', null, 'Спасибо, ответ отправлен!'),
        h('p', { className: 'muted' }, `Ваши ответы на форму «${title}» получены.`),
        h('button', { type: 'button', className: 'btn', onclick: () => location.reload() }, 'Заполнить ещё раз')
      )
    );
  }

  async function init() {
    let form;
    try {
      form = await api('GET', `/api/public/forms/${encodeURIComponent(slug)}`);
    } catch (err) {
      if (err.status === 404) return unavailable();
      show(h('div', { className: 'card center' }, h('h1', null, 'Ошибка'), h('p', null, err.message)));
      return;
    }

    document.title = form.title;
    const rendered = window.FormRenderer.renderForm(form, {
      onSubmit: async (answers) => {
        await api('POST', `/api/public/forms/${encodeURIComponent(slug)}/responses`, { answers });
        thanks(form.title);
        window.scrollTo(0, 0);
      },
    });
    show(rendered.el);
  }

  init();
})();
