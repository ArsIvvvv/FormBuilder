'use strict';

(function () {
  const { h, api, toast, copyText, formatDate } = window.UI;
  const app = document.getElementById('app');

  const TYPE_LABELS = {
    text: 'Короткий текст',
    textarea: 'Длинный текст',
    number: 'Число',
    email: 'Email',
    radio: 'Выбор одного (radio)',
    checkbox: 'Выбор нескольких (checkbox)',
    select: 'Выпадающий список',
    date: 'Дата',
  };
  const CHOICE = ['radio', 'checkbox', 'select'];
  const DEFAULT_OPTIONS = 'Вариант 1\nВариант 2';

  const fullUrl = (path) => location.origin + path;

  // replaceChildren превращает массивы и null в текст, поэтому раскрываем вложенные массивы
  // и отбрасываем пустые значения сами
  function setView(...nodes) {
    app.replaceChildren(...nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false));
  }

  function showError(err) {
    setView(
      h(
        'div',
        { className: 'card center' },
        h('h2', null, 'Что-то пошло не так'),
        h('p', null, err.message),
        h('a', { className: 'btn', href: '#/' }, 'К списку форм')
      )
    );
  }

  function statusBadge(status) {
    return h(
      'span',
      { className: 'badge ' + (status === 'published' ? 'ok' : 'draft') },
      status === 'published' ? 'Опубликована' : 'Черновик'
    );
  }

  // ====================== Список форм ======================

  async function viewList() {
    setView(h('p', { className: 'muted' }, 'Загрузка…'));
    let forms;
    try {
      forms = await api('GET', '/api/forms');
    } catch (err) {
      return showError(err);
    }

    const header = h(
      'div',
      { className: 'page-head' },
      h('h1', null, 'Формы'),
      h('a', { className: 'btn primary', href: '#/new' }, '+ Создать форму')
    );

    if (forms.length === 0) {
      return setView(
        header,
        h(
          'div',
          { className: 'card center' },
          h('p', null, 'Пока нет ни одной формы. Создайте первую, чтобы начать собирать отклики.'),
          h('a', { className: 'btn primary', href: '#/new' }, 'Создать форму')
        )
      );
    }

    const rows = forms.map((f) => {
      const togglePublish = h(
        'button',
        {
          className: 'btn small',
          onclick: async () => {
            try {
              if (f.status === 'published') await api('POST', `/api/forms/${f.id}/unpublish`);
              else await api('POST', `/api/forms/${f.id}/publish`);
              toast(f.status === 'published' ? 'Форма снята с публикации' : 'Форма опубликована');
              viewList();
            } catch (err) {
              toast(err.message, true);
            }
          },
        },
        f.status === 'published' ? 'Снять с публикации' : 'Опубликовать'
      );

      return h(
        'tr',
        null,
        h(
          'td',
          { 'data-label': 'Название' },
          h('a', { className: 'title-link', href: `#/edit/${f.id}` }, f.title),
          f.status === 'published' && f.url
            ? h('div', { className: 'small' }, h('a', { href: f.url, target: '_blank', rel: 'noopener' }, fullUrl(f.url)))
            : null
        ),
        h('td', { 'data-label': 'Статус' }, statusBadge(f.status)),
        h('td', { 'data-label': 'Создана' }, formatDate(f.createdAt)),
        h('td', { 'data-label': 'Ответов' }, h('a', { href: `#/responses/${f.id}` }, String(f.responsesCount))),
        h(
          'td',
          { className: 'actions' },
          h('a', { className: 'btn small', href: `#/edit/${f.id}` }, 'Редактировать'),
          h('a', { className: 'btn small', href: `#/responses/${f.id}` }, 'Ответы'),
          togglePublish,
          f.status === 'published' && f.url
            ? h('button', { className: 'btn small', onclick: () => copyText(fullUrl(f.url)) }, 'Копировать ссылку')
            : null,
          h(
            'button',
            {
              className: 'btn small danger',
              onclick: async () => {
                if (!confirm(`Удалить форму «${f.title}» вместе со всеми ответами?`)) return;
                try {
                  await api('DELETE', `/api/forms/${f.id}`);
                  toast('Форма удалена');
                  viewList();
                } catch (err) {
                  toast(err.message, true);
                }
              },
            },
            'Удалить'
          )
        )
      );
    });

    setView(
      header,
      h(
        'div',
        { className: 'card table-card' },
        h(
          'table',
          { className: 'table responsive' },
          h('thead', null, h('tr', null, ['Название', 'Статус', 'Создана', 'Ответов', 'Действия'].map((t) => h('th', null, t)))),
          h('tbody', null, rows)
        )
      )
    );
  }

  // ====================== Конструктор ======================

  function newQuestionId() {
    return 'q' + Math.random().toString(36).slice(2, 10);
  }

  function toEditorQuestion(q) {
    return {
      id: q.id,
      type: q.type,
      label: q.label,
      hint: q.hint || '',
      required: Boolean(q.required),
      optionsText: (q.options || []).join('\n'),
    };
  }

  async function viewEditor(id) {
    const state = { id: null, title: '', description: '', status: 'draft', url: null, questions: [], showPreview: false };

    if (id) {
      setView(h('p', { className: 'muted' }, 'Загрузка…'));
      try {
        const f = await api('GET', `/api/forms/${id}`);
        Object.assign(state, {
          id: f.id,
          title: f.title,
          description: f.description,
          status: f.status,
          url: f.url,
          questions: f.questions.map(toEditorQuestion),
        });
      } catch (err) {
        return showError(err);
      }
    }

    const collect = () => ({
      title: state.title,
      description: state.description,
      questions: state.questions.map((q) => ({
        id: q.id,
        type: q.type,
        label: q.label,
        hint: q.hint,
        required: q.required,
        options: CHOICE.includes(q.type)
          ? q.optionsText.split('\n').map((s) => s.trim()).filter(Boolean)
          : [],
      })),
    });

    async function save() {
      const payload = collect();
      const saved = state.id ? await api('PUT', `/api/forms/${state.id}`, payload) : await api('POST', '/api/forms', payload);
      state.id = saved.id;
      state.status = saved.status;
      state.url = saved.url;
      state.questions = saved.questions.map(toEditorQuestion);
      history.replaceState(null, '', `#/edit/${saved.id}`);
      return saved;
    }

    const previewBox = h('div', { className: 'preview-box' });
    function refreshPreview() {
      if (!state.showPreview) {
        previewBox.replaceChildren();
        return;
      }
      const data = collect();
      previewBox.replaceChildren(
        h('h3', null, 'Предпросмотр'),
        window.FormRenderer.renderForm(data, { preview: true }).el
      );
    }

    function render() {
      const scrollY = window.scrollY;

      const questionCards = state.questions.map((q, i) => {
        const isChoice = CHOICE.includes(q.type);
        return h(
          'div',
          { className: 'card question' },
          h(
            'div',
            { className: 'question-head' },
            h('strong', null, `Вопрос ${i + 1}`),
            h(
              'div',
              { className: 'row-gap' },
              h('button', { className: 'btn small', title: 'Выше', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
              h(
                'button',
                { className: 'btn small', title: 'Ниже', disabled: i === state.questions.length - 1, onclick: () => move(i, 1) },
                '↓'
              ),
              h('button', { className: 'btn small danger', title: 'Удалить вопрос', onclick: () => remove(i) }, 'Удалить')
            )
          ),
          h(
            'div',
            { className: 'grid-2' },
            h(
              'label',
              { className: 'stack' },
              h('span', null, 'Тип поля'),
              h(
                'select',
                {
                  value: q.type,
                  onchange: (e) => {
                    q.type = e.target.value;
                    if (CHOICE.includes(q.type) && !q.optionsText.trim()) q.optionsText = DEFAULT_OPTIONS;
                    render();
                  },
                },
                Object.entries(TYPE_LABELS).map(([v, l]) => h('option', { value: v }, l))
              )
            ),
            h(
              'label',
              { className: 'inline-check' },
              h('input', {
                type: 'checkbox',
                checked: q.required,
                onchange: (e) => {
                  q.required = e.target.checked;
                  refreshPreview();
                },
              }),
              h('span', null, 'Обязательное поле')
            )
          ),
          h(
            'label',
            { className: 'stack' },
            h('span', null, 'Текст вопроса'),
            h('input', {
              type: 'text',
              value: q.label,
              maxlength: 500,
              placeholder: 'Например: Как вас зовут?',
              oninput: (e) => {
                q.label = e.target.value;
                refreshPreview();
              },
            })
          ),
          h(
            'label',
            { className: 'stack' },
            h('span', null, 'Подсказка (необязательно)'),
            h('input', {
              type: 'text',
              value: q.hint,
              maxlength: 500,
              oninput: (e) => {
                q.hint = e.target.value;
                refreshPreview();
              },
            })
          ),
          isChoice
            ? h(
                'label',
                { className: 'stack' },
                h('span', null, 'Варианты ответа (каждый с новой строки)'),
                h('textarea', {
                  rows: 4,
                  value: q.optionsText,
                  oninput: (e) => {
                    q.optionsText = e.target.value;
                    refreshPreview();
                  },
                })
              )
            : null
        );
      });

      const typeSelect = h(
        'select',
        { id: 'new-type' },
        Object.entries(TYPE_LABELS).map(([v, l]) => h('option', { value: v }, l))
      );

      const linkPanel =
        state.status === 'published' && state.url
          ? h(
              'div',
              { className: 'card link-panel' },
              h('strong', null, 'Форма опубликована. Ссылка для студентов:'),
              h(
                'div',
                { className: 'link-row' },
                h('input', { type: 'text', readonly: true, value: fullUrl(state.url), onfocus: (e) => e.target.select() }),
                h('button', { className: 'btn', onclick: () => copyText(fullUrl(state.url)) }, 'Копировать'),
                h('a', { className: 'btn', href: state.url, target: '_blank', rel: 'noopener' }, 'Открыть')
              )
            )
          : null;

      setView(
        h(
          'div',
          { className: 'page-head' },
          h('h1', null, state.id ? 'Редактирование формы' : 'Новая форма'),
          h('div', { className: 'row-gap' }, state.id ? statusBadge(state.status) : null)
        ),
        linkPanel,
        h(
          'div',
          { className: 'card' },
          h(
            'label',
            { className: 'stack' },
            h('span', null, 'Название формы *'),
            h('input', {
              type: 'text',
              value: state.title,
              maxlength: 200,
              placeholder: 'Например: Отклик на стажировку',
              oninput: (e) => {
                state.title = e.target.value;
                refreshPreview();
              },
            })
          ),
          h(
            'label',
            { className: 'stack' },
            h('span', null, 'Описание'),
            h('textarea', {
              rows: 3,
              value: state.description,
              maxlength: 2000,
              oninput: (e) => {
                state.description = e.target.value;
                refreshPreview();
              },
            })
          )
        ),
        questionCards.length ? questionCards : h('div', { className: 'card center muted' }, 'Вопросов пока нет. Добавьте первый ниже.'),
        h(
          'div',
          { className: 'card add-row' },
          h('span', null, 'Добавить вопрос:'),
          typeSelect,
          h(
            'button',
            {
              className: 'btn',
              onclick: () => {
                const type = typeSelect.value;
                state.questions.push({
                  id: newQuestionId(),
                  type,
                  label: '',
                  hint: '',
                  required: false,
                  optionsText: CHOICE.includes(type) ? DEFAULT_OPTIONS : '',
                });
                render();
                window.scrollTo(0, document.body.scrollHeight);
              },
            },
            '+ Добавить'
          )
        ),
        h(
          'div',
          { className: 'toolbar' },
          h(
            'button',
            {
              className: 'btn primary',
              onclick: async () => {
                try {
                  await save();
                  toast('Форма сохранена');
                  render();
                } catch (err) {
                  toast(err.message, true);
                }
              },
            },
            'Сохранить'
          ),
          state.status === 'published'
            ? h(
                'button',
                {
                  className: 'btn',
                  onclick: async () => {
                    try {
                      await save();
                      const f = await api('POST', `/api/forms/${state.id}/unpublish`);
                      state.status = f.status;
                      toast('Форма снята с публикации');
                      render();
                    } catch (err) {
                      toast(err.message, true);
                    }
                  },
                },
                'Снять с публикации'
              )
            : h(
                'button',
                {
                  className: 'btn success',
                  onclick: async () => {
                    try {
                      await save();
                      const f = await api('POST', `/api/forms/${state.id}/publish`);
                      state.status = f.status;
                      state.url = f.url;
                      toast('Форма опубликована');
                      render();
                      window.scrollTo(0, 0);
                    } catch (err) {
                      toast(err.message, true);
                    }
                  },
                },
                'Сохранить и опубликовать'
              ),
          h(
            'button',
            {
              className: 'btn',
              onclick: () => {
                state.showPreview = !state.showPreview;
                render();
              },
            },
            state.showPreview ? 'Скрыть предпросмотр' : 'Предпросмотр'
          ),
          state.id ? h('a', { className: 'btn', href: `#/responses/${state.id}` }, 'Ответы') : null,
          h('a', { className: 'btn', href: '#/' }, 'К списку')
        ),
        previewBox
      );

      refreshPreview();
      window.scrollTo(0, scrollY);
    }

    function move(i, delta) {
      const j = i + delta;
      if (j < 0 || j >= state.questions.length) return;
      [state.questions[i], state.questions[j]] = [state.questions[j], state.questions[i]];
      render();
    }

    function remove(i) {
      state.questions.splice(i, 1);
      render();
    }

    render();
  }

  // ====================== Ответы ======================

  async function viewResponses(id) {
    setView(h('p', { className: 'muted' }, 'Загрузка…'));
    let data;
    try {
      data = await api('GET', `/api/forms/${id}/responses`);
    } catch (err) {
      return showError(err);
    }

    const cell = (v) => (v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(v));

    const head = h(
      'div',
      { className: 'page-head' },
      h(
        'div',
        null,
        h('h1', null, data.form.title),
        h('p', { className: 'muted' }, `Ответов: ${data.total} · `, statusBadge(data.form.status))
      ),
      h(
        'div',
        { className: 'row-gap' },
        h('a', { className: 'btn', href: `#/edit/${data.form.id}` }, 'Редактировать форму'),
        h('a', { className: 'btn primary', href: `/api/forms/${data.form.id}/responses.csv`, download: 'responses.csv' }, 'Экспорт в CSV'),
        h('a', { className: 'btn', href: '#/' }, 'К списку')
      )
    );

    if (data.total === 0) {
      return setView(
        head,
        h(
          'div',
          { className: 'card center' },
          h('p', null, 'Ответов пока нет.'),
          data.form.url
            ? h('p', { className: 'muted' }, 'Ссылка для студентов: ', h('a', { href: data.form.url, target: '_blank', rel: 'noopener' }, fullUrl(data.form.url)))
            : h('p', { className: 'muted' }, 'Форма ещё не опубликована.')
        )
      );
    }

    setView(
      head,
      h(
        'div',
        { className: 'card table-card scroll-x' },
        h(
          'table',
          { className: 'table' },
          h(
            'thead',
            null,
            h('tr', null, h('th', null, '#'), h('th', null, 'Дата и время'), data.columns.map((c) => h('th', null, c.label)))
          ),
          h(
            'tbody',
            null,
            data.rows.map((r, i) =>
              h(
                'tr',
                null,
                h('td', null, String(data.total - i)),
                h('td', { className: 'nowrap' }, formatDate(r.submittedAt)),
                data.columns.map((c) => h('td', { className: 'answer' }, cell(r.values[c.id])))
              )
            )
          )
        )
      )
    );
  }

  // ====================== Роутинг ======================

  function route() {
    const parts = location.hash.replace(/^#/, '').split('/').filter(Boolean);
    window.scrollTo(0, 0);
    if (parts[0] === 'new') return viewEditor(null);
    if (parts[0] === 'edit' && parts[1]) return viewEditor(decodeURIComponent(parts[1]));
    if (parts[0] === 'responses' && parts[1]) return viewResponses(decodeURIComponent(parts[1]));
    return viewList();
  }

  window.addEventListener('hashchange', route);
  route();
})();
