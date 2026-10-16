/* Shared schema and wizard engine. No HTML from administrators is evaluated. */
(function (root) {
    'use strict';
    const types = { text: 'Metin', textarea: 'Uzun metin', number: 'Sayı', quantity: 'Miktar ve birim', date: 'Tarih', select: 'Seçenekler', lookup: 'Kayıtlı listeden seçim', group: 'Tekrarlanan grup' };
    const clone = value => JSON.parse(JSON.stringify(value));
    const uid = () => 'f_' + crypto.randomUUID().replaceAll('-', '');
    const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
    const base = () => ({ title: 'Yeni form', description: '', fields: [
        { id: 'first_name', type: 'text', label: 'İsim', required: true },
        { id: 'last_name', type: 'text', label: 'Soyisim', required: true },
        { id: 'date', type: 'date', label: 'Tarih', required: true }
    ] });
    const field = type => ({ id: uid(), type, label: types[type], required: false,
        ...(type === 'select' ? { options: ['Seçenek 1', 'Seçenek 2'] } : {}),
        ...(type === 'quantity' ? { units: ['adet', 'kg', 'lt', 'mt'] } : {}),
        ...(type === 'lookup' ? { listId: '', kind: '' } : {}),
        ...(type === 'group' ? { fields: [{ id: uid(), type: 'text', label: 'Açıklama', required: true }] } : {}) });
    const visible = (f, values) => !f.condition || values[f.condition.field] === f.condition.equals;
    function checkDefinition(def, lists = []) {
        if (!def.title?.trim() || def.title.trim().length > 120) throw Error('Form adı 1–120 karakter olmalı.');
        const walk = (fields, depth = 0) => {
            if (!Array.isArray(fields) || !fields.length || fields.length > 50 || depth > 1) throw Error('Her grupta 1–50 alan olabilir. İç içe gruplar desteklenmiyor.');
            const seen = new Map();
            for (const f of fields) {
                if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(f.id) || seen.has(f.id) || !types[f.type] || !f.label?.trim() || f.label.length > 120 || typeof f.required !== 'boolean') throw Error('Alan başlığı, türü veya kimliği geçersiz.');
                if (f.condition) {
                    const prior = seen.get(f.condition.field);
                    if (prior?.type !== 'select' || !prior.options.includes(f.condition.equals)) throw Error(`${f.label}: Koşul önceki bir seçenek alanına bağlı olmalı.`);
                }
                seen.set(f.id, f);
                if (['select','quantity'].includes(f.type)) {
                    const opts = f.type === 'select' ? f.options : f.units;
                    if (!Array.isArray(opts) || !opts.length || opts.length > 100 || new Set(opts).size !== opts.length || opts.some(o => typeof o !== 'string' || !o.trim() || o.length > 120)) throw Error(`${f.label}: Benzersiz seçenek/birimler girin.`);
                }
                if (f.type === 'lookup' && !lists.some(l => l.id === f.listId && l.active)) throw Error(`${f.label}: Aktif bir liste seçin.`);
                if (f.type === 'group') walk(f.fields, depth + 1);
            }
        };
        walk(def.fields);
        for (const [id, type] of [['first_name','text'],['last_name','text'],['date','date']]) {
            if (!def.fields.some(f => f.id === id && f.type === type && f.required && !f.condition)) throw Error('İsim, soyisim ve tarih zorunlu olmalı.');
        }
        if (JSON.stringify(def).length > 60000) throw Error('Form çok büyük.');
        return def;
    }
    function clean(fields, values) {
        const result = {};
        for (const f of fields) {
            if (!visible(f, result)) continue;
            let v = values[f.id];
            if (v === undefined || v === null || v === '') continue;
            if (f.type === 'group') v = v.map(row => clean(f.fields, row));
            result[f.id] = v;
        }
        return result;
    }
    function validate(fields, values, items) {
        for (const f of fields) {
            if (!visible(f, values)) continue;
            const v = values[f.id], empty = v === undefined || v === null || v === '';
            if (empty) { if (f.required) return `${f.label} zorunlu.`; continue; }
            if (['text','textarea'].includes(f.type) && (typeof v !== 'string' || v.length > 4000 || (f.required && !v.trim()))) return `${f.label}: Geçerli bir metin girin.`;
            if (f.type === 'number' && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) return `${f.label}: Negatif olmayan bir sayı girin.`;
            if (f.type === 'quantity' && (typeof v.value !== 'number' || !Number.isFinite(v.value) || v.value < 0 || !f.units.includes(v.unit))) return `${f.label}: Miktar ve birim seçin.`;
            if (f.type === 'select' && !f.options.includes(v)) return `${f.label}: Bir seçenek seçin.`;
            if (f.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)) || new Date(v).toISOString().slice(0,10) !== v)) return `${f.label}: Geçerli bir tarih seçin.`;
            if (f.type === 'lookup' && !items.some(i => i.id === v.id && i.label === v.label && i.list_id === f.listId && i.active && (!f.kind || i.kind === f.kind))) return `${f.label}: Aktif bir kayıt seçin.`;
            if (f.type === 'group') {
                if (!Array.isArray(v) || v.length > 50 || (f.required && !v.length)) return `${f.label}: En az bir satır ekleyin (en fazla 50).`;
                for (const row of v) { const error = validate(f.fields, row, items); if (error) return error; }
            }
        }
        return '';
    }
    function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; }
    function button(text, action, cls = '') { const b = el('button', text, cls); b.type = 'button'; b.addEventListener('click', action); return b; }
    function labeled(label, input) { const l = el('label', undefined, 'mf-label'); l.append(el('span', label), input); return l; }
    function select(options, value) { const s = el('select'); for (const [v, text] of options) { const o = el('option', text); o.value = v; s.append(o); } if (value !== undefined) s.value = value; return s; }
    function summary(host, fields, values) {
        for (const f of fields) {
            if (!visible(f, values)) continue;
            const v = values[f.id];
            const box = el('div', undefined, 'mf-answer'); box.append(el('strong', f.label));
            if (f.type === 'group' && Array.isArray(v)) v.forEach((row, i) => { const group = el('div', undefined, 'mf-card'); group.append(el('h4', `Satır ${i+1}`)); summary(group, f.fields, row); box.append(group); });
            else box.append(el('p', v == null || v === '' ? '—' : f.type === 'lookup' ? v.label : f.type === 'quantity' ? `${v.value} ${v.unit}` : String(v)));
            host.append(box);
        }
    }
    function mountWizard(host, definition, items, { onSave, onExit, preview = false, datePicker } = {}) {
        host.replaceChildren();
        const def = clone(definition);
        let values = {}, index = 0, busy = false, submissionId = crypto.randomUUID();
        const seedDates = fields => { for (const f of fields) if (f.type === 'date') values[f.id] = today(); };
        seedDates(def.fields);
        if (!preview && localStorage.getItem('madenci_remember_personal_info') === 'true') {
            values.first_name = localStorage.getItem('madenci_saved_first_name') || '';
            values.last_name = localStorage.getItem('madenci_saved_last_name') || '';
        }
        const shell = el('div', undefined, 'mf mf-wizard'); host.append(shell);
        function controls(fields, target, parent) {
            const readers = [];
            for (const f of fields) {
                const box = el('div', undefined, 'mf-field'); parent.append(box);
                const title = f.label + (f.required ? ' *' : '');
                let read;
                if (f.type === 'group') {
                    box.append(el('h3', title));
                    let rows = target[f.id] || (f.required ? [{}] : []);
                    const rowsHost = el('div'); box.append(rowsHost);
                    let rowReaders = [];
                    const drawRows = () => {
                        rowsHost.replaceChildren(); rowReaders = [];
                        rows.forEach((row, i) => {
                            const card = el('div', undefined, 'mf-card'); card.append(el('h4', `Satır ${i+1}`)); rowsHost.append(card);
                            const r = controls(f.fields, row, card); rowReaders.push(r);
                            card.append(button('Satırı kaldır', () => { rowReaders.forEach(r => r()); rows.splice(i,1); drawRows(); }, 'mf-danger'));
                        });
                    };
                    drawRows();
                    box.append(button('＋ Satır ekle', () => { if (rows.length >= 50) return; rowReaders.forEach(r => r()); rows.push({}); drawRows(); }));
                    read = () => { rowReaders.forEach(r => r()); return rows.map(row => clean(f.fields, row)); };
                } else {
                    let input;
                    if (f.type === 'select' || f.type === 'lookup') {
                        const opts = f.type === 'select' ? f.options.map(o => [o,o]) : items.filter(i => i.list_id === f.listId && i.active && (!f.kind || i.kind === f.kind)).map(i => [i.id,i.label]);
                        input = select([['','Seçin'], ...opts], f.type === 'lookup' ? target[f.id]?.id || '' : target[f.id] || '');
                        if (!opts.length) box.append(el('p', 'Bu alan için aktif seçenek yok. Yönetici listeye kayıt eklemeli.', 'mf-error'));
                    } else {
                        input = el(f.type === 'textarea' ? 'textarea' : 'input');
                        if (f.type !== 'textarea') input.type = ['number','quantity'].includes(f.type) ? 'number' : f.type === 'date' ? 'date' : 'text';
                        input.value = (f.type === 'quantity' ? target[f.id]?.value : target[f.id]) ?? (f.type === 'date' ? today() : '');
                        if (['number','quantity'].includes(f.type)) { input.min = '0'; input.step = 'any'; }
                        if (['text','textarea'].includes(f.type)) input.maxLength = 4000;
                        if (f.id === 'first_name') input.autocomplete = 'given-name';
                        if (f.id === 'last_name') input.autocomplete = 'family-name';
                    }
                    input.setAttribute('aria-label', title); input.required = f.required;
                    box.append(labeled(title, input));
                    if (f.type === 'date' && datePicker) datePicker(input);
                    let units;
                    if (f.type === 'quantity') { units = select(f.units.map(u => [u,u]), target[f.id]?.unit || f.units[0]); box.append(labeled('Birim', units)); }
                    read = () => {
                        if (input.value === '') return undefined;
                        if (f.type === 'lookup') { const item = items.find(i => i.id === input.value && i.list_id === f.listId && i.active); return item ? { id: item.id, label: item.label } : undefined; }
                        if (f.type === 'quantity') return { value: Number(input.value), unit: units.value };
                        return f.type === 'number' ? Number(input.value) : input.value;
                    };
                }
                readers.push({ f, box, read });
            }
            const collect = () => {
                for (const {f, box, read} of readers) {
                    const active = visible(f, target); box.hidden = !active;
                    if (active) { const v = read(); if (v !== undefined) target[f.id] = v; else delete target[f.id]; }
                    else delete target[f.id];
                }
            };
            parent.addEventListener('change', collect); collect();
            return collect;
        }
        function render() {
            shell.replaceChildren();
            values = clean(def.fields, values);
            const fields = def.fields.filter(f => visible(f, values));
            index = Math.min(index, fields.length);
            shell.append(el('h2', def.title), el('p', def.description || ''), el('p', `${index+1} / ${fields.length+1} · ${preview ? 'Önizleme' : 'Rapor girişi'}`, 'mf-muted'));
            const content = el('div', undefined, 'mf-card'); shell.append(content);
            let collect = () => {};
            if (index < fields.length) collect = controls([fields[index]], values, content);
            else { content.append(el('h3', 'Kontrol et ve kaydet')); summary(content, def.fields, values); }
            if (!preview && fields[index]?.id === 'last_name') {
                const remember = el('input'); remember.type = 'checkbox';
                remember.checked = localStorage.getItem('madenci_remember_personal_info') === 'true';
                remember.onchange = () => {
                    localStorage.setItem('madenci_remember_personal_info', String(remember.checked));
                    if (!remember.checked) {
                        localStorage.removeItem('madenci_saved_first_name');
                        localStorage.removeItem('madenci_saved_last_name');
                    }
                };
                content.append(labeled('İsim ve soyisim bu cihazda hatırlansın', remember));
            }
            const error = el('p', '', 'mf-error'); error.setAttribute('role', 'alert'); shell.append(error);
            const nav = el('div', undefined, 'mf-toolbar'); shell.append(nav);
            nav.append(button(index ? 'Geri' : 'Form türlerine dön', () => { if (busy) return; collect(); if (index) { index--; render(); } else onExit?.(); }));
            const next = button(index < fields.length ? 'Devam et' : preview ? 'Önizlemeyi tamamla' : 'Kaydet', async () => {
                if (busy) return;
                collect();
                const issue = validate(index < fields.length ? [fields[index]] : def.fields, values, items);
                if (issue) { error.textContent = issue; content.querySelector('input:not(.hidden),select,textarea')?.focus(); return; }
                if (index < fields.length) { index++; render(); return; }
                if (preview) { error.textContent = 'Önizleme tamamlandı. Veritabanına kayıt gönderilmedi.'; return; }
                busy = true; next.disabled = true; next.textContent = 'Kaydediliyor…';
                nav.querySelectorAll('button').forEach(b => b.disabled = true);
                try { await onSave(clean(def.fields, values), submissionId); }
                catch (e) { error.textContent = e.message || 'Kayıt gönderilemedi. Tekrar deneyin.'; }
                finally { busy = false; next.textContent = 'Kaydet'; nav.querySelectorAll('button').forEach(b => b.disabled = false); }
            }, 'mf-primary'); nav.append(next);
            shell.onkeydown = event => {
                if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.isComposing && event.target.matches('input:not([type="date"])')) { event.preventDefault(); event.stopPropagation(); next.click(); }
            };
            content.querySelector('input:not(.hidden),select,textarea,button')?.focus({preventScroll:true});
        }
        render();
        return { getValues: () => clone(values) };
    }
    const api = { types, clone, uid, today, base, field, visible, checkDefinition, clean, validate, el, button, labeled, select, summary, mountWizard };
    root.MadenciForms = api;
    if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
