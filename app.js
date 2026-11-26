/* EscalaMed v3 — app único para MASTER e médicos (pt-BR).
   Modo demonstração: sem config do Supabase → dados reais de set/out/nov/2026 carregados de demo_data.js,
   alterações ficam no navegador (localStorage). Modo real: Supabase (Auth com e-mail e senha + RLS + funções do schema.sql). */
(function () {
'use strict';
const cfg = window.ESCALAMED_CONFIG || {};
const REAL = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
const TZ = 'America/Sao_Paulo';
// Na demonstração as trocas são liberadas como se hoje fosse 01/09/2026 (os dados reais são de setembro).
const DEMO_TODAY = Date.parse('2026-09-01T00:00:00-03:00');
const nowMs = () => REAL ? Date.now() : DEMO_TODAY;
const LS_KEY = 'escalamed_demo_v11'; // v11: não está vindo, SEM LOTE, informação incorreta (v4.2). Antes: v10 // v10: contratos por área + alerta “sem contrato” (v4.1). Antes: v9 // v9: picker por setor, nomes colados, PDF retrato, conflitos na grade (não migra v8)

// ───────── utilidades ─────────
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rid = (p = 'id') => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const fD = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const fDs = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
const fH = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fW = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'short' });
const fK = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fM = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const ms = t => typeof t === 'number' ? t : Date.parse(t);
const validMs = t => { const n = ms(t); return Number.isFinite(n) ? n : null; };
const fmtD = t => { const n = validMs(t); return n != null ? fD.format(n) : '—'; };
const fmtDs = t => { const n = validMs(t); return n != null ? fDs.format(n) : '—'; };
const fmtH = t => { const n = validMs(t); return n != null ? fH.format(n) : '—'; };
const fmtDH = t => { const n = validMs(t); return n != null ? fmtD(n) + ' ' + fmtH(n) : '—'; };
const wday = t => { const n = validMs(t); return n != null ? fW.format(n).replace('.', '') : ''; };
const dayKey = t => { const n = validMs(t); return n != null ? fK.format(n) : ''; };
const monthOf = t => {
  const k = dayKey(t);
  if (k) return k.slice(0, 7);
  const s = String(t || '');
  return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : '';
};
const fmtMonth = ym => {
  const m = String(ym || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m)) return '—';
  const d = new Date(m + '-15T12:00:00Z');
  if (!Number.isFinite(d.getTime())) return '—';
  const s = fM.format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const localToIso = s => s && s.length === 16 ? s + ':00-03:00' : s;
const initials = n => String(n || '?').split(' ').filter(w => w.length > 2 || /^[A-Z]/.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const normTxt = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const normMatricula = s => String(s || '').replace(/[^0-9]/g, '').replace(/^0+/, '');
const clone = x => JSON.parse(JSON.stringify(x));
const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);
const overlap = (a, b) => ms(a.starts_at) < ms(b.ends_at) && ms(b.starts_at) < ms(a.ends_at);

// ───────── estado ─────────
const S = {
  data: null, me: null, page: null, sb: null, user: null,
  f: { month: null, sector: '', doctor: '', version: 'vigente', view: 'tabela', onlyChanged: false, origem: '' },
  pg: {}, ponto: { f: { empresa: '', setor: '', medico: '', status: '', soEventos: false, todosMeses: false }, cache: null, showExtras: false },
  tabs: {}, login: { step: 1, matricula: '', found: null, mode: 'medico' },
  esc: { month: null, sectorId: '', view: 'home', file: null, preview: null, mapSheet: null, pick: null, conf: null, searchQ: '', todas: false }
};
let IDX = {};
function reindex() {
  const d = S.data;
  IDX = {
    doc: new Map(d.doctors.map(x => [x.id, x])), sec: new Map(d.sectors.map(x => [x.id, x])),
    sched: new Map(d.schedules.map(x => [x.id, x])), shift: new Map(d.shifts.map(x => [x.id, x])),
    swap: new Map(d.swaps.map(x => [x.id, x])),
    account: new Map((d.accounts || []).filter(a => a.doctor_id).map(a => [a.doctor_id, a])),
    ctr: new Map((d.contracts || []).map(x => [x.id, x])),
    ctrByDoc: (d.contractDoctors || []).reduce((m, x) => ((m[x.doctor_id] = m[x.doctor_id] || []).push(x), m), {}),
    hist: d.history.reduce((m, h) => ((m[h.shift_id] = m[h.shift_id] || []).push(h), m), {})
  };
  const byM = new Map();
  d.shifts.forEach(s => {
    if (!s._day) { s._day = dayKey(s.starts_at); s._month = s._day.slice(0, 7); }
    s.sector_id = s.sector_id || IDX.sched.get(s.schedule_id)?.sector_id;
    const m = s._month;
    if (!byM.has(m)) byM.set(m, []);
    byM.get(m).push(s);
  });
  IDX.shiftsByMonth = byM;
  S.ponto.cache = null;
}
const doc = id => IDX.doc.get(id);
const docName = id => doc(id)?.name || '—';
function shiftName(s, id) {
  const i = id === undefined ? s?.doctor_id : id;
  if (i) return docName(i);
  return (s && s.source_text) || '—';
}
function shiftLabelHtml(s, id) {
  const i = id === undefined ? s?.doctor_id : id;
  if (i) return docLabel(i);
  return esc((s && s.source_text) || '—') + ' ' + tag('fora do cadastro', 'red');
}
const secName = id => IDX.sec.get(id)?.name || '—';
const shiftById = id => IDX.shift.get(id);
const hasAccount = id => IDX.account.has(id);
const pubShift = s => (IDX.sched.get(s.schedule_id)?.status || 'published') === 'published';
const isMaster = () => S.me?.kind === 'master';
const isEscalista = () => S.me?.kind === 'escalista' || S.me?.kind === 'master';
const myDoc = () => S.me?.doctor_id ? doc(S.me.doctor_id) : null;
const inSector = (docId, secId) => !!doc(docId)?.sector_ids?.includes(secId);
const months = () => {
  const set = new Set((S.data?.schedules || []).map(s => s.month_ref));
  if (!REAL) ['2026-09', '2026-10', '2026-11', '2026-12'].forEach(m => set.add(m));
  (S.data?.eventosAdversos || []).forEach(e => { const ym = String(e.data_evento || '').slice(0, 7); if (ym.length === 7) set.add(ym); });
  const cur = monthOf(nowMs());
  set.add(cur);
  const [y, mo] = cur.split('-').map(Number);
  const nxt = mo === 12 ? (y + 1) + '-01' : y + '-' + String(mo + 1).padStart(2, '0');
  set.add(nxt);
  return [...set].sort();
};
const changed = s => s.original_doctor_id && s.original_doctor_id !== s.doctor_id;
const docLabel = (id, opts = {}) => { const d = doc(id); if (!d) return '—'; return esc(d.name) + (opts.mat && d.matricula ? ` <span class="muted">· ${esc(d.matricula)}</span>` : ''); };
const TYPE_ICON = { 'Plantão': '●', 'Sobreaviso': '◌', 'Visita': '◇' };

// ───────── dados da demonstração ─────────
function seedToData() {
  const S0 = window.ESCALAMED_SEED;
  if (!S0) throw new Error('demo_data.js não carregado');
  const fix = o => ({ ...o, starts_at: localToIso(o.starts_at), ends_at: localToIso(o.ends_at) });
  const doctors = S0.doctors.map(d => ({ ...d, sector_ids: [...(d.sector_ids || [])] }));
  const byMat = Object.fromEntries(doctors.map(d => [d.matricula, d]));
  const shifts = S0.shifts.map(s => ({ ...fix(s), original_doctor_id: s.doctor_id, changed_at: null }));
  const t0 = Date.parse('2026-08-28T10:00:00-03:00');
  const iso = (dt) => new Date(dt).toISOString();
  const acc = (key, mat, email) => ({ user_id: 'u-' + key, email, role: 'doctor', doctor_id: byMat[mat].id, bound_at: iso(t0), bound_via: 'Primeiro acesso aprovado (exemplo da demo)' });
  const accounts = [
    { user_id: 'u-master', email: 'coordenacao.demo@exemplo.com', role: 'master', doctor_id: null },
    Object.assign(acc('bruna', '105895', 'bruna.demo@exemplo.com'), { role: 'escalista' }), acc('gabriela', '94', 'gabriela.demo@exemplo.com'), acc('mgraca', '169', 'mgraca.demo@exemplo.com')
  ];
  accounts.slice(1).forEach(a => { const d = doctors.find(x => x.id === a.doctor_id); d.email = a.email; });
  const req = (mat, email, h) => { const d = byMat[mat]; return { id: rid('req'), tipo: 'primeiro_acesso', user_id: 'u-ex-' + mat, email, name: d.name, matricula: mat, empresa: d.empresa, crm: null, specialty: null, phone: null, sector_ids: [...d.sector_ids], status: 'pending', suggested_doctor_id: d.id, doctor_id: null, decision_note: null, created_at: iso(t0 + h * 3600e3), exemplo: true }; };
  const requests = [req('100595', 'albertina.demo@exemplo.com', 20), req('106095', 'luis.demo@exemplo.com', 26)];
  return {
    fonte: S0.fonte, dadosAte: S0.dadosAte, geradoEm: S0.geradoEm,
    units: S0.units, sectors: S0.sectors, escalas: (S0.escalas || []).map(e => ({ ...e })), doctors, schedules: S0.schedules.map(s => ({ ...s })), shifts,
    punches: S0.punches.map(p => ({ doctorId: p.doctor_id, ts: localToIso(p.ts) })),
    whatsapp: S0.whatsapp.map(w => ({ ...fix(w), status: w.sai_doctor_id && w.entra_doctor_id ? w.status : 'a_revisar' })),
    naoResolvidos: S0.naoResolvidos || [],
    contracts: (S0.contracts || []).map(c => ({ ...c })), contractDoctors: (S0.contract_doctors || []).map(x => ({ ...x, lotes: x.lotes.map(l => ({ ...l })) })),
    fonteContratos: S0.fonteContratos || null,
    ctrAreas: (S0.ctr_areas || []).map(a => ({ ...a, sector_ids: [...(a.sector_ids || [])] })), ctrLinks: (S0.ctr_links || []).map(l => ({ ...l })), ctrModelo: S0.ctr_modelo || null,
    swaps: [], requests, invites: [], history: [], audit: [], accounts,
    notifications: requests.map(r => ({ id: rid('n'), user_id: 'u-master', title: 'Primeiro acesso aguardando aprovação', message: `${r.name} (matrícula ${r.matricula}) criou o acesso com o e-mail ${r.email}.`, read_at: null, created_at: r.created_at })),
    settings: { approval_required: false, first_access_approval: false, diretor_tecnico: ((S0.settings || {}).diretor_tecnico) || 'Dra. Barbara Castro', coordenadores: {} },
    lookups: [], eventosAdversos: evSeedDemo()
  };
}
function demoSave() {
  const d = S.data;
  const patch = {};
  d.shifts.forEach(s => { if (s.doctor_id !== s.original_doctor_id || s.status !== s._status0 || s.changed_at || s.match_conf !== s._match0) patch[s.id] = { doctor_id: s.doctor_id, changed_at: s.changed_at, status: s.status, match_conf: s.match_conf }; });
  const seedIds = new Set((window.ESCALAMED_SEED?.shifts || []).map(s => s.id));
  const present = new Set(d.shifts.map(s => s.id));
  const removedShifts = [...seedIds].filter(id => !present.has(id));
  const extraShifts = d.shifts.filter(s => !seedIds.has(s.id));
  const ctr = d._ctrDirty ? { contracts: d.contracts, ctrLinks: d.ctrLinks, ctrAreas: d.ctrAreas, fonteContratos: d.fonteContratos } : null;
  const keep = { v: 10, ctr, patch, doctors: d.doctors, swaps: d.swaps, requests: d.requests, invites: d.invites, history: d.history, audit: d.audit.slice(0, 1000),
    accounts: d.accounts, notifications: d.notifications.slice(0, 500), settings: d.settings, whatsapp: d.whatsapp, users: d.users || [], resets: (d.resets || []).filter(r => r.exp > Date.now()),
    schedules: d.schedules, escalas: d.escalas || [], extraShifts, removedShifts, aliasesNomes: d.aliasesNomes || {}, layoutMaps: d.layoutMaps || {}, importNotes: d.importNotes || [], extraTurnos: d.extraTurnos || {}, removedTurnos: d.removedTurnos || {}, horarioEdits: d.horarioEdits || {}, eventosAdversos: d.eventosAdversos || [] };
  try { if (S.me?.user_id) sessionStorage.setItem(LS_KEY + '_sessao', S.me.user_id); else sessionStorage.removeItem(LS_KEY + '_sessao'); } catch (e) { /* sem sessionStorage */ }
  try { localStorage.setItem(LS_KEY, JSON.stringify(keep)); } catch (e) { console.warn('Não foi possível salvar a demonstração:', e.message); }
}
function demoLoad() {
  S.data = seedToData();
  S.data.shifts.forEach(s => { s._status0 = s.status; s._match0 = s.match_conf; });
  S.data.aliasesNomes = S.data.aliasesNomes || {};
  S.data.layoutMaps = S.data.layoutMaps || {};
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { saved = null; }
  if (saved && saved.v === 10) {
    if (saved.ctr) { Object.assign(S.data, saved.ctr); S.data._ctrDirty = true; }
    const by = new Map(S.data.shifts.map(s => [s.id, s]));
    Object.entries(saved.patch || {}).forEach(([id, p]) => { const s = by.get(id); if (s) Object.assign(s, p); });
    ['doctors', 'swaps', 'requests', 'invites', 'history', 'audit', 'accounts', 'notifications', 'settings', 'whatsapp', 'users', 'resets', 'eventosAdversos'].forEach(k => { if (saved[k]) S.data[k] = saved[k]; });
    if (saved.schedules) S.data.schedules = saved.schedules;
    if (saved.removedShifts && saved.removedShifts.length) {
      const rm = new Set(saved.removedShifts);
      S.data.shifts = S.data.shifts.filter(s => !rm.has(s.id));
    }
    if (saved.extraShifts && saved.extraShifts.length) {
      const ids = new Set(S.data.shifts.map(s => s.id));
      saved.extraShifts.forEach(s => { if (!ids.has(s.id)) S.data.shifts.push(s); });
    }
    if (saved.aliasesNomes) S.data.aliasesNomes = saved.aliasesNomes;
    if (saved.layoutMaps) S.data.layoutMaps = saved.layoutMaps;
    ['importNotes', 'extraTurnos', 'removedTurnos', 'horarioEdits'].forEach(k => { if (saved[k]) S.data[k] = saved[k]; });
  }
  const brunaDoc = (S.data.doctors || []).find(d => d.matricula === '105895');
  const brunaAcc = (S.data.accounts || []).find(a => a.user_id === 'u-bruna' || (brunaDoc && a.doctor_id === brunaDoc.id));
  if (brunaAcc) brunaAcc.role = 'escalista';
  evEnsureDemo();
  reindex();
  try { return sessionStorage.getItem(LS_KEY + '_sessao'); } catch (e) { return null; }
}
function demoReset() { localStorage.removeItem(LS_KEY); location.hash = ''; location.reload(); }
function audit(operation, description, details) {
  if (REAL) return;
  S.data.audit.unshift({ id: rid('a'), actor: S.me?.kind === 'master' ? 'MASTER' : (myDoc()?.name || S.me?.email || 'Sistema'), operation, description, details: details || null, created_at: new Date().toISOString() });
}
function notifyUser(userId, title, message) { if (!REAL && userId) S.data.notifications.unshift({ id: rid('n'), user_id: userId, title, message, read_at: null, created_at: new Date().toISOString() }); }
function notifyDoctor(docId, title, message) { const a = IDX.account.get(docId); if (a) notifyUser(a.user_id, title, message); }
function notifyMasters(title, message) { (S.data.accounts || []).filter(a => a.role === 'master').forEach(a => notifyUser(a.user_id, title, message)); }

// ───────── UI básica ─────────
let toastT;
function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' error' : ''); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 5000); }
function modal(title, body, opts = {}) {
  $('#modalRoot').innerHTML = `<div class="overlay" data-close="1"><div class="modal ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><div><h2>${esc(title)}</h2>${opts.sub ? `<p>${esc(opts.sub)}</p>` : ''}</div><button class="icon-btn" data-act="closeModal" aria-label="Fechar">✕</button></div><div class="modal-body">${body}</div></div></div>`;
  const first = $('#modalRoot input:not([type=hidden]),#modalRoot select,#modalRoot textarea'); if (first && !opts.noFocus) first.focus();
}
function closeModal() { $('#modalRoot').innerHTML = ''; }
const tag = (txt, color = 'gray', title = '') => `<span class="tag ${color}" ${title ? `title="${esc(title)}"` : ''}>${esc(txt)}</span>`;
const SWAP_ST = { pending: ['Aguarda o colega', 'orange'], needs_master: ['Aguarda MASTER', 'orange'], completed: ['Concluída', 'green'], rejected: ['Recusada', 'red'], cancelled: ['Cancelada', 'gray'], conflict: ['Conflito', 'red'] };
const swapTag = st => tag(...(SWAP_ST[st] || [st, 'gray']));
const CONF = { alta: ['nome conferido', 'green'], manual: ['conferido manualmente', 'green'], media: ['nome provável', 'orange'], baixa: ['nome incerto', 'red'], responsavel: ['responsável pelo setor', 'orange'], contexto: ['pelo contexto', 'orange'], nenhum: ['não identificado', 'red'], fora_cadastro: ['fora do cadastro', 'red'], copia: ['copiado do mês passado', 'gray'] };
function pager(key, total, size = 50) {
  const pages = Math.max(1, Math.ceil(total / size)); let p = Math.min(S.pg[key] || 1, pages); S.pg[key] = p;
  return { from: (p - 1) * size, to: p * size, html: total > size ? `<div class="pager"><button class="btn small" data-act="page" data-key="${key}" data-p="${p - 1}" ${p <= 1 ? 'disabled' : ''}>‹ Anterior</button><span>Página ${p} de ${pages} · ${total.toLocaleString('pt-BR')} linhas</span><button class="btn small" data-act="page" data-key="${key}" data-p="${p + 1}" ${p >= pages ? 'disabled' : ''}>Próxima ›</button></div>` : `<div class="pager"><span>${total.toLocaleString('pt-BR')} linha(s)</span></div>` };
}
function header(title, desc, actions = '') {
  const eye = isMaster() && !REAL ? 'PAINEL MASTER' : isEscalista() ? 'QUEM MONTA A ESCALA' : 'ÁREA DO MÉDICO';
  return `<div class="page-head"><div><div class="eyebrow">${eye}</div><h1>${esc(title)}</h1>${desc ? `<p class="desc">${desc}</p>` : ''}</div>${actions ? `<div class="head-actions">${actions}</div>` : ''}</div>`;
}
const opt = (v, label, sel) => `<option value="${esc(v)}" ${String(sel) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
function monthSelect(name = 'month', val = S.f.month) { return `<select data-f="${name}" aria-label="Mês">${months().map(m => opt(m, fmtMonth(m), val)).join('')}</select>`; }
function sectorSelect(val = S.f.sector, all = true, list = S.data.sectors, name = 'sector') { return `<select data-f="${name}" aria-label="Setor">${all ? opt('', 'Todos os setores', val) : ''}${list.slice().sort((a, b) => a.name.localeCompare(b.name)).map(s => opt(s.id, s.name, val)).join('')}</select>`; }
function sheetExport(sheets, base) {
  // sheets: [{name, rows:[{...}]}] → XLSX (SheetJS) ou CSV por aba
  const csv = rows => { const k = Object.keys(rows[0] || { vazio: '' }); return '\uFEFF' + [k.join(';'), ...rows.map(r => k.map(x => '"' + String(r[x] ?? '').replace(/"/g, '""') + '"').join(';'))].join('\r\n'); };
  const dl = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); };
  const X = window.XLSX;
  if (X) { const wb = X.utils.book_new(); sheets.forEach(s => X.utils.book_append_sheet(wb, X.utils.json_to_sheet(s.rows.length ? s.rows : [{ '(vazio)': '' }]), s.name.slice(0, 31))); X.writeFile(wb, base + '.xlsx'); return 'xlsx'; }
  sheets.forEach(s => dl(new Blob([csv(s.rows)], { type: 'text/csv;charset=utf-8' }), `${base}_${normTxt(s.name).replace(/[^a-z0-9]+/g, '_')}.csv`));
  return 'csv';
}
// ───────── carregamento de planilha (SheetJS) para exportações ─────────
function ensureXlsx() {
  if (window.XLSX) return Promise.resolve(true);
  return new Promise(res => {
    const sc = document.createElement('script'); sc.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    const t = setTimeout(() => res(false), 4000);
    sc.onload = () => { clearTimeout(t); res(!!window.XLSX); }; sc.onerror = () => { clearTimeout(t); res(false); };
    document.head.appendChild(sc);
  });
}
async function exportSheets(sheets, base) { await ensureXlsx(); const f = sheetExport(sheets, base); toast(f === 'xlsx' ? 'Planilha gerada.' : 'Sem acesso ao gerador de XLSX: exportado em CSV (um arquivo por aba).'); }

// ───────── modo real (Supabase) ─────────
async function sbClient() {
  if (S.sb) return S.sb;
  const mod = await import('https://esm.sh/@supabase/supabase-js@2');
  S.sb = mod.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, detectSessionInUrl: true } });
  return S.sb;
}
async function rpc(fn, args) { const { data, error } = await S.sb.rpc(fn, args || {}); if (error) throw new Error(error.message); return data; }
async function fetchAll(table, build) {
  let out = [], from = 0; const step = 1000;
  for (;;) { let q = S.sb.from(table).select('*'); if (build) q = build(q); const { data, error } = await q.range(from, from + step - 1); if (error) throw new Error(error.message); out = out.concat(data || []); if (!data || data.length < step) break; from += step; }
  return out;
}
async function realLoad() {
  const sb = S.sb, master = isMaster(), staff = isEscalista();
  const [units, sectors, doctors, ds, schedules, swaps, notifications, settings] = await Promise.all([
    fetchAll('units'), fetchAll('sectors'), fetchAll('doctors'), fetchAll('doctor_sectors'), fetchAll('schedules'),
    fetchAll('swaps', q => q.order('created_at', { ascending: false })), fetchAll('notifications', q => q.order('created_at', { ascending: false }).limit(200)),
    sb.from('app_settings').select('*').eq('id', 1).maybeSingle().then(r => r.data || {})]);
  const secs = ds.reduce((m, x) => ((m[x.doctor_id] = m[x.doctor_id] || []).push(x.sector_id), m), {});
  doctors.forEach(d => (d.sector_ids = secs[d.id] || []));
  const extra = master ? await Promise.all([fetchAll('profiles'), fetchAll('registration_requests', q => q.order('created_at', { ascending: false })), fetchAll('invites', q => q.order('created_at', { ascending: false })),
    fetchAll('whatsapp_swaps', q => q.order('starts_at')), fetchAll('audit_log', q => q.order('created_at', { ascending: false }).limit(1000)), fetchAll('shift_assignments', q => q.order('changed_at')), fetchAll('eventos_adversos', q => q.order('data_evento'))]) : [[], [], [], [], [], [], []];
  const [profiles, requests, invites, whatsapp, auditLog, history, eventosAdversos] = extra;
  // contratos: RLS deixa MASTER e escalista lerem (contracts, contract_doctors, contract_doctor_sectors + v4.1)
  const [contracts, cds, cdss] = staff ? await Promise.all([fetchAll('contracts'), fetchAll('contract_doctors'), fetchAll('contract_doctor_sectors')]) : [[], [], []];
  const lotes = cdss.reduce((m, x) => ((m[x.contract_id + '|' + x.doctor_id] = m[x.contract_id + '|' + x.doctor_id] || []).push({ lote: x.lote, sector_id: x.sector_id, coordenacao: x.coordenacao }), m), {});
  const contractDoctors = cds.map(x => ({ ...x, lotes: lotes[x.contract_id + '|' + x.doctor_id] || [] }));
  // v4.1: áreas do contrato → setores e vínculos médico × contrato × área (se a migração ainda não rodou, fica vazio)
  let ctrAreas = [], ctrLinks = [];
  if (staff) {
    try {
      const [ar, as_, li] = await Promise.all([fetchAll('contract_areas'), fetchAll('contract_area_sectors'), fetchAll('contract_links')]);
      const secs = as_.reduce((m, x) => ((m[x.area_id] = m[x.area_id] || []).push(x.sector_id), m), {});
      ctrAreas = ar.map(a => ({ ...a, sector_ids: secs[a.id] || [] })); ctrLinks = li;
    } catch (e) { console.warn('contratos v4.1 indisponíveis:', e.message); }
  }
  contracts.forEach(c => { if (c.carga_horaria !== undefined) c.carga = c.carga_horaria; });
  S.data = {
    units, sectors, doctors, schedules, shifts: S.data?.shifts || [], swaps, notifications, settings,
    accounts: profiles.map(p => ({ user_id: p.user_id, role: p.role, doctor_id: p.doctor_id, email: doctors.find(d => d.id === p.doctor_id)?.email, bound_at: p.created_at })),
    requests, invites, whatsapp, audit: auditLog, history: history.map(h => ({ ...h, from: h.from_doctor_id, to: h.to_doctor_id })),
    eventosAdversos: eventosAdversos || [],
    punches: [], fonte: {
      '2026-09': 'Escala completa de setembro/2026 (PDF FMSFI, OCR + conferência) e cartão ponto de médicos credenciados (Portal da Transparência).',
      '2026-10': 'Outubro/2026: escala completa (PDF FMSFI, OCR + apelidos e correções da Bruna).',
      '2026-11': 'Novembro/2026: escala completa (PDF FMSFI, OCR + apelidos e correções da Bruna), publicada.'
    }, dadosAte: {}, naoResolvidos: [], loadedMonths: S.data?.loadedMonths || {}, contracts, contractDoctors, ctrAreas, ctrLinks
  };
  if (!staff) { // médico: colegas com conta não são visíveis por RLS; candidatos vêm da função swap_candidates
    S.data.accounts = [{ user_id: S.me.user_id, role: 'doctor', doctor_id: S.me.doctor_id }];
  }
  S.data.aliasesNomes = S.data.aliasesNomes || {};
  S.data.layoutMaps = S.data.layoutMaps || {};
  S.data.horarioEdits = S.data.horarioEdits || {};
  if (staff && typeof escLoadHorariosReal === 'function') {
    await escLoadHorariosReal();
  }
  if (staff) {
    try {
      const als = await fetchAll('name_aliases');
      als.forEach(a => { S.data.aliasesNomes[a.sector_id ? a.alias_norm + '@' + a.sector_id : a.alias_norm] = a.doctor_id; });
    } catch (e) { /* tabela ainda não migrada */ }
  }
  S.data.loadedMonths = {};
  await ensureMonth(S.f.month || monthOf(Date.now()));
  if (staff || !master) await ensureMonth(monthOf(Date.now() + 31 * 864e5));
  if (staff) {
    // carrega rascunhos (a leitura RLS já os inclui para o escalista)
    for (const m of months()) await ensureMonth(m);
  }
  try {
    const cnt = {};
    let from = 0, step = 1000, lastTs = {};
    for (;;) {
      const { data, error } = await sb.from('punches').select('data,marcado_em').range(from, from + step - 1);
      if (error) throw error;
      (data || []).forEach(p => {
        const ym = String(p.data || '').slice(0, 7);
        if (ym.length === 7) { cnt[ym] = (cnt[ym] || 0) + 1; if (p.marcado_em) lastTs[ym] = p.marcado_em; }
      });
      if (!data || data.length < step) break;
      from += step;
    }
    const best = Object.entries(cnt).sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0];
    if (best) {
      S.data.dadosAte[best[0]] = lastTs[best[0]];
      const curN = cnt[S.f.month] || 0;
      if (!S.f.month || curN < best[1] * 0.5) S.f.month = best[0];
    }
  } catch (e) { /* mês padrão permanece */ }
}
async function ensureMonth(ym) {
  if (!REAL || !ym || S.data.loadedMonths[ym]) return;
  const ids = (S.data?.schedules || []).filter(s => s.month_ref === ym).map(s => s.id);
  if (!ids.length) { S.data.loadedMonths[ym] = true; return; }
  const rows = await fetchAll('shifts', q => q.in('schedule_id', ids).order('starts_at'));
  const keep = S.data.shifts.filter(s => !ids.includes(s.schedule_id));
  S.data.shifts = keep.concat(rows); S.data.loadedMonths[ym] = true; reindex();
}

// ───────── acesso ─────────
// Modo real: só a coordenação entra (usuário + senha, ex.: BRUNA). A Edge Function "auth-matricula"
// resolve o identificador técnico no servidor e devolve só a sessão (esse identificador nunca vai ao navegador).
// Login de médico, cadastro e primeiro acesso ficam fechados no servidor. A demonstração mantém o fluxo antigo.
const SITE_URL = () => location.origin + location.pathname;
const maskEmail = e => { const [u, d] = String(e || '').split('@'); return u && d ? u[0] + '***@' + d : ''; };
async function boot() {
  try {
    if (REAL) {
      const recovery = /type=recovery/.test(location.hash + location.search);
      await sbClient();
      S.sb.auth.onAuthStateChange((ev, sess) => {
        if (ev === 'PASSWORD_RECOVERY') { S.user = sess?.user || S.user; S.login = { ...S.login, step: 'nova_senha', recoveryReal: true }; S.me = null; route(); }
        if (ev === 'SIGNED_OUT') location.reload();
      });
      const { data } = await S.sb.auth.getSession();
      S.user = data.session?.user || null;
      if (recovery) { S.login.step = 'nova_senha'; S.login.recoveryReal = true; return route(); }
      await resolveAccess();
    } else {
      const sess = demoLoad();
      await demoEnsureHashes();
      const rt = location.hash.match(/redefinir=([a-z0-9]+)/i);
      if (rt) { S.login = { step: 'nova_senha', token: rt[1] }; return route(); }
      demoSetSession(sess); route();
    }
  } catch (e) { console.error(e); renderFatal(e.message); }
}
function meFromAccount(a) { return { kind: a.role, user_id: a.user_id, doctor_id: a.doctor_id, email: a.email }; }
async function resolveAccess() {
  if (!S.user) { S.me = null; return route(); }
  let st = await rpc('my_access_state');
  const meta = S.user.user_metadata || {};
  if (st.state === 'none') { // primeiro login depois de confirmar o e-mail: completa o que foi pedido no cadastro
    try {
      if (meta.invite) { await rpc('accept_invite', { p_token: meta.invite, p_name: meta.nome || '', p_crm: '', p_specialty: '', p_phone: '' }); st = await rpc('my_access_state'); }
      else if (meta.cadastro) { const c = meta.cadastro; await rpc('submit_registration', { p_name: c.name, p_crm: c.crm, p_specialty: c.specialty || '', p_matricula: c.matricula, p_empresa: c.empresa || '', p_phone: c.phone || '', p_sector_ids: c.sectors || [] }); st = await rpc('my_access_state'); }
      else if (meta.matricula) st = await rpc('claim_matricula', { p_matricula: meta.matricula, p_nome: meta.nome });
    } catch (e) { S.loginError = e.message; }
  }
  S.me = { kind: st.state === 'master' ? 'master' : st.state, user_id: S.user.id, doctor_id: st.doctor_id || null, email: S.user.email, display_name: st.display_name || null, note: st.note };
  if (['master', 'doctor', 'escalista'].includes(S.me.kind)) { S.f.month = S.f.month || (S.me.kind === 'escalista' && !REAL ? '2026-11' : defaultMonth()); await realLoad(); }
  else if (!S.data) { S.data = { sectors: await fetchAll('sectors'), units: [], doctors: [], schedules: [], shifts: [], swaps: [], requests: [], invites: [], whatsapp: [], history: [], audit: [], accounts: [], notifications: [], settings: {}, punches: [], eventosAdversos: [] }; reindex(); }
  route();
}
function defaultMonth() { const ms_ = months(); if (!ms_.length) return monthOf(Date.now()); return REAL ? (ms_.includes(monthOf(Date.now())) ? monthOf(Date.now()) : ms_[ms_.length - 1]) : '2026-09'; }
function route() {
  closeModal();
  const k = S.me?.kind;
  if (k === 'master' || k === 'doctor' || k === 'escalista') { S.f.month = S.f.month || (k === 'escalista' && !REAL ? '2026-11' : defaultMonth()); S.page = S.page || (k === 'master' ? 'painel' : k === 'escalista' ? 'montar' : 'troca'); showShell(); return; }
  $('#shell').classList.add('hidden'); $('#login').classList.remove('hidden');
  renderLogin();
}
function renderFatal(msg) { $('#login').classList.remove('hidden'); $('#shell').classList.add('hidden'); $('#login').innerHTML = `<div class="login-card"><div class="logo big"><span class="logo-icon">${logoSvg()}</span>Escala<span class="accent">Med</span></div><h1>Não foi possível iniciar</h1><p class="desc">${esc(msg)}</p><button class="btn primary full" onclick="location.reload()">Tentar novamente</button></div>`; }
function inviteToken() { const m = location.hash.match(/convite=([a-z0-9-]+)/i); return m ? m[1] : null; }
const pwFields = (confirm = true) => `<div class="field"><label for="pw1">${confirm ? 'Crie uma senha' : 'Senha'}</label><input id="pw1" name="senha" type="password" autocomplete="${confirm ? 'new-password' : 'current-password'}" minlength="${confirm ? 4 : 1}" required>${confirm ? '<small class="hint">Mínimo de 4 caracteres.</small>' : ''}</div>${confirm ? '<div class="field"><label for="pw2">Repita a senha</label><input id="pw2" name="senha2" type="password" autocomplete="new-password" minlength="4" required></div>' : ''}`;
// painel de marca do login (só visual; escondido no celular)
function loginBrand() {
  const ic = p => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  return `<aside class="login-brand" aria-hidden="true"><div class="lb-top"><span class="lb-mark">${logoSvg()}</span><span class="lb-name">Escala<b>Med</b></span></div>
    <div class="lb-mid"><h2>Escalas e trocas de plantão, num só lugar.</h2><p>Hospital Municipal Padre Germano Lauck · Foz do Iguaçu</p>
    <ul><li>${ic('<path d="M8 2v4M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/>')}<span><b>Escala do mês</b> montada e conferida na tela</span></li>
    <li>${ic('<path d="m8 3-4 4 4 4M4 7h16M16 21l4-4-4-4M20 17H4"/>')}<span><b>Trocas rastreáveis</b>, a escala original fica preservada</span></li>
    <li>${ic('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>')}<span><b>Escala x cartão ponto</b> e relatório do mês</span></li></ul></div>
    <div class="lb-foot">HMPGL · EscalaMed</div></aside>`;
}
function renderLogin() {
  const L = S.login, k = S.me?.kind, tok = inviteToken();
  let body = '';
  const err = L.error ? `<p class="err">${esc(L.error)}</p>` : '';
  if (k === 'pending') {
    const r = S.me.request || {};
    body = `<div class="state-ico wait">⏳</div><h1>Aguardando aprovação</h1><p class="desc">Seu primeiro acesso foi registrado${r.name ? ` como <b>${esc(r.name)}</b>${r.matricula ? ` (matrícula ${esc(r.matricula)})` : ''}` : ''}. A coordenação (MASTER) precisa confirmar antes de você usar o app. Depois da aprovação, entre com a <b>matrícula e a senha</b> que você criou.</p>
      <div class="login-actions"><button class="btn primary full" data-act="refreshAccess">Verificar novamente</button><button class="btn full" data-act="logout">Sair</button></div>`;
  } else if (k === 'rejected') {
    body = `<div class="state-ico bad">!</div><h1>Acesso não aprovado</h1><p class="desc">${esc(S.me.note || S.me.request?.decision_note || 'Procure a coordenação.')}</p><div class="login-actions"><button class="btn full" data-act="logout">Sair</button></div>`;
  } else if (k === 'none') {
    body = `<h1>Quase lá</h1><p class="desc">Sua conta (${esc(S.me.email)}) ainda não está ligada a uma matrícula.${S.loginError ? `<br><span class="err">${esc(S.loginError)}</span>` : ''}</p><p class="hint">Procure a coordenação.</p><button class="btn full" data-act="logout">Sair</button>`;
  } else if (L.step === 'nova_senha') {
    body = `<h1>Nova senha</h1><p class="desc">Crie a nova senha da sua conta.</p><form id="newPwForm">${pwFields(true)}${err}<button class="btn primary full">Salvar nova senha</button></form>`;
  } else if (REAL) {
    body = `<h1>Entrar</h1><p class="desc">Digite o usuário e a senha.</p>
      <form id="staffForm"><div class="field"><label for="userIn">Usuário</label><input id="userIn" name="usuario" autocomplete="username" required></div>${pwFields(false)}${err}<button class="btn primary full">Entrar</button></form>
      <p class="hint">Se esquecer a senha, peça ao administrador para redefinir.</p>`;
  } else if (L.step === 'enviado') {
    body = `<div class="state-ico">✉</div><h1>Confira seu e-mail</h1><p class="desc">${L.sentMsg}</p>${L.demoMail ? demoMailBox(L.demoMail) : ''}<button class="btn full" data-act="loginRestart">Voltar ao login</button>`;
  } else if (L.step === 'master') {
    body = `<h1>Coordenação (MASTER)</h1><p class="desc">Entre com o e-mail e a senha da conta MASTER.</p><form id="masterForm"><div class="field"><label>E-mail</label><input name="email" type="email" autocomplete="username" required></div>${pwFields(false)}${err}<button class="btn primary full">Entrar</button></form>
      <button class="btn link" data-act="masterForgot">Esqueci minha senha</button><button class="btn link" data-act="loginRestart">‹ Voltar ao acesso do médico</button>`;
  } else if (L.step === 'master_forgot') {
    body = `<h1>Redefinir senha (MASTER)</h1><form id="masterForgotForm"><div class="field"><label>E-mail da conta MASTER</label><input name="email" type="email" required></div>${err}<button class="btn primary full">Enviar link</button></form><button class="btn link" data-act="loginRestart">‹ Voltar</button>`;
  } else if (L.mode === 'cadastro') {
    body = registrationForm();
  } else if (L.mode === 'convite') {
    body = `<h1>Convite da coordenação</h1><p class="desc">Informe seu e-mail (para recuperar a senha) e crie uma senha.</p><form id="inviteAcceptForm"><div class="field"><label>E-mail</label><input name="email" type="email" autocomplete="email" required></div>${pwFields(true)}${err}<button class="btn primary full">Ativar acesso</button></form><button class="btn link" data-act="loginRestart">‹ Voltar</button>`;
  } else if (L.step === 3 && L.found && !L.found.ja_vinculado) {
    body = `<div class="steps">${stepDots(3)}</div><h1>Primeiro acesso</h1><p class="desc"><b>${esc(L.found.nome)}</b> · ${keyTxt(L.found)}.<br>Informe um e-mail (usado só para recuperar a senha) e crie sua senha. Depois, você entra só com a <b>matrícula e a senha</b>.</p>
      <form id="firstForm"><div class="field"><label for="emailIn">E-mail</label><input id="emailIn" name="email" type="email" autocomplete="email" required placeholder="seu@email.com"></div>${pwFields(true)}${err}
      <p class="hint">${S.data?.settings?.first_access_approval === true ? 'A coordenação confirma o primeiro acesso antes da liberação. ' : ''}Uma conta por matrícula.${REAL ? ' Você receberá um e-mail para confirmar o endereço.' : ''}</p><button class="btn primary full">Criar acesso</button></form>
      <button class="btn link" data-act="loginBack" data-step="2">‹ Voltar</button>`;
  } else if (L.step === 3 && L.found) {
    body = `<div class="steps">${stepDots(3)}</div><h1>Digite sua senha</h1><p class="desc"><b>${esc(L.found.nome)}</b> · ${keyTxt(L.found)}</p>
      <form id="pwForm">${pwFields(false)}${err}<button class="btn primary full">Entrar</button></form>
      <button class="btn link" data-act="forgot">Esqueci minha senha</button><button class="btn link" data-act="loginBack" data-step="1">‹ Outra matrícula</button>`;
  } else if (L.step === 2 && L.found) {
    body = `<div class="steps">${stepDots(2)}</div><h1>Confirme seu nome</h1><p class="desc">A ${keyTxt(L.found, true)} pertence a:</p>
      <label class="name-choice"><input type="radio" name="nomeConf" value="1"><span><b>${esc(L.found.nome)}</b><small>Cadastro do colaborador · FMS</small></span></label>
      <button class="btn primary full" data-act="confirmName" disabled id="btnConfirmName">Sou eu — continuar</button>
      <button class="btn link" data-act="loginBack" data-step="1">Não sou eu / digitar outro número</button>`;
  } else {
    body = `${tok ? `<div class="callout">Você recebeu um <b>convite</b> da coordenação.</div><button class="btn primary full" data-act="openInvite">Ativar meu acesso pelo convite</button><hr>` : ''}
      <div class="steps">${stepDots(1)}</div><h1>Acesso do médico</h1><p class="desc">Digite a sua <b>matrícula</b> (a do crachá).</p>${matriculaStep()}`;
  }
  const demo = !REAL && !k ? `<div class="demo-box"><div class="demo-title">Demonstração · acesso rápido</div><p>Contas de exemplo (senha <b>demo1234</b>, ex.: matrícula <b>105895</b>). Para testar o primeiro acesso, use a matrícula de teste <b>1988</b> (vinicyus teste) ou a <b>101595</b>.</p>
      <div class="demo-grid">${S.data.accounts.map(a => `<button class="btn small" data-act="demoLogin" data-user="${a.user_id}">${a.role === 'master' ? 'MASTER (coordenação)' : a.role === 'escalista' ? esc((n => n[0] + ' ' + n[n.length - 1])(docName(a.doctor_id).split(' '))) + ' (escalista)' : esc((n => n[0] + ' ' + n[n.length - 1])(docName(a.doctor_id).split(' ')))}</button>`).join('')}</div>
      <button class="btn link small" data-act="demoReset">Restaurar demonstração</button></div>` : '';
  $('#login').innerHTML = `<div class="login-split">${loginBrand()}<div class="login-wrap"><div class="login-card"><div class="logo big"><span class="logo-icon">${logoSvg()}</span>Escala<span class="accent">Med</span></div><div class="login-sub">HMPGL · Escalas e trocas de plantão</div>${body}
    ${!REAL && !k && L.step === 1 && (!L.mode || L.mode === 'medico') ? `<div class="login-foot"><button class="btn link small" data-act="masterLogin">Sou da coordenação (MASTER)</button><button class="btn link small" data-act="newRegistration">Não encontrou sua matrícula? Solicitar cadastro</button></div>` : ''}</div>${demo}</div></div>`;
  const inp = $('#matInput'); if (inp) { inp.focus(); inp.value = L.matricula || ''; }
  const staff = $('#userIn'); if (staff) staff.focus();
  const f1 = $('#emailIn') || (L.step === 3 ? $('#pw1') : null); if (f1) f1.focus();
}
const stepDots = n => [1, 2, 3].map(i => `<span class="dot ${i <= n ? 'on' : ''}">${i}</span>`).join('<i></i>') + `<div class="step-labels"><span>Matrícula</span><span>Nome</span><span>Senha</span></div>`;
function matriculaStep() {
  return `<form id="matForm" class="mat-form" autocomplete="off"><label for="matInput">Matrícula</label><input id="matInput" name="matricula" maxlength="20" inputmode="numeric" placeholder="105895" required>
    ${S.login.error ? `<p class="err">${esc(S.login.error)}</p>` : ''}<button class="btn primary full">Continuar</button></form><p class="hint">Só mostramos o nome ligado ao número digitado. Nenhuma lista de médicos é exibida.</p>`;
}
function registrationForm() {
  return `<h1>Solicitar cadastro</h1><p class="desc">Use apenas se a sua matrícula não foi encontrada (ex.: admissão recente). A coordenação analisa o pedido.</p>
  <form id="regForm" class="form-grid one"><div class="field"><label>Nome completo *</label><input name="name" required minlength="3"></div>
  <div class="field"><label>Matrícula *</label><input name="matricula" inputmode="numeric" required></div><div class="field"><label>CRM / UF *</label><input name="crm" required placeholder="00000-PR"></div><div class="field"><label>Especialidade</label><input name="specialty"></div>
  <div class="field"><label>Empresa (PJ)</label><input name="empresa"></div><div class="field"><label>Telefone</label><input name="phone" inputmode="tel"></div>
  <div class="field"><label>Setores em que atua *</label><div class="checks">${S.data.sectors.slice().sort((a, b) => a.name.localeCompare(b.name)).map(s => `<label><input type="checkbox" name="sector" value="${s.id}"> ${esc(s.name)}</label>`).join('')}</div></div>
  <div class="field"><label>E-mail * (para recuperar a senha)</label><input name="email" type="email" required></div>${pwFields(true)}${S.login.error ? `<p class="err">${esc(S.login.error)}</p>` : ''}
  <button class="btn primary full">Enviar pedido</button><button type="button" class="btn link" data-act="loginRestart">Voltar ao acesso por matrícula</button></form>`;
}
function checkPw(o) {
  if ((o.senha || '').length < 4) throw new Error('A senha precisa ter pelo menos 4 caracteres.');
  if (o.senha !== o.senha2) throw new Error('As duas senhas não são iguais.');
}
// ── passo 1: consulta da matrícula (real: função com limite de tentativas; demo: simulação local com o mesmo limite)
function demoRate(key, max, winMs) {
  const L = S.data.lookups = (S.data.lookups || []).filter(t => t.t > Date.now() - 3600e3);
  if (L.filter(t => t.k === key && t.t > Date.now() - winMs).length >= max) throw new Error('Muitas tentativas. Aguarde alguns minutos e tente de novo.');
  L.push({ k: key, t: Date.now() });
}
// Login somente por matrícula (mesma regra de public.doctor_by_login). Prefixo CRM/CRO é recusado.
function doctorByLogin(raw) {
  if (/^\s*CR[MO]/i.test(String(raw || ''))) return null;
  const n = normMatricula(raw);
  if (!n || n.length > 12) return null;
  return S.data.doctors.find(x => x.matricula === n && x.cadastro_fms && x.active !== false) || null;
}
const loginKey = d => d.matricula;
const keyTxt = (f, bold) => `matrícula ${bold ? `<b>${esc(f.matricula)}</b>` : esc(f.matricula)}`;
async function lookupMatricula(raw) {
  if (REAL) return rpc('lookup_matricula', { p_matricula: raw });
  demoRate('lookup', 8, 600e3);
  const d = doctorByLogin(raw);
  return d ? { found: true, matricula: loginKey(d), nome: d.name, ja_vinculado: !!demoUserForMatricula(loginKey(d), true) } : { found: false };
}
// ── demo: "auth.users" local com senha em SHA-256 + sal (nunca texto puro)
async function sha256(txt) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)); return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join(''); }
const newSalt = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2, '0')).join('');
async function demoEnsureHashes() {
  S.data.users = S.data.users || [];
  for (const a of S.data.accounts) if (!S.data.users.some(u => u.user_id === a.user_id)) { const salt = newSalt(); S.data.users.push({ user_id: a.user_id, email: a.email, salt, hash: await sha256(salt + 'demo1234'), created_at: new Date().toISOString() }); }
  for (const r of S.data.requests.filter(r => r.exemplo)) if (!S.data.users.some(u => u.user_id === r.user_id)) { const salt = newSalt(); S.data.users.push({ user_id: r.user_id, email: r.email, salt, hash: await sha256(salt + 'demo1234'), created_at: r.created_at }); }
  demoSave();
}
function demoUserForMatricula(m, soAtivos) { // mesma regra do servidor: conta ligada à matrícula ou 1º acesso/pedido pendente
  const d = doctorByLogin(m), n = normMatricula(m);
  const acc = d && IDX.account.get(d.id);
  if (acc) return S.data.users.find(u => u.user_id === acc.user_id);
  if (/^\s*CR[MO]/i.test(String(m || ''))) return null;
  const r = S.data.requests.find(x => ((d && x.suggested_doctor_id === d.id) || x.matricula === n) && (soAtivos ? ['pending'] : ['pending', 'rejected']).includes(x.status));
  return r ? S.data.users.find(u => u.user_id === r.user_id) : null;
}
function demoSetSession(userId) {
  S.me = null; if (!userId) return;
  const acc = S.data.accounts.find(a => a.user_id === userId);
  if (acc) { S.me = meFromAccount(acc); return; }
  const r = S.data.requests.filter(x => x.user_id === userId && x.status !== 'cancelled')[0];
  if (r && ['pending', 'rejected'].includes(r.status)) S.me = { kind: r.status, user_id: userId, email: r.email, request: r };
}
function demoSignIn(userId) { demoSetSession(userId); S.page = null; S.w = null; S.login = { step: 1, matricula: '', found: null }; demoSave(); route(); }
async function demoCreateUser(email, senha) {
  email = email.trim().toLowerCase();
  if (S.data.users.some(u => u.email === email)) throw new Error('Este e-mail já tem uma conta. Use outro e-mail ou entre com a sua matrícula e senha.');
  const salt = newSalt(), u = { user_id: 'u-' + newSalt().slice(0, 12), email, salt, hash: await sha256(salt + senha), created_at: new Date().toISOString() };
  S.data.users.push(u); return u;
}
async function loginStaff(usuario, senha) {
  const { data, error } = await S.sb.functions.invoke('auth-matricula', { body: { acao: 'entrar', matricula: usuario, senha } });
  if (error) { let msg = 'Usuário ou senha incorretos.'; try { msg = (await error.context.json()).error || msg; } catch (e) { /* resposta sem corpo */ } throw new Error(msg); }
  if (!data?.access_token) throw new Error(data?.error || 'Usuário ou senha incorretos.');
  const { data: s, error: e2 } = await S.sb.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
  if (e2) throw new Error(e2.message);
  S.user = s.user; return resolveAccess();
}
async function loginMatricula(matricula, senha) {
  if (REAL) {
    const { data, error } = await S.sb.functions.invoke('auth-matricula', { body: { acao: 'entrar', matricula, senha } });
    if (error) { let msg = 'Usuário ou senha incorretos.'; try { msg = (await error.context.json()).error || msg; } catch (e) { /* resposta sem corpo */ } throw new Error(msg); }
    const { data: s, error: e2 } = await S.sb.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
    if (e2) throw new Error(e2.message);
    S.user = s.user; return resolveAccess();
  }
  demoRate('login:' + matricula, 10, 900e3);
  const u = demoUserForMatricula(matricula);
  if (!u || u.hash !== await sha256(u.salt + senha)) throw new Error('Matrícula ou senha incorretos.');
  demoSignIn(u.user_id);
}
async function forgotMatricula(matricula) {
  if (REAL) {
    const { data, error } = await S.sb.functions.invoke('auth-matricula', { body: { acao: 'recuperar', matricula, redirectTo: SITE_URL() } });
    if (error) { let msg = 'Não foi possível enviar o link.'; try { msg = (await error.context.json()).error || msg; } catch (e) { /* idem */ } throw new Error(msg); }
    return { masked: data.email_mascarado };
  }
  demoRate('recover:' + matricula, 3, 3600e3);
  const u = demoUserForMatricula(matricula);
  if (!u) throw new Error('Este acesso ainda não tem senha. Faça o primeiro acesso.');
  return demoSendReset(u);
}
function demoSendReset(u) {
  const token = newSalt();
  S.data.resets = (S.data.resets || []).filter(r => r.exp > Date.now()); S.data.resets.push({ token, user_id: u.user_id, exp: Date.now() + 3600e3 });
  demoSave();
  return { masked: maskEmail(u.email), demoMail: { to: u.email, link: SITE_URL() + '#redefinir=' + token } };
}
function demoMailBox(m) {
  return `<div class="mail-sim" aria-label="E-mail simulado"><div class="mail-sim-h">✉ E-mail simulado (na versão real ele chega na caixa de entrada)</div><div><b>Para:</b> ${esc(maskEmail(m.to))}</div><div><b>Assunto:</b> Redefinir sua senha do EscalaMed</div><p>Recebemos um pedido para redefinir sua senha. O link vale por 1 hora.</p><a class="btn primary full" id="resetLink" href="${esc(m.link)}">Criar nova senha</a></div>`;
}
async function firstAccess(o) {
  checkPw(o);
  const L = S.login;
  if (REAL) {
    const { data, error } = await S.sb.auth.signUp({ email: o.email.trim(), password: o.senha, options: { emailRedirectTo: SITE_URL(), data: { matricula: L.found.matricula, nome: L.found.nome } } });
    if (error) throw new Error(error.message);
    if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) throw new Error('Este e-mail já tem uma conta. Use outro e-mail.');
    if (data.session) { S.user = data.user; return resolveAccess(); }
    S.login = { step: 'enviado', sentMsg: `Enviamos um link de confirmação para <b>${esc(o.email.trim())}</b>. Abra o e-mail e clique no link para concluir o primeiro acesso.` }; return renderLogin();
  }
  demoRate('first:' + L.found.matricula, 5, 900e3);
  const d = doctorByLogin(L.found.matricula);
  if (d && hasAccount(d.id)) throw new Error('Este acesso já tem senha. Entre com a matrícula e a senha.');
  const u = await demoCreateUser(o.email, o.senha);
  try { const st = demoClaim(u.user_id, u.email, L.found.matricula, L.found.nome); demoSave(); if (st === 'doctor') demoSignIn(u.user_id); else { demoSetSession(u.user_id); S.login = { step: 1 }; demoSave(); route(); } }
  catch (e) { S.data.users = S.data.users.filter(x => x !== u); throw e; }
}
function demoClaim(userId, email, matricula, nome) {
  const d = doctorByLogin(matricula);
  if (!d) throw new Error('Matrícula não encontrada no cadastro');
  if (normTxt(d.name) !== normTxt(nome)) throw new Error('O nome confirmado não corresponde à matrícula');
  if (hasAccount(d.id)) throw new Error('Esta matrícula já tem uma conta. Somente o MASTER pode refazer o vínculo.');
  if (S.data.requests.some(r => r.tipo === 'primeiro_acesso' && r.status === 'pending' && r.suggested_doctor_id === d.id && r.user_id !== userId)) throw new Error('Já existe um primeiro acesso pendente para esta matrícula. Procure o MASTER.');
  S.data.requests.filter(r => r.user_id === userId && r.status === 'pending').forEach(r => (r.status = 'cancelled'));
  const ap = S.data.settings.first_access_approval === true;
  const r = { id: rid('req'), tipo: 'primeiro_acesso', user_id: userId, email, name: d.name, matricula: d.matricula, empresa: d.empresa, sector_ids: [...d.sector_ids], status: ap ? 'pending' : 'approved', suggested_doctor_id: d.id, doctor_id: ap ? null : d.id, decision_note: ap ? null : 'Vínculo automático (aprovação do MASTER no 1º acesso desligada)', created_at: new Date().toISOString(), decided_at: ap ? null : new Date().toISOString() };
  S.data.requests.unshift(r);
  if (ap) { notifyMasters('Primeiro acesso aguardando aprovação', `${d.name} (${d.matricula ? 'matrícula ' + d.matricula : loginKey(d)}) criou o acesso com o e-mail ${email}.`); audit('FIRST_ACCESS', `Primeiro acesso solicitado: ${d.name} (${email})`); return 'pending'; }
  bindAccount(userId, email, d.id, 'Primeiro acesso (sem aprovação)');
  notifyMasters('Primeiro acesso', `${d.name} (${d.matricula ? 'matrícula ' + d.matricula : loginKey(d)}) criou o acesso com o e-mail ${email}.`);
  return 'doctor';
}
function bindAccount(userId, email, docId, via) {
  S.data.accounts.push({ user_id: userId, email, role: 'doctor', doctor_id: docId, bound_at: new Date().toISOString(), bound_via: via });
  const d = doc(docId); d.email = email; reindex();
  audit('ACCOUNT_BOUND', `Conta ${email} vinculada a ${d.name} (${d.matricula ? 'matrícula ' + d.matricula : loginKey(d)})`);
}
async function acceptInvite(o) {
  checkPw(o);
  const token = inviteToken();
  if (REAL) {
    const { data, error } = await S.sb.auth.signUp({ email: o.email.trim(), password: o.senha, options: { emailRedirectTo: SITE_URL(), data: { invite: token } } });
    if (error) throw new Error(error.message);
    if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) throw new Error('Este e-mail já tem uma conta.');
    history.replaceState(null, '', location.pathname);
    if (data.session) { S.user = data.user; return resolveAccess(); }
    S.login = { step: 'enviado', sentMsg: `Enviamos um link de confirmação para <b>${esc(o.email.trim())}</b>. Clique nele para ativar o acesso.` }; return renderLogin();
  }
  const inv = S.data.invites.find(i => i.token === token);
  if (!inv || inv.revoked || inv.used_at || Date.parse(inv.expires_at) < Date.now()) throw new Error('Convite inválido, usado ou expirado.');
  if (inv.email && inv.email !== o.email.trim().toLowerCase()) throw new Error('Este convite foi gerado para outro e-mail.');
  if (inv.doctor_id && hasAccount(inv.doctor_id)) throw new Error('Este médico já tem conta.');
  const u = await demoCreateUser(o.email, o.senha);
  inv.sector_ids.forEach(s => { const d = doc(inv.doctor_id); if (d && !d.sector_ids.includes(s)) d.sector_ids.push(s); });
  bindAccount(u.user_id, u.email, inv.doctor_id, 'Convite');
  inv.used_at = new Date().toISOString(); inv.used_by = u.email;
  notifyMasters('Convite utilizado', `${docName(inv.doctor_id)} ativou o acesso pelo convite.`);
  history.replaceState(null, '', location.pathname); demoSignIn(u.user_id);
}
async function setNewPassword(o) {
  checkPw(o);
  if (REAL) { const { error } = await S.sb.auth.updateUser({ password: o.senha }); if (error) throw new Error(error.message); history.replaceState(null, '', location.pathname); S.login = { step: 1 }; toast('Senha alterada.'); return resolveAccess(); }
  const r = (S.data.resets || []).find(x => x.token === S.login.token && x.exp > Date.now());
  if (!r) throw new Error('Link inválido ou expirado. Peça um novo em “Esqueci minha senha”.');
  const u = S.data.users.find(x => x.user_id === r.user_id); u.salt = newSalt(); u.hash = await sha256(u.salt + o.senha);
  S.data.resets = S.data.resets.filter(x => x !== r); audit('PASSWORD_RESET', 'Senha redefinida pelo link de recuperação: ' + maskEmail(u.email));
  history.replaceState(null, '', location.pathname); S.login = { step: 1, matricula: '', found: null }; demoSave(); renderLogin(); toast('Senha alterada. Entre com a matrícula e a nova senha.');
}
async function masterLogin(o) {
  if (REAL) { const { data, error } = await S.sb.auth.signInWithPassword({ email: o.email.trim(), password: o.senha }); if (error) throw new Error('E-mail ou senha incorretos.'); S.user = data.user; return resolveAccess(); }
  demoRate('master', 10, 900e3);
  const u = S.data.users.find(x => x.email === o.email.trim().toLowerCase());
  const acc = u && S.data.accounts.find(a => a.user_id === u.user_id && a.role === 'master');
  if (!acc || u.hash !== await sha256(u.salt + o.senha)) throw new Error('E-mail ou senha incorretos.');
  demoSignIn(u.user_id);
}
async function masterForgot(o) {
  const email = o.email.trim().toLowerCase();
  if (REAL) { const { error } = await S.sb.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL() }); if (error) throw new Error(error.message); S.login = { step: 'enviado', sentMsg: 'Se este e-mail tiver conta, enviamos um link para criar a nova senha.' }; return renderLogin(); }
  const u = S.data.users.find(x => x.email === email);
  const r = u ? demoSendReset(u) : null;
  S.login = { step: 'enviado', sentMsg: 'Se este e-mail tiver conta, enviamos um link para criar a nova senha.', demoMail: r?.demoMail }; renderLogin();
}
// ───────── ícones (SVG inline, sem dependências; traços no estilo Lucide, licença ISC) ─────────
const NAV_SVG = {
  painel: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  montar: '<path d="M8 2v4M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M12 14v4M10 16h4"/>',
  habilitacoes: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  escala: '<path d="M8 2v4M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/>',
  versoes: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7M11 18H8a2 2 0 0 1-2-2V9"/>',
  ponto: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  relatorio: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8"/>',
  whatsapp: '<path d="m8 3-4 4 4 4M4 7h16M16 21l4-4-4-4M20 17H4"/>',
  troca: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  trocas: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  cadastros: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  medicos: '<path d="M11 2v2M5 2v2M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1"/><path d="M8 15a6 6 0 0 0 12 0v-3"/><circle cx="20" cy="10" r="2"/>',
  contratos: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect x="2" y="6" width="20" height="14" rx="2"/>',
  assistente: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>',
  auditoria: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  config: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>'
};
function navIco(k, fallback) { const p = NAV_SVG[k]; return p ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>` : fallback; }
function logoSvg() { return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9.5 3h5v6.5H21v5h-6.5V21h-5v-6.5H3v-5h6.5z" fill="currentColor"/></svg>'; }
// ───────── estrutura ─────────
function navItems() {
  const d = S.data;
  if (isMaster() && REAL) { // BRUNA: vista enxuta, no estilo de quem monta a escala
    return [['montar', '✎', 'Escala do mês'], ['whatsapp', '⇄', 'Trocas'], ['contratos', '▤', 'Contratos', ctrNavCount()], ['ponto', '⏱', 'Cartão ponto'], ['habilitacoes', '♟', 'Habilitações'], ['relatorio', '▤', 'Relatório do mês']];
  }
  if (isMaster()) {
    const ctrAlert = (d.contracts || []).filter(c => ['vencido', 'vencendo'].includes(ctrStatus(c).k)).length;
    const pend = d.requests.filter(r => r.status === 'pending').length, swp = d.swaps.filter(s => s.status === 'needs_master').length, wa = d.whatsapp.filter(w => w.status === 'a_revisar').length;
    return [['painel', '◫', 'Painel'], ['montar', '✎', 'Inclusão de escala'], ['habilitacoes', '♟', 'Habilitações'], ['escala', '▦', 'Escala'], ['versoes', '⇆', 'Original x vigente'], ['ponto', '⏱', 'Escala x Ponto'], ['relatorio', '▤', 'Relatório do mês'], ['trocas', '⇄', 'Trocas', swp], ['troca', '⇄', 'Troca de plantão'], ['whatsapp', '✆', 'Trocas do WhatsApp', wa],
      ['cadastros', '✚', 'Cadastros pendentes', pend], ['medicos', '♙', 'Médicos'], ['contratos', '▤', 'Contratos', ctrAlert], ['assistente', '✦', 'Assistente'], ['auditoria', '◷', 'Auditoria'], ['config', '⚙', 'Configurações']];
  }
  if (S.me?.kind === 'escalista') {
    const escNav = [['montar', '✎', 'Inclusão de escala'], ['habilitacoes', '♟', 'Habilitações'], ['troca', '⇄', 'Troca de plantão'], ['contratos', '▤', 'Contratos', ctrNavCount()]];
    if (typeof aiAllowed === 'function' && aiAllowed()) escNav.push(['assistente', '✦', 'Assistente']);
    return escNav;
  }
  return [['troca', '⇄', 'Troca de plantão']]; // médico: uma tela só (sem menu)
}
function showShell() {
  $('#login').classList.add('hidden'); $('#shell').classList.remove('hidden');
  document.body.classList.toggle('doctor-mode', S.me?.kind === 'doctor');
  render();
}
function render() {
  if (!S.me || !['master', 'doctor', 'escalista'].includes(S.me.kind)) return route();
  const items = navItems();
  if (!items.some(i => i[0] === S.page)) S.page = items[0][0];
  if (S.me.kind === 'doctor') { // médico: cabeçalho simples (marca, nome, Sair) + tela única de troca
    $('#docTop').innerHTML = docTop();
    try { $('#content').innerHTML = PAGES.troca(); } catch (e) { console.error(e); $('#content').innerHTML = `<div class="empty">Erro ao montar a tela: ${esc(e.message)}</div>`; }
    return;
  }
  $('#nav').innerHTML = items.map(([k, ic, label, n]) => `<button class="nav-link ${S.page === k ? 'active' : ''}" data-act="nav" data-page="${k}"><span class="nav-ico">${navIco(k, ic)}</span><span class="nav-label">${esc(label)}</span>${n ? `<span class="nav-count">${n}</span>` : ''}</button>`).join('');
  $('#bottomNav').innerHTML = isMaster() ? '' : items.map(([k, ic, label, n]) => `<button class="${S.page === k ? 'active' : ''}" data-act="nav" data-page="${k}"><span>${navIco(k, ic)}</span>${esc(label.replace('Escala do setor', 'Setor').replace('Meus plantões', 'Plantões'))}${n ? `<b>${n}</b>` : ''}</button>`).join('');
  const name = isMaster() ? (REAL ? (S.me.display_name || 'BRUNA') : 'Coordenação (MASTER)') : (myDoc()?.name || (S.me.kind === 'escalista' ? 'Escalista' : ''));
  const av = isMaster() ? (REAL ? (name.trim().charAt(0) || 'B') : 'M') : initials(name);
  const sub = isMaster() ? (REAL ? 'MASTER' : '') : (S.me.kind === 'escalista' ? 'Monta a escala' : '');
  $('#who').innerHTML = `<div class="avatar">${esc(av)}</div><div class="who-txt"><b>${esc(name)}</b><small>${esc(sub)}</small></div><button class="btn small" data-act="logout">Sair</button>`;
  const bar = $('#envPill') && $('#envPill').closest('.topbar');
  if (REAL) { $('#envPill').textContent = ''; $('#envPill').hidden = true; if (bar) bar.classList.add('no-pill'); }
  else { $('#envPill').hidden = false; $('#envPill').textContent = 'Demonstração'; $('#envPill').className = 'env-pill'; if (bar) bar.classList.remove('no-pill'); }
  $('#crumb').textContent = items.find(i => i[0] === S.page)?.[2] || '';
  const fn = PAGES[S.page];
  try { $('#content').innerHTML = (S.loginWarn ? `<div class="callout warn">${esc(S.loginWarn)}</div>` : '') + fn(); }
  catch (e) { console.error(e); $('#content').innerHTML = `<div class="empty">Erro ao montar a tela: ${esc(e.message)}</div>`; }
  $('#sidebar').classList.remove('open');
}
const PAGES = {};
function demoBanner() { return REAL ? '' : `<div class="callout info small-callout"><b>Demonstração</b> · escalas reais de ${fmtMonth('2026-09')}, ${fmtMonth('2026-10')} e ${fmtMonth('2026-11')}, com cartão ponto de setembro. Para permitir trocas, a demo considera <b>hoje = 01/09/2026</b>.</div>`; }
function kpi(label, n, sub, kind = '', act = '') { return `<div class="kpi ${kind}" ${act ? `data-act="nav" data-page="${act}" role="button" tabindex="0"` : ''}><div class="kpi-n">${typeof n === 'number' ? n.toLocaleString('pt-BR') : n}</div><div class="kpi-l">${esc(label)}</div>${sub ? `<div class="kpi-s">${sub}</div>` : ''}</div>`; }

// ───────── MASTER: painel ─────────
PAGES.painel = () => {
  const d = S.data, m = S.f.month, sh = d.shifts.filter(s => s._month === m && s.status !== 'cancelled' && pubShift(s));
  const alt = sh.filter(changed).length, pend = d.requests.filter(r => r.status === 'pending').length;
  const acc = d.accounts.filter(a => a.role === 'doctor').length;
  const fonte = d.fonte?.[m] || '';
  let pk = null;
  if (!REAL) pk = EscalaPonto.kpis(pontoRows(m).rows);
  else {
    const c = pontoRows(m);
    if (c.loading) loadPontoReal(m).catch(e => toast(e.message, true));
    else pk = EscalaPonto.kpis(c.rows);
  }
  return header('Painel', `Competência ${esc(fmtMonth(m))}${fonte ? ` · <span class="muted">${esc(fonte)}</span>` : ''}`, monthSelect()) + demoBanner() + `
  <div class="kpis">${kpi('Médicos no cadastro', d.doctors.length, `${d.doctors.filter(x => x.cadastro_fms).length} no cadastro FMS · ${acc} com conta`, '', 'medicos')}
  ${kpi('Plantões / sobreavisos', sh.length, `${sh.filter(s => s.type === 'Plantão').length} plantões · ${sh.filter(s => s.type === 'Sobreaviso').length} sobreavisos · ${sh.filter(s => s.type === 'Visita').length} visitas`, '', 'escala')}
  ${kpi('Alterados vs. escala original', alt, alt ? 'ver Antes → Agora' : 'nenhuma troca aplicada neste mês', alt ? 'warn' : '', 'versoes')}
  ${kpi('Cadastros pendentes', pend, 'primeiros acessos e pedidos', pend ? 'warn' : '', 'cadastros')}
  ${kpi('Trocas aguardando MASTER', d.swaps.filter(s => s.status === 'needs_master').length, d.settings.approval_required ? 'aprovação obrigatória ligada' : 'aprovação do MASTER desligada', '', 'trocas')}
  ${kpi('WhatsApp a revisar', d.whatsapp.filter(w => w.status === 'a_revisar').length, `${d.whatsapp.length} mensagens de troca importadas`, '', 'whatsapp')}</div>
  ${pk ? `<div class="card"><div class="card-head"><h2>Escala x Ponto · ${esc(fmtMonth(m))}</h2><button class="btn small" data-act="nav" data-page="ponto">Abrir cruzamento</button></div>
    <div class="kpis small">${kpi('Plantões avaliados', pk.plantoes)}${kpi('Cumpridos', pk.cumpridos, '', 'ok')}${kpi('Faltas', pk.faltas, '', 'bad')}${kpi('Atrasos', pk.atrasos, '', 'warn')}${kpi('Saídas antecipadas', pk.saidas, '', 'warn')}${kpi('Incompletos', pk.incompletos, '', 'warn')}</div></div>` : ''}
  ${d.naoResolvidos?.length && m === '2026-09' ? `<div class="callout warn">${d.naoResolvidos.length} nomes da escala em PDF não puderam ser ligados a um médico com segurança e ficaram fora (sem invenção de dados). Plantões com nome incerto aparecem com ⚠ no cruzamento.</div>` : ''}`;
};

// ───────── MASTER/médico: escala (vigente ou original) ─────────
function shiftsFiltered(opts = {}) {
  const f = S.f, q = normTxt(f.doctor), ver = f.version;
  return S.data.shifts.filter(s => s._month === f.month && pubShift(s) && (!f.sector || s.sector_id === f.sector) && s.status !== 'cancelled'
    && (!opts.sectors || opts.sectors.includes(s.sector_id))
    && (!f.onlyChanged || changed(s))
    && (!q || normTxt(shiftName(s, ver === 'original' ? s.original_doctor_id : s.doctor_id) + ' ' + (s.source_text || '')).includes(q) || (changed(s) && normTxt(shiftName(s, s.original_doctor_id) + ' ' + shiftName(s, s.doctor_id)).includes(q))))
    .sort((a, b) => ms(a.starts_at) - ms(b.starts_at) || secName(a.sector_id).localeCompare(secName(b.sector_id)));
}
const who = s => S.f.version === 'original' ? s.original_doctor_id : s.doctor_id;
function versionToggle() { return `<div class="seg" role="group" aria-label="Versão da escala"><button class="${S.f.version === 'vigente' ? 'on' : ''}" data-act="setF" data-k="version" data-v="vigente">Vigente</button><button class="${S.f.version === 'original' ? 'on' : ''}" data-act="setF" data-k="version" data-v="original">Original</button></div>`; }
function viewToggle() { return `<div class="seg" role="group" aria-label="Visualização"><button class="${S.f.view === 'tabela' ? 'on' : ''}" data-act="setF" data-k="view" data-v="tabela">Tabela</button><button class="${S.f.view === 'calendario' ? 'on' : ''}" data-act="setF" data-k="view" data-v="calendario">Calendário</button></div>`; }
PAGES.escala = () => masterEscala();
function masterEscala() {
  const rows = shiftsFiltered(), alt = rows.filter(changed).length;
  const filters = `<div class="filters">${monthSelect()}${sectorSelect()}<input data-f="doctor" type="search" placeholder="Buscar médico" value="${esc(S.f.doctor)}" aria-label="Buscar médico">${versionToggle()}${viewToggle()}<label class="chk"><input type="checkbox" data-f="onlyChanged" ${S.f.onlyChanged ? 'checked' : ''}> Só alterados</label></div>`;
  const verNote = S.f.version === 'original' ? `<div class="callout info">Mostrando a <b>escala original</b> (a versão salva) (como foi divulgada, antes das trocas). ${alt} plantão(ões) desta seleção mudaram depois.</div>` : (alt ? `<div class="callout">Mostrando a <b>escala vigente</b>. ${alt} plantão(ões) desta seleção foram alterados após a publicação (marcados com ⇆).</div>` : '');
  return header('Escala', `${esc(fmtMonth(S.f.month))} · ${rows.length.toLocaleString('pt-BR')} lançamentos`, `<button class="btn" data-act="exportEscala">Exportar ${S.f.version}</button>`) + filters + verNote + (S.f.view === 'calendario' ? calendar(rows) : shiftTable(rows, 'escala'));
}
function shiftTable(rows, key) {
  const p = pager(key, rows.length);
  return `<div class="table-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Horário</th><th>Setor · local</th><th>Tipo</th><th>Médico (${S.f.version === 'original' ? 'original' : 'vigente'})</th><th></th></tr></thead><tbody>
  ${rows.slice(p.from, p.to).map(s => `<tr class="${changed(s) ? 'changed' : ''} ${s.status === 'conflito' ? 'conflict' : ''}" data-act="shift" data-id="${s.id}"><td>${wday(s.starts_at)} ${fmtDs(s.starts_at)}</td><td>${fmtH(s.starts_at)}–${fmtH(s.ends_at)}</td><td>${esc(secName(s.sector_id))}<div class="muted small">${esc(s.local || '')}</div></td><td>${TYPE_ICON[s.type] || ''} ${esc(s.type)}</td>
   <td>${shiftLabelHtml(s, who(s))}${s.match_conf && !['alta', 'manual', 'copia'].includes(s.match_conf) && who(s) ? ` ${tag('⚠ ' + (CONF[s.match_conf]?.[0] || s.match_conf), 'orange', 'Texto na escala: ' + (s.source_text || ''))}` : ''}${changed(s) ? `<div class="diff-mini">⇆ ${S.f.version === 'original' ? 'Agora: ' + esc(shiftName(s, s.doctor_id)) : 'Antes: ' + esc(shiftName(s, s.original_doctor_id))}</div>` : ''}</td>
   <td>${s.status === 'conflito' ? tag('duplicidade na escala', 'red') : ''}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">Nenhum plantão para os filtros.</td></tr>`}</tbody></table></div>${p.html}`;
}
function calendar(rows) {
  if (!S.f.sector) return `<div class="callout info">Escolha um setor para ver o calendário (o mês inteiro do hospital tem ${rows.length} lançamentos; use a tabela para todos os setores).</div>`;
  const [y, mo] = S.f.month.split('-').map(Number), first = new Date(Date.UTC(y, mo - 1, 1)), days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const by = rows.reduce((m, s) => ((m[s._day] = m[s._day] || []).push(s), m), {});
  let cells = '';
  for (let i = 0; i < first.getUTCDay(); i++) cells += '<div class="cal-cell off"></div>';
  for (let dd = 1; dd <= days; dd++) {
    const k = `${S.f.month}-${String(dd).padStart(2, '0')}`, list = by[k] || [];
    cells += `<div class="cal-cell"><div class="cal-day">${dd}</div>${list.map(s => `<button class="cal-item ${s.type === 'Sobreaviso' ? 'sa' : ''} ${changed(s) ? 'changed' : ''}" data-act="shift" data-id="${s.id}" title="${esc(s.local || '')}">${fmtH(s.starts_at)} ${esc(shiftName(s, who(s)).split(' ').slice(0, 2).join(' '))}${!s.doctor_id ? ' · fora' : ''}${changed(s) ? ' ⇆' : ''}</button>`).join('')}</div>`;
  }
  return `<div class="cal"><div class="cal-head">${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(x => `<div>${x}</div>`).join('')}</div><div class="cal-grid">${cells}</div></div><p class="muted small">⇆ = plantão alterado depois da publicação. Clique para ver o histórico.</p>`;
}
function shiftDetails(id) {
  const s = shiftById(id); if (!s) return;
  const h = IDX.hist[s.id] || [];
  const sw = S.data.swaps.filter(x => x.shift_from_id === s.id || x.shift_to_id === s.id);
  const canSwap = !isMaster() && s.doctor_id === S.me.doctor_id && ms(s.starts_at) > nowMs() && s.status === 'active';
  modal('Plantão', `<div class="kv"><div><span>Data</span><b>${wday(s.starts_at)} ${fmtD(s.starts_at)}</b></div><div><span>Horário</span><b>${fmtH(s.starts_at)}–${fmtH(s.ends_at)}</b></div><div><span>Setor</span><b>${esc(secName(s.sector_id))}</b></div><div><span>Local na escala</span><b>${esc(s.local || '—')}</b></div><div><span>Tipo</span><b>${esc(s.type)}</b></div>
   <div><span>Escala original</span><b>${docLabel(s.original_doctor_id, { mat: 1 })}</b></div><div><span>Responsável vigente</span><b class="${changed(s) ? 'hl' : ''}">${docLabel(s.doctor_id, { mat: 1 })}</b></div>
   ${s.match_conf && !['alta', 'manual'].includes(s.match_conf) ? `<div class="span2"><span>Leitura do nome no PDF</span><b>⚠ ${esc(CONF[s.match_conf]?.[0] || s.match_conf)} — texto: “${esc(s.source_text || '')}”</b></div>` : ''}</div>
   ${h.length || sw.length ? `<h3>Histórico</h3><ul class="timeline">${h.map(x => `<li><b>${fmtDH(x.changed_at)}</b> · ${esc(docName(x.from))} → ${esc(docName(x.to))} <span class="muted">(${esc({ troca: 'troca', whatsapp: 'troca do WhatsApp', edicao_master: 'edição do MASTER' }[x.motivo] || x.motivo)}${x.changed_by_name ? ' · ' + esc(x.changed_by_name) : ''})</span></li>`).join('')}
     ${sw.filter(x => x.status !== 'completed').map(x => `<li>${fmtDH(x.created_at)} · proposta ${esc(docName(x.requester_id))} → ${esc(docName(x.target_id))} ${swapTag(x.status)}</li>`).join('')}</ul>` : '<p class="muted">Sem alterações desde a publicação.</p>'}
   <div class="form-actions">${isMaster() ? `<button class="btn" data-act="editShift" data-id="${s.id}">Alterar responsável</button>` : ''}${canSwap ? `<button class="btn primary" data-act="openSwap" data-id="${s.id}">Solicitar troca</button>` : ''}<button class="btn" data-act="closeModal">Fechar</button></div>`, { noFocus: true });
}
function editShift(id) {
  const s = shiftById(id), cands = S.data.doctors.filter(d => d.active !== false && d.sector_ids.includes(s.sector_id) && d.id !== s.doctor_id).sort((a, b) => a.name.localeCompare(b.name));
  modal('Alterar responsável', `<form id="editShiftForm"><input type="hidden" name="id" value="${s.id}"><p class="desc">${wday(s.starts_at)} ${fmtD(s.starts_at)} · ${fmtH(s.starts_at)}–${fmtH(s.ends_at)} · ${esc(secName(s.sector_id))}<br>Atual: <b>${esc(docName(s.doctor_id))}</b> · Original (não muda): ${esc(docName(s.original_doctor_id))}</p>
   <div class="field"><label>Novo responsável (habilitados no setor)</label><select name="doctor_id" required><option value="">Selecione</option>${cands.map(d => opt(d.id, d.name + (d.matricula ? ' · ' + d.matricula : ''))).join('')}</select></div>
   <div class="field"><label>Motivo *</label><input name="motivo" required maxlength="200" placeholder="Ex.: troca comunicada à coordenação"></div>
   <p class="hint">A escala original (a versão salva) é preservada; esta alteração entra no histórico e na auditoria.</p><div class="form-actions"><button type="button" class="btn" data-act="closeModal">Cancelar</button><button class="btn primary">Salvar</button></div></form>`);
}

// ───────── MASTER: original x vigente ─────────
function changeInfo(s) {
  const h = (IDX.hist[s.id] || []).slice(-1)[0];
  const sw = (h?.swap_id && IDX.swap.get(h.swap_id)) || S.data.swaps.filter(x => x.status === 'completed' && (x.shift_from_id === s.id || x.shift_to_id === s.id)).sort((a, b) => ms(b.completed_at) - ms(a.completed_at))[0];
  const origem = sw ? (sw.origin === 'whatsapp' ? 'whatsapp' : 'app') : 'manual';
  return { sw, h, origem, when: h?.changed_at || sw?.completed_at || s.changed_at, by: sw?.approved_by || (h?.motivo === 'edicao_master' ? 'MASTER (edição manual)' : h?.changed_by_name) || '—', motivo: h?.motivo_txt || '' };
}
const ORIG = { app: ['Troca no app', 'blue'], whatsapp: ['WhatsApp', 'green'], manual: ['Edição MASTER', 'orange'] };
PAGES.versoes = () => {
  const f = S.f, all = S.data.shifts.filter(s => s._month === f.month && s.status !== 'cancelled' && pubShift(s) && (!f.sector || s.sector_id === f.sector));
  const q = normTxt(f.doctor);
  const alt = all.filter(changed).map(s => ({ s, i: changeInfo(s) }));
  const cnt = { total: alt.length, app: alt.filter(x => x.i.origem === 'app').length, whatsapp: alt.filter(x => x.i.origem === 'whatsapp').length, manual: alt.filter(x => x.i.origem === 'manual').length };
  const show = f.diffAll ? all.map(s => ({ s, i: changed(s) ? changeInfo(s) : null })) : alt;
  const rows = show.filter(x => (!q || normTxt(docName(x.s.original_doctor_id) + ' ' + docName(x.s.doctor_id)).includes(q)) && (!f.origem || x.i?.origem === f.origem))
    .sort((a, b) => ms(a.s.starts_at) - ms(b.s.starts_at));
  const p = pager('versoes' + (f.diffAll ? 'all' : ''), rows.length);
  const filters = `<div class="filters">${monthSelect()}${sectorSelect()}<input data-f="doctor" type="search" placeholder="Médico (antes ou agora)" value="${esc(f.doctor)}" aria-label="Buscar médico">
    <select data-f="origem" aria-label="Origem da mudança">${opt('', 'Todas as origens', f.origem)}${opt('app', 'Troca no app', f.origem)}${opt('whatsapp', 'WhatsApp', f.origem)}${opt('manual', 'Edição do MASTER', f.origem)}</select>
    <div class="seg"><button class="${!f.diffAll ? 'on' : ''}" data-act="setF" data-k="diffAll" data-v="">Só alterados</button><button class="${f.diffAll ? 'on' : ''}" data-act="setF" data-k="diffAll" data-v="1">Lado a lado (todos)</button></div></div>`;
  const body = rows.slice(p.from, p.to).map(({ s, i }) => `<tr class="${i ? 'changed' : ''}" data-act="shift" data-id="${s.id}"><td>${wday(s.starts_at)} ${fmtDs(s.starts_at)}<div class="muted small">${fmtH(s.starts_at)}–${fmtH(s.ends_at)}</div></td><td>${esc(secName(s.sector_id))}<div class="muted small">${esc(s.local || '')} · ${esc(s.type)}</div></td>
    <td class="${i ? 'was' : ''}">${i ? '<span class="lbl">Antes</span>' : ''}${esc(shiftName(s, s.original_doctor_id))}</td><td class="arrow">${i ? '→' : '='}</td><td class="${i ? 'now' : ''}">${i ? '<span class="lbl">Agora</span>' : ''}${esc(shiftName(s, s.doctor_id))}</td>
    <td>${i ? tag(...ORIG[i.origem]) + (i.sw ? `<div class="muted small">Troca #${esc(String(i.sw.id).slice(-6))} · ${i.sw.kind === 'reciprocal' ? 'recíproca' : 'substituição'}</div>` : '') : ''}</td><td>${i ? fmtDH(i.when) : ''}</td><td>${i ? esc(i.by) : ''}</td></tr>`).join('');
  return header('Escala original x vigente', 'A escala salva fica congelada como original; cada troca ou ajuste altera só a versão vigente e fica registrado aqui.',
    `<button class="btn" data-act="exportVersao" data-v="original">Exportar original</button><button class="btn" data-act="exportVersao" data-v="vigente">Exportar vigente</button><button class="btn primary" data-act="exportVersao" data-v="comparacao">Exportar comparação</button>`) + filters +
    `<div class="kpis small">${kpi('Lançamentos no filtro', all.length)}${kpi('Alterados', cnt.total, all.length ? (100 * cnt.total / all.length).toFixed(1).replace('.', ',') + '% da escala' : '', cnt.total ? 'warn' : '')}${kpi('Por troca no app', cnt.app)}${kpi('Por WhatsApp', cnt.whatsapp)}${kpi('Edição do MASTER', cnt.manual)}</div>
    <div class="table-wrap"><table class="tbl diff"><thead><tr><th>Data</th><th>Setor · local</th><th>Escala original</th><th></th><th>Escala vigente</th><th>Referência</th><th>Data da mudança</th><th>Aprovado por</th></tr></thead><tbody>${body || `<tr><td colspan="8" class="empty">${f.diffAll ? 'Nada para os filtros.' : 'Nenhum plantão alterado nesta seleção — a escala vigente é igual à original.'}</td></tr>`}</tbody></table></div>${p.html}`;
};
function versionRows(kind) {
  const f = S.f, list = S.data.shifts.filter(s => s._month === f.month && s.status !== 'cancelled' && pubShift(s) && (!f.sector || s.sector_id === f.sector)).sort((a, b) => ms(a.starts_at) - ms(b.starts_at));
  const base = (s, docId) => ({ 'Data': fmtD(s.starts_at), 'Dia': wday(s.starts_at), 'Início': fmtH(s.starts_at), 'Fim': fmtH(s.ends_at), 'Setor': secName(s.sector_id), 'Local': s.local || '', 'Tipo': s.type, 'Médico': docId ? docName(docId) : (s.source_text || '—'), 'Matrícula': doc(docId)?.matricula || '', 'Empresa': doc(docId)?.empresa || '', 'Observação': docId ? '' : 'fora do cadastro' });
  if (kind === 'original') return list.map(s => base(s, s.original_doctor_id));
  if (kind === 'vigente') return list.map(s => ({ ...base(s, s.doctor_id), 'Alterado': changed(s) ? 'sim' : '' }));
  return list.filter(changed).map(s => { const i = changeInfo(s); return { 'Data': fmtD(s.starts_at), 'Início': fmtH(s.starts_at), 'Fim': fmtH(s.ends_at), 'Setor': secName(s.sector_id), 'Local': s.local || '', 'Tipo': s.type, 'Antes (original)': docName(s.original_doctor_id), 'Agora (vigente)': docName(s.doctor_id), 'Origem': ORIG[i.origem][0], 'Troca': i.sw ? String(i.sw.id) : '', 'Modalidade': i.sw ? (i.sw.kind === 'reciprocal' ? 'recíproca' : 'substituição') : '', 'Data da mudança': fmtDH(i.when), 'Aprovado por': i.by }; });
}
// ───────── MASTER: Escala x Ponto ─────────
function pontoRows(m) {
  const key = m + '|' + S.data.shifts.length + '|' + (S.data._ver || 0);
  if (S.ponto.cache?.key === key) return S.ponto.cache;
  if (REAL) return S.ponto.cache && S.ponto.cache.month === m ? S.ponto.cache : { key: null, rows: [], extras: [], loading: true, month: m };
  const swapNote = {};
  S.data.swaps.filter(x => x.status === 'completed').forEach(x => {
    const n = (x.origin === 'whatsapp' ? 'Troca do WhatsApp: ' : x.kind === 'reciprocal' ? 'Troca recíproca aprovada: ' : 'Troca aprovada: ') + docName(x.requester_id) + (x.kind === 'reciprocal' ? ' ⇄ ' : ' → ') + docName(x.target_id);
    [x.shift_from_id, x.shift_to_id].filter(Boolean).forEach(id => (swapNote[id] = n));
  });
  const shifts = S.data.shifts.filter(s => s._month === m && pubShift(s) && s.doctor_id && ['active', 'conflito'].includes(s.status)).map(s0 => {
    const s = typeof escShiftEffectiveTimes === 'function' ? escShiftEffectiveTimes(s0) : s0;
    return {
    id: s.id, startTs: s.starts_at, endTs: s.ends_at, doctorId: s.doctor_id, sector: secName(s.sector_id), local: s.local, type: s.type, conf: s.match_conf, texto: s.source_text,
    swapNote: swapNote[s.id] || (changed(s) ? `Responsável alterado: ${docName(s.original_doctor_id)} → ${docName(s.doctor_id)}` : '') }; });
  const [y, mo] = m.split('-').map(Number), end = Date.parse(`${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, '0')}-01T23:59:59-03:00`), start = Date.parse(m + '-01T00:00:00-03:00') - 864e5;
  const punches = S.data.punches.filter(p => { const t = ms(p.ts); return t >= start && t <= end; });
  const ids = new Set(shifts.map(s => s.doctorId));
  const r = EscalaPonto.crossCheck({ shifts, punches: punches.filter(p => ids.has(p.doctorId) || monthOf(p.ts) === m), doctors: S.data.doctors.map(d => ({ id: d.id, name: d.name, matricula: d.matricula, empresa: d.empresa || 'Empresa não informada' })), dadosAte: localToIso(S.data.dadosAte?.[m]) });
  r.extras = r.extras.filter(x => monthOf(x.ts) === m);
  S.ponto.cache = { key, rows: r.rows, extras: r.extras, month: m };
  return S.ponto.cache;
}
async function loadPontoReal(m) {
  const [rows, extras] = await Promise.all([rpc('cross_check', { p_month: m, p_tol_min: 15 }), rpc('punches_outside_schedule', { p_month: m })]);
  S.ponto.cache = { key: 'real', month: m, rows: rows.map(r => ({ key: r.block_key, shiftIds: r.shift_ids, doctorId: r.doctor_id, doctorName: r.doctor_name, matricula: r.matricula || '', empresa: r.empresa || 'Empresa não informada', sector: r.sector, local: r.local || '', type: r.type, startTs: ms(r.starts_at), endTs: ms(r.ends_at), entrada: r.entrada ? ms(r.entrada) : null, saida: r.saida ? ms(r.saida) : null, status: r.status, ocorrencias: r.ocorrencias || [], difEntrada: r.dif_entrada_min, difSaida: r.dif_saida_min, incerto: r.incerto, nota: r.nota || '', swapped: /Troca/.test(r.nota || '') })),
    extras: extras.map(x => ({ doctorId: x.doctor_id, doctorName: x.doctor_name, matricula: x.matricula, empresa: x.empresa, ts: ms(x.marcado_em) })) };
  render();
}
function pontoFiltered(rows) {
  const f = S.ponto.f;
  return rows.filter(r => (!f.empresa || r.empresa === f.empresa) && (!f.setor || r.sector.split(' / ').includes(f.setor)) && (!f.medico || normTxt(r.doctorName).includes(normTxt(f.medico)))
    && (!f.status || (f.status === 'incerto' ? r.incerto : f.status === 'troca' ? r.swapped : ['cumprido', 'sobreaviso', 'visita_sem', 'visita_ok'].includes(f.status) ? r.status === f.status : r.ocorrencias.includes(f.status))));
}
PAGES.ponto = () => {
  const m = S.f.month, c = pontoRows(m);
  if (REAL && c.loading) { loadPontoReal(m).catch(e => toast(e.message, true)); return header('Escala x Ponto', 'Carregando cruzamento…'); }
  const f = S.ponto.f, rows = pontoFiltered(c.rows), k = EscalaPonto.kpis(rows), p = pager('ponto', rows.length);
  const emp = [...new Set(c.rows.map(r => r.empresa))].sort(), secs = [...new Set(c.rows.flatMap(r => r.sector.split(' / ')))].sort();
  const ST = EscalaPonto.STATUS;
  const dados = S.data.dadosAte?.[m];
  return header('Escala x Ponto', `Escala <b>vigente</b> de ${esc(fmtMonth(m))} cruzada com o cartão ponto do Portal da Transparência. Quem assumiu o plantão por troca é quem responde por ele.${dados ? ` Ponto até ${fmtD(localToIso(dados))}.` : ''}`,
    `<button class="btn" data-act="printPonto">Imprimir / PDF</button><button class="btn primary" data-act="exportPonto">Exportar por empresa</button>`) +
  `<div class="filters">${monthSelect()}<select data-pf="empresa" aria-label="Empresa">${opt('', 'Todas as empresas', f.empresa)}${emp.map(e => opt(e, e, f.empresa)).join('')}</select>
   <select data-pf="setor" aria-label="Setor">${opt('', 'Todos os setores', f.setor)}${secs.map(e => opt(e, e, f.setor)).join('')}</select><input data-pf="medico" type="search" placeholder="Médico" value="${esc(f.medico)}" aria-label="Médico">
   <select data-pf="status" aria-label="Status">${opt('', 'Todos os status', f.status)}${[['cumprido', 'Cumprido'], ['falta', 'Falta'], ['atraso', 'Atraso'], ['saida_antecipada', 'Saída antecipada'], ['incompleto', 'Incompleto'], ['visita_sem', 'Visita sem marcação'], ['sobreaviso', 'Sobreaviso'], ['incerto', '⚠ Nome incerto na escala'], ['troca', 'Com troca']].map(([v, l]) => opt(v, l, f.status)).join('')}</select></div>
  <div class="kpis small">${kpi('Plantões', k.plantoes)}${kpi('Cumpridos', k.cumpridos, '', 'ok')}${kpi('Faltas', k.faltas, '', 'bad')}${kpi('Atrasos', k.atrasos, '', 'warn')}${kpi('Saídas antecipadas', k.saidas, '', 'warn')}${kpi('Incompletos', k.incompletos, '', 'warn')}${kpi('Visitas c/ marcação', `${k.visitasOk}/${k.visitas}`)}${kpi('Sobreavisos', k.sobreaviso, 'não cobrados')}</div>
  <div class="table-wrap"><table class="tbl ponto"><thead><tr><th>Data</th><th>Escalado</th><th>Médico</th><th>Empresa</th><th>Setor · local</th><th>Entrada</th><th>Saída</th><th>Status</th><th>Observação</th></tr></thead><tbody>
  ${rows.slice(p.from, p.to).map(r => `<tr class="${r.swapped ? 'changed' : ''}"><td>${wday(r.startTs)} ${fmtDs(r.startTs)}</td><td>${fmtH(r.startTs)}–${fmtH(r.endTs)}</td><td>${esc(r.doctorName)}<div class="muted small">${esc(r.matricula)}</div></td><td class="small">${esc(r.empresa)}</td><td>${esc(r.sector)}<div class="muted small">${esc(r.local)}</div></td>
   <td>${r.entrada ? fmtH(r.entrada) + (r.difEntrada ? `<div class="muted small">${r.difEntrada > 0 ? '+' : ''}${r.difEntrada} min</div>` : '') : '—'}</td><td>${r.saida ? fmtH(r.saida) + (fmtDs(r.saida) !== fmtDs(r.startTs) ? ` <span class="muted small">${fmtDs(r.saida)}</span>` : '') + (r.difSaida ? `<div class="muted small">${r.difSaida > 0 ? '+' : ''}${r.difSaida} min</div>` : '') : '—'}</td>
   <td>${(r.ocorrencias.length ? r.ocorrencias : [r.status]).map(o => `<span class="st ${ST[o]?.[1] || ''}">${esc(ST[o]?.[0] || o)}</span>`).join(' ')}${r.incerto ? ' <span class="st warn" title="Nome lido na escala com correspondência incerta">⚠</span>' : ''}</td><td class="small obs">${esc(r.nota || '')}${typeof evNotaHtml === 'function' ? evNotaHtml(evNotasPonto(r)) : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Nada para os filtros.</td></tr>'}</tbody></table></div>${p.html}
  <div class="card"><div class="card-head"><h2>Marcações fora da escala · ${c.extras.length}</h2><button class="btn small" data-act="toggleExtras">${S.ponto.showExtras ? 'Ocultar' : 'Mostrar'}</button></div>
  ${S.ponto.showExtras ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Médico</th><th>Empresa</th><th>Marcação</th></tr></thead><tbody>${c.extras.slice(0, 300).map(x => `<tr><td>${esc(x.doctorName)}</td><td class="small">${esc(x.empresa)}</td><td>${fmtDH(x.ts)}</td></tr>`).join('')}</tbody></table></div>${c.extras.length > 300 ? '<p class="muted small">Mostrando 300; a exportação traz todas.</p>' : ''}` : '<p class="muted small">Batidas que não caem em nenhum plantão, sobreaviso ou visita do médico.</p>'}</div>`;
};

// ───────── trocas ─────────
function swapLine(x) {
  const a = shiftById(x.shift_from_id), b = x.shift_to_id && shiftById(x.shift_to_id);
  const st = s => s ? `${wday(s.starts_at)} ${fmtDs(s.starts_at)} ${fmtH(s.starts_at)}–${fmtH(s.ends_at)} · ${esc(secName(s.sector_id))}` : 'plantão de outro mês';
  return `<div class="swap"><div class="swap-who"><b>${esc(docName(x.requester_id))}</b> ${x.kind === 'reciprocal' ? '⇄' : '→'} <b>${esc(docName(x.target_id))}</b></div>
  <div class="swap-what">${st(a)}${b ? `<br>em troca de ${st(b)}` : ''}</div>${x.note ? `<div class="muted small">“${esc(x.note)}”</div>` : ''}
  <div class="swap-meta">${swapTag(x.status)} ${x.origin === 'whatsapp' ? tag('WhatsApp', 'green') : ''} <span class="muted small">pedido em ${fmtDH(x.created_at)}${x.completed_at ? ' · concluída ' + fmtDH(x.completed_at) + (x.approved_by ? ' · ' + esc(x.approved_by) : '') : ''}</span></div></div>`;
}
PAGES.trocas = () => masterTrocas();
function masterTrocas() {
  const t = S.tabs.trocas || 'pend', all = S.data.swaps;
  const list = t === 'pend' ? all.filter(x => x.status === 'needs_master') : t === 'abertas' ? all.filter(x => x.status === 'pending') : all;
  return header('Trocas de plantão', `Aprovação do MASTER está <b>${S.data.settings.approval_required ? 'ligada' : 'desligada'}</b> (Configurações). Trocas concluídas alteram só a escala vigente.`) +
    tabs('trocas', [['pend', 'Aguardando MASTER', all.filter(x => x.status === 'needs_master').length], ['abertas', 'Aguardando colega', all.filter(x => x.status === 'pending').length], ['todas', 'Todas', all.length]]) +
    (list.map(x => `<div class="card row">${swapLine(x)}${x.status === 'needs_master' ? `<div class="row-actions"><button class="btn danger" data-act="approveSwap" data-id="${x.id}" data-ok="0">Recusar</button><button class="btn primary" data-act="approveSwap" data-id="${x.id}" data-ok="1">Aprovar</button></div>` : ''}</div>`).join('') || '<div class="empty">Nenhuma troca aqui.</div>');
}
function tabs(key, list) { const cur = S.tabs[key] || list[0][0]; return `<div class="tabs">${list.map(([k, l, n]) => `<button class="${cur === k ? 'on' : ''}" data-act="tab" data-key="${key}" data-v="${k}">${esc(l)}${n !== undefined ? ` <b>${n}</b>` : ''}</button>`).join('')}</div>`; }

// ───────── MASTER: WhatsApp ─────────
const WA_TAB_LABEL = { todas: 'Todas', importada: 'Prontas para aplicar', a_revisar: 'A revisar', aplicada: 'Aplicadas', descartada: 'Descartadas' };
const WA_PRINT_ST = { importada: 'Pronta para aplicar', a_revisar: 'A revisar', aplicada: 'Aplicada', descartada: 'Descartada' };
const waWhen = w => w.starts_at || w.data_plantao;
function waSafeText(s) {
  return String(s || '')
    .replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, '…')
    .replace(/(?:\+?\s*55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s.]?\d{4}/g, '…')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi, '…');
}
function waMonthsAvail() {
  return [...new Set((S.data.whatsapp || []).map(w => monthOf(waWhen(w))).filter(Boolean))].sort();
}
function waFiltered(status, mes) {
  const t = status === undefined ? (S.tabs.wa || 'todas') : status;
  const m = mes === undefined ? (S.f.waMes || '') : mes;
  return (S.data.whatsapp || []).filter(w => (t === 'todas' || w.status === t) && (!m || monthOf(waWhen(w)) === m))
    .sort((a, b) => (validMs(waWhen(a)) || 0) - (validMs(waWhen(b)) || 0));
}
function waPerson(w, side) {
  const id = w[side + '_doctor_id'];
  if (id) return docName(id);
  return waSafeText(w[side + '_texto']) || 'não identificado';
}
function waPlantaoData(w) {
  if (w.starts_at) return fmtD(w.starts_at);
  if (w.data_plantao) return String(w.data_plantao).split('-').reverse().join('/');
  return '—';
}
function trocasReportHtml() {
  const t = S.tabs.wa || 'todas';
  const mes = S.f.waMes || '';
  const list = waFiltered();
  const gerado = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date());
  const rows = list.map(w => `<tr>
      <td>${esc(waPlantaoData(w))}${w.horario ? `<div class="muted">${esc(waSafeText(w.horario))}</div>` : ''}</td>
      <td>${esc(waSafeText(w.setor_texto || '—'))}${w.especialidade ? `<div class="muted">${esc(waSafeText(w.especialidade))}</div>` : ''}</td>
      <td>${esc(waPerson(w, 'sai'))}</td>
      <td>${esc(waPerson(w, 'entra'))}</td>
      <td>${esc(WA_PRINT_ST[w.status] || w.status || '—')}</td>
      <td>${esc(waSafeText(w.observacao || '—'))}</td>
    </tr>`).join('') || '<tr><td colspan="6">Nenhuma troca neste filtro.</td></tr>';
  return `<div class="ponto-print-head">
    <p class="ponto-print-hosp">Hospital Municipal Padre Germano Lauck (HMPGL) · Foz do Iguaçu</p>
    <h1>Relatório de trocas de plantão — HMPGL</h1>
    <p>Período: ${esc(mes ? fmtMonth(mes) : 'todos os meses')} · Aba: ${esc(WA_TAB_LABEL[t] || t)}</p>
    <p>Gerado em ${esc(gerado)} (horário de Brasília)</p>
  </div>
  <p class="ponto-print-kpis"><b>Total de trocas:</b> ${list.length}</p>
  <table class="trocas-print-tbl">
    <thead><tr><th>Plantão</th><th>Setor</th><th>Sai</th><th>Entra</th><th>Status</th><th>Observação</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}
function printTrocasReport() {
  let el = document.getElementById('trocasPrint');
  if (!el) { el = document.createElement('div'); el.id = 'trocasPrint'; el.className = 'ponto-print trocas-print'; document.body.appendChild(el); }
  el.innerHTML = trocasReportHtml();
  let style = document.getElementById('trocasPrintPage');
  if (!style) { style = document.createElement('style'); style.id = 'trocasPrintPage'; document.head.appendChild(style); }
  style.textContent = '@page{size:A4 landscape;margin:10mm 8mm}';
  document.body.classList.add('printing-ponto', 'printing-trocas');
  const done = () => { document.body.classList.remove('printing-ponto', 'printing-trocas'); style.textContent = ''; };
  window.addEventListener('afterprint', done, { once: true });
  setTimeout(() => window.print(), 50);
}
PAGES.whatsapp = () => {
  const W = S.data.whatsapp || [], t = S.tabs.wa || 'todas';
  const mes = S.f.waMes || '';
  const monthsAvail = waMonthsAvail();
  const base = mes ? W.filter(w => monthOf(waWhen(w)) === mes) : W;
  const list = waFiltered();
  const cf = c => c ? tag(CONF[c]?.[0] || c, CONF[c]?.[1] || 'gray') : '';
  const actions = `<label class="wa-mes-lab">Mês <select data-f="waMes" aria-label="Mês do relatório">${opt('', 'Todos os meses', mes)}${monthsAvail.map(m => opt(m, fmtMonth(m), mes)).join('')}</select></label>
      <button class="btn" data-act="printTrocas">Imprimir relatório</button>`;
  return header('Trocas do WhatsApp', 'Histórico importado do grupo (somente leitura). Cada mensagem pode ser aplicada à escala vigente quando a escala daquele mês estiver carregada; a original não muda.', actions) +
    tabs('wa', [['todas', 'Todas', base.length], ['importada', 'Prontas para aplicar', base.filter(w => w.status === 'importada').length], ['a_revisar', 'A revisar', base.filter(w => w.status === 'a_revisar').length], ['aplicada', 'Aplicadas', base.filter(w => w.status === 'aplicada').length], ['descartada', 'Descartadas', base.filter(w => w.status === 'descartada').length]]) +
    `<div class="table-wrap"><table class="tbl"><thead><tr><th>Plantão</th><th>Setor (mensagem)</th><th>Sai</th><th>Entra</th><th>Status</th><th></th></tr></thead><tbody>${list.map(w => `<tr><td>${esc(waPlantaoData(w))}<div class="muted small">${esc(w.horario || '')}</div></td><td>${esc(w.setor_texto || '')}<div class="muted small">${esc(w.especialidade || '')}</div></td>
     <td>${esc(w.sai_texto)}<div class="small">${w.sai_doctor_id ? '→ ' + esc(docName(w.sai_doctor_id)) + ' ' + cf(w.match_sai || 'alta') : tag('não identificado', 'red')}</div></td><td>${esc(w.entra_texto)}<div class="small">${w.entra_doctor_id ? '→ ' + esc(docName(w.entra_doctor_id)) + ' ' + cf(w.match_entra || 'alta') : tag('não identificado', 'red')}</div></td>
     <td>${tag(...({ importada: ['Pronta', 'blue'], a_revisar: ['A revisar', 'orange'], aplicada: ['Aplicada', 'green'], descartada: ['Descartada', 'gray'] }[w.status] || [w.status || '—', 'gray']))}${w.observacao ? `<div class="muted small">${esc(w.observacao)}</div>` : ''}</td>
     <td class="nowrap">${['importada', 'a_revisar'].includes(w.status) ? `<button class="btn small" data-act="waFix" data-id="${w.id}">Revisar</button> <button class="btn small primary" data-act="waApply" data-id="${w.id}" ${w.sai_doctor_id && w.entra_doctor_id ? '' : 'disabled'}>Aplicar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nada aqui.</td></tr>'}</tbody></table></div>
    <p class="muted small">As mensagens importadas são de ${monthsAvail.map(fmtMonth).join(', ') || '—'}${mes ? ` · filtro: ${fmtMonth(mes)}` : ''}. Aplicar procura o plantão do médico que sai, no mesmo dia e horário, na escala carregada.</p>`;
};
function waFix(id) {
  const w = S.data.whatsapp.find(x => String(x.id) === String(id)), ds = S.data.doctors.slice().sort((a, b) => a.name.localeCompare(b.name));
  const sel = (n, v) => `<select name="${n}"><option value="">— não identificado —</option>${ds.map(d => opt(d.id, d.name + ' · ' + (d.matricula || ''), v)).join('')}</select>`;
  modal('Revisar troca do WhatsApp', `<div class="quote">${esc(w.texto_original || '')}</div><form id="waForm"><input type="hidden" name="id" value="${w.id}"><div class="form-grid"><div class="field"><label>Sai: “${esc(w.sai_texto)}”</label>${sel('sai', w.sai_doctor_id)}</div><div class="field"><label>Entra: “${esc(w.entra_texto)}”</label>${sel('entra', w.entra_doctor_id)}</div></div>
   <div class="form-actions"><button type="button" class="btn danger" data-act="waDiscard" data-id="${w.id}">Descartar</button><button class="btn primary">Salvar revisão</button></div></form>`, { wide: true });
}

// ───────── MASTER: cadastros ─────────
PAGES.cadastros = () => {
  const R = S.data.requests, t = S.tabs.cad || 'pend';
  const pend = R.filter(r => r.status === 'pending');
  let body = '';
  if (t === 'pend') body = pend.map(reqCard).join('') || '<div class="empty">Nenhum cadastro pendente.</div>';
  if (t === 'dec') body = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Quando</th><th>Médico</th><th>E-mail da conta</th><th>Tipo</th><th>Decisão</th></tr></thead><tbody>${R.filter(r => r.status !== 'pending').map(r => `<tr><td>${fmtDH(r.decided_at || r.created_at)}</td><td>${esc(r.name)}<div class="muted small">${esc(r.matricula || '')}</div></td><td>${esc(r.email)}</td><td>${esc(TIPO[r.tipo] || r.tipo)}</td><td>${tag(...({ approved: ['Aprovado', 'green'], rejected: ['Recusado', 'red'], cancelled: ['Cancelado', 'gray'] }[r.status] || [r.status]))}<div class="muted small">${esc(r.decision_note || '')}</div></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nada ainda.</td></tr>'}</tbody></table></div>`;
  if (t === 'contas') { const A = S.data.accounts.filter(a => a.role === 'doctor'); body = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Médico</th><th>Matrícula</th><th>E-mail da conta</th><th>Vinculada em</th><th></th></tr></thead><tbody>${A.map(a => `<tr><td>${esc(docName(a.doctor_id))}</td><td>${esc(doc(a.doctor_id)?.matricula || '')}</td><td>${esc(a.email || '')}</td><td>${fmtDH(a.bound_at)}<div class="muted small">${esc(a.bound_via || '')}</div></td><td><button class="btn small danger" data-act="unbind" data-id="${a.doctor_id}">Desfazer vínculo</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nenhuma conta vinculada.</td></tr>'}</tbody></table></div><p class="muted small">Uma conta (e-mail e senha) por matrícula. O médico entra com matrícula + senha e recupera a senha pelo e-mail cadastrado. Desfazer o vínculo é a única forma de trocar o e-mail da conta (ele refaz o primeiro acesso por matrícula).</p>`; }
  if (t === 'conv') body = `<div class="card"><div class="card-head"><h2>Gerar link de convite</h2></div><form id="inviteForm" class="form-grid"><div class="field"><label>Médico (sem conta)</label><select name="doctor_id" required><option value="">Selecione</option>${S.data.doctors.filter(d => !hasAccount(d.id)).sort((a, b) => a.name.localeCompare(b.name)).map(d => opt(d.id, d.name + ' · ' + (d.matricula || 's/ matrícula'))).join('')}</select></div><div class="field"><label>Restringir a um e-mail (opcional)</label><input name="email" type="email" placeholder="nome@exemplo.com"></div><div class="field span2"><button class="btn primary">Gerar link</button> <span class="hint">O app não envia e-mail: copie o link e mande por onde preferir. Validade: 14 dias, uso único. Quem entra por convite já fica liberado.</span></div></form></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Criado</th><th>Médico</th><th>E-mail</th><th>Situação</th><th>Link</th></tr></thead><tbody>${S.data.invites.map(i => `<tr><td>${fmtDH(i.created_at)}</td><td>${esc(docName(i.doctor_id))}</td><td>${esc(i.email || 'qualquer')}</td><td>${i.used_at ? tag('Usado', 'green') : i.revoked ? tag('Revogado', 'gray') : Date.parse(i.expires_at) < Date.now() ? tag('Expirado', 'gray') : tag('Ativo', 'blue')}</td><td>${!i.used_at && !i.revoked ? `<input class="link-box" readonly value="${esc(inviteUrl(i.token))}" aria-label="Link do convite"> <button class="btn small" data-act="copyInvite" data-token="${i.token}">Copiar</button> <button class="btn small danger" data-act="revokeInvite" data-id="${i.id}">Revogar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nenhum convite.</td></tr>'}</tbody></table></div>`;
  return header('Cadastros pendentes', `O médico entra digitando a <b>matrícula</b>, confirma o <b>nome</b> e cria uma <b>senha</b> (o e-mail é pedido só no primeiro acesso, para recuperar a senha). Depois entra com matrícula + senha. ${S.data.settings.first_access_approval !== false ? 'O primeiro acesso fica aqui até você aprovar' : 'Aprovação do primeiro acesso desligada: o vínculo é automático'} (Configurações).`) +
    tabs('cad', [['pend', 'Pendentes', pend.length], ['dec', 'Decididos'], ['contas', 'Contas vinculadas', S.data.accounts.filter(a => a.role === 'doctor').length], ['conv', 'Convites']]) + body;
};
const TIPO = { primeiro_acesso: 'Primeiro acesso (matrícula)', cadastro_novo: 'Cadastro novo', convite: 'Convite' };
const inviteUrl = tok => location.origin + location.pathname + '#convite=' + tok;
function reqCard(r) {
  const d = r.suggested_doctor_id && doc(r.suggested_doctor_id), first = r.tipo === 'primeiro_acesso';
  const free = S.data.doctors.filter(x => !hasAccount(x.id)).sort((a, b) => a.name.localeCompare(b.name));
  const secs = new Set(r.sector_ids?.length ? r.sector_ids : d?.sector_ids || []);
  return `<form class="card req" data-req="${r.id}"><div class="req-head"><div class="avatar">${esc(initials(r.name))}</div><div><h3>${esc(r.name)}</h3><div class="muted small">${tag(TIPO[r.tipo] || r.tipo, first ? 'blue' : 'orange')} ${r.exemplo ? tag('exemplo da demo', 'gray') : ''} pedido em ${fmtDH(r.created_at)}</div></div></div>
  <div class="kv"><div><span>E-mail da conta</span><b>${esc(r.email)}</b></div><div><span>Matrícula informada</span><b>${esc(r.matricula || '—')}</b></div><div><span>Empresa</span><b>${esc(r.empresa || d?.empresa || '—')}</b></div>${r.crm ? `<div><span>CRM</span><b>${esc(r.crm)}</b></div>` : ''}${r.specialty ? `<div><span>Especialidade</span><b>${esc(r.specialty)}</b></div>` : ''}${r.phone ? `<div><span>Telefone</span><b>${esc(r.phone)}</b></div>` : ''}</div>
  ${first ? `<div class="match ok">✓ Matrícula <b>${esc(d?.matricula)}</b> = <b>${esc(d?.name)}</b> no cadastro do colaborador da FMS${d?.admissao ? ` (admissão ${fmtD(d.admissao + 'T12:00:00-03:00')})` : ''}. O médico confirmou o próprio nome antes de criar a senha.</div><input type="hidden" name="doctor_id" value="${d?.id}">`
    : `<div class="field"><label>Vincular a</label><select name="doctor_id">${opt('', '➕ Criar novo médico com os dados do pedido', r.suggested_doctor_id || '')}${free.map(x => opt(x.id, x.name + ' · ' + (x.matricula || 's/ matr.') + (x.id === r.suggested_doctor_id ? ' (sugerido)' : ''), r.suggested_doctor_id || '')).join('')}</select></div>`}
  <div class="field"><label>Habilitações (setores em que pode assumir plantões)</label><div class="checks">${S.data.sectors.slice().sort((a, b) => a.name.localeCompare(b.name)).map(s => `<label><input type="checkbox" name="sector" value="${s.id}" ${secs.has(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}</div></div>
  <div class="field"><label>Observação (vai para o médico se recusar)</label><input name="note" maxlength="300"></div>
  <div class="form-actions"><button type="button" class="btn danger" data-act="rejectReq" data-id="${r.id}">Recusar</button><button type="button" class="btn primary" data-act="approveReq" data-id="${r.id}">Aprovar acesso</button></div></form>`;
}

// ───────── MASTER: médicos ─────────
PAGES.medicos = () => {
  const f = S.tabs.medF || (S.tabs.medF = { q: '', emp: '', sec: '', conta: '' });
  const list = S.data.doctors.filter(d => (!f.q || normTxt(d.name + ' ' + (d.matricula || '') + ' ' + (d.crm || '')).includes(normTxt(f.q))) && (!f.emp || d.empresa === f.emp) && (!f.sec || d.sector_ids.includes(f.sec))
    && (!f.conta || (f.conta === 'com' ? hasAccount(d.id) : f.conta === 'sem' ? !hasAccount(d.id) : !d.cadastro_fms))).sort((a, b) => a.name.localeCompare(b.name));
  const p = pager('medicos', list.length), emps = [...new Set(S.data.doctors.map(d => d.empresa).filter(Boolean))].sort();
  return header('Médicos', `${S.data.doctors.length} médicos · fonte: Cadastro do Colaborador (FMS: matrícula, nome, admissão) + Portal da Transparência (empresa) + planilha CONTRATOS MÉDICOS (CRM, especialidade, contrato e lotes). O login é só por matrícula. Habilitações = setores em que o médico pode assumir plantões.`, `<button class="btn primary" data-act="editDoctor">Novo médico</button>`) +
  `<div class="filters"><input data-mf="q" type="search" placeholder="Nome, matrícula ou CRM" value="${esc(f.q)}" aria-label="Buscar"><select data-mf="emp" aria-label="Empresa">${opt('', 'Todas as empresas', f.emp)}${emps.map(e => opt(e, e, f.emp)).join('')}</select><select data-mf="sec" aria-label="Setor">${opt('', 'Todos os setores', f.sec)}${S.data.sectors.map(s => opt(s.id, s.name, f.sec)).join('')}</select><select data-mf="conta" aria-label="Conta">${opt('', 'Com e sem conta', f.conta)}${opt('com', 'Com conta', f.conta)}${opt('sem', 'Sem conta', f.conta)}${opt('fora', 'Fora do cadastro FMS', f.conta)}</select></div>
  <div class="table-wrap"><table class="tbl"><thead><tr><th>Médico</th><th>Matrícula</th><th>CRM/CRO</th><th>Admissão</th><th>Empresa</th><th>Habilitações</th><th>Conta</th><th></th></tr></thead><tbody>${list.slice(p.from, p.to).map(d => `<tr><td>${esc(d.name)}${d.cadastro_fms ? '' : ' ' + tag('fora do cadastro FMS', 'orange')}</td><td>${d.matricula ? esc(d.matricula) : '—'}</td><td class="small">${d.crm ? esc((d.conselho || 'CRM') + ' ' + d.crm) : '—'}</td><td>${d.admissao ? fmtD(d.admissao + 'T12:00:00-03:00') : '—'}</td><td class="small">${esc(d.empresa || '—')}</td>
   <td>${d.sector_ids.slice(0, 3).map(s => tag(secName(s), 'blue')).join(' ')}${d.sector_ids.length > 3 ? ' ' + tag('+' + (d.sector_ids.length - 3)) : ''}${!d.sector_ids.length ? '<span class="muted small">nenhuma</span>' : ''}</td><td>${hasAccount(d.id) ? tag('vinculada', 'green', IDX.account.get(d.id)?.email) : '<span class="muted small">sem conta</span>'}</td><td><button class="btn small" data-act="editDoctor" data-id="${d.id}">Editar</button></td></tr>`).join('')}</tbody></table></div>${p.html}`;
};
function editDoctor(id) {
  const d = id ? doc(id) : null, secs = new Set(d?.sector_ids || []);
  modal(d ? 'Editar médico' : 'Novo médico', `<form id="doctorForm"><input type="hidden" name="id" value="${esc(d?.id || '')}"><div class="form-grid"><div class="field span2"><label>Nome *</label><input name="name" required value="${esc(d?.name || '')}" ${d?.cadastro_fms ? 'readonly title="Nome oficial do cadastro FMS"' : ''}></div>
   <div class="field"><label>Matrícula</label><input name="matricula" inputmode="numeric" value="${esc(d?.matricula || '')}" ${d?.cadastro_fms ? 'readonly' : ''}></div><div class="field"><label>Empresa</label><input name="empresa" value="${esc(d?.empresa || '')}"></div>
   <div class="field"><label>${esc(d?.conselho || 'CRM')}</label><input name="crm" value="${esc(d?.crm || '')}"></div><div class="field"><label>Especialidade</label><input name="specialty" value="${esc(d?.specialty || '')}"></div>
   ${d && (IDX.ctrByDoc || {})[d.id] ? `<div class="field span2"><label>Contrato(s) e setores do contrato</label><div class="ctr-box">${doctorContractsHtml(d)}<p class="hint">Acesso: ${esc(loginTxt(d))}. Habilitações = setores dos lotes do contrato + setores em que já aparece na escala (coordenação não habilita plantão).</p></div></div>` : ''}
   <div class="field span2"><label>Habilitações</label><div class="checks">${S.data.sectors.slice().sort((a, b) => a.name.localeCompare(b.name)).map(s => `<label><input type="checkbox" name="sector" value="${s.id}" ${secs.has(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}</div></div>
   <div class="field"><label>Situação</label><select name="active">${opt('true', 'Ativo', String(d?.active !== false))}${opt('false', 'Inativo', String(d?.active !== false))}</select></div></div>
   <div class="form-actions"><button type="button" class="btn" data-act="closeModal">Cancelar</button><button class="btn primary">Salvar</button></div></form>`, { wide: true });
}

// ───────── MASTER: contratos (planilha CONTRATOS MÉDICOS) ─────────
// contrato → empresa (PJ, CNPJ) → médicos → setores (lotes). MASTER e escalista veem (RLS v4.1). Sem CPF/telefone/e-mail da planilha.
const AVISO_DIAS = 60; // igual ao modelo CONTRATOS MÉDICOS (Situação “A vencer (≤60 dias)”)
function ctrStatus(c) {
  if (!c.fim) return { k: 'sem', txt: 'sem vigência', color: 'gray', dias: null };
  const dias = Math.round((Date.parse(c.fim + 'T23:59:59-03:00') - nowMs()) / 864e5);
  if (dias < 0) return { k: 'vencido', txt: `vencido há ${-dias} dia${dias === -1 ? '' : 's'}`, color: 'red', dias };
  if (dias <= AVISO_DIAS) return { k: 'vencendo', txt: `vence em ${dias} dia${dias === 1 ? '' : 's'}`, color: 'orange', dias };
  return { k: 'vigente', txt: 'vigente', color: 'green', dias };
}
const fmtDia = d => d ? d.split('-').reverse().join('/') : '—';
const loginTxt = d => d.matricula ? `matr. ${d.matricula}` : 'sem matrícula (sem login)';
function ctrSetores(x) {
  return x.lotes.map(l => tag(secName(l.sector_id) + (l.coordenacao ? ' · coordenação' : ''), l.coordenacao ? 'gray' : 'blue', l.lote)).join(' ') || '<span class="muted small">sem lote</span>';
}
// PAGES.contratos: ver 06g_contratos.js (v4.1: áreas, médicos sem contrato, importar modelo)
function doctorContractsHtml(d) {
  const L = (IDX.ctrByDoc || {})[d.id] || [];
  if (!L.length) return '<p class="muted small">Sem contrato na planilha CONTRATOS MÉDICOS.</p>';
  return L.map(x => { const c = IDX.ctr.get(x.contract_id) || {}, s = ctrStatus(c);
    return `<div class="ctr-mini"><div><b>Contrato ${esc(c.numero || 's/ nº')}</b> · ${esc(c.razao_social || '')} ${tag(s.txt, s.color)}</div><div class="muted small">CNPJ ${esc(c.cnpj || '—')} · vigência ${fmtDia(c.inicio)} → ${fmtDia(x.fim || c.fim)}</div><div>${ctrSetores(x)}</div></div>`; }).join('');
}

// ───────── MASTER: auditoria e configurações ─────────
PAGES.auditoria = () => {
  const A = S.data.audit, p = pager('audit', A.length);
  return header('Auditoria', 'Registro de todas as ações (somente inclusão; ninguém edita ou apaga). Mudanças de responsável também ficam no histórico de cada plantão.') +
    `<div class="table-wrap"><table class="tbl"><thead><tr><th>Quando</th><th>Quem</th><th>Operação</th><th>Descrição</th></tr></thead><tbody>${A.slice(p.from, p.to).map(a => `<tr><td class="nowrap">${fmtDH(a.created_at)}</td><td>${esc(a.actor)}</td><td><code>${esc(a.operation)}</code></td><td>${esc(a.description || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Sem registros ainda.</td></tr>'}</tbody></table></div>${p.html}`;
};
PAGES.config = () => {
  const st = S.data.settings;
  return header('Configurações', '') + `<div class="card"><label class="switch-row"><input type="checkbox" data-act="setting" data-k="first_access_approval" ${st.first_access_approval === true ? 'checked' : ''}><span><b>Aprovação do MASTER no primeiro acesso</b><small>Ligado: quando o médico faz matrícula → nome → e-mail e senha pela primeira vez, o vínculo fica pendente em “Cadastros pendentes”. Desligado (padrão): o médico entra direto ao criar a senha (continua uma conta por matrícula).</small></span></label>
   <label class="switch-row"><input type="checkbox" data-act="setting" data-k="approval_required" ${st.approval_required ? 'checked' : ''}><span><b>Trocas exigem aprovação do MASTER</b><small>Desligado: a troca vale quando o colega aceita. Ligado: depois do aceite, aguarda o MASTER.</small></span></label></div>
   <div class="card"><h2>Fontes dos dados</h2><ul class="plain">${Object.entries(S.data.fonte || {}).map(([m, t]) => `<li><b>${esc(fmtMonth(m))}</b>: ${esc(t)}</li>`).join('')}<li><b>Médicos</b>: Cadastro do Colaborador da FMS (matrícula, nome, admissão — sem CPF) + Portal da Transparência (empresa).</li><li><b>Trocas do WhatsApp</b>: mensagens do grupo de trocas, importadas como histórico.</li></ul>
   ${REAL ? '' : '<button class="btn danger" data-act="demoReset">Restaurar demonstração (apaga o que foi feito neste navegador)</button>'}</div>`;
};

// ───────── Relatório do mês (inconsistências Escala x Ponto, imprimível) ─────────
PAGES.relatorio = () => {
  const f = S.ponto.f;
  const so = typeof evSoAtivo === 'function' ? evSoAtivo() : !!f.soEventos;
  const m = f.todosMeses ? '__todos__' : S.f.month;
  const evs = typeof evList === 'function' ? evList(m, f) : [];
  const nEv = evs.length, nRev = evs.filter(e => e.status_vinculo !== 'vinculado').length;
  const mesTxt = typeof evMesLabel === 'function' ? evMesLabel(m, f) : fmtMonth(S.f.month);
  if (!so) {
    const c = pontoRows(S.f.month);
    if (REAL && c.loading) { loadPontoReal(S.f.month).catch(e => toast(e.message, true)); return header('Relatório do mês', 'Carregando cruzamento…'); }
    const emp = [...new Set(c.rows.map(r => r.empresa))].sort(), secs = [...new Set([...c.rows.flatMap(r => r.sector.split(' / ')), ...(typeof evUnidades === 'function' ? evUnidades() : [])])].sort();
    return header('Relatório do mês', `Inconsistências do cartão ponto com a escala vigente de ${esc(fmtMonth(S.f.month))} (já com as trocas) e eventos adversos dos memorandos.${nEv ? ' ' + nEv + ' evento(s) adverso(s) neste mês.' : ''}`,
      `<button class="btn primary" data-act="printPonto">Imprimir / PDF</button>`) +
    `<div class="filters">${typeof monthSelectRelatorio === 'function' ? monthSelectRelatorio() : monthSelect()}<select data-pf="empresa" aria-label="Empresa">${opt('', 'Todas as empresas', f.empresa)}${emp.map(e => opt(e, e, f.empresa)).join('')}</select>
     <select data-pf="setor" aria-label="Setor">${opt('', 'Todos os setores', f.setor)}${secs.map(e => opt(e, e, f.setor)).join('')}</select>
     <label class="ev-so-tog"><input type="checkbox" data-rf="soEventos" ${f.soEventos ? 'checked' : ''}><span>Só eventos adversos${nEv ? ` <b>${nEv}</b>` : ''}</span></label></div>
    <div class="card rel-preview">${pontoReportHtml(S.f.month, c, { tela: true })}</div>`;
  }
  const uns = typeof evUnidades === 'function' ? evUnidades(typeof evList === 'function' ? evList(m, { ...f, setor: '' }) : evs) : [];
  return header('Relatório do mês', `Eventos adversos dos memorandos · ${esc(mesTxt)}. ${nEv} evento(s)${nRev ? `, ${nRev} a revisar` : ''}.`,
    `<button class="btn primary" data-act="printPonto">Imprimir / PDF</button>`) +
  `<div class="filters">${typeof monthSelectRelatorio === 'function' ? monthSelectRelatorio() : monthSelect()}<select data-pf="empresa" aria-label="Empresa">${opt('', 'Todas as empresas', f.empresa)}</select>
   <select data-pf="setor" aria-label="Setor">${opt('', 'Todas as unidades', f.setor)}${uns.map(e => opt(e, e, f.setor)).join('')}</select>
   <label class="ev-so-tog on"><input type="checkbox" data-rf="soEventos" checked><span>Só eventos adversos${nEv ? ` <b>${nEv}</b>` : ''}</span></label></div>
  <div class="card rel-preview ev-so-preview">${typeof evSoReportHtml === 'function' ? evSoReportHtml(m, f, { tela: true }) : ''}</div>`;
};
// ───────── MÉDICO: tela única de troca (Área do profissional) ─────────
// Pedidos recebidos → nova troca (setor → quem troca → mês/dia/horário → quem assume → enviar) → pedidos recentes.
const isFutureShift = s => ms(s.starts_at) > nowMs();
const canRequestForOthers = () => isMaster() || S.me?.kind === 'escalista';
function myShifts(future = true) { return S.data.shifts.filter(s => s.doctor_id === S.me.doctor_id && s.status !== 'cancelled' && pubShift(s) && (future ? isFutureShift(s) : !isFutureShift(s))).sort((a, b) => ms(a.starts_at) - ms(b.starts_at)); }
const openSwapFor = s => S.data.swaps.find(x => ['pending', 'needs_master'].includes(x.status) && (x.shift_from_id === s.id || x.shift_to_id === s.id));
const swappable = (docId) => S.data.shifts.filter(s => s.doctor_id === docId && s.status === 'active' && pubShift(s) && isFutureShift(s) && !openSwapFor(s)).sort((a, b) => ms(a.starts_at) - ms(b.starts_at));
const shiftLabel = s => `${wday(s.starts_at)} ${fmtDs(s.starts_at)} · ${fmtH(s.starts_at)}–${fmtH(s.ends_at)}${s.type !== 'Plantão' ? ' · ' + s.type : ''}${s.local ? ' · ' + s.local : ''}`;
const horaLabel = s => `${fmtH(s.starts_at)}–${fmtH(s.ends_at)}${s.type !== 'Plantão' ? ' · ' + s.type : ''}${s.local ? ' · ' + s.local : ''}${s.escala_id && typeof escEscalaName === 'function' && escEscalaName(s.escala_id) ? ' · ' + escEscalaName(s.escala_id) : ''}`;
const whereTxt = s => { const sec = secName(s.sector_id); return s.local && normTxt(s.local).startsWith(normTxt(sec)) ? s.local : sec + (s.local ? ' · ' + s.local : ''); };
function isUnidadeSetor(name) {
  return /uti|pronto socorro|trauma|\bsvo\b|melhor em casa|radiolog|coordenacao medica|nir|auditoria medica|\bexames\b|ecocardiograma|nutricao|pequenas cirurgias|^teste$/.test(escNormName(name));
}
function wiz() { return (S.w = S.w || { sector: '', doctor: '', month: '', day: '', shift: '', target: '', note: '', cands: {} }); }
function wizSet(k, v) {
  const w = wiz(); w[k] = v;
  if (k === 'sector') { w.doctor = canRequestForOthers() ? '' : (S.me.doctor_id || ''); w.month = ''; w.day = ''; w.shift = ''; w.target = ''; }
  if (k === 'doctor') { w.month = ''; w.day = ''; w.shift = ''; w.target = ''; }
  if (k === 'month') { w.day = ''; w.shift = ''; w.target = ''; }
  if (k === 'day') { w.shift = ''; w.target = ''; }
  if (k === 'shift') w.target = '';
}
function demoCandidates(s) {
  const busy = (id) => {
    if (typeof escConflictsFor === 'function') return escConflictsFor(id, s.starts_at, s.ends_at, x => x.id === s.id).length > 0;
    return S.data.shifts.some(x => x.doctor_id === id && x.status === 'active' && overlap(x, s) && x.id !== s.id);
  };
  return S.data.doctors.filter(d => d.id !== s.doctor_id && d.active !== false && hasAccount(d.id) && (d.sector_ids || []).includes(s.sector_id) && !busy(d.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
async function loadCandidates(shiftId) { // modo real: função swap_candidates (RLS não mostra quem tem conta)
  const w = wiz(); if (!shiftId || w.cands[shiftId]) return;
  try { w.cands[shiftId] = REAL ? await rpc('swap_candidates', { p_shift: shiftId }) : demoCandidates(shiftById(shiftId)); }
  catch (e) { w.cands[shiftId] = []; throw e; }
}
function docTop() {
  const d = myDoc();
  return `<div class="doc-brand"><span class="doc-symbol">+</span>EscalaMed</div><div class="doc-who"><span class="doc-name">${esc(d?.name || '')}</span><button class="btn small" data-act="logout">Sair</button></div>`;
}
function trocaMonthOptions() {
  const cur = monthOf(nowMs());
  return months().filter(m => m >= cur);
}
PAGES.troca = () => {
  const w = wiz(), staff = canRequestForOthers(), me = S.me.doctor_id;
  if (!staff && me && !w.doctor) w.doctor = me;
  const curMonth = monthOf(nowMs());
  const allFuture = S.data.shifts.filter(s => s.status === 'active' && pubShift(s) && isFutureShift(s) && !openSwapFor(s));
  // 1. setor: médico vê só onde tem plantão futuro; escalista/MASTER vê setores com escala futura
  const pool = staff ? allFuture : allFuture.filter(s => s.doctor_id === me);
  const secIds = [...new Set(pool.map(s => s.sector_id))].sort((a, b) => secName(a).localeCompare(secName(b), 'pt-BR'));
  const espec = secIds.filter(id => !isUnidadeSetor(secName(id)));
  const unids = secIds.filter(id => isUnidadeSetor(secName(id)));
  if (secIds.length === 1 && !w.sector) w.sector = secIds[0];
  const grp = (label, ids) => ids.length ? `<optgroup label="${esc(label)}">${ids.map(id => opt(id, secName(id), w.sector)).join('')}</optgroup>` : '';
  const sectorOpts = (espec.length && unids.length) ? (grp('Especialidades', espec) + grp('Setores', unids)) : secIds.map(id => opt(id, secName(id), w.sector)).join('');

  // 2. quem está trocando
  const habDocs = w.sector ? [...new Set(allFuture.filter(s => s.sector_id === w.sector).map(s => s.doctor_id))]
    .map(id => S.data.doctors.find(d => d.id === id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) : [];
  if (staff && habDocs.length === 1 && !w.doctor) w.doctor = habDocs[0].id;
  if (!staff) w.doctor = me || '';
  const trocador = w.doctor;
  const escalasSetor = w.sector && typeof escEscalasOf === 'function' ? escEscalasOf(w.sector).filter(e => (staff ? allFuture : allFuture.filter(s => s.doctor_id === (staff ? trocador : me))).some(s => s.sector_id === w.sector && s.escala_id === e.id)) : [];
  if (escalasSetor.length === 1 && !w.escala) w.escala = escalasSetor[0].id;
  if (w.escala && escalasSetor.length && !escalasSetor.some(e => e.id === w.escala)) { w.escala = ''; w.day = ''; w.shift = ''; }
  const mine = trocador && w.sector ? swappable(trocador).filter(s => s.sector_id === w.sector && (!w.escala || s.escala_id === w.escala || (!s.escala_id && escalasSetor.length <= 1))) : [];

  // 3. mês / dia / horário (só meses atuais e futuros; horários reais da escala daquele dia)
  const mesOk = trocaMonthOptions();
  const monthsAvail = [...new Set(mine.map(s => monthOf(s.starts_at)))].filter(m => mesOk.includes(m)).sort();
  if (monthsAvail.length === 1 && !w.month) w.month = monthsAvail[0];
  if (w.month && !monthsAvail.includes(w.month)) { w.month = ''; w.day = ''; w.shift = ''; }
  const daysAvail = mine.filter(s => monthOf(s.starts_at) === w.month).map(s => +dayKey(s.starts_at).slice(8));
  const daysUniq = [...new Set(daysAvail)].sort((a, b) => a - b);
  if (w.day && !daysUniq.includes(+w.day)) { w.day = ''; w.shift = ''; }
  const horas = mine.filter(s => monthOf(s.starts_at) === w.month && +dayKey(s.starts_at).slice(8) === +w.day);
  if (horas.length === 1 && !w.shift) w.shift = horas[0].id;
  if (w.shift && !horas.some(s => s.id === w.shift)) w.shift = '';

  const from = w.shift && shiftById(w.shift);
  if (from && !w.cands[from.id] && !w.loading) { w.loading = true; setTimeout(() => run(async () => { try { await loadCandidates(from.id); } finally { w.loading = false; } render(); })); }
  const cands = (from && w.cands[from.id]) || null, target = w.target && cands?.find(c => c.id === w.target);
  const ready = from && target;
  const ap = S.data.settings.approval_required;
  const emptyHelp = !secIds.length
    ? (staff ? 'Não há plantões futuros salvos na escala para trocar.' : 'Você não tem plantões futuros disponíveis para troca na escala vigente.')
    : '';

  const form = `<section class="docCard" aria-label="Nova troca">
   <div class="dfield"><label for="wSector">1. Especialidade ou setor</label>
     <select id="wSector"><option value="">Selecione</option>${sectorOpts}</select>
     ${emptyHelp ? `<div class="dhelp">${emptyHelp}</div>` : '<div class="dhelp">Especialidades médicas e setores/unidades do hospital, na mesma lista.</div>'}</div>
   ${escalasSetor.length > 1 ? `<div class="dfield"><label for="wEscala">Escala</label>
     <select id="wEscala" ${w.sector ? '' : 'disabled'}><option value="">Selecione a escala</option>${escalasSetor.map(e => opt(e.id, e.name, w.escala)).join('')}</select>
     <div class="dhelp">Cada página oficial é uma escala (ex.: Pronto-Socorro, Visita, UTI 1).</div></div>` : ''}
   <div class="dfield"><label for="wDoctor">2. Quem está trocando</label>
     ${staff
       ? `<select id="wDoctor" ${w.sector ? '' : 'disabled'}><option value="">${w.sector ? 'Selecione o médico' : 'Selecione o setor primeiro'}</option>${habDocs.map(d => opt(d.id, d.name + (d.matricula ? ' · ' + d.matricula : ''), w.doctor)).join('')}</select><div class="dhelp">Só entram médicos habilitados neste setor com plantão futuro livre para troca.</div>`
       : `<div class="dstatic" id="wDoctorLabel">${esc(docName(me) || 'Você')}</div><input type="hidden" id="wDoctor" value="${esc(me || '')}">`}</div>
   <div class="dfield"><label>3. Seu plantão</label>
     <div class="dfields-3">
       <div class="dfield tight"><label for="wMonth">Mês</label>
         <select id="wMonth" ${trocador && w.sector ? '' : 'disabled'}><option value="">Mês</option>${monthsAvail.map(m => opt(m, fmtMonth(m), w.month)).join('')}</select></div>
       <div class="dfield tight"><label for="wDay">Dia</label>
         <select id="wDay" ${w.month ? '' : 'disabled'}><option value="">Dia</option>${daysUniq.map(d => opt(String(d), String(d).padStart(2, '0'), String(w.day))).join('')}</select></div>
       <div class="dfield tight"><label for="wShift">Horário</label>
         <select id="wShift" ${w.day ? '' : 'disabled'}><option value="">${w.day ? 'Horário' : 'Dia primeiro'}</option>${horas.map(s => opt(s.id, horaLabel(s), w.shift)).join('')}</select></div>
     </div>
     <div class="dhelp">Só o mês atual e os futuros. O horário é o da escala oficial daquele dia.</div></div>
   <div class="dfield"><label for="wTarget">4. Quem assume</label>
     <select id="wTarget" ${cands ? '' : 'disabled'}><option value="">${from && !cands ? 'Carregando…' : 'Selecione o colega'}</option>${(cands || []).map(c => opt(c.id, c.name + (c.empresa ? ' — ' + c.empresa : ''), w.target)).join('')}</select>
     <div class="dhelp">${cands && !cands.length ? '<span class="err">Nenhum colega habilitado neste setor tem conta e está livre neste horário.</span>' : 'Só aparecem colegas com conta, habilitados no setor e livres no horário (sem choque com outro plantão ou sobreaviso).'}</div></div>
   <div class="dfield"><label for="wNote">5. Mensagem ao colega (opcional)</label>
     <textarea id="wNote" rows="2" maxlength="500" ${target ? '' : 'disabled'}>${esc(w.note)}</textarea></div>
   <button class="btn primary docSubmit" data-act="wSubmit" ${ready ? '' : 'disabled'}>Solicitar troca</button></section>
   <div class="docNotice">O colega precisa aceitar o pedido${ap ? ' e o MASTER aprovar' : ''}. A troca muda a escala vigente; a escala original (a versão salva) continua registrada.${REAL ? '' : '<br>Demonstração com dados reais de setembro a novembro/2026 · a demo considera hoje = 01/09/2026.'}</div>`;

  const viewer = staff ? (w.doctor || me) : me;
  const all = viewer ? S.data.swaps.filter(x => x.requester_id === viewer || x.target_id === viewer) : [];
  const recv = !staff && me ? all.filter(x => x.target_id === me && x.status === 'pending') : [];
  const sent = (staff ? S.data.swaps.filter(x => !['rejected', 'cancelled'].includes(x.status)).sort((a, b) => ms(b.created_at) - ms(a.created_at)).slice(0, 8)
    : all.filter(x => !recv.includes(x)).sort((a, b) => ms(b.created_at) - ms(a.created_at)).slice(0, 6));
  const reqLine = x => { const a = shiftById(x.shift_from_id), b = x.shift_to_id && shiftById(x.shift_to_id); return `${a ? esc(shiftLabel(a)) + (a.local ? '' : ' · ' + esc(secName(a.sector_id))) : 'plantão de outro mês'}${b ? `<br>em troca de ${esc(shiftLabel(b))}` : ''}${x.note ? `<br><i>“${esc(x.note)}”</i>` : ''}`; };
  const recvHtml = recv.length ? `<section class="docRequests first" aria-label="Pedidos para você confirmar"><h2>Pedidos para você confirmar (${recv.length})</h2>${recv.map(x => `<div class="docReq recv"><div><div class="docReqName">${esc(docName(x.requester_id))} pediu ${x.kind === 'reciprocal' ? 'uma troca recíproca' : 'que você assuma o plantão'}</div><div class="docReqMeta">${reqLine(x)}</div></div><div class="docReqAct"><button class="btn small danger" data-act="respondSwap" data-id="${x.id}" data-ok="0">Recusar</button><button class="btn small primary" data-act="respondSwap" data-id="${x.id}" data-ok="1">Aceitar</button></div></div>`).join('')}</section>` : '';
  const reqs = sent.length ? `<section class="docRequests" aria-label="Seus pedidos">
   ${sent.length ? `<h2>${staff ? 'Pedidos recentes' : 'Seus pedidos recentes'}</h2>${sent.map(x => { const out = x.requester_id === (viewer || me); return `<div class="docReq"><div><div class="docReqName">${out ? 'Para ' + esc(docName(x.target_id)) : 'De ' + esc(docName(x.requester_id))}</div><div class="docReqMeta">${reqLine(x)}</div></div><div class="docReqAct">${swapTag(x.status)}${!staff && out && ['pending', 'needs_master'].includes(x.status) ? `<button class="btn small" data-act="cancelSwap" data-id="${x.id}">Cancelar</button>` : ''}</div></div>`; }).join('')}` : ''}</section>` : '';
  const sub = staff
    ? 'Filtre pelo setor, escolha quem está trocando, o plantão (mês, dia e horário) e o colega que assume.'
    : 'Escolha o plantão e o colega que vai assumir. O pedido vai para o colega confirmar.';
  return `<div class="docTopline">Área do profissional</div><h1 class="docHeading">Troca de plantão</h1><p class="docSub">${sub}</p>${recvHtml}${form}${reqs}`;
};
async function wizSubmit() {
  const w = wiz();
  await A.requestSwap(w.shift, w.target, null, w.note);
  S.w = { sector: w.sector, doctor: w.doctor, month: w.month, day: '', shift: '', target: '', note: '', cands: {} };
  render();
}
// ───────── ações (demo em memória com as mesmas regras do SQL; real via funções do Supabase) ─────────
async function done(msg) {
  if (REAL) { await realLoad(); S.ponto.cache = null; } else { S.data._ver = (S.data._ver || 0) + 1; reindex(); demoSave(); }
  if (S.w) S.w.cands = {}; // candidatos mudam depois de cada troca
  closeModal(); render(); if (msg) toast(msg);
}
const A = {};
A.requestSwap = async (from, target, to, note) => {
  if (REAL) { await rpc('request_swap', { p_shift_from: from, p_target: target, p_shift_to: to || null, p_note: note || null }); return done('Pedido enviado ao colega.'); }
  const a = shiftById(from), b = to && shiftById(to);
  const staff = typeof canRequestForOthers === 'function' && canRequestForOthers();
  if (!a || a.status !== 'active' || !isFutureShift(a) || !pubShift(a)) throw new Error('Plantão de origem inválido ou passado');
  if (!staff && a.doctor_id !== S.me.doctor_id) throw new Error('Plantão de origem inválido, passado ou não é seu');
  if (!demoCandidates(a).some(d => d.id === target)) throw new Error('Destinatário sem conta aprovada, sem habilitação neste setor ou ocupado no horário');
  if (to && (!b || b.doctor_id !== target || b.sector_id !== a.sector_id || !isFutureShift(b))) throw new Error('Plantão de contrapartida inválido');
  if (S.data.swaps.some(x => ['pending', 'needs_master'].includes(x.status) && [x.shift_from_id, x.shift_to_id].includes(from))) throw new Error('Já existe uma troca em andamento para este plantão');
  const sw = { id: rid('troca'), requester_id: a.doctor_id, target_id: target, shift_from_id: from, shift_to_id: to || null, kind: to ? 'reciprocal' : 'substitution', status: 'pending', origin: 'app', note: note || null, created_at: new Date().toISOString() };
  S.data.swaps.unshift(sw);
  notifyDoctor(target, 'Novo pedido de troca', `${docName(sw.requester_id)} pediu ${to ? 'uma troca recíproca' : 'que você assuma o plantão'} de ${fmtD(a.starts_at)} ${fmtH(a.starts_at)} (${secName(a.sector_id)}).`);
  audit('SWAP_CREATED', `${docName(sw.requester_id)} → ${docName(target)} · plantão ${fmtD(a.starts_at)} ${fmtH(a.starts_at)} ${secName(a.sector_id)}`);
  return done('Pedido enviado ao colega.');
};
function demoComplete(sw, approvedBy) {
  const a = shiftById(sw.shift_from_id), b = sw.shift_to_id && shiftById(sw.shift_to_id);
  if (a.doctor_id !== sw.requester_id || a.status !== 'active' || !isFutureShift(a)) { sw.status = 'conflict'; throw new Error('A escala mudou desde o pedido'); }
  if (!inSector(sw.target_id, a.sector_id)) throw new Error('Destinatário perdeu a habilitação no setor');
  if (b && (b.doctor_id !== sw.target_id || b.status !== 'active' || !isFutureShift(b))) throw new Error('Plantão de contrapartida não está mais disponível');
  const busy = (docId, s, skip) => s.type === 'Plantão' && S.data.shifts.some(x => x.doctor_id === docId && x.status === 'active' && x.type === 'Plantão' && !skip.includes(x.id) && overlap(x, s));
  if (busy(sw.target_id, a, [a.id, b?.id])) throw new Error('O colega tem plantão no mesmo horário');
  if (b && busy(sw.requester_id, b, [a.id, b.id])) throw new Error('Você tem plantão no horário da contrapartida');
  const t = new Date().toISOString(), by = S.me?.kind === 'master' ? 'MASTER' : docName(S.me?.doctor_id);
  const move = (s, to) => { S.data.history.push({ shift_id: s.id, from: s.doctor_id, to, swap_id: sw.id, motivo: sw.origin === 'whatsapp' ? 'whatsapp' : 'troca', changed_by_name: by, changed_at: t }); s.doctor_id = to; s.changed_at = t; };
  move(a, sw.target_id); if (b) move(b, sw.requester_id);
  Object.assign(sw, { status: 'completed', completed_at: t, approved_by: approvedBy });
  [sw.requester_id, sw.target_id].forEach(d => notifyDoctor(d, 'Troca concluída', `A escala vigente foi atualizada: ${fmtD(a.starts_at)} ${fmtH(a.starts_at)} ${secName(a.sector_id)} agora é de ${docName(sw.target_id)}.`));
  audit('SWAP_COMPLETED', `Escala vigente: ${fmtD(a.starts_at)} ${fmtH(a.starts_at)} ${secName(a.sector_id)} — ${docName(sw.requester_id)} → ${docName(sw.target_id)} (${approvedBy})`);
}
A.respondSwap = async (id, ok) => {
  if (REAL) { await rpc('respond_swap', { p_swap_id: id, p_accept: ok }); return done(ok ? 'Troca aceita.' : 'Troca recusada.'); }
  const sw = IDX.swap.get(id); if (!sw || sw.status !== 'pending' || sw.target_id !== S.me.doctor_id) throw new Error('Pedido não está mais disponível');
  sw.responded_at = new Date().toISOString();
  if (!ok) { sw.status = 'rejected'; notifyDoctor(sw.requester_id, 'Troca recusada', `${docName(sw.target_id)} recusou o pedido.`); audit('SWAP_REJECTED', `${docName(sw.target_id)} recusou troca de ${docName(sw.requester_id)}`); return done('Troca recusada.'); }
  if (S.data.settings.approval_required) { sw.status = 'needs_master'; notifyMasters('Troca aguardando aprovação', `${docName(sw.requester_id)} → ${docName(sw.target_id)}`); notifyDoctor(sw.requester_id, 'Troca aceita pelo colega', 'Agora aguarda a aprovação do MASTER.'); audit('SWAP_ACCEPTED', `${docName(sw.target_id)} aceitou; aguarda MASTER`); return done('Aceita. Agora aguarda o MASTER.'); }
  demoComplete(sw, 'Aceite do destinatário'); return done('Troca concluída. A escala vigente foi atualizada.');
};
A.approveSwap = async (id, ok) => {
  if (REAL) { await rpc('approve_swap', { p_swap_id: id, p_approve: ok }); return done(ok ? 'Troca aprovada.' : 'Troca recusada.'); }
  const sw = IDX.swap.get(id); if (!sw || sw.status !== 'needs_master') throw new Error('Troca não aguarda aprovação');
  if (!ok) { sw.status = 'rejected'; [sw.requester_id, sw.target_id].forEach(d => notifyDoctor(d, 'Troca não aprovada', 'O MASTER recusou a troca.')); audit('SWAP_REJECTED', 'MASTER recusou troca'); return done('Troca recusada.'); }
  demoComplete(sw, 'MASTER'); return done('Troca aprovada; escala vigente atualizada.');
};
A.cancelSwap = async id => {
  if (REAL) { await rpc('cancel_swap', { p_swap_id: id }); return done('Pedido cancelado.'); }
  const sw = IDX.swap.get(id); if (!sw || sw.requester_id !== S.me.doctor_id || !['pending', 'needs_master'].includes(sw.status)) throw new Error('Não é possível cancelar');
  sw.status = 'cancelled'; notifyDoctor(sw.target_id, 'Pedido de troca cancelado', `${docName(sw.requester_id)} cancelou o pedido.`); audit('SWAP_CANCELLED', 'Pedido cancelado pelo solicitante'); return done('Pedido cancelado.');
};
A.waApply = async id => {
  if (REAL) { const r = await rpc('apply_whatsapp_swap', { p_id: id }); return done(r === 'aplicada' ? 'Troca aplicada à escala vigente.' : 'Plantão correspondente não está na escala carregada (veja a observação).'); }
  const w = S.data.whatsapp.find(x => String(x.id) === String(id));
  const s = S.data.shifts.find(x => x.doctor_id === w.sai_doctor_id && x.status === 'active' && ms(x.starts_at) === ms(w.starts_at) && ms(x.ends_at) === ms(w.ends_at));
  if (!s) { w.observacao = `Plantão correspondente não encontrado na escala carregada (${fmtMonth(monthOf(w.starts_at || w.data_plantao)) || 'mês'} ainda não foi importado).`; await done(); return toast('A escala deste mês ainda não está carregada; a mensagem fica pronta para aplicar depois.', true); }
  if (!inSector(w.entra_doctor_id, s.sector_id)) doc(w.entra_doctor_id).sector_ids.push(s.sector_id);
  const t = new Date().toISOString(), sw = { id: rid('troca'), requester_id: w.sai_doctor_id, target_id: w.entra_doctor_id, shift_from_id: s.id, shift_to_id: null, kind: 'substitution', status: 'completed', origin: 'whatsapp', note: 'Importada do WhatsApp: ' + (w.texto_original || '').slice(0, 300), created_at: t, completed_at: t, approved_by: 'Importada do WhatsApp (MASTER)' };
  S.data.swaps.unshift(sw); S.data.history.push({ shift_id: s.id, from: s.doctor_id, to: w.entra_doctor_id, swap_id: sw.id, motivo: 'whatsapp', changed_by_name: 'MASTER', changed_at: t });
  s.doctor_id = w.entra_doctor_id; s.changed_at = t; Object.assign(w, { status: 'aplicada', shift_id: s.id, swap_id: sw.id });
  audit('WHATSAPP_APPLIED', `${docName(sw.requester_id)} → ${docName(sw.target_id)} em ${fmtD(s.starts_at)}`); return done('Troca do WhatsApp aplicada à escala vigente.');
};
A.waSave = async (id, sai, entra) => {
  if (REAL) { const { error } = await S.sb.from('whatsapp_swaps').update({ sai_doctor_id: sai || null, entra_doctor_id: entra || null, status: sai && entra ? 'importada' : 'a_revisar' }).eq('id', id); if (error) throw new Error(error.message); return done('Revisão salva.'); }
  const w = S.data.whatsapp.find(x => String(x.id) === String(id)); Object.assign(w, { sai_doctor_id: sai || null, entra_doctor_id: entra || null, match_sai: sai ? 'manual' : null, match_entra: entra ? 'manual' : null, status: sai && entra ? 'importada' : 'a_revisar' });
  audit('WHATSAPP_REVIEWED', `Mensagem revisada: ${w.sai_texto} → ${w.entra_texto}`); return done('Revisão salva.');
};
A.waDiscard = async id => {
  if (REAL) { const { error } = await S.sb.from('whatsapp_swaps').update({ status: 'descartada' }).eq('id', id); if (error) throw new Error(error.message); return done('Descartada.'); }
  S.data.whatsapp.find(x => String(x.id) === String(id)).status = 'descartada'; audit('WHATSAPP_DISCARDED', 'Mensagem de troca descartada'); return done('Descartada.');
};
A.approveReq = async (id, docId, sectors, note) => {
  if (REAL) { await rpc('approve_registration', { p_request_id: id, p_doctor_id: docId || null, p_sector_ids: sectors, p_note: note || null }); return done('Acesso aprovado.'); }
  const r = S.data.requests.find(x => x.id === id); if (!r || r.status !== 'pending') throw new Error('Pedido inexistente ou já decidido');
  if (r.tipo === 'primeiro_acesso' && docId !== r.suggested_doctor_id) throw new Error('Primeiro acesso: o vínculo é com a matrícula informada');
  if (!sectors.length && !(docId && doc(docId).sector_ids.length)) throw new Error('Defina ao menos uma habilitação');
  if (docId && hasAccount(docId)) throw new Error('Este médico já tem conta vinculada');
  let d = docId && doc(docId);
  if (!d) { d = { id: rid('med'), name: r.name, matricula: r.matricula || null, empresa: r.empresa || null, crm: r.crm, specialty: r.specialty, active: true, origem: 'autocadastro', cadastro_fms: false, sector_ids: [] }; S.data.doctors.push(d); reindex(); }
  sectors.forEach(s => { if (!d.sector_ids.includes(s)) d.sector_ids.push(s); });
  Object.assign(r, { status: 'approved', doctor_id: d.id, decided_at: new Date().toISOString(), decision_note: note || null });
  bindAccount(r.user_id, r.email, d.id, TIPO[r.tipo] + ' aprovado pelo MASTER');
  notifyUser(r.user_id, 'Acesso aprovado', 'Seu acesso ao EscalaMed foi liberado. Você já pode ver a escala e fazer trocas.');
  audit('REGISTRATION_APPROVED', `Acesso aprovado: ${d.name} (${r.email})`); return done(`Acesso aprovado: ${d.name}.`);
};
A.rejectReq = async (id, note) => {
  if (REAL) { await rpc('reject_registration', { p_request_id: id, p_note: note || null }); return done('Pedido recusado.'); }
  const r = S.data.requests.find(x => x.id === id); Object.assign(r, { status: 'rejected', decided_at: new Date().toISOString(), decision_note: note || 'Procure a coordenação para mais informações.' });
  notifyUser(r.user_id, 'Cadastro não aprovado', r.decision_note); audit('REGISTRATION_REJECTED', `Pedido recusado: ${r.name}`); return done('Pedido recusado.');
};
A.unbind = async (docId, motivo) => {
  if (REAL) { await rpc('unbind_account', { p_doctor_id: docId, p_motivo: motivo }); return done('Vínculo desfeito.'); }
  const a = IDX.account.get(docId); S.data.accounts = S.data.accounts.filter(x => x !== a); S.data.users = (S.data.users || []).filter(u => u.user_id !== a.user_id); doc(docId).email = null;
  audit('ACCOUNT_UNBOUND', `Vínculo desfeito: ${docName(docId)} (${a.email}) — ${motivo}`); return done('Vínculo desfeito. O médico pode refazer o primeiro acesso por matrícula (novo e-mail e senha).');
};
A.createInvite = async (docId, email) => {
  let token;
  if (REAL) token = await rpc('create_invite', { p_doctor_id: docId, p_email: email || null, p_sector_ids: doc(docId)?.sector_ids || [] });
  else { if (hasAccount(docId)) throw new Error('Este médico já tem conta'); token = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join(''); S.data.invites.unshift({ id: rid('conv'), token, doctor_id: docId, email: (email || '').toLowerCase() || null, sector_ids: [...doc(docId).sector_ids], created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 14 * 864e5).toISOString(), used_at: null, revoked: false }); audit('INVITE_CREATED', 'Convite gerado para ' + docName(docId)); }
  await done(); S.tabs.cad = 'conv'; render();
  modal('Link de convite', `<p class="desc">Envie este link para <b>${esc(docName(docId))}</b> (o app não envia nada sozinho):</p><input class="link-box full" readonly value="${esc(inviteUrl(token))}" id="invLink"><div class="form-actions"><button class="btn primary" data-act="copyInvite" data-token="${token}">Copiar link</button></div>`, { noFocus: true });
};
A.revokeInvite = async id => {
  if (REAL) { const { error } = await S.sb.from('invites').update({ revoked: true }).eq('id', id); if (error) throw new Error(error.message); return done('Convite revogado.'); }
  S.data.invites.find(i => i.id === id).revoked = true; audit('INVITE_REVOKED', 'Convite revogado'); return done('Convite revogado.');
};
A.saveDoctor = async (f) => {
  const v = { name: f.name.trim(), matricula: normMatricula(f.matricula) || null, empresa: f.empresa.trim() || null, crm: f.crm.trim() || null, specialty: f.specialty.trim() || null, active: f.active === 'true' };
  if (REAL) {
    let id = f.id;
    if (id) { const { error } = await S.sb.from('doctors').update(v).eq('id', id); if (error) throw new Error(error.message); }
    else { const r = await S.sb.from('doctors').insert({ ...v, origem: 'cadastro' }).select('id').single(); if (r.error) throw new Error(r.error.message); id = r.data.id; }
    const cur = doc(id)?.sector_ids || [];
    const add = f.sectors.filter(s => !cur.includes(s)), del = cur.filter(s => !f.sectors.includes(s));
    if (add.length) { const { error } = await S.sb.from('doctor_sectors').insert(add.map(s => ({ doctor_id: id, sector_id: s }))); if (error) throw new Error(error.message); }
    if (del.length) { const { error } = await S.sb.from('doctor_sectors').delete().eq('doctor_id', id).in('sector_id', del); if (error) throw new Error(error.message); }
    return done('Médico salvo.');
  }
  if (v.matricula && S.data.doctors.some(d => d.matricula === v.matricula && d.id !== f.id)) throw new Error('Matrícula já cadastrada');
  let d = f.id && doc(f.id);
  if (!d) { d = { id: rid('med'), origem: 'cadastro', cadastro_fms: false, sector_ids: [] }; S.data.doctors.push(d); }
  Object.assign(d, v, { sector_ids: f.sectors }); audit('DOCTOR_SAVED', `Médico salvo: ${d.name} · habilitações: ${f.sectors.map(secName).join(', ')}`); return done('Médico salvo.');
};
A.editShift = async (id, docId, motivo) => {
  if (REAL) { const { error } = await S.sb.from('shifts').update({ doctor_id: docId }).eq('id', id); if (error) throw new Error(error.message); return done('Responsável alterado (original preservado).'); }
  const s = shiftById(id), t = new Date().toISOString();
  if (!inSector(docId, s.sector_id)) throw new Error('Médico sem habilitação neste setor');
  if (s.type === 'Plantão' && S.data.shifts.some(x => x.id !== s.id && x.doctor_id === docId && x.status === 'active' && x.type === 'Plantão' && overlap(x, s))) throw new Error('O médico já tem plantão neste horário');
  S.data.history.push({ shift_id: s.id, from: s.doctor_id, to: docId, swap_id: null, motivo: 'edicao_master', motivo_txt: motivo, changed_by_name: 'MASTER', changed_at: t });
  audit('SHIFT_UPDATE', `${fmtD(s.starts_at)} ${fmtH(s.starts_at)} ${secName(s.sector_id)}: ${docName(s.doctor_id)} → ${docName(docId)} · motivo: ${motivo}`);
  s.doctor_id = docId; s.changed_at = t; notifyDoctor(docId, 'Plantão atribuído pela coordenação', `${fmtD(s.starts_at)} ${fmtH(s.starts_at)} ${secName(s.sector_id)}.`);
  return done('Responsável alterado (escala original preservada).');
};
A.setting = async (k, v) => {
  if (REAL) { const { error } = await S.sb.from('app_settings').update({ [k]: v }).eq('id', 1); if (error) throw new Error(error.message); return done('Configuração salva.'); }
  S.data.settings[k] = v; audit('SETTINGS', `${k} = ${v}`); return done('Configuração salva.');
};
A.markRead = async () => {
  const t = new Date().toISOString();
  if (REAL) { await S.sb.from('notifications').update({ read_at: t }).is('read_at', null); return done(); }
  S.data.notifications.forEach(n => { if (n.user_id === S.me.user_id && !n.read_at) n.read_at = t; }); return done();
};
A.submitRegistration = async (f) => {
  if (!normMatricula(f.matricula)) throw new Error('Informe a matrícula.');
  if (!(f.sectors || []).length) throw new Error('Escolha ao menos um setor');
  checkPw(f);
  if (REAL) {
    const cad = { name: f.name.trim(), crm: f.crm.trim(), specialty: f.specialty, matricula: f.matricula, empresa: f.empresa, phone: f.phone, sectors: f.sectors };
    const { data, error } = await S.sb.auth.signUp({ email: f.email.trim(), password: f.senha, options: { emailRedirectTo: SITE_URL(), data: { cadastro: cad } } });
    if (error) throw new Error(error.message);
    if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) throw new Error('Este e-mail já tem uma conta.');
    if (data.session) { S.user = data.user; return resolveAccess(); }
    S.login = { step: 'enviado', sentMsg: `Enviamos um link de confirmação para <b>${esc(f.email.trim())}</b>. Depois de confirmar, seu pedido vai para a coordenação.` }; return renderLogin();
  }
  const m = normMatricula(f.matricula);
  if (S.data.doctors.some(d => d.matricula === m && d.cadastro_fms)) throw new Error('Esta matrícula já está no cadastro da FMS. Use o acesso por matrícula.');
  if (demoUserForMatricula(m, true)) throw new Error('Já existe um pedido ou conta com esta matrícula. Procure a coordenação.');
  const u = await demoCreateUser(f.email, f.senha);
  const sug = S.data.doctors.find(d => d.matricula === m && !hasAccount(d.id));
  const r = { id: rid('req'), tipo: 'cadastro_novo', user_id: u.user_id, email: u.email, name: f.name.trim(), crm: f.crm.trim(), specialty: f.specialty.trim() || null, matricula: m, empresa: f.empresa.trim() || null, phone: f.phone.trim() || null, sector_ids: f.sectors, status: 'pending', suggested_doctor_id: sug?.id || null, created_at: new Date().toISOString() };
  S.data.requests.unshift(r); notifyMasters('Novo pedido de cadastro', `${r.name} (matrícula ${m}) pediu acesso.`); audit('REGISTRATION_SUBMITTED', 'Pedido de cadastro: ' + r.name);
  S.me = { kind: 'pending', user_id: u.user_id, email: u.email, request: r }; S.login = { step: 1 }; demoSave(); route();
};


// Relatório imprimível (A4) das inconsistências do cruzamento Escala x Ponto. Só leitura.
function printPontoReport() {
  const f = S.ponto.f || {};
  const so = typeof evSoAtivo === 'function' ? evSoAtivo() : !!f.soEventos;
  const m = f.todosMeses ? '__todos__' : S.f.month;
  const html = so && typeof evSoReportHtml === 'function'
    ? evSoReportHtml(m, f, { tela: false })
    : (REAL && pontoRows(S.f.month).loading ? null : pontoReportHtml(S.f.month, pontoRows(S.f.month)));
  if (!html) return toast('Aguarde o cruzamento carregar.', true);
  let el = document.getElementById('pontoPrint');
  if (!el) { el = document.createElement('div'); el.id = 'pontoPrint'; el.className = 'ponto-print'; document.body.appendChild(el); }
  el.innerHTML = html;
  document.body.classList.add('printing-ponto');
  window.addEventListener('afterprint', () => document.body.classList.remove('printing-ponto'), { once: true });
  setTimeout(() => window.print(), 50);
}
function pontoReportHtml(m, c, opts = {}) {
  const rows = pontoFiltered(c.rows);
  const f = S.ponto.f;
  const extras = (c.extras || []).filter(x => (!f.empresa || x.empresa === f.empresa) && (!f.medico || normTxt(x.doctorName || '').includes(normTxt(f.medico))));
  const incertos = rows.filter(r => r.incerto);
  const by = {};
  const add = (map, key, item) => { (map[key] = map[key] || []).push(item); };
  rows.forEach(r => {
    const k = (r.doctorId || r.doctorName) + '|' + (r.empresa || '');
    if (!by[k]) by[k] = { name: r.doctorName, mat: r.matricula || '', empresa: r.empresa || '', falta: [], atraso: [], saida: [], incompleto: [], visita_sem: [], eventos: [] };
    if (r.ocorrencias?.includes('falta')) by[k].falta.push(r);
    if (r.ocorrencias?.includes('atraso')) by[k].atraso.push(r);
    if (r.ocorrencias?.includes('saida_antecipada')) by[k].saida.push(r);
    if (r.ocorrencias?.includes('incompleto')) by[k].incompleto.push(r);
    if (r.status === 'visita_sem') by[k].visita_sem.push(r);
  });
  extras.forEach(x => {
    const k = (x.doctorId || x.doctorName) + '|' + (x.empresa || '');
    if (!by[k]) by[k] = { name: x.doctorName, mat: x.matricula || '', empresa: x.empresa || '', falta: [], atraso: [], saida: [], incompleto: [], visita_sem: [], extras: [] };
    (by[k].extras = by[k].extras || []).push(x);
  });
  if (typeof evMergeIntoReport === 'function') evMergeIntoReport(m, by, f);
  const docs = Object.values(by).filter(d => d.falta.length || d.atraso.length || d.saida.length || d.incompleto.length || d.visita_sem.length || (d.extras || []).length || (d.eventos || []).length)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const line = r => `${wday(r.startTs)} ${fmtDs(r.startTs)} ${fmtH(r.startTs)}–${fmtH(r.endTs)} · ${esc(r.sector || '')}${r.difEntrada != null && r.ocorrencias?.includes('atraso') ? ` · atraso ${r.difEntrada} min` : ''}${r.difSaida != null && r.ocorrencias?.includes('saida_antecipada') ? ` · saiu ${Math.abs(r.difSaida)} min antes` : ''}`;
  const block = (title, arr) => arr.length ? `<h4>${esc(title)} · ${arr.length}</h4><ul>${arr.map(r => `<li>${line(r)}</li>`).join('')}</ul>` : '';
  const k = typeof EscalaPonto !== 'undefined' ? EscalaPonto.kpis(rows) : {};
  const filt = [f.empresa && 'Empresa: ' + f.empresa, f.setor && 'Setor: ' + f.setor, f.medico && 'Médico: ' + f.medico, f.status && 'Status: ' + f.status].filter(Boolean);
  const html = `<div class="ponto-print-head">
    <p class="ponto-print-hosp">Hospital Municipal Padre Germano Lauck (HMPGL) · Foz do Iguaçu</p>
    <h1>Escala x Ponto · Relatório de inconsistências</h1>
    <p>${esc(fmtMonth(m))}${filt.length ? ' · ' + esc(filt.join(' · ')) : ''}</p>
    <p class="muted">Escala vigente (já com trocas). Tolerância de 15 minutos para atraso e saída antecipada. Sobreaviso não é cobrado.</p>
  </div>
  <p class="ponto-print-kpis"><b>Plantões:</b> ${k.plantoes ?? '—'} · <b>Cumpridos:</b> ${k.cumpridos ?? '—'} · <b>Faltas:</b> ${k.faltas ?? 0} · <b>Atrasos &gt; 15 min:</b> ${k.atrasos ?? 0} · <b>Saídas antecipadas:</b> ${k.saidas ?? 0} · <b>Incompletos:</b> ${k.incompletos ?? 0} · <b>Marcações fora da escala:</b> ${extras.length}</p>
  ${docs.length ? docs.map(d => `<section class="ponto-print-doc"><h3>${esc(d.name)}${d.mat ? ` <span class="muted">matr. ${esc(d.mat)}</span>` : ''}<small>${esc(d.empresa)}</small></h3>
    ${block('Faltas', d.falta)}${block('Atrasos acima de 15 minutos', d.atraso)}${block('Saídas antecipadas', d.saida)}${block('Marcações incompletas', d.incompleto)}${block('Visitas sem marcação', d.visita_sem)}
    ${(d.extras || []).length ? `<h4>Marcações fora da escala · ${d.extras.length}</h4><ul>${d.extras.map(x => `<li>${esc(fmtDH(x.ts))}</li>`).join('')}</ul>` : ''}
    ${typeof evBlock === 'function' ? evBlock(d.eventos || []) : ''}
  </section>`).join('') : '<p>Nenhuma inconsistência para os filtros deste mês.</p>'}
  ${typeof evSecaoRelatorio === 'function' ? evSecaoRelatorio(m, f, { tela: !!opts.tela }) : ''}
  <section class="ponto-print-doc"><h3>Médicos não encontrados</h3>
    ${incertos.length ? `<p>Nomes da escala com correspondência incerta (${incertos.length}):</p><ul>${incertos.map(r => `<li>${esc(r.doctorName)} · ${wday(r.startTs)} ${fmtDs(r.startTs)} ${fmtH(r.startTs)}–${fmtH(r.endTs)} · ${esc(r.sector || '')}${r.nota ? ` — ${esc(r.nota)}` : ''}</li>`).join('')}</ul>` : '<p>Nenhum neste mês (pelo cruzamento da escala vigente com o cartão ponto).</p>'}
  </section>`;
  return html;
}

// ───────── exportações ─────────
async function exportPonto() {
  const c = pontoRows(S.f.month), rows = pontoFiltered(c.rows);
  if (!rows.length) return toast('Nada para exportar.', true);
  const f = await EscalaPonto.exportByEmpresa(rows, c.extras, S.f.month);
  toast(f === 'xlsx' ? 'Planilha gerada (uma aba por empresa + resumo).' : 'Sem acesso ao gerador de XLSX: exportado em CSV.');
}
function exportVersao(kind) {
  const base = `escala_${S.f.month}${S.f.sector ? '_' + normTxt(secName(S.f.sector)).replace(/[^a-z0-9]+/g, '_') : ''}`;
  if (kind === 'comparacao') return exportSheets([{ name: 'Escala original', rows: versionRows('original') }, { name: 'Escala vigente', rows: versionRows('vigente') }, { name: 'Alterações', rows: versionRows('alteracoes') }], base + '_original_x_vigente');
  return exportSheets([{ name: kind === 'original' ? 'Escala original' : 'Escala vigente', rows: versionRows(kind) }], base + '_' + kind);
}
// ───────── Escalista: montar, conferir e salvar a escala ─────────
// v4.3: o botão “Publicar” virou “Salvar”. Salvar grava a escala e a deixa valendo para os médicos (no banco continua sendo publish_month / status 'published').
// Prioridade: extremamente simples, poucos cliques, português claro.

function escYm() { return S.esc.month || S.f.month || (!REAL ? '2026-11' : defaultMonth()); }
function escDays(ym) { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); }
function escSetores() { return (S.data.sectors || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')); }
function escSchedules(ym) { return (S.data.schedules || []).filter(s => s.month_ref === ym); }
function escEscalasOf(sectorId) {
  return (S.data.escalas || []).filter(e => e.sector_id === sectorId).slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || a.name.localeCompare(b.name, 'pt-BR'));
}
function escEscalaName(id) { return (S.data.escalas || []).find(e => e.id === id)?.name || ''; }
function escEnsureEscala(sid) {
  const list = escEscalasOf(sid);
  if (!list.length) return (S.esc.escalaId = null);
  if (S.esc.escalaId && list.some(e => e.id === S.esc.escalaId)) return S.esc.escalaId;
  const ym = escYm();
  const hit = list.find(e => escShiftsOf(ym, sid, e.id).length) || list[0];
  return (S.esc.escalaId = hit.id);
}
function escTurnoStoreKey(ym, sid, eid) { return ym + '|' + sid + (eid ? '|' + eid : ''); }
function escShiftsOf(ym, sectorId, escalaId) {
  const ids = new Set(escSchedules(ym).filter(s => !sectorId || s.sector_id === sectorId).map(s => s.id));
  return (S.data.shifts || []).filter(s => ids.has(s.schedule_id) && s.status !== 'cancelled' && (!escalaId || s.escala_id === escalaId || (!s.escala_id && escEscalasOf(s.sector_id)[0]?.id === escalaId)));
}
function escMonthStatus(ym) {
  const sch = escSchedules(ym);
  if (!sch.length) return { k: 'empty', label: 'Ainda não há escala neste mês' };
  if (sch.every(s => s.status === 'published')) return { k: 'published', label: 'Salva — os médicos já vêem esta escala' };
  if (sch.some(s => s.status === 'published') && sch.some(s => s.status === 'draft')) return { k: 'mixed', label: 'Parte salva, parte com alterações não salvas' };
  return { k: 'draft', label: 'Alterações não salvas — toque em Salvar' };
}
function escPrevYm(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0');
}
function escMonthShort(ym) {
  return fmtMonth(ym).replace(/ de \d{4}/, '').toLowerCase();
}
function escMapWeekdayDay(fromYm, dayNum, toYm) {
  const fromDate = new Date(fromYm + '-' + String(dayNum).padStart(2, '0') + 'T12:00:00-03:00');
  if (Number.isNaN(fromDate.getTime())) return 0;
  const dow = fromDate.getDay();
  const occ = Math.floor((dayNum - 1) / 7);
  const toFirst = new Date(toYm + '-01T12:00:00-03:00');
  const target = 1 + ((dow - toFirst.getDay() + 7) % 7) + occ * 7;
  return target > escDays(toYm) ? 0 : target;
}
const ESC_COPY_HINT = 'Copia o mesmo dia da semana (o 1º sábado do mês passado vai para o 1º sábado deste mês).';

// ── nomes: mesma lógica de aliases_nomes.json (exato / apelido / parecido) ──
function escNormName(s) {
  // “DrRoger” / “DraJamile” (Dr colado ao nome, com maiúscula) = “Dr Roger” / “Dra Jamile”
  let t = String(s || '').replace(/\b(Dra?)\.?(?=[A-ZÀ-Ý])/g, '$1 ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  t = t.replace(/\b(dra?|doutora?|prof(?:essor)?a?|srta?)\b\.?/g, ' ');
  t = t.replace(/atendimento por avaliacao/g, ' ');
  t = t.replace(/[^a-z0-9]+/g, ' ').trim();
  t = t.replace(/\b(de|da|do|dos|das|e|del|d)\b/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}
function escTokens(s) { return escNormName(s).split(' ').filter(t => t.length > 1 || t.length === 1); }
function escDice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9 * Math.min(a.length, b.length) / Math.max(a.length, b.length) + 0.1;
  const ta = a.split(' '), tb = b.split(' ');
  const sb = new Set(tb);
  let inter = 0; ta.forEach(x => { if (sb.has(x)) inter++; });
  const j = (2 * inter) / (ta.length + tb.length || 1);
  // prefix initials: "f" ~ "figueiredo"
  let soft = 0, n = 0;
  const used = new Set();
  ta.forEach(x => {
    const hit = tb.find((y, i) => !used.has(i) && (y === x || (x.length === 1 && y.startsWith(x)) || (y.length === 1 && x.startsWith(y))));
    if (hit) { soft++; used.add(tb.indexOf(hit)); }
    n++;
  });
  return Math.max(j, n ? soft / Math.max(ta.length, tb.length) : 0);
}
function escGenSuffixes(s) { return new Set(escTokens(s).filter(x => /^(junior|jr|filho|neto|sobrinho)$/.test(x))); }
function escGenOk(a, b) {
  const A = [...escGenSuffixes(a)].sort().join(), B = [...escGenSuffixes(b)].sort().join();
  return A === B;
}
function escAliasMaps() {
  const byNorm = new Map(), byMat = new Map(), forbid = new Set();
  (S.data.doctors || []).forEach(d => {
    byNorm.set(escNormName(d.name), d.id);
    if (d.matricula) byMat.set(String(d.matricula), d.id);
  });
  const A = window.ESCALAMED_ALIASES || {};
  (A.mesma_pessoa || []).forEach(it => {
    const d = (S.data.doctors || []).find(x => x.matricula === String(it.matricula));
    if (!d) return;
    const sid = it.setor && (S.data.sectors || []).find(s => escNormName(s.name) === escNormName(it.setor))?.id;
    (it.planilha || []).forEach(n => {
      if (!escGenOk(n, d.name)) return;
      const kn = escNormName(n);
      if (sid) byNorm.set(kn + '@' + sid, d.id); else byNorm.set(kn, d.id);
    });
    if (it.cadastro && !sid) byNorm.set(escNormName(it.cadastro), d.id);
  });
  (A.nao_casar || []).forEach(it => {
    const a = escNormName(it.planilha || '');
    (it.matriculas || []).forEach(m => forbid.add(a + '|' + m));
  });
  Object.entries(S.data.aliasesNomes || {}).forEach(([k, id]) => byNorm.set(k, id));
  return { byNorm, byMat, forbid };
}
function escSplitNames(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  return s.split(/\s*(?:\n|;|\/|,(?=\s*[A-ZÁÉÍÓÚ]))\s*/).map(x => x.trim()).filter(x => x && !/^(--+|—|-|x+|feriado|ferias|férias|vazio)$/i.test(x));
}
function escLev1(a, b) { // distância de edição ≤ 1
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 4) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++e > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return e + (a.length - i) + (b.length - j) <= 1;
}
function escTokFit(toks, docToks) { // 2 = todos exatos, 1 = algum com 1 letra de diferença, 0 = não serve
  let fuzzy = false;
  for (const x of toks) {
    if (docToks.includes(x)) continue;
    if (x.length === 1 && docToks.some(y => y.startsWith(x))) continue;
    if (docToks.some(y => escLev1(x, y))) { fuzzy = true; continue; }
    return 0;
  }
  return fuzzy ? 1 : 2;
}
function escMatchOne(raw, sectorId) {
  const text = String(raw || '').trim();
  if (!text) return { kind: 'empty', raw: text, doctorId: null, score: 0 };
  const maps = escAliasMaps();
  const mat = normMatricula(text);
  if (/^\s*\d[\d.\s-]*$/.test(text) && mat && maps.byMat.has(mat)) return { kind: 'exact', raw: text, doctorId: maps.byMat.get(mat), score: 1, via: 'matricula' };
  const n = escNormName(text);
  const scoped = sectorId && n ? maps.byNorm.get(n + '@' + sectorId) : null;
  if (scoped) return { kind: 'exact', raw: text, doctorId: scoped, score: 1, via: 'alias' };
  if (n && maps.byNorm.has(n)) return { kind: 'exact', raw: text, doctorId: maps.byNorm.get(n), score: 1, via: 'alias' };
  const docsAll = S.data.doctors || [];
  const ck = escTokens(text).join('');
  if (ck) {
    const hits = docsAll.filter(d => escTokens(d.name).join('') === ck && !maps.forbid.has(n + '|' + (d.matricula || '')));
    const hitsOk = hits.filter(d => escGenOk(text, d.name));
    const names = new Set(hitsOk.map(d => d.name));
    if (hitsOk.length && names.size === 1) return { kind: 'exact', raw: text, doctorId: hitsOk[0].id, score: 1, via: 'colado' };
  }
  const toks = n.split(' ').filter(Boolean);
  if (!toks.length) return { kind: 'unmatched', raw: text, doctorId: null, score: 0 };
  const docs = S.data.doctors || [];
  const fits = docs.map(d => ({ d, f: maps.forbid.has(n + '|' + (d.matricula || '')) || !escGenOk(text, d.name) ? 0 : escTokFit(toks, escNormName(d.name).split(' ')) })).filter(x => x.f);
  const pick = list => {
    const ex = list.filter(x => x.f === 2);
    if (ex.length === 1) return { d: ex[0].d, kind: toks.length >= 2 ? 'exact' : 'similar' };
    if (!ex.length && list.length === 1) return { d: list[0].d, kind: 'similar' };
    return null;
  };
  let r = pick(fits);
  if (!r && sectorId) r = pick(fits.filter(x => (x.d.sector_ids || []).includes(sectorId)));
  if (r) return { kind: r.kind, raw: text, doctorId: r.d.id, score: r.kind === 'exact' ? 0.95 : 0.8, via: 'parecido' };
  let best = null;
  docs.forEach(d => {
    const sc = escDice(n, escNormName(d.name));
    if (sc >= 0.8 && (!best || sc > best.score) && !maps.forbid.has(n + '|' + (d.matricula || '')) && escGenOk(text, d.name)) best = { kind: 'similar', raw: text, doctorId: d.id, score: sc, via: 'parecido' };
  });
  return best || { kind: 'unmatched', raw: text, doctorId: null, score: 0 };
}
function escRememberAlias(raw, doctorId, sectorId) {
  const n = escNormName(raw);
  if (!n || !doctorId) return;
  S.data.aliasesNomes = S.data.aliasesNomes || {};
  const key = sectorId ? n + '@' + sectorId : n;
  S.data.aliasesNomes[key] = doctorId;
  if (!REAL) demoSave();
  else rpc('upsert_name_alias', { p_alias: n, p_doctor: doctorId, p_sector: sectorId || null }).catch(() => {});
}

// ── horários / datas ──
function escParseHorario(s, setorNome) {
  const t = String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/(\d)\s*h\s*(\d{2})/g, '$1:$2').replace(/(\d)\s*h(rs|s)?\b/g, '$1:00').replace(/\b(as|ate|a)\b/g, '-');
  const m = t.match(/(\d{1,2})(?::?(\d{2}))?\s*[-–a]+\s*(\d{1,2})(?::?(\d{2}))?/);
  if (m) {
    const a = String(m[1]).padStart(2, '0') + ':' + (m[2] || '00');
    const b = String(m[3]).padStart(2, '0') + ':' + (m[4] || '00');
    return { start: a, end: b };
  }
  const sec = escNormName(setorNome || '');
  if (/psiquiatria/.test(sec)) {
    if (/tarde/.test(t)) return { start: '12:00', end: '18:00' };
    if (/manha|rotina/.test(t)) return { start: '06:00', end: '12:00' };
  }
  if (/plastica/.test(sec)) {
    if (/manha/.test(t)) return { start: '07:00', end: '12:00' };
    if (/tarde/.test(t)) return { start: '12:00', end: '17:00' };
    if (/noite/.test(t)) return { start: '17:00', end: '07:00' };
  }
  if (/manha\s*1|manha\s*1°|manha\s*1º/.test(t)) return { start: '07:00', end: '13:00', local: 'Manhã 1°' };
  if (/manha\s*2/.test(t)) return { start: '07:00', end: '13:00', local: 'Manhã 2°' };
  if (/manha/.test(t) && /tarde/.test(t)) return { start: '07:00', end: '19:00' };
  if (/manha|rotina/.test(t)) return { start: '07:00', end: '13:00' };
  if (/tarde/.test(t)) return { start: '13:00', end: '19:00' };
  if (/noite\s*19.*01|19:00\s*-\s*01/.test(t)) return { start: '19:00', end: '01:00' };
  if (/noite\s*01|01:00\s*-\s*07/.test(t)) return { start: '01:00', end: '07:00' };
  if (/noite|noturno/.test(t)) return { start: '19:00', end: '07:00' };
  if (/diurno/.test(t)) return { start: '07:00', end: '19:00' };
  if (/24\s*h/.test(t) || /\bp\s*1\b|\bp\s*2\b|primeiro plantonista|segundo plantonista/.test(t)) return { start: '07:00', end: '07:00' };
  if (/medico/.test(t) && !/\d/.test(t)) return { start: '07:00', end: '19:00' };
  return null;
}
function escGuessType(label, setorNome) {
  const t = escNormName(label + ' ' + (setorNome || ''));
  if (/visita/.test(t)) return 'Visita';
  if (/sobreaviso|svo|endoscopia|nefrologia|vascular|pediatrica|toracica|ginecologia|otorrino/.test(t) && /sobreaviso|svo|endoscopia|nefrologia|vascular/.test(escNormName(setorNome || label))) return 'Sobreaviso';
  if (/sobreaviso/.test(t)) return 'Sobreaviso';
  return 'Plantão';
}
function escParseDay(v, ym) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v >= 1 && v <= 31) return v;
  if (v instanceof Date && !isNaN(v)) return new Date(v.getTime() + 12 * 3600e3).getDate();
  const s = String(v).trim();
  // Excel serial
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n >= 1 && n <= 31 && !s.includes('.')) return n;
    if (n > 20000 && n < 80000) { // excel date
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5);
      const iso = d.toISOString().slice(0, 10);
      if (iso.startsWith(ym)) return +iso.slice(8);
    }
  }
  const m = s.match(/(\d{1,2})\s*[\/\-]\s*(\d{1,2})(?:\s*[\/\-]\s*(\d{2,4}))?/);
  if (m) return +m[1];
  const m2 = s.match(/^(\d{1,2})\b/);
  if (m2 && +m2[1] >= 1 && +m2[1] <= 31) return +m2[1];
  return null;
}
function escIso(ym, day, hm, endNext) {
  const [h, mi] = hm.split(':').map(Number);
  const [y, m] = ym.split('-').map(Number);
  const dt = new Date(y, m - 1, day, h, mi, 0);
  if (endNext) dt.setDate(dt.getDate() + 1);
  const p = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}T${p(dt.getHours())}:${p(dt.getMinutes())}:00-03:00`;
}
function escRange(ym, day, start, end) {
  const wrap = end <= start; // 19:00-07:00 or 07:00-07:00 (24h) or 19:00-01:00
  return { starts_at: escIso(ym, day, start, false), ends_at: escIso(ym, day, end, wrap) };
}

function escGuessSetor(name, aoa) {
  const blob = escNormName([name, ...(aoa || []).slice(0, 8).map(r => (r || []).join(' '))].join(' '));
  const list = escSetores();
  let best = null;
  list.forEach(s => {
    const n = escNormName(s.name);
    if (blob.includes(n) || n.includes(blob.slice(0, 20))) {
      const sc = n.length;
      if (!best || sc > best.sc) best = { setor: s, sc };
    }
  });
  // especiais
  if (/sad|emad|melhor em casa/.test(blob)) return list.find(s => /melhor em casa/i.test(s.name)) || best?.setor || null;
  if (/\bsvo\b|verificacao de obito/.test(blob)) return list.find(s => s.name === 'SVO') || best?.setor || null;
  if (/uti\s*[1-4]/.test(blob)) return list.find(s => /UTI/.test(s.name)) || best?.setor || null;
  return best?.setor || null;
}

function escIsHeaderish(v) {
  const t = escNormName(v);
  return /^(data|dia|dia da semana|semana|manha|tarde|noite|diurno|noturno|medico|nome|horario|funcao|setor|periodo|p 1|p 2|emad|lista)/.test(t) || escParseHorario(v);
}
function escRowLooksDays(row) {
  let n = 0;
  (row || []).forEach(c => { const d = escParseDay(c, '2026-11'); if (d) n++; });
  return n >= 5;
}
function escColLooksDays(aoa, col) {
  let n = 0;
  aoa.forEach(r => { const d = escParseDay((r || [])[col], '2026-11'); if (d) n++; });
  return n >= 8;
}

function escDetectSheet(aoa, sheetName) {
  const rows = (aoa || []).map(r => (r || []).map(c => (c == null ? '' : c)));
  const maxC = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const blob = escNormName(sheetName + ' ' + rows.slice(0, 12).map(r => r.join(' ')).join(' '));
  const remembered = (S.data.layoutMaps || {})[escNormName(sheetName)];
  // list
  let headerRow = -1, scores = [];
  rows.forEach((r, i) => {
    const cells = r.map(x => escNormName(x));
    const hasData = cells.some(c => c === 'data' || /^dia$/.test(c));
    const hasMed = cells.some(c => /medico|matricula|nome/.test(c));
    const hasHor = cells.some(c => /horario|turno|hora/.test(c));
    const hasSetor = cells.some(c => c === 'setor');
    if (hasData && hasMed && hasHor) scores.push({ i, kind: 'list', conf: 0.95 + (hasSetor ? 0.05 : 0) });
  });
  if (scores.length) return Object.assign({ sheetName, aoa: rows, setor: escGuessSetor(sheetName, rows) }, scores.sort((a, b) => b.conf - a.conf)[0], { conf: scores[0].conf, kind: 'list', headerRow: scores[0].i });

  if (/sad|emad|melhor em casa/.test(blob) || rows.some(r => /emad/i.test(String(r[0] || '')))) {
    return { kind: 'sad_weeks', conf: 0.95, sheetName, aoa: rows, setor: escGuessSetor(sheetName, rows) };
  }
  // SVO: NOME + HORARIO + many day numbers + short marks
  const svoHead = rows.findIndex(r => escNormName(r[0]) === 'nome' && r.some(c => escNormName(c) === 'horario' || escParseDay(c, '2026-11')));
  if (svoHead >= 0 || (/\bsvo\b|verificacao de obito/.test(blob) && rows.some(r => escRowLooksDays(r)))) {
    return { kind: 'svo_marks', conf: 0.93, sheetName, aoa: rows, headerRow: Math.max(svoHead, 0), setor: escGuessSetor(sheetName, rows) };
  }
  // days as columns: a row with many day numbers and a column of horarios
  let dayRow = rows.findIndex(r => escRowLooksDays(r));
  if (dayRow >= 0) {
    // are there horario labels on the left?
    const leftLabels = rows.slice(dayRow + 1, dayRow + 10).map(r => r[0]);
    const horarios = leftLabels.filter(x => escParseHorario(x) || /manha|tarde|noite|diurno|noturno|horario/i.test(String(x))).length;
    const namesLeft = leftLabels.filter(x => escNormName(x).split(' ').length >= 2 && !escIsHeaderish(x)).length;
    if (horarios >= 1 && namesLeft === 0) return { kind: 'days_as_cols', conf: 0.9, sheetName, aoa: rows, headerRow: dayRow, setor: escGuessSetor(sheetName, rows) };
    if (namesLeft >= 1) return { kind: 'svo_marks', conf: 0.8, sheetName, aoa: rows, headerRow: dayRow, setor: escGuessSetor(sheetName, rows) };
  }
  // days as rows: a header with MANHA/TARDE/MEDICO and first col dates
  rows.forEach((r, i) => {
    const labs = r.filter(c => escIsHeaderish(c));
    if (labs.length >= 2) {
      const below = rows.slice(i + 1, i + 16);
      const days = below.filter(rr => escParseDay(rr[0], '2026-11') || escParseDay(rr[1], '2026-11')).length;
      if (days >= 6) headerRow = i;
    }
  });
  if (headerRow >= 0) {
    return { kind: 'days_as_rows', conf: 0.92, sheetName, aoa: rows, headerRow, setor: escGuessSetor(sheetName, rows) };
  }
  if (remembered) return Object.assign({ conf: 0.7, sheetName, aoa: rows, setor: escGuessSetor(sheetName, rows) }, remembered);
  return { kind: 'unknown', conf: 0.2, sheetName, aoa: rows, setor: escGuessSetor(sheetName, rows) };
}

function escCellItems(ym, day, raw, turno, sectorId) {
  if (day == null || day < 1) return [];
  const names = escSplitNames(raw);
  return names.map(n => {
    const m = escMatchOne(n, sectorId);
    const rng = escRange(ym, day, turno.start, turno.end);
    return { ...m, day, turno, ...rng, type: turno.type, local: turno.local || '' };
  });
}

function escParseList(det, ym) {
  const rows = det.aoa, h = rows[det.headerRow] || [];
  const idx = {};
  h.forEach((c, i) => {
    const n = escNormName(c);
    if (n === 'data' || n === 'dia') idx.data = i;
    else if (/horario|turno|hora/.test(n)) idx.hor = i;
    else if (n === 'setor') idx.setor = i;
    else if (/medico|matricula|nome/.test(n)) idx.med = i;
  });
  const items = [];
  for (let r = det.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const day = escParseDay(row[idx.data], ym);
    const hor = escParseHorario(row[idx.hor]) || { start: '07:00', end: '19:00' };
    const setorNome = idx.setor != null ? String(row[idx.setor] || '') : (det.setor?.name || det.sheetName);
    const turno = { key: hor.start + '-' + hor.end, label: String(row[idx.hor] || (hor.start + '-' + hor.end)), start: hor.start, end: hor.end, type: escGuessType(setorNome, setorNome), local: hor.local || '' };
    const setor = escGuessSetor(setorNome, []) || det.setor;
    escCellItems(ym, day, row[idx.med], turno, (escGuessSetor(setorNome, []) || det.setor)?.id).forEach(it => items.push({ ...it, setorId: setor?.id, setorNome: setor?.name || setorNome }));
  }
  return items;
}
function escParseDaysAsRows(det, ym) {
  const rows = det.aoa;
  if (det.headerRow == null || det.headerRow < 0) { // sem cabeçalho (vindo de “Como ler esta aba?”): 1ª coluna = dia, demais = médicos
    det.headerRow = -1;
    const maxC = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const items = [];
    const turnos = Array.from({ length: Math.max(0, maxC - 1) }, (_, i) => ({ col: i + 1, key: '07:00-19:00' + (maxC > 2 ? '·' + (i + 1) : ''), label: maxC > 2 ? 'Coluna ' + (i + 1) : '07:00–19:00', start: '07:00', end: '19:00', type: escGuessType('', det.setor?.name), local: maxC > 2 ? 'Coluna ' + (i + 1) : '' }));
    rows.forEach(row => {
      const day = escParseDay(row[0], ym); if (!day) return;
      turnos.forEach(t => escCellItems(ym, day, row[t.col], t, det.setor?.id).forEach(it => items.push({ ...it, setorId: det.setor?.id, setorNome: det.setor?.name || det.sheetName })));
    });
    return items;
  }
  const h = rows[det.headerRow] || [];
  const turnos = [];
  let dayCol = 0;
  h.forEach((c, i) => {
    const n = escNormName(c);
    if (n === 'data' || n === 'dia' || n === 'dia do mes') dayCol = i;
    if (/semana|periodo/.test(n)) return;
    const hor = escParseHorario(c, det.setor?.name);
    if (hor || /medico|manha|tarde|noite|diurno|noturno|p 1|p 2/.test(n)) {
      const type = escGuessType(c, det.setor?.name);
      turnos.push({ col: i, key: (hor ? hor.start + '-' + hor.end : n) + (hor?.local || ''), label: String(c).trim(), start: hor?.start || '07:00', end: hor?.end || '19:00', type, local: hor?.local || (/p 1/.test(n) ? 'P1' : /p 2/.test(n) ? 'P2' : '') });
    }
  });
  const items = [];
  for (let r = det.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const day = escParseDay(row[dayCol], ym) || escParseDay(row[0], ym) || escParseDay(row[1], ym);
    if (!day) continue;
    turnos.forEach(t => escCellItems(ym, day, row[t.col], t, det.setor?.id).forEach(it => items.push({ ...it, setorId: det.setor?.id, setorNome: det.setor?.name || det.sheetName })));
  }
  return items;
}
function escParseDaysAsCols(det, ym) {
  const rows = det.aoa, h = rows[det.headerRow] || [];
  const dayOf = [];
  h.forEach((c, i) => { const d = escParseDay(c, ym); if (d) dayOf[i] = d; });
  const items = [];
  for (let r = det.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const hor = escParseHorario(row[0]) || escParseHorario(row[1]);
    if (!hor && !/manha|tarde|noite|diurno|noturno|horario/i.test(String(row[0] || ''))) continue;
    const h2 = hor || { start: '07:00', end: '19:00' };
    const turno = { key: h2.start + '-' + h2.end + (h2.local || ''), label: String(row[0] || (h2.start + '-' + h2.end)), start: h2.start, end: h2.end, type: escGuessType(row[0], det.setor?.name), local: h2.local || '' };
    row.forEach((c, i) => {
      if (dayOf[i]) escCellItems(ym, dayOf[i], c, turno, det.setor?.id).forEach(it => items.push({ ...it, setorId: det.setor?.id, setorNome: det.setor?.name || det.sheetName }));
    });
  }
  return items;
}
function escParseSad(det, ym) {
  const rows = det.aoa, items = [];
  let days = [], bloco = 'MANHÃ', local = '';
  const manha = { start: '07:00', end: '13:00', type: 'Plantão' };
  const tarde = { start: '13:00', end: '19:00', type: 'Plantão' };
  rows.forEach(row => {
    const a = String(row[0] || '');
    if (!String(row[0] || '').trim() && row.some(c => /\d{1,2}\s*\/\s*\d{1,2}/.test(String(c)))) {
      days = row.map(c => escParseDay(c, ym));
      return;
    }
    if (/^manh/i.test(a)) { bloco = 'MANHÃ'; return; }
    if (/^tard/i.test(a)) { bloco = 'TARDE'; return; }
    const em = a.match(/emad\s*(\d)/i);
    if (em) local = 'EMAD ' + em[1];
    if (!local || !days.length) return;
    if (!em && !local) return;
    const base = bloco === 'TARDE' ? tarde : manha;
    const turno = { key: base.start + '-' + base.end + '-' + local, label: bloco + ' · ' + local, start: base.start, end: base.end, type: 'Plantão', local };
    row.forEach((c, i) => {
      if (i === 0) return;
      if (days[i]) escCellItems(ym, days[i], c, turno, det.setor?.id).forEach(it => items.push({ ...it, setorId: det.setor?.id, setorNome: det.setor?.name || 'MELHOR EM CASA' }));
    });
  });
  return items;
}
function escParseSvo(det, ym) {
  const rows = det.aoa, items = [];
  let header = null, days = [];
  rows.forEach(row => {
    if (escRowLooksDays(row) || (escNormName(row[0]) === 'nome' && row.some(c => escParseDay(c, ym)))) {
      header = row;
      days = row.map(c => escParseDay(c, ym));
      return;
    }
    if (!header) return;
    const nome = String(row[0] || '').trim();
    if (!nome || /diretor|tecnica|barbara|fundacao|servico|verificacao|plantao de sobreaviso|escala de plantao/i.test(nome)) return;
    const hor = escParseHorario(row[1]) || escParseHorario(row[2]) || { start: '07:00', end: '19:00' };
    const isSobre = /sobreaviso|credenciado/i.test(rows.map(r => r[0]).join(' '));
    const turno = { key: escNormName(nome) + hor.start + hor.end, label: (row[1] || (hor.start + '-' + hor.end)) + ' · ' + nome, start: hor.start, end: hor.end, type: 'Sobreaviso', local: nome };
    row.forEach((c, i) => {
      if (!days[i]) return;
      const mark = String(c == null ? '' : c).trim();
      if (!mark || /feriado|ferias|férias|^-$/.test(mark.toLowerCase())) return;
      // qualquer marcação (X, RO, ALI, iniciais) indica presença; o nome vem da linha
      escCellItems(ym, days[i], nome, turno, det.setor?.id).forEach(it => items.push({ ...it, setorId: det.setor?.id, setorNome: det.setor?.name || 'SVO' }));
    });
  });
  return items;
}
function escParseSheet(det, ym) {
  if (det.kind === 'list') return escParseList(det, ym);
  if (det.kind === 'days_as_rows') return escParseDaysAsRows(det, ym);
  if (det.kind === 'days_as_cols') return escParseDaysAsCols(det, ym);
  if (det.kind === 'sad_weeks') return escParseSad(det, ym);
  if (det.kind === 'svo_marks') return escParseSvo(det, ym);
  return [];
}

function escGroupPreview(items) {
  const by = new Map();
  items.forEach(it => {
    const sid = it.setorId || '_';
    if (!by.has(sid)) by.set(sid, { setorId: it.setorId, setorNome: it.setorNome || 'Sem setor', items: [], turnos: new Map() });
    const g = by.get(sid);
    g.items.push(it);
    const k = it.turno.key;
    if (!g.turnos.has(k)) g.turnos.set(k, it.turno);
  });
  return [...by.values()];
}

// ── persistência do rascunho ──
function escHasHab(docId, sectorId) { return inSector(docId, sectorId); }
function escHasContrato(docId, sectorId, ym) {
  const list = S.data.contractDoctors || [];
  const day = (ym || escYm()) + '-01';
  return list.some(x => {
    if (x.doctor_id !== docId) return false;
    if (x.inicio && x.inicio > day) return false;
    if (x.fim && x.fim < day) return false;
    const lotes = x.lotes || [];
    if (!lotes.length) return true;
    return lotes.some(l => l.sector_id === sectorId && !l.coordenacao);
  });
}

async function escSaveSectorDraft(ym, sectorId, items, escalaId) {
  const d = S.data;
  let sch = d.schedules.find(s => s.month_ref === ym && s.sector_id === sectorId);
  if (!sch) {
    sch = { id: rid('esc'), sector_id: sectorId, month_ref: ym, status: 'draft', fonte: 'escalista' };
    d.schedules.push(sch);
  } else {
    sch.status = 'draft';
  }
  const eid = escalaId || items.find(it => it.escala_id)?.escala_id || (S.esc && S.esc.sectorId === sectorId && S.esc.escalaId) || escEscalasOf(sectorId)[0]?.id || null;
  d.shifts = d.shifts.filter(s => s.schedule_id !== sch.id || (eid && s.escala_id && s.escala_id !== eid));
  items.filter(it => it.day && (it.doctorId || (it.raw && String(it.raw).trim()))).forEach(it => {
    const sh = {
      id: rid('sh'), doctor_id: it.doctorId || null, original_doctor_id: it.doctorId || null, changed_at: null,
      sector_id: sectorId, starts_at: it.starts_at, ends_at: it.ends_at, type: it.type || 'Plantão',
      local: it.local || '', page: null, status: 'active', schedule_id: sch.id, escala_id: eid || it.escala_id || it.escalaId || null,
      source_text: it.raw || '', match_conf: it.kind === 'exact' ? 'alta' : it.kind === 'similar' ? 'media' : (it.kind === 'fora' || !it.doctorId) ? 'fora_cadastro' : 'manual'
    };
    d.shifts.push(sh);
  });
  reindex();
  if (!REAL) { demoSave(); return sch.id; }
  // Envia o setor inteiro (todas as escalas) para o banco não apagar a outra escala no DELETE + INSERT.
  const payload = d.shifts.filter(s => s.schedule_id === sch.id && s.status !== 'cancelled').map(sh => ({
    doctor_id: sh.doctor_id, starts_at: sh.starts_at, ends_at: sh.ends_at, type: sh.type, local: sh.local,
    source_text: sh.source_text, match_conf: sh.match_conf, escala_id: sh.escala_id || null
  }));
  return rpc('save_escala_draft', { p_month: ym, p_sector: sectorId, p_shifts: payload });
}

function escWarnings(ym) {
  const out = [];
  const rawShifts = escShiftsOf(ym);
  const shifts = typeof escShiftEffectiveTimes === 'function' ? rawShifts.map(escShiftEffectiveTimes) : rawShifts;
  const bySec = new Map();
  shifts.forEach(s => {
    (bySec.get(s.sector_id) || bySec.set(s.sector_id, []).get(s.sector_id)).push(s);
  });
  // grade esperada por setor a partir dos turnos já lançados
  escSetores().forEach(sec => {
    const list = bySec.get(sec.id) || [];
    if (!list.length && !escSchedules(ym).some(s => s.sector_id === sec.id)) return;
    const byEsc = new Map();
    list.forEach(s => { const k = s.escala_id || '_'; (byEsc.get(k) || byEsc.set(k, []).get(k)).push(s); });
    const n = escDays(ym);
    byEsc.forEach((lst, eid) => {
      const turnos = [];
      const seen = new Set();
      lst.forEach(s => {
        const a = fmtH(s.starts_at), b = fmtH(s.ends_at);
        const k = a + '-' + b + '|' + (s.local || '') + '|' + s.type;
        if (seen.has(k)) return; seen.add(k);
        turnos.push({ start: a, end: b, local: s.local || '', type: s.type, key: k });
      });
      const enome = escEscalaName(eid);
      turnos.forEach(t => {
        for (let d = 1; d <= n; d++) {
          const has = lst.some(s => +dayKey(s.starts_at).slice(8) === d && fmtH(s.starts_at) === t.start && (s.local || '') === t.local);
          if (!has) out.push({ k: 'vazio', setorId: sec.id, escalaId: eid === '_' ? null : eid, day: d, turno: t, txt: `Falta médico: ${secName(sec.id)}${enome ? ' · ' + enome : ''} · dia ${d} · ${t.local ? t.local + ' · ' : ''}${t.start}–${t.end}` });
        }
      });
    });
  });
  // sobreposição do mesmo médico em qualquer tipo (plantão, sobreaviso, visita), inclusive virada do dia
  const prev = escPrevYm(ym);
  const [yy, mm] = ym.split('-').map(Number);
  const nxt = mm === 12 ? (yy + 1) + '-01' : yy + '-' + String(mm + 1).padStart(2, '0');
  const seenSh = new Set();
  const around = [];
  [...escShiftsOf(prev), ...rawShifts, ...escShiftsOf(nxt)].forEach(s0 => {
    const s = typeof escShiftEffectiveTimes === 'function' ? escShiftEffectiveTimes(s0) : s0;
    if (seenSh.has(s.id)) return;
    seenSh.add(s.id);
    around.push(s);
  });
  const byDoc = new Map();
  around.forEach(s => {
    if (!s.doctor_id) return;
    (byDoc.get(s.doctor_id) || byDoc.set(s.doctor_id, []).get(s.doctor_id)).push(s);
  });
  byDoc.forEach(list => {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (escSameSlot(a, b.sector_id, b.starts_at, b.ends_at, b.local)) continue;
        if (!overlap(a, b)) continue;
        // só avisa se pelo menos um dos plantões é deste mês
        if (monthOf(a.starts_at) !== ym && monthOf(b.starts_at) !== ym) continue;
        const ta = escShiftTypeLabel(a.type), tb = escShiftTypeLabel(b.type);
        const name = docName(a.doctor_id);
        const txt = (ta === 'sobreaviso' || tb === 'sobreaviso')
          ? `${name} está de sobreaviso e em outro horário ao mesmo tempo: ${escWhereShift(a)} e ${escWhereShift(b)}`
          : `${name} já está escalado em ${escWhereShift(a)} e também em ${escWhereShift(b)}`;
        out.push({ k: 'choque', setorId: a.sector_id, day: +dayKey(a.starts_at).slice(8), txt });
      }
    }
  });
  shifts.forEach(s => {
    if (!s.doctor_id && ctrNomeIncompleto(s.source_text || '')) {
      out.push({ k: 'incorreta', setorId: s.sector_id, escalaId: s.escala_id, day: +dayKey(s.starts_at).slice(8), shiftId: s.id, doctorId: null, raw: s.source_text || '', type: s.type, start: fmtH(s.starts_at), end: fmtH(s.ends_at), txt: `Informação incorreta: “${s.source_text || '—'}” — nome incompleto, não identifica o médico (${secName(s.sector_id)} · ${fmtD(s.starts_at)} ${fmtH(s.starts_at)})` });
      return;
    }
    if (!s.doctor_id) {
      out.push({ k: 'nome', setorId: s.sector_id, escalaId: s.escala_id, day: +dayKey(s.starts_at).slice(8), shiftId: s.id, doctorId: null, raw: s.source_text || '', type: s.type, start: fmtH(s.starts_at), end: fmtH(s.ends_at), txt: `Fora do cadastro: “${s.source_text || '—'}” (${secName(s.sector_id)} · ${fmtD(s.starts_at)} ${fmtH(s.starts_at)})` });
      return;
    }
    if (s.match_conf === 'media' || s.match_conf === 'baixa') {
      out.push({ k: 'provavel', setorId: s.sector_id, escalaId: s.escala_id, day: +dayKey(s.starts_at).slice(8), shiftId: s.id, doctorId: s.doctor_id, raw: s.source_text || '', type: s.type, start: fmtH(s.starts_at), end: fmtH(s.ends_at), txt: `Nome provável: “${s.source_text || docName(s.doctor_id)}” → ${docName(s.doctor_id)} (${secName(s.sector_id)} · ${fmtD(s.starts_at)} ${fmtH(s.starts_at)})` });
    }
    if (!escHasHab(s.doctor_id, s.sector_id)) {
      out.push({ k: 'hab', setorId: s.sector_id, day: +dayKey(s.starts_at).slice(8), txt: `${docName(s.doctor_id)} não tem habilitação em ${secName(s.sector_id)} (${fmtD(s.starts_at)} ${fmtH(s.starts_at)})` });
    } else if (ctrHasData()) {
      const cr = ctrShiftCheck(s);
      if (cr && cr.k !== 'cedido') out.push({ k: 'contrato', setorId: s.sector_id, escalaId: s.escala_id, day: +dayKey(s.starts_at).slice(8), txt: `${docName(s.doctor_id)}: ${cr.motivo} — ${cr.detalhe} (${secName(s.sector_id)}, ${fmtD(s.starts_at)} ${fmtH(s.starts_at)})` });
    } else if ((S.data.contractDoctors || []).length && !escHasContrato(s.doctor_id, s.sector_id, ym)) {
      out.push({ k: 'contrato', setorId: s.sector_id, day: +dayKey(s.starts_at).slice(8), txt: `${docName(s.doctor_id)} está sem contrato nesse setor (${secName(s.sector_id)}, ${fmtD(s.starts_at)})` });
    }
  });
  const seenNome = new Set(out.filter(w => w.k === 'nome').map(w => (w.setorId || '') + '|' + (w.day || '') + '|' + escNormName(w.raw || '')));
  (S.data.importNotes || []).filter(n => n.month === ym).forEach(n => {
    const k = (n.setorId || '') + '|' + (n.day || '') + '|' + escNormName(n.raw || '');
    if (seenNome.has(k)) return;
    seenNome.add(k);
    out.push({ k: 'nome', setorId: n.setorId, day: n.day, raw: n.raw || '', txt: `Nome não casado com o cadastro: “${n.raw}” (${n.setorNome || secName(n.setorId)} · dia ${n.day})` });
  });
  return out;
}

// ── construir / alterar a grade na tela ──
function escDefaultTurnos(sectorId) {
  const nome = secName(sectorId);
  const L = (window.ESCALAMED_LAYOUTS || {}).layouts || [];
  const hit = L.find(l => (l.setores || []).some(s => escNormName(s) === escNormName(nome)) && l.turnos);
  if (hit) return hit.turnos.map(t => ({ key: t.start + '-' + t.end + (t.local || ''), label: t.header, start: t.start.slice(0, 5), end: t.end.slice(0, 5), type: t.type, local: t.local || '' }));
  if (/melhor em casa/i.test(nome)) {
    return ['1', '2', '3'].flatMap(n => ([
      { key: '07:00-13:00-EMAD ' + n, label: 'Manhã · EMAD ' + n, start: '07:00', end: '13:00', type: 'Plantão', local: 'EMAD ' + n },
      { key: '13:00-19:00-EMAD ' + n, label: 'Tarde · EMAD ' + n, start: '13:00', end: '19:00', type: 'Plantão', local: 'EMAD ' + n }
    ]));
  }
  return [
    { key: '07:00-13:00', label: 'Manhã 07-13', start: '07:00', end: '13:00', type: 'Plantão', local: '' },
    { key: '13:00-19:00', label: 'Tarde 13-19', start: '13:00', end: '19:00', type: 'Plantão', local: '' },
    { key: '19:00-07:00', label: 'Noite 19-07', start: '19:00', end: '07:00', type: 'Plantão', local: '' }
  ];
}
function escTurnoMin(hm) { const [h, m] = String(hm || '0:0').split(':').map(Number); return ((h * 60 + (m || 0)) - 300 + 1440) % 1440; } // dia começa às 05:00
function escTurnoCmp(a, b) {
  return escTurnoMin(a.start) - escTurnoMin(b.start) || escTurnoMin(a.end || a.start) - escTurnoMin(b.end || b.start) || String(a.local || '').localeCompare(String(b.local || ''), 'pt-BR');
}
function escGrid(ym, sectorId, escalaId) {
  const eid = escalaId || null;
  const hmap = typeof escHorarioMap === 'function' ? escHorarioMap(ym, sectorId, eid) : { cols: {}, days: {} };
  const list = escShiftsOf(ym, sectorId, eid);
  let turnos = [];
  const seen = new Set();
  const colTimes = {};
  list.forEach(s => {
    const key = typeof escShiftTurnoKey === 'function' ? escShiftTurnoKey(s, hmap) : (fmtH(s.starts_at) + '-' + fmtH(s.ends_at) + (s.local || ''));
    const start0 = fmtH(s.starts_at), end0 = fmtH(s.ends_at);
    const day = +dayKey(s.starts_at).slice(8);
    const ov = (hmap.days || {})[key + '|' + day];
    const isOv = ov && ov.start === start0 && ov.end === end0;
    if (!isOv && !colTimes[key]) colTimes[key] = { start: start0, end: end0, type: s.type, local: s.local || '' };
    if (seen.has(key)) return; seen.add(key);
    const parts = typeof escKeyParts === 'function' ? escKeyParts(key) : null;
    const col = (hmap.cols || {})[key];
    const start = (col && col.start) || (colTimes[key] && colTimes[key].start) || (parts && parts.start) || start0;
    const end = (col && col.end) || (colTimes[key] && colTimes[key].end) || (parts && parts.end) || end0;
    const local = s.local || (parts && parts.local) || '';
    turnos.push({ key, label: (local ? local + ' · ' : '') + start + '–' + end, start, end, type: s.type, local });
  });
  const tk = escTurnoStoreKey(ym, sectorId, eid);
  ((S.data.extraTurnos || {})[tk] || (S.data.extraTurnos || {})[ym + '|' + sectorId] || []).forEach(x => {
    if (turnos.some(t => t.key === x.key)) return;
    const col = (hmap.cols || {})[x.key];
    const start = (col && col.start) || x.start, end = (col && col.end) || x.end;
    turnos.push(Object.assign({}, x, { start, end, label: (x.local ? x.local + ' · ' : '') + start + '–' + end }));
  });
  const gone = (S.data.removedTurnos || {})[tk] || (S.data.removedTurnos || {})[ym + '|' + sectorId] || [];
  turnos = turnos.filter(x => !gone.includes(x.key));
  turnos.forEach(t => {
    const col = (hmap.cols || {})[t.key];
    if (col) { t.start = col.start; t.end = col.end; t.label = (t.local ? t.local + ' · ' : '') + t.start + '–' + t.end; }
  });
  turnos.sort(escTurnoCmp);
  const cells = {};
  list.forEach(s => {
    const key0 = typeof escShiftTurnoKey === 'function' ? escShiftTurnoKey(s, hmap) : (fmtH(s.starts_at) + '-' + fmtH(s.ends_at) + (s.local || ''));
    const key = key0 + '|' + (+dayKey(s.starts_at).slice(8));
    const kind = (!s.doctor_id || s.match_conf === 'fora_cadastro') ? 'fora' : (s.match_conf === 'media' ? 'similar' : 'exact');
    (cells[key] = cells[key] || []).push({ doctorId: s.doctor_id || null, shiftId: s.id, raw: s.source_text || docName(s.doctor_id), kind });
  });
  return { turnos, cells, n: escDays(ym), empty: !list.length, sectorId, escalaId: eid };
}
async function escWriteGrid(ym, sectorId, grid, escalaId) {
  const items = [];
  grid.turnos.forEach(t => {
    for (let d = 1; d <= grid.n; d++) {
      (grid.cells[t.key + '|' + d] || []).forEach(c => {
        if (!c.doctorId && !(c.raw && String(c.raw).trim())) return;
        const ef = typeof escTurnoEf === 'function' ? escTurnoEf(t, d, ym, sectorId, escalaId) : t;
        const rng = escRange(ym, d, ef.start, ef.end);
        items.push({ doctorId: c.doctorId || null, raw: c.raw, kind: c.kind || (c.doctorId ? 'exact' : 'fora'), day: d, turno: t, type: t.type, local: t.local, escala_id: escalaId || S.esc.escalaId || null, ...rng });
      });
    }
  });
  await escSaveSectorDraft(ym, sectorId, items, escalaId || S.esc.escalaId || null);
}

function escDoctorsOfSetor(sectorId) {
  return (S.data.doctors || []).filter(d => d.active !== false && (d.sector_ids || []).includes(sectorId));
}
function escShiftTypeLabel(t) {
  if (t === 'Sobreaviso') return 'sobreaviso';
  if (t === 'Visita') return 'visita';
  return 'plantão';
}
function escWhereShift(s) {
  const day = +dayKey(s.starts_at).slice(8);
  const loc = s.local ? ' · ' + s.local : '';
  const tipo = escShiftTypeLabel(s.type);
  const core = `${secName(s.sector_id)}, dia ${day}, ${fmtH(s.starts_at)}–${fmtH(s.ends_at)}${loc}`;
  return `${core} (${tipo === 'visita' ? 'plantão · visita' : tipo})`;
}
function escSameSlot(s0, sectorId, starts_at, ends_at, local) {
  const s = typeof escShiftEffectiveTimes === 'function' ? escShiftEffectiveTimes(s0) : s0;
  return s.sector_id === sectorId && ms(s.starts_at) === ms(starts_at) && ms(s.ends_at) === ms(ends_at) && (s.local || '') === (local || '');
}
function escConflictsFor(doctorId, starts_at, ends_at, except) {
  if (!doctorId || !starts_at || !ends_at) return [];
  const a = { starts_at, ends_at };
  const out = [];
  (S.data.shifts || []).forEach(s0 => {
    const s = typeof escShiftEffectiveTimes === 'function' ? escShiftEffectiveTimes(s0) : s0;
    if (!s.doctor_id || s.doctor_id !== doctorId || s.status === 'cancelled') return;
    if (except && except(s0)) return;
    if (overlap(a, s)) out.push(s);
  });
  out.sort((x, y) => ms(x.starts_at) - ms(y.starts_at));
  return out;
}
function escConflictMsg(name, others) {
  if (!others.length) return '';
  if (others.length === 1) {
    const o = others[0], typ = escShiftTypeLabel(o.type);
    const verb = typ === 'sobreaviso' ? 'já está de sobreaviso em' : typ === 'visita' ? 'já está em visita em' : 'já está escalado em';
    return `${name} ${verb} ${escWhereShift(o)}`;
  }
  return `${name} já está escalado em outro horário: ${others.map(escWhereShift).join('; ')}`;
}
function escConflictShort(o) {
  if (!o) return '';
  const typ = escShiftTypeLabel(o.type);
  const tag = ` (${typ === 'visita' ? 'plantão' : typ})`;
  return `já escalado em ${secName(o.sector_id)}, ${fmtH(o.starts_at)}–${fmtH(o.ends_at)}${tag}`;
}
function escPickerExcept(p) {
  if (!p || !p.sectorId || !p.starts_at) return () => false;
  return s => escSameSlot(s, p.sectorId, p.starts_at, p.ends_at, p.local || '');
}
function escDoctorOptions(q, selected) {
  const p = S.esc.pick || {};
  const nq = escNormName(q || '');
  const dig = String(q || '').replace(/\D/g, '');
  const all = (S.data.doctors || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const ofSetor = p.sectorId ? escDoctorsOfSetor(p.sectorId).slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) : all;
  const emptySetor = !!(p.sectorId && !ofSetor.length);
  let list = (p.sectorId && !p.showAll && ofSetor.length) ? ofSetor : all;
  if (selected && !list.some(d => d.id === selected)) {
    const d = doc(selected);
    if (d) list = [d, ...list];
  }
  const filt = nq ? list.filter(d => escNormName(d.name).includes(nq) || (dig && String(d.matricula || '').includes(dig))) : list;
  const except = escPickerExcept(p);
  return filt.slice(0, 205).map(d => {
    const busy = (p.starts_at && p.ends_at) ? escConflictsFor(d.id, p.starts_at, p.ends_at, except) : [];
    const mark = busy.length ? `<small class="choque">${esc(escConflictMsg(d.name, busy))}</small>` : '';
    return `<button type="button" class="${d.id === selected ? 'on' : ''}" data-act="escPickDoc" data-id="${d.id}"><b>${esc(d.name)}</b><small>matrícula ${esc(d.matricula || '—')}${d.empresa ? ' · ' + esc(d.empresa) : ''}</small>${mark}</button>`;
  }).join('') || '<div class="muted">Nenhum nome nessa busca.</div>';
}
function escOpenPicker(opts) {
  opts = opts || {};
  opts.showAll = !!opts.showAll;
  S.esc.pick = opts;
  const ofSetor = opts.sectorId ? escDoctorsOfSetor(opts.sectorId) : [];
  const emptySetor = !!(opts.sectorId && !ofSetor.length);
  const title = opts.title || (opts.sectorId ? 'Toque no nome certo.' : 'Toque no nome certo. A lista tem os 205 do cadastro.');
  const note = emptySetor ? '<p class="esc-pick-note">Nenhum médico deste setor no cadastro. Mostrando todos.</p>' : '';
  const toggle = (opts.sectorId && ofSetor.length) ? `<button type="button" class="esc-pick-toggle" data-act="escPickToggle">${opts.showAll ? 'Mostrar só deste setor' : 'Mostrar médicos de outros setores'}</button>` : '';
  modal('Escolher o médico', `
    <div class="esc-pick">
      <p class="esc-help">${esc(title)}</p>
      ${note}
      <input type="search" placeholder="Buscar por nome ou matrícula" data-act="escFilter" value="${esc(opts.q || '')}">
      <div class="lst">${escDoctorOptions(opts.q || '', opts.doctorId)}</div>
      ${toggle}
      ${typeof escRepeatHtml === 'function' ? escRepeatHtml(opts) : ''}
      <div class="esc-apply-all hidden" id="escApplyAllBox">
        <label><input type="checkbox" id="escApplyAllAlias" checked> <span id="escApplyAllLab"></span></label>
        <button type="button" class="btn primary" data-act="escPickApply">Confirmar escolha</button>
      </div>
      <div class="form-actions" style="margin-top:10px">
        ${opts.allowClear ? '<button class="btn" data-act="escPickClear">Deixar vazio</button>' : ''}
        <button class="btn" data-act="closeModal">Cancelar</button>
      </div>
    </div>`, { wide: true, noFocus: false });
  const inp = document.querySelector('.esc-pick input[type=search]');
  if (inp && opts.q) { inp.value = opts.q; inp.dispatchEvent(new Event('input', { bubbles: true })); }
}

function escKindLabel(kind) {
  return kind === 'exact' ? 'casou certo' : kind === 'similar' ? 'nome parecido — confira' : kind === 'unmatched' ? 'não encontrado — escolha o médico' : kind === 'fora' ? 'fora do cadastro' : '';
}

// ── páginas ──
function escMonthSelect() {
  const ym = escYm();
  return `<select data-act="escSetMonth" aria-label="Mês">${months().map(m => opt(m, fmtMonth(m), ym)).join('')}</select>`;
}

PAGES.montar = () => {
  const v = S.esc.view || 'home';
  if (v === 'import') return escPageImport();
  if (v === 'map') return escPageMap();
  if (v === 'grid') return escPageGrid();
  if (v === 'conf') return escPageConf();
  return escPageHome();
};

function escPageHome() {
  const ym = escYm(), st = escMonthStatus(ym), warns = escSchedules(ym).length ? escWarnings(ym) : [];
  const nSet = new Set(escSchedules(ym).map(s => s.sector_id)).size;
  const nSh = escShiftsOf(ym).length;
  return header(REAL && isMaster() ? 'Escala do mês' : 'Inclusão de escala', `Escolha o mês, importe um arquivo ou preencha na tela. Depois confira e salve.`, escMonthSelect()) + `
    <div class="esc-home">
      <div class="esc-status"><span class="esc-badge ${st.k}">${esc(st.label)}</span>
        ${nSh ? `<span class="muted">${nSet} setor(es) · ${nSh.toLocaleString('pt-BR')} plantões</span>` : ''}
        ${warns.length ? `<span class="tag orange">${warns.length} aviso(s) para conferir</span>` : ''}
      </div>
      <div class="esc-actions">
        <button class="esc-big primary" data-act="escGoImport"><b>Importar de um arquivo</b><small>PDF, Excel, Word ou CSV. Tem modelo pronto, no formato de cada setor. Você confere os nomes antes de usar.</small>${typeof escFileTypeIcons === 'function' ? escFileTypeIcons() : ''}</button>
        <button class="esc-big" data-act="escCopyPrev" ${escShiftsOf(escPrevYm(ym)).length ? '' : 'disabled'} title="${esc(escShiftsOf(escPrevYm(ym)).length ? ESC_COPY_HINT : 'Ainda não há escala de ' + escMonthShort(escPrevYm(ym)) + ' para copiar.')}"><b>Começar pela escala do mês passado</b><small>${escShiftsOf(escPrevYm(ym)).length ? ESC_COPY_HINT : 'Ainda não há escala de ' + esc(escMonthShort(escPrevYm(ym))) + ' para copiar.'}</small></button>
        <button class="esc-big" data-act="escGoGrid"><b>Mostrar escalas</b><small>Grade do mês: toque na célula e escolha o médico.</small></button>
      </div>
      ${st.k !== 'empty' ? `<div class="esc-bar">
        <button class="btn" data-act="escGoGrid">Continuar editando</button>
        <button class="btn" data-act="escGoConf">Conferir avisos</button>
        <button class="btn primary" data-act="escSalvar">Salvar</button>
        <button class="btn print-keep" data-act="escPrint">Exportar PDF / imprimir</button>
        ${REAL && isMaster() ? '<button class="btn" data-act="nav" data-page="contratos">Verificar contratos</button>' : ''}
      </div>` : ''}
    </div>`;
}

function escPageImport() {
  const ym = escYm(), prev = S.esc.preview;
  return header('Importar de um arquivo', `Mês: ${esc(fmtMonth(ym))}. Depois da importação você confere os nomes e pode ajustar na tela.`, `<button class="btn" data-act="escHome">‹ Voltar</button> ${escMonthSelect()}`) + `
    <div class="esc-bar">
      <button class="btn primary" data-act="escBaixarModelo">Baixar modelo por setor</button>
      <button class="btn" data-act="escBaixarModeloPadrao">Baixar modelo padrão</button>
      <label class="btn">${prev ? 'Trocar arquivo' : 'Escolher arquivo'}<input type="file" accept=".xlsx,.xls,.csv,.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/csv" data-act="escFile" hidden></label>
    </div>
    ${typeof escFileTypeIcons === 'function' ? escFileTypeIcons() : ''}<p class="esc-help">Aceita <b>Excel (.xlsx/.xls)</b>, <b>CSV</b>, <b>Word (.docx)</b> com tabelas e <b>PDF de texto</b>. PDF escaneado (imagem) não é lido com segurança — use o modelo Excel. O <b>modelo padrão</b> (recomendado) é uma grade vertical, um dia por linha, até 6 horários, no formato Nome — matrícula. O outro modelo traz uma aba no jeito de cada setor. Toda importação passa pela conferência (verde / amarelo / vermelho) antes de entrar na escala.</p>
    ${S.esc.importNote ? `<div class="callout warn">${esc(S.esc.importNote)}</div>` : ''}
    ${!prev ? `<div class="esc-drop" id="escDrop"><b>Solte o arquivo aqui</b>ou toque em “Escolher arquivo”. Aceita PDF, Excel, Word e CSV.</div>` : escPreviewHtml(prev)}
  `;
}
function escPreviewHtml(prev) {
  const groups = prev.groups || [];
  const sid = S.esc.sectorId || groups[0]?.setorId || groups[0]?.setorNome;
  const g = groups.find(x => (x.setorId && x.setorId === sid) || x.setorNome === sid) || groups[0];
  if (!g) return `<div class="callout warn">Não encontrei plantões nesta planilha. Se o formato for diferente, o app pede “Como ler esta aba?”.</div>`;
  const pend = g.items.filter(i => i.kind === 'unmatched' || i.kind === 'similar').length;
  const allPend = groups.reduce((n, x) => n + x.items.filter(i => i.kind === 'unmatched' || i.kind === 'similar').length, 0);
  const turnos = [...g.turnos.values()];
  const n = escDays(escYm());
  const by = new Map();
  g.items.forEach(it => {
    const k = it.turno.key + '|' + it.day;
    (by.get(k) || by.set(k, []).get(k)).push(it);
  });
  const head = `<tr><th class="esc-corner">Horário</th>${Array.from({ length: n }, (_, i) => `<th>${i + 1}</th>`).join('')}</tr>`;
  const body = turnos.map(t => `<tr><td class="esc-turno">${esc(t.label)}<div class="muted">${esc(t.start)}–${esc(t.end)}</div></td>${Array.from({ length: n }, (_, i) => {
    const d = i + 1, arr = by.get(t.key + '|' + d) || [];
    if (!arr.length) return `<td class="esc-cell empty" data-act="escPrevCell" data-setor="${esc(g.setorId || '')}" data-tk="${esc(t.key)}" data-day="${d}">+</td>`;
    const kind = arr.some(a => a.kind === 'unmatched') ? 'unmatched' : arr.some(a => a.kind === 'similar') ? 'similar' : 'ok';
    const names = arr.map(a => a.doctorId ? docName(a.doctorId) : a.raw).join(' · ');
    return `<td class="esc-cell ${kind}" data-act="escPrevCell" data-setor="${esc(g.setorId || '')}" data-tk="${esc(t.key)}" data-day="${d}" title="${esc(escKindLabel(arr[0].kind))}"><span class="nm">${esc(names)}</span></td>`;
  }).join('')}</tr>`).join('');
  return `
    <div class="esc-legend"><span><i style="background:#eefaf4"></i> Nome conferido</span><span><i style="background:#fff4d6"></i> Nome parecido — toque para confirmar</span><span><i style="background:#fdecef"></i> Não encontrado — toque e escolha</span></div>
    ${allPend ? `<div class="callout warn">${allPend} nome(s) para conferir. Toque na célula amarela ou vermelha e escolha o médico certo. A escolha fica lembrada da próxima vez.</div>` : `<div class="callout info">Todos os nomes casaram com o cadastro.</div>`}
    <div class="esc-setores">${groups.map(x => `<button class="${g === x ? 'on' : ''}" data-act="escPrevSetor" data-id="${esc(x.setorId || x.setorNome)}">${esc(x.setorNome || 'Setor')}${x.items.some(i => i.kind !== 'exact' && i.kind !== 'empty') ? '<span class="dot"></span>' : ''}</button>`).join('')}</div>
    <div class="esc-grid-wrap"><table class="esc-grid"><thead>${head}</thead><tbody>${body}</tbody></table></div>
    <div class="esc-bar" style="margin-top:14px">
      <button class="btn primary" data-act="escApplyImport">Usar esta escala</button>
      <button class="btn" data-act="escHome">Cancelar</button>
    </div>`;
}

function escPageMap() {
  const sh = S.esc.mapSheet;
  if (!sh) return escPageImport();
  const rows = (sh.aoa || []).slice(0, 10);
  const cols = Math.max(1, ...rows.map(r => r.length));
  const table = `<table><tbody>${rows.map((r, i) => `<tr>${Array.from({ length: cols }, (_, c) => `<td>${esc(String(r[c] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const setores = escSetores();
  return header('Como ler esta aba?', `Aba “${esc(sh.sheetName)}”. Olhe o pedacinho abaixo e diga onde estão os dias, os horários e os nomes.`, `<button class="btn" data-act="escGoImport">‹ Voltar</button>`) + `
    <div class="esc-map">
      <p class="esc-help">Isso só aparece quando a planilha não está num formato conhecido. A escolha fica lembrada para este setor nos próximos meses.</p>
      <div class="prev">${table}</div>
      <p><label>Este setor é:</label><select id="escMapSetor">${opt('', '— escolher —', sh.setor?.id || '')}${setores.map(s => opt(s.id, s.name, sh.setor?.id)).join('')}</select></p>
      <p><label>Os dias do mês estão:</label>
        <select id="escMapDias">${opt('col', 'Na primeira coluna (um dia por linha)', sh.kind === 'days_as_rows' ? 'col' : '')}${opt('row', 'Na primeira linha (um dia por coluna)', sh.kind === 'days_as_cols' || sh.kind === 'svo_marks' ? 'row' : '')}${opt('sad', 'Em semanas, como a escala do SAD', sh.kind === 'sad_weeks' ? 'sad' : '')}${opt('list', 'Em uma coluna “Data”, no formato de lista', sh.kind === 'list' ? 'list' : '')}</select></p>
      <p><label>Os horários estão:</label>
        <select id="escMapHor">${opt('cols', 'Nas colunas de cima (Manhã, Tarde, Noite…)', 'cols')}${opt('rows', 'Nas linhas da esquerda', '')}${opt('svo', 'Na coluna Horário, com marcações nos dias (como o SVO)', '')}${opt('um', 'Não tem coluna de horário (é um médico por dia)', '')}</select></p>
      <div class="esc-bar"><button class="btn primary" data-act="escMapOk">Ler assim</button></div>
    </div>`;
}

function escCellHtml(a, confMsg, ctrR, q) {
  const rawName = a.doctorId ? (docName(a.doctorId) || a.raw || '—') : (a.raw || '—');
  const name = esc(rawName);
  const hit = q && escNameMatches(rawName, q);
  const fora = a.doctorId || ctrR?.k === 'incorreta' ? '' : `<span class="fora-mark"${ctrR ? ` title="${esc(ctrR.detalhe)}"` : ''}>fora do cadastro</span>`;
  const ch = confMsg ? `<span class="choque-mark">${esc(confMsg)}</span>` : '';
  return `<span class="nm${hit ? ' esc-hit' : ''}">${name}</span>${fora}${ch}${typeof ctrMarkHtml === 'function' ? ctrMarkHtml(ctrR) : ''}`;
}
function escCellConflictMap(ym, sectorId, day, t, arr) {
  const ef = typeof escTurnoEf === 'function' ? escTurnoEf(t, day, ym, sectorId, S.esc?.escalaId) : t;
  const rng = escRange(ym, day, ef.start, ef.end);
  const map = {};
  (arr || []).forEach(c => {
    if (!c.doctorId) return;
    const others = escConflictsFor(c.doctorId, rng.starts_at, rng.ends_at, s => escSameSlot(s, sectorId, rng.starts_at, rng.ends_at, t.local || ''));
    if (others.length) map[c.doctorId] = { short: escConflictShort(others[0]), msg: escConflictMsg(docName(c.doctorId), others), others };
  });
  return map;
}
function escPrintStatus(st) {
  if (st.k === 'published') return 'Salva';
  if (st.k === 'draft') return 'Não salva';
  if (st.k === 'mixed') return 'Parte salva, parte não salva';
  return st.label || '';
}
function escPrintTable(ym, sectorId, g, escalaId) {
  const st = escMonthStatus(ym);
  const head = `<tr><th>Dia</th>${g.turnos.map(t => `<th>${esc(t.local || t.label)}<div class="muted">${esc(t.start)}–${esc(t.end)}${t.local ? ' · ' + esc(t.local) : ''} · ${esc(escTipoLabel(t.type))}</div></th>`).join('')}</tr>`;
  const body = Array.from({ length: g.n }, (_, i) => {
    const d = i + 1;
    const when = ym + '-' + String(d).padStart(2, '0') + 'T12:00:00-03:00';
    const cells = g.turnos.map(t => {
      const arr = g.cells[t.key + '|' + d] || [];
      const ef = typeof escTurnoEf === 'function' ? escTurnoEf(t, d, ym, sectorId, escalaId) : t;
      const hora = ef.dayOver ? `<div class="muted">${esc(ef.start)}–${esc(ef.end)}</div>` : '';
      if (!arr.length) return hora ? `<td>${hora}</td>` : '<td></td>';
      const names = arr.map(a => a.doctorId ? docName(a.doctorId) : (a.raw || '')).filter(Boolean).join('<br>');
      return `<td>${names}${hora}</td>`;
    }).join('');
    return `<tr><th>${d}<span class="wd">${esc(wday(when))}</span></th>${cells}</tr>`;
  }).join('');
  return `<div class="esc-print-only">
    ${escOfficialHeader(sectorId, ym)}
    <div class="esc-print-title">
      <h1>${esc(secName(sectorId))}${escalaId && escEscalaName(escalaId) ? ' · ' + esc(escEscalaName(escalaId)) : ''} · ${esc(fmtMonth(ym))} · HMPGL</h1>
      <p>${esc(escPrintStatus(st))}</p>
    </div>
    <table class="esc-print"><thead>${head}</thead><tbody>${body}</tbody></table>
    ${escOfficialFooter(sectorId)}
  </div>`;
}
function escCellKind(arr) {
  if (arr.some(a => a.kind === 'fora' || a.kind === 'unmatched' || !a.doctorId)) return 'fora';
  if (arr.some(a => a.kind === 'similar')) return 'similar';
  return 'ok';
}

function escSearchQ() { return String((S.esc && S.esc.searchQ) || '').trim(); }
function escNameMatches(name, q) {
  const nq = normTxt(q == null ? escSearchQ() : q);
  if (!nq) return false;
  return normTxt(name || '').includes(nq);
}
function escAssignName(a) { return a && a.doctorId ? (docName(a.doctorId) || a.raw || '') : ((a && a.raw) || ''); }
function escShiftName(s) { return s && s.doctor_id ? (docName(s.doctor_id) || s.source_text || '') : ((s && s.source_text) || ''); }
function escBuscaCountLabel(n) { return n === 1 ? '1 plantão' : (n + ' plantões'); }
function escBuscaTodos(ym, q) {
  const nq = normTxt(q);
  if (!nq) return [];
  const out = [];
  escShiftsOf(ym, null, null).forEach(s0 => {
    const s = typeof escShiftEffectiveTimes === 'function' ? escShiftEffectiveTimes(s0) : s0;
    const name = escShiftName(s);
    if (!escNameMatches(name, nq)) return;
    const day = +dayKey(s.starts_at).slice(8);
    const escalaNome = s.escala_id ? escEscalaName(s.escala_id) : '';
    const setor = secName(s.sector_id);
    out.push({
      day, weekday: wday(s.starts_at), start: fmtH(s.starts_at), end: fmtH(s.ends_at),
      setorId: s.sector_id, setor, escalaId: s.escala_id || null,
      escalaNome, tipo: escTipoLabel(s.type), name, local: s.local || '',
      setorLabel: escalaNome && escalaNome !== setor ? (setor + ' · ' + escalaNome) : setor
    });
  });
  out.sort((a, b) => a.day - b.day || String(a.start).localeCompare(String(b.start)) || String(a.setor).localeCompare(String(b.setor), 'pt-BR'));
  return out;
}
function escGridBuscaCount(g, q) {
  if (!q || !g) return 0;
  let n = 0;
  (g.turnos || []).forEach(t => {
    for (let d = 1; d <= g.n; d++) {
      (g.cells[t.key + '|' + d] || []).forEach(a => { if (escNameMatches(escAssignName(a), q)) n++; });
    }
  });
  return n;
}
function escSearchBarHtml(count) {
  const q = String((S.esc && S.esc.searchQ) || '');
  const showN = !!String(q).trim() && count != null;
  return `<label class="esc-busca">Buscar médico <span class="esc-busca-wrap"><input type="search" id="escSearchMed" data-act="escSearch" placeholder="Nome do médico" value="${esc(q)}" autocomplete="off" spellcheck="false"><button type="button" class="esc-busca-x" data-act="escSearchClear" title="Limpar busca" ${String(q).trim() ? '' : 'hidden'}>×</button></span></label><span class="esc-busca-count${showN ? ' on' : ''}" id="escBuscaCount">${showN ? esc(escBuscaCountLabel(count)) : ''}</span>`;
}
function escPaintSearch() {
  const q = escSearchQ();
  const x = document.querySelector('.esc-busca-x');
  if (x) x.hidden = !q;
  const countEl = document.getElementById('escBuscaCount');
  if (S.esc && S.esc.todas) return;
  const body = document.querySelector('table.esc-grid tbody');
  if (!body) {
    if (countEl) { countEl.textContent = q ? escBuscaCountLabel(0) : ''; countEl.classList.toggle('on', !!q); }
    return;
  }
  let n = 0;
  body.querySelectorAll('tr[data-day]').forEach(tr => {
    tr.querySelectorAll('td.esc-cell').forEach(td => {
      let hitCell = false;
      td.querySelectorAll('.nm').forEach(nm => {
        const ok = !!(q && escNameMatches(nm.textContent, q));
        nm.classList.toggle('esc-hit', ok);
        if (ok) { hitCell = true; n++; }
      });
      td.classList.toggle('esc-hit-cell', hitCell);
    });
    const hitDay = !!tr.querySelector('.esc-hit');
    tr.classList.toggle('esc-day-nomatch', !!q && !hitDay);
    tr.classList.toggle('esc-hit-row', !!q && hitDay);
  });
  if (countEl) { countEl.textContent = q ? escBuscaCountLabel(n) : ''; countEl.classList.toggle('on', !!q); }
}
function escRestoreSearchFocus() {
  const n = document.getElementById('escSearchMed');
  if (!n) return;
  n.focus();
  try { const len = n.value.length; n.setSelectionRange(len, len); } catch (e) {}
}
function escPageTodas() {
  const ym = escYm();
  const setores = escSetores().filter(s => s.name !== 'TESTE');
  const q = escSearchQ();
  const rows = q ? escBuscaTodos(ym, q) : [];
  const setorSel = `<label>Setor <select data-act="escSetSetor">${opt('__todas__', 'Todas as escalas', '__todas__')}${setores.map(s => opt(s.id, s.name, '')).join('')}</select></label>`;
  let body;
  if (!q) {
    body = `<div class="callout info" id="escBuscaHint">Digite o nome do médico para ver as escalas dele neste mês, em todos os setores.</div>`;
  } else if (!rows.length) {
    body = `<div class="callout" id="escBuscaHint">Nenhum plantão ou sobreaviso de “${esc(q)}” em ${esc(fmtMonth(ym))}.</div>`;
  } else {
    body = `<table class="esc-busca-todas" id="escBuscaTodas"><thead><tr><th>Dia</th><th>Semana</th><th>Horário</th><th>Setor</th><th>Tipo</th></tr></thead><tbody>${rows.map(r => `<tr data-act="escOpenBuscaRow" data-setor="${esc(r.setorId)}" data-escala="${esc(r.escalaId || '')}" data-day="${r.day}" title="Abrir a escala deste setor"><td>${r.day}</td><td>${esc(r.weekday)}</td><td>${esc(r.start)}–${esc(r.end)}${r.local ? ' · ' + esc(r.local) : ''}</td><td>${esc(r.setorLabel)}</td><td>${esc(r.tipo)}</td></tr>`).join('')}</tbody></table>`;
  }
  return header('Mostrar escalas', `${esc(fmtMonth(ym))} · todas as escalas${q ? ' · ' + esc(escBuscaCountLabel(rows.length)) : ''}.`, `<button class="btn" data-act="escHome">‹ Voltar</button> ${escMonthSelect()}`) + `
    <div class="esc-bar">
      ${setorSel}
      ${escSearchBarHtml(q ? rows.length : null)}
      <button class="btn" data-act="escGoConf">Conferir avisos</button>
    </div>
    ${body}`;
}

function escPageGrid() {
  if (S.esc && S.esc.todas) return escPageTodas();
  const ym = escYm();
  const setores = escSetores().filter(s => s.name !== 'TESTE');
  const sid = S.esc.sectorId || setores[0]?.id;
  S.esc.sectorId = sid;
  const eid = escEnsureEscala(sid);
  const g = escGrid(ym, sid, eid);
  const st = escMonthStatus(ym);
  const prev = escPrevYm(ym);
  const hasPrev = escShiftsOf(prev, sid, eid).length > 0;
  const escNome = escEscalaName(eid);
  const emptyState = g.empty ? `<div class="callout info" id="escEmptyState">Ainda não há escala de ${esc(escMonthShort(ym))} para este setor${escNome ? ' · ' + esc(escNome) : ''}.${hasPrev ? ' Você pode copiar a de ' + esc(escMonthShort(prev)) + ' (mesmo dia da semana) ou começar uma grade vazia.' : ''}</div>` : '';
  const copyBtn = hasPrev
    ? `<button class="btn" data-act="escCopyPrevOne" title="${esc(ESC_COPY_HINT)}">Copiar esta escala do mês passado</button>`
    : `<button class="btn" data-act="escCopyPrevOne" disabled title="Ainda não há esta escala em ${esc(escMonthShort(prev))}">Copiar esta escala do mês passado</button><span class="muted small">Ainda não há esta escala em ${esc(escMonthShort(prev))}</span>`;
  const q = escSearchQ();
  const buscaN = escGridBuscaCount(g, q);
  const hasDocs = typeof escTemMedicos === 'function' ? escTemMedicos(ym, sid, eid) : escShiftsOf(ym, sid, eid).some(s => s.doctor_id || (s.source_text && String(s.source_text).trim()));
  const clearBtn = hasDocs
    ? `<button class="btn danger" data-act="escLimpar" title="Retira todos os médicos desta escala, neste mês e setor. Os horários ficam.">Limpar escala</button>`
    : `<button class="btn danger" data-act="escLimpar" disabled title="A escala já está vazia">Limpar escala</button>`;
  const head = `<tr><th class="esc-corner esc-daycol">Dia <button class="btn small" data-act="escAddTurno" title="Acrescentar horário">+</button></th>${g.turnos.map(t => `<th class="esc-hcol" data-tk="${esc(t.key)}"><div class="esc-hlab">${esc(t.local || t.label)}</div><button type="button" class="esc-hora-btn" data-act="escEditHorario" data-tk="${esc(t.key)}" title="Editar horário deste turno">${esc(t.start)}–${esc(t.end)}</button><select class="esc-tipo ${escTipoOf(t.type) === 'Sobreaviso' ? 'sob' : 'pla'}" data-act="escTurnoTipo" data-tk="${esc(t.key)}" aria-label="Tipo do horário">${['Plantão', 'Sobreaviso'].map(x => opt(x, x, escTipoOf(t.type))).join('')}</select><button class="btn link small" data-act="escDelTurno" data-tk="${esc(t.key)}">Tirar este horário</button></th>`).join('')}</tr>`;
  const body = Array.from({ length: g.n }, (_, i) => {
    const d = i + 1;
    const when = ym + '-' + String(d).padStart(2, '0') + 'T12:00:00-03:00';
    const dow = new Date(when).getDay();
    const we = dow === 0 || dow === 6;
    const cells = g.turnos.map(t => {
      const arr = g.cells[t.key + '|' + d] || [];
      const ef = typeof escTurnoEf === 'function' ? escTurnoEf(t, d, ym, sid, eid) : t;
      const mark = ef.dayOver ? `<span class="esc-hora-mark" title="Horário deste dia: ${esc(ef.start)}–${esc(ef.end)}">${esc(ef.start)}–${esc(ef.end)}</span>` : '';
      if (!arr.length) return `<td class="esc-cell empty${ef.dayOver ? ' esc-hora-over' : ''}" data-act="escEditCell" data-tk="${esc(t.key)}" data-day="${d}"><span class="nm">+</span>${mark}</td>`;
      const cmap = escCellConflictMap(ym, sid, d, t, arr);
      const hasCh = Object.keys(cmap).length > 0;
      const tip = [...Object.values(cmap).map(x => x.msg), escKindLabel(arr[0].kind)].filter(Boolean).join(' — ');
      const copy = d < g.n ? `<button type="button" class="esc-copy-next" data-act="escCopyNext" data-tk="${esc(t.key)}" data-day="${d}" title="Copiar para o próximo dia">↓</button>` : '';
      const dayIso = ym + '-' + String(d).padStart(2, '0');
      const crs = arr.map(a => (ctrHasData() ? ctrCheck(a.doctorId || null, a.raw || '', sid, dayIso) : null));
      const hasCtr = crs.some(r => r && r.k !== 'fora' && r.k !== 'incorreta' && r.k !== 'cedido');
      const hasErr = crs.some(r => r && r.k === 'incorreta');
      const tip2 = [...new Set([tip, ...crs.filter(Boolean).map(r => r.motivo + ': ' + r.detalhe), ef.dayOver ? ('horário deste dia: ' + ef.start + '–' + ef.end) : ''].filter(Boolean))].join(' — ');
      const hits = q ? arr.filter(a => escNameMatches(escAssignName(a), q)).length : 0;
      return `<td class="esc-cell ${escCellKind(arr)}${hasCh ? ' choque' : ''}${hasCtr ? ' sem-contrato' : ''}${hasErr ? ' info-incorreta' : ''}${hits ? ' esc-hit-cell' : ''}${ef.dayOver ? ' esc-hora-over' : ''}" data-act="escEditCell" data-tk="${esc(t.key)}" data-day="${d}" title="${esc(tip2)}">${arr.map((a, i) => escCellHtml(a, a.doctorId && cmap[a.doctorId] ? cmap[a.doctorId].short : '', crs[i], q)).join('')}${mark}${copy}</td>`;
    }).join('');
    const dayHit = q && cells.includes('esc-hit');
    return `<tr class="${we ? 'we' : ''}${q && !dayHit ? ' esc-day-nomatch' : ''}${dayHit ? ' esc-hit-row' : ''}" data-day="${d}"><th class="esc-day">${d}<span class="wd">${esc(wday(when))}</span></th>${cells}</tr>`;
  }).join('');
  const printHtml = g.turnos.length ? escPrintTable(ym, sid, g, eid) : '';
  return header('Mostrar escalas', `${esc(fmtMonth(ym))} · toque na célula para escolher, trocar ou limpar o médico.`, `<button class="btn" data-act="escHome">‹ Voltar</button> ${escMonthSelect()}`) + `
    <div class="esc-bar">
      <label>Setor <select data-act="escSetSetor">${opt('__todas__', 'Todas as escalas', '')}${setores.map(s => opt(s.id, s.name, sid)).join('')}</select></label>
      ${escEscalasOf(sid).length ? `<label>Escala <select data-act="escSetEscala">${escEscalasOf(sid).map(e => opt(e.id, e.name, eid)).join('')}</select></label>` : ''}
      ${escSearchBarHtml(q ? buscaN : null)}
      ${copyBtn}
      ${clearBtn}
      <button class="btn" data-act="escGoConf">Conferir avisos</button>
      <button class="btn primary" data-act="escSalvar">Salvar</button>
      <button class="btn" data-act="escPrint">Exportar PDF / imprimir</button>
      ${S.esc.undoRepeat ? '<button class="btn" data-act="escUndoRepeat">Desfazer</button>' : ''}
    </div>
    <span class="esc-badge ${st.k}">${esc(st.label)}</span>
    ${escAssinaturasBar(sid)}
    ${emptyState}
    ${g.empty && !g.turnos.length ? `<div class="esc-bar"><button class="btn" data-act="escStartEmpty">Começar uma grade vazia</button></div>` : ''}
    ${g.turnos.length ? `<div class="esc-grid-wrap" style="margin-top:10px"><table class="esc-grid esc-vgrid"><thead>${head}</thead><tbody>${body}</tbody></table></div>${printHtml}` : ''}`;
}

function escConfRowHtml(w) {
  const clickable = (w.k === 'nome' || w.k === 'incorreta' || w.k === 'provavel') && w.shiftId && isEscalista();
  if (!clickable) {
    return `<div class="esc-warn ${w.k === 'choque' || w.k === 'nome' || w.k === 'incorreta' ? 'red' : ''}" ${w.setorId ? `data-act="escJump" data-setor="${esc(w.setorId)}" data-day="${w.day || ''}"` : ''}><div><b>${esc(w.txt)}</b></div></div>`;
  }
  const badge = w.k === 'provavel' ? tag('nome provável', 'orange') : w.k === 'incorreta' ? tag('informação incorreta', 'red') : tag('fora do cadastro', 'red');
  const name = w.k === 'provavel' ? (docName(w.doctorId) || w.raw || '—') : (w.raw || '—');
  const meta = [w.day ? ('dia ' + w.day) : '', (w.start && w.end) ? (w.start + '–' + w.end) : '', secName(w.setorId), w.escalaId ? escEscalaName(w.escalaId) : '', escTipoLabel ? escTipoLabel(w.type) : (w.type || '')].filter(Boolean).join(' · ');
  const pop = w.k === 'provavel' ? `<div class="esc-conf-pop hidden" data-pop="${esc(w.shiftId)}">
      <button type="button" class="btn primary" data-act="escConfConfirm" data-shift="${esc(w.shiftId)}">Confirmar ${esc(docName(w.doctorId))}</button>
      <button type="button" class="btn" data-act="escConfConfirmAll" data-doc="${esc(w.doctorId)}">Confirmar todos os prováveis deste médico</button>
      <button type="button" class="btn" data-act="escConfTrocar" data-shift="${esc(w.shiftId)}">Trocar médico</button>
    </div>` : '';
  return `<div class="esc-warn ${w.k === 'nome' || w.k === 'incorreta' ? 'red' : 'amber'} clickable" data-act="escConfRow" data-kind="${w.k}" data-shift="${esc(w.shiftId)}">
    <div class="esc-warn-line"><span class="esc-warn-meta">${esc(meta)}</span><span class="esc-warn-name">${esc(name)} ${badge}</span></div>
    ${pop}
  </div>`;
}
function escPageConf() {
  const ym = escYm();
  const warns = escWarnings(ym);
  const byK = { incorreta: 'Informação incorreta — nome incompleto (corrija a escala)', vazio: 'Plantão sem médico', choque: 'Mesmo médico em dois lugares no mesmo horário', hab: 'Sem habilitação no setor', contrato: 'Sem contrato que cubra o setor (Contratos)', provavel: 'Nome provável — confira', nome: 'Nome não casado com o cadastro' };
  const groups = {};
  warns.forEach(w => { (groups[w.k] = groups[w.k] || []).push(w); });
  const st = escMonthStatus(ym);
  const html = Object.keys(byK).filter(k => groups[k]).map(k => `
    <h3>${esc(byK[k])} <span class="muted">(${groups[k].length})</span></h3>
    <div class="esc-warns">${groups[k].slice(0, 40).map(escConfRowHtml).join('')}${groups[k].length > 40 ? `<p class="muted">… e mais ${groups[k].length - 40}</p>` : ''}</div>`).join('') || `<div class="callout info">Nenhum aviso neste mês. Pode salvar.</div>`;
  return header('Conferir antes de salvar', `Os avisos não impedem salvar. Toque no nome para confirmar ou trocar. Se estiver tudo certo, toque em Salvar.`, `<button class="btn" data-act="escGoGrid">‹ Voltar à grade</button> ${escMonthSelect()}`) + `
    <div class="esc-status"><span class="esc-badge ${st.k}">${esc(st.label)}</span>${warns.length ? `<span class="tag orange" id="escWarnCount">${warns.length} aviso(s)</span>` : '<span class="tag green">sem avisos</span>'}</div>
    ${html}
    <div class="esc-bar">
      <button class="btn primary" data-act="escSalvar">${warns.length && st.k !== 'published' ? 'Salvar mesmo assim' : 'Salvar'}</button>
      <button class="btn" data-act="escPrint">Exportar PDF / imprimir</button>
    </div>`;
}

// ── ações ──
const EscAct = {
  escHome: () => { S.esc.view = 'home'; S.esc.preview = null; S.esc.mapSheet = null; render(); },
  escGoImport: () => { S.esc.view = 'import'; render(); },
  escGoGrid: () => { S.esc.view = 'grid'; if (!S.esc.sectorId) S.esc.sectorId = escSetores().find(s => s.name === 'PEDIATRIA')?.id || escSetores()[0]?.id; render(); },
  escStartEmpty: () => {
    const ym = escYm(), sid = S.esc.sectorId, k = escTurnoStoreKey(ym, sid, escEnsureEscala(sid));
    S.data.extraTurnos = S.data.extraTurnos || {};
    if (!(S.data.extraTurnos[k] || []).length) S.data.extraTurnos[k] = escDefaultTurnos(sid);
    if (!REAL) demoSave();
    toast('Grade vazia pronta. Toque nas células para pôr os médicos.');
    render();
  },
  escGoConf: () => { S.esc.view = 'conf'; render(); },
  escSetMonth: el => { const v = el.value; S.esc.month = v; S.f.month = v; S.esc.preview = null; return ensureMonth(v).then(() => render()); },
  escSetSetor: el => {
    if (el.value === '__todas__') { S.esc.todas = true; render(); return; }
    S.esc.todas = false;
    S.esc.sectorId = el.value;
    S.esc.escalaId = null;
    render();
  },
  escSearch: (el, e) => {
    if (e && e.type !== 'input' && e.type !== 'change' && e.type !== 'search') return;
    S.esc.searchQ = el.value || '';
    if (S.esc.todas) { render(); escRestoreSearchFocus(); return; }
    escPaintSearch();
  },
  escSearchClear: () => {
    S.esc.searchQ = '';
    if (S.esc.todas) { render(); const n = document.getElementById('escSearchMed'); if (n) n.focus(); return; }
    const inp = document.getElementById('escSearchMed');
    if (inp) inp.value = '';
    escPaintSearch();
  },
  escOpenBuscaRow: el => {
    S.esc.todas = false;
    S.esc.sectorId = el.dataset.setor;
    S.esc.escalaId = el.dataset.escala || null;
    const day = +el.dataset.day || 0;
    render();
    const tr = document.querySelector('.esc-grid tbody tr[data-day="' + day + '"]');
    if (tr) {
      tr.classList.add('esc-jump');
      tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => tr.classList.remove('esc-jump'), 1800);
    }
  },
  escSetEscala: el => { S.esc.escalaId = el.value; render(); },
  escPrevSetor: el => { S.esc.sectorId = el.dataset.id; S.esc.escalaId = el.dataset.escala || null; render(); },
  escBaixarModelo: () => escBaixarModelo(),
  escFile: (el) => escReadFile(el.files && el.files[0]),
  escFilter: (el, e) => { if (e && e.type !== 'input') return; const box = el.closest('.esc-pick')?.querySelector('.lst'); if (box) box.innerHTML = escDoctorOptions(el.value, S.esc.pick?.doctorId); },
  escPickToggle: () => {
    const p = S.esc.pick; if (!p) return;
    p.showAll = !p.showAll;
    const box = document.querySelector('.esc-pick'); if (!box) return;
    const q = box.querySelector('input[type=search]')?.value || '';
    const lst = box.querySelector('.lst');
    if (lst) lst.innerHTML = escDoctorOptions(q, p.doctorId);
    const btn = box.querySelector('[data-act=escPickToggle]');
    if (btn) btn.textContent = p.showAll ? 'Mostrar só deste setor' : 'Mostrar médicos de outros setores';
  },
  escPickDoc: async el => {
    const id = el.dataset.id, p = S.esc.pick;
    if (!p) return closeModal();
    // na grade, trocar o médico de uma célula que já tinha médico não vira apelido; nome fora do cadastro vira apelido do setor
    if (p.raw && !(p.repeatable && p.doctorId)) escRememberAlias(p.raw, id, p.repeatable ? p.sectorId : undefined);
    if (p.repeatable && typeof escApplyRepeat === 'function') {
      const mode = document.querySelector('input[name=escRep]:checked')?.value || 'one';
      const ate = +document.querySelector('#escRepAte')?.value || p.day;
      const overwrite = !!document.querySelector('#escRepOverwrite')?.checked;
      const ok = await escApplyRepeat({ doctorId: id, mode, ate, overwrite, ym: p.ym || escYm(), sectorId: p.sectorId, turno: p.turno, day: p.day });
      if (!ok) return;
      closeModal(); render();
      return;
    }
    if (p.starts_at && p.ends_at) {
      const others = escConflictsFor(id, p.starts_at, p.ends_at, escPickerExcept(p));
      if (others.length && !confirm(escConflictMsg(docName(id), others) + '\n\nColocar mesmo assim?')) return;
    }
    if (p.onPick) await p.onPick(id);
    if (p.starts_at && p.ends_at) {
      const others = escConflictsFor(id, p.starts_at, p.ends_at, escPickerExcept(p));
      if (others.length) toast(escConflictMsg(docName(id), others), true);
    }
    closeModal(); render();
  },
  escPickClear: async () => {
    const p = S.esc.pick;
    if (p?.onPick) await p.onPick(null);
    closeModal(); render();
  },
  escPrevCell: el => {
    const prev = S.esc.preview; if (!prev) return;
    const g = prev.groups.find(x => (x.setorId || x.setorNome) === el.dataset.setor) || prev.groups[0];
    const day = +el.dataset.day, tk = el.dataset.tk;
    const arr = g.items.filter(i => i.turno.key === tk && i.day === day);
    const first = arr[0];
    const t0 = (g.turnos.get && g.turnos.get(tk)) || first?.turno || {};
    const rng0 = (t0.start && t0.end) ? escRange(escYm(), day, t0.start, t0.end) : {};
    escOpenPicker({
      title: `Dia ${day} · ${first?.turno.label || t0.label || ''} — ${g.setorNome}`,
      raw: first?.raw || '',
      doctorId: first?.doctorId || null,
      sectorId: g.setorId,
      local: t0.local || '',
      starts_at: rng0.starts_at,
      ends_at: rng0.ends_at,
      allowClear: true,
      onPick: id => {
        // atualiza todos os unmatched/similar desta célula, ou cria um
        const t = (g.turnos.get && g.turnos.get(tk)) || first?.turno;
        if (id) {
          if (arr.length) arr.forEach(it => { it.doctorId = id; it.kind = 'exact'; it.via = 'manual'; });
          else {
            const rng = escRange(escYm(), day, t.start, t.end);
            const it = { kind: 'exact', raw: docName(id), doctorId: id, day, turno: t, type: t.type, local: t.local, setorId: g.setorId, setorNome: g.setorNome, ...rng };
            g.items.push(it);
          }
        } else {
          g.items = g.items.filter(i => !(i.turno.key === tk && i.day === day));
        }
      }
    });
  },
  escEditCell: el => {
    const ym = escYm(), sid = S.esc.sectorId, eid = escEnsureEscala(sid), g = escGrid(ym, sid, eid);
    const t = g.turnos.find(x => x.key === el.dataset.tk);
    const day = +el.dataset.day;
    const arr = g.cells[t.key + '|' + day] || [];
    const ef = typeof escTurnoEf === 'function' ? escTurnoEf(t, day, ym, sid, eid) : t;
    const rng = escRange(ym, day, ef.start, ef.end);
    escOpenPicker({
      title: `${secName(sid)} · dia ${day} · ${ef.start}–${ef.end}`,
      raw: arr[0]?.raw || '',
      doctorId: arr[0]?.doctorId || null,
      shiftId: arr[0]?.shiftId || null,
      sectorId: sid,
      local: t.local || '',
      starts_at: rng.starts_at,
      ends_at: rng.ends_at,
      repeatable: true,
      ym, day, turno: t,
      allowClear: true,
      onPick: async id => {
        if (!id) g.cells[t.key + '|' + day] = [];
        else g.cells[t.key + '|' + day] = [{ doctorId: id, raw: docName(id), kind: 'exact' }];
        await escWriteGrid(ym, sid, g, eid);
        toast(id ? 'Médico colocado.' : 'Célula limpa.');
      }
    });
  },
  escAddTurno: async () => {
    const start = prompt('Horário de início (ex.: 07:00)', '07:00');
    if (!start) return;
    const end = prompt('Horário de término (ex.: 13:00). Se for noite, pode ser 07:00 do dia seguinte.', '13:00');
    if (!end) return;
    const ym = escYm(), sid = S.esc.sectorId, eid = escEnsureEscala(sid), g = escGrid(ym, sid, eid);
    const hor = escParseHorario(start + '-' + end) || { start, end };
    const key = hor.start + '-' + hor.end;
    if (g.turnos.some(t => t.key === key)) { toast('Esse horário já está na grade.', true); return; }
    const nt = { key, label: hor.start + '–' + hor.end, start: hor.start, end: hor.end, type: 'Plantão', local: '' };
    S.data.extraTurnos = S.data.extraTurnos || {};
    const sk = escTurnoStoreKey(ym, sid, eid);
    (S.data.extraTurnos[sk] = S.data.extraTurnos[sk] || []).push(nt);
    const rm = (S.data.removedTurnos || {})[sk]; if (rm) S.data.removedTurnos[sk] = rm.filter(k => k !== key);
    if (!REAL) demoSave(); toast('Horário acrescentado. Toque nas células para pôr os médicos.'); render();
  },
  escDelTurno: async el => {
    if (!confirm('Tirar este horário desta escala? Os médicos lançados nele saem juntos.')) return;
    const ym = escYm(), sid = S.esc.sectorId, eid = escEnsureEscala(sid), g = escGrid(ym, sid, eid);
    const k = el.dataset.tk, kk = escTurnoStoreKey(ym, sid, eid);
    g.turnos = g.turnos.filter(t => t.key !== k);
    S.data.extraTurnos = S.data.extraTurnos || {}; S.data.removedTurnos = S.data.removedTurnos || {};
    S.data.extraTurnos[kk] = (S.data.extraTurnos[kk] || []).filter(x => x.key !== k);
    (S.data.removedTurnos[kk] = S.data.removedTurnos[kk] || []).push(k);
    await escWriteGrid(ym, sid, g, eid); render();
  },
  escApplyImport: async () => {
    const prev = S.esc.preview; if (!prev) return;
    const ym = escYm();
    const notes = [];
    for (const g of prev.groups) {
      if (!g.setorId) { toast('Escolha o setor de cada aba com nome em aberto. Abra “Como ler esta aba?” se precisar.', true); continue; }
      g.items.filter(i => i.kind === 'unmatched').forEach(i => notes.push({ month: ym, setorId: g.setorId, setorNome: g.setorNome, day: i.day, raw: i.raw }));
      const ok = g.items.filter(i => i.doctorId);
      await escSaveSectorDraft(ym, g.setorId, ok);
    }
    const secs = new Set(prev.groups.map(g => g.setorId));
    S.data.importNotes = (S.data.importNotes || []).filter(n => !(n.month === ym && secs.has(n.setorId))).concat(notes);
    if (!REAL) demoSave();
    S.esc.view = 'grid';
    S.esc.preview = null;
    toast(notes.length ? `Escala trazida (ainda não salva). ${notes.length} nome(s) ficaram de fora — confira.` : 'Escala trazida. Confira e toque em Salvar.');
    render();
  },
  escMapOk: async () => {
    const sh = S.esc.mapSheet; if (!sh) return;
    const setorId = $('#escMapSetor')?.value;
    const dias = $('#escMapDias')?.value;
    const hor = $('#escMapHor')?.value;
    const kind = dias === 'list' ? 'list' : dias === 'sad' ? 'sad_weeks' : hor === 'svo' ? 'svo_marks' : dias === 'row' ? 'days_as_cols' : 'days_as_rows';
    sh.kind = kind;
    if (kind === 'days_as_rows' && (hor === 'um' || sh.headerRow == null)) sh.headerRow = -1;
    sh.setor = escSetores().find(s => s.id === setorId) || sh.setor;
    sh.conf = 1;
    S.data.layoutMaps = S.data.layoutMaps || {};
    S.data.layoutMaps[escNormName(sh.sheetName)] = { kind, setorId };
    if (!REAL) demoSave();
    const items = escParseSheet(sh, escYm());
    const groups = escGroupPreview(items);
    S.esc.preview = S.esc.preview || { groups: [], fileName: '' };
    // substitui / acrescenta este grupo
    const rest = S.esc.preview.groups.filter(g => g.setorNome !== (sh.setor?.name || sh.sheetName) && g.sheetName !== sh.sheetName);
    S.esc.preview.groups = rest.concat(groups);
    S.esc.mapSheet = null;
    S.esc.view = 'import';
    toast('Aba lida. Confira os nomes.');
    render();
  },
  escCopyPrev: () => escCopyPrev(null),
  escCopyPrevOne: () => escCopyPrev(S.esc.sectorId, S.esc.escalaId),
  escLimpar: () => escLimparEscala(),
  escLimparCancel: () => closeModal(),
  escLimparOk: () => escLimparOk(),
  escSalvar: () => escSalvar(),
  escPublish: () => escSalvar(), // nome antigo do botão
  escReopen: async () => {
    if (!confirm('Abrir de novo este mês para ajuste? A escala sai do ar para os médicos até você salvar outra vez.')) return;
    const ym = escYm();
    if (REAL) await rpc('reopen_month', { p_month: ym });
    escSchedules(ym).forEach(s => { s.status = 'draft'; });
    if (!REAL) demoSave();
    toast('Mês aberto para ajuste. Toque em Salvar quando terminar.');
    S.esc.view = 'grid'; render();
  },
  escPrint: () => escPrint(),
  escJump: el => { S.esc.sectorId = el.dataset.setor; S.esc.escalaId = el.dataset.escala || S.esc.escalaId; S.esc.view = 'grid'; render(); }
};

async function escCopyPrev(sectorId, escalaId) {
  const ym = escYm();
  const prev = escPrevYm(ym);
  const st = escMonthStatus(ym);
  const prevShifts = sectorId ? escShiftsOf(prev, sectorId, escalaId) : escShiftsOf(prev);
  if (!prevShifts.length) {
    toast('Ainda não há escala de ' + escMonthShort(prev) + (sectorId ? ' para este setor' : '') + '.', true);
    return;
  }
  if (!confirm(`Copiar a escala de ${fmtMonth(prev)} para ${fmtMonth(ym)}${sectorId ? ' (só ' + secName(sectorId) + (escalaId && escEscalaName(escalaId) ? ' · ' + escEscalaName(escalaId) : '') + ')' : ''}?\n\n${ESC_COPY_HINT}\nO que já estiver neste mês nesta escala será substituído.`)) return;
  if (REAL) {
    await rpc('copy_previous_month', { p_to_month: ym, p_sector: sectorId || null });
    await ensureMonth(ym);
  } else {
    const secs = sectorId ? [sectorId] : [...new Set(escSchedules(prev).map(s => s.sector_id))];
    let copied = 0;
    for (const sid of secs) {
      const items = [];
      escShiftsOf(prev, sid, (sectorId && escalaId) ? escalaId : null).forEach(s => {
        const day0 = +dayKey(s.starts_at).slice(8);
        const day = escMapWeekdayDay(prev, day0, ym);
        if (!day) return;
        const start = fmtH(s.starts_at), end = fmtH(s.ends_at);
        const rng = escRange(ym, day, start, end);
        items.push({ doctorId: s.doctor_id || null, raw: s.source_text || (s.doctor_id ? docName(s.doctor_id) : ''), kind: s.doctor_id ? 'exact' : 'fora', day, type: s.type, local: s.local || '', escala_id: s.escala_id || escalaId || null, turno: { key: start + '-' + end + (s.local || ''), label: start + '–' + end, start, end, type: s.type, local: s.local || '' }, ...rng });
      });
      if (!items.length && sectorId) { toast('Nenhum plantão de ' + escMonthShort(prev) + ' coube neste mês (pelo dia da semana).', true); return; }
      await escSaveSectorDraft(ym, sid, items, (sectorId && escalaId) ? escalaId : (items[0] && items[0].escala_id) || null);
      copied += items.length;
    }
    if (!copied) { toast('Nada foi copiado de ' + escMonthShort(prev) + '.', true); return; }
  }
  toast('Escala do mês passado copiada (mesmo dia da semana). Ajuste o que mudou, confira e toque em Salvar.');
  S.esc.view = 'grid'; render();
}

function escEscalaTitulo(sid, eid, ym) {
  const setor = secName(sid);
  const nome = eid ? escEscalaName(eid) : '';
  return (nome ? setor + ' – ' + nome : setor) + ' de ' + fmtMonth(ym);
}
function escTemMedicos(ym, sid, eid) {
  return escShiftsOf(ym, sid, eid).some(s => s.doctor_id || (s.source_text && String(s.source_text).trim()));
}
function escLimparEscala() {
  if (!isEscalista()) { toast('Só quem monta a escala pode limpar.', true); return; }
  const ym = escYm(), sid = S.esc.sectorId, eid = escEnsureEscala(sid);
  if (!escTemMedicos(ym, sid, eid)) { toast('A escala já está vazia.', true); return; }
  const titulo = escEscalaTitulo(sid, eid, ym);
  modal('Limpar escala', `
    <p>Limpar toda a escala de ${esc(titulo)}? Todos os médicos serão retirados.</p>
    <div class="form-actions">
      <button type="button" class="btn" data-act="escLimparCancel">Cancelar</button>
      <button type="button" class="btn danger" data-act="escLimparOk" id="escLimparOk">Limpar</button>
    </div>`);
}
async function escLimparOk() {
  closeModal();
  if (!isEscalista()) { toast('Só quem monta a escala pode limpar.', true); return; }
  const ym = escYm(), sid = S.esc.sectorId, eid = escEnsureEscala(sid);
  if (!escTemMedicos(ym, sid, eid)) { toast('A escala já está vazia.', true); return; }
  const g = escGrid(ym, sid, eid);
  const prevShifts = escShiftsOf(ym, sid, eid).map(s => ({ ...s }));
  const sch = (S.data.schedules || []).find(s => s.month_ref === ym && s.sector_id === sid);
  const prevStatus = sch ? sch.status : null;
  const tk = escTurnoStoreKey(ym, sid, eid);
  S.data.extraTurnos = S.data.extraTurnos || {};
  const kept = (S.data.extraTurnos[tk] || []).map(t => ({ ...t }));
  g.turnos.forEach(t => { if (!kept.some(x => x.key === t.key)) kept.push({ key: t.key, label: t.label, start: t.start, end: t.end, type: t.type, local: t.local || '' }); });
  S.data.extraTurnos[tk] = kept;
  g.turnos.forEach(t => { for (let d = 1; d <= g.n; d++) g.cells[t.key + '|' + d] = []; });
  S.esc.undoRepeat = { kind: 'clear', ym, sectorId: sid, escalaId: eid, prevShifts, prevStatus };
  await escWriteGrid(ym, sid, g, eid);
  toast('Escala limpa. Toque em Salvar para gravar, ou em Desfazer para voltar.');
  render();
}

// Salvar = gravar e deixar a escala valendo para os médicos (antes “Publicar”).
// As edições da grade já ficam gravadas a cada toque (como rascunho); Salvar torna o mês vigente
// (banco: publish_month → status 'published', original preservado). Se já estiver salvo, só confirma.
async function escSalvar() {
  const ym = escYm();
  const hadHora = typeof escHorarioPending === 'function' && escHorarioPending();
  if (typeof escCommitHorarios === 'function') await escCommitHorarios(ym);
  const warns = escWarnings(ym);
  const st = escMonthStatus(ym);
  if (!escSchedules(ym).length) { toast('Não há escala para salvar neste mês.', true); return; }
  if (st.k === 'published' && !hadHora) { toast('Escala salva. Os médicos já veem esta versão.'); return; }
  if (warns.length && !confirm(`A escala de ${fmtMonth(ym)} ainda tem ${warns.length} aviso(s). Salvar mesmo assim?\n\nDepois de salva, os médicos passam a ver esta escala (e ela entra no cruzamento com o ponto).`)) return;
  if (REAL) await rpc('publish_month', { p_month: ym });
  else {
    escSchedules(ym).forEach(s => { s.status = 'published'; });
    escShiftsOf(ym).forEach(s => { if (!s.original_doctor_id) s.original_doctor_id = s.doctor_id; });
    demoSave();
  }
  audit('SCHEDULE_PUBLISHED', 'Escala salva — mês ' + ym);
  toast('Escala salva. Os médicos já podem vê-la.');
  render();
}
const escPublish = escSalvar; // compatibilidade com o nome antigo

function escPrint() {
  S.esc.view = 'grid';
  render();
  window.print();
}

async function escDownloadXlsxBuf(buf, nome) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Modelo baixado.');
}
async function escTryDownloadOficial(nome) {
  try {
    if ((location.protocol || '') === 'file:') return false;
    const r = await fetch(new URL(nome, document.baseURI || location.href));
    if (!r.ok) return false;
    const buf = await r.arrayBuffer();
    if (!buf.byteLength) return false;
    await escDownloadXlsxBuf(buf, nome);
    return true;
  } catch (e) { return false; }
}
function escTipoColunas(titulo, colunas) {
  const sob = /buco|cardiologia|sobreaviso|pediatrica|pl[aá]stica|tor[aá]cica|vascular|endoscopia|ginecologia|nefrologia|otorrino|^svo/i.test(titulo);
  const tipo = sob ? 'Sobreaviso' : 'Plantão';
  return colunas.map(c => /^(DATA|DIA|DIA DA SEMANA|SEMANA|PER[ÍI]ODO)$/i.test(c) ? c : c + ' · ' + tipo);
}
function escAssinaturaLinhas(titulo) {
  const setor = (titulo || '').replace(/\s[-–].*$/, '').trim();
  const sec = (S.data.sectors || []).find(s => escNormName(s.name) === escNormName(setor));
  const coord = (sec && (typeof escCoord === 'function' ? escCoord(sec.id) : sec.coordenador)) || '______________________';
  const dir = (typeof escDiretor === 'function' ? escDiretor() : '') || 'Dra. Barbara Castro';
  return [[], [], ['Coordenador(a) da especialidade: ' + coord, '', 'Diretor(a) Técnico(a): ' + dir]];
}
async function escBaixarModelo() {
  if (window.ESCALAMED_MODELO_SETOR_B64) {
    const bin = Uint8Array.from(atob(window.ESCALAMED_MODELO_SETOR_B64), c => c.charCodeAt(0));
    await escDownloadXlsxBuf(bin, 'Modelo_Escala_EscalaMed.xlsx'); return;
  }
  if (await escTryDownloadOficial('Modelo_Escala_EscalaMed.xlsx')) return;
  await ensureXlsx();
  if (!window.XLSX) { toast('Não foi possível montar a planilha neste aparelho.', true); return; }
  const ym = escYm();
  const wb = XLSX.utils.book_new();
  const info = [
    ['Modelo de escala — EscalaMed · HMPGL'],
    [],
    ['Como usar'],
    ['1. Escolha a aba do setor (o formato de cada uma segue a escala que o hospital já publica).'],
    ['2. Escreva o nome do médico (ou a matrícula) em cada célula. Pode deixar em branco o plantão vago.'],
    ['3. Se no mesmo horário trabalham duas ou três pessoas, escreva um nome em cada linha da célula.'],
    ['4. Salve o arquivo e, no EscalaMed, toque em “Importar de um arquivo”.'],
    [],
    ['Também aceitamos a aba Lista (DATA, HORÁRIO, SETOR, MÉDICO/MATRÍCULA), a grade com os dias nas colunas, a escala do SAD (semanas/EMAD) e a grade do SVO.'],
    ['Não coloque CPF, telefone nem e-mail. Só nome ou matrícula.']
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(info), 'Instruções');
  const lista = [['Lista de plantões (um por linha)'], ['Preencha a data, o horário (ex.: 07:00-13:00), o setor e o nome ou a matrícula.'], [], ['DATA', 'HORÁRIO', 'SETOR', 'MÉDICO/MATRÍCULA']];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(lista), 'Lista');
  const n = escDays(ym);
  const [y, mo] = ym.split('-').map(Number);
  const wd = d => ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'][new Date(y, mo - 1, d).getDay() === 0 ? 6 : new Date(y, mo - 1, d).getDay() - 1];
  function sheetDaysRows(titulo, colunas, tipo) {
    const cols = escTipoColunas(titulo, colunas);
    const aoa = [[`ESCALA · ${titulo}`], [`SETOR: ${titulo}`, '', `MÊS: ${String(mo).padStart(2, '0')}/${y}`], [], cols];
    for (let d = 1; d <= n; d++) {
      const row = cols.map((h, i) => {
        const k = escNormName(h);
        if (k === 'data' || k === 'dia') return `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`;
        if (/semana/.test(k)) return wd(d);
        if (/periodo/.test(k)) return '24hs';
        return '';
      });
      aoa.push(row);
    }
    escAssinaturaLinhas(titulo).forEach(r => aoa.push(r));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, titulo.slice(0, 31));
  }
  const layouts = [
    ['PEDIATRIA', ['DATA', 'DIA DA SEMANA', 'MANHÃ', 'TARDE', 'NOITE']],
    ['ANESTESIA', ['DATA', 'DIA DA SEMANA', 'MANHÃ 7h00 às 13h00', 'TARDE 13h00 às 19h00', 'NOITE 19h00 às 01h00', 'NOITE 01h00 às 7h00']],
    ['CARDIOLOGIA', ['DATA', 'DIA DA SEMANA', 'DIURNO (07:00-19:00)', 'NOTURNO (19:00-07:00)']],
    ['CIRURGIA GERAL - Plantão', ['DATA', 'DIA DA SEMANA', 'MANHÃ', 'TARDE', 'NOITE']],
    ['CIRURGIA GERAL - Sobreaviso', ['DATA', 'DIA DA SEMANA', 'NOITE']],
    ['CIRURGIA GERAL - Visita', ['DATA', 'DIA DA SEMANA', 'MANHÃ/TARDE']],
    ['ENDOSCOPIA', ['DATA', 'DIA DA SEMANA', 'MÉDICO']],
    ['NEFROLOGIA', ['DATA', 'DIA DA SEMANA', 'MÉDICO']],
    ['NEUROCIRURGIA', ['DIA', 'SEMANA', 'P 1 (Primeiro plantonista)', 'PERÍODO', 'P 2 (Segundo plantonista)']],
    ['OFTALMOLOGIA', ['DATA', 'DIA DA SEMANA', 'MANHÃ', 'TARDE', 'NOITE']],
    ['PRONTO SOCORRO - Decisão', ['DATA', 'DIA DA SEMANA', 'MANHÃ', 'TARDE', 'NOITE']],
    ['PRONTO SOCORRO - 3º plantonista', ['DATA', 'DIA DA SEMANA', 'MANHÃ 1°', 'MANHÃ 2°', 'TARDE', 'NOITE (19h-01h)']],
    ['PSIQUIATRIA', ['DATA', 'DIA DA SEMANA', 'MANHÃ 06:00-12:00', 'TARDE 12:00-18:00']],
    ['UTI 1', ['DATA', 'DIA DA SEMANA', 'MANHÃ', 'TARDE', 'NOITE']],
    ['BUCO MAXILO', ['DATA', 'DIA DA SEMANA', 'MANHÃ', 'TARDE', 'NOITE']],
    ['CIRURGIA PEDIATRICA', ['DATA', 'DIA DA SEMANA', 'MÉDICO']],
    ['CIRURGIA PLÁSTICA', ['DATA', 'DIA DA SEMANA', 'MANHÃ 07:00-12:00', 'TARDE 12:00-17:00', 'NOITE 17:00-07:00']],
    ['CIRURGIA TORÁCICA', ['DATA', 'DIA DA SEMANA', 'DIURNO (7h-19h)', 'NOTURNO (19h-7h)']],
    ['CIRURGIA VASCULAR', ['DATA', 'DIA DA SEMANA', 'MÉDICO']],
    ['GINECOLOGIA', ['DATA', 'DIA DA SEMANA', 'DIURNO', 'NOTURNO']],
    ['ORTOPEDIA - Pronto-Socorro', ['DATA', 'DIA DA SEMANA', 'MANHÃ', 'TARDE', 'NOITE']],
    ['ORTOPEDIA - Visita', ['DATA', 'DIA DA SEMANA', 'MANHÃ']],
    ['OTORRINO', ['DATA', 'DIA DA SEMANA', 'DIURNO 07H-19H', 'NOTURNO 19H-07H']],
    ['RADIOLOGIA - Tomografia', ['DATA', 'DIA DA SEMANA', 'MANHÃ', 'TARDE', 'NOITE']],
    ['RADIOLOGIA - Ultrassom', ['DATA', 'DIA DA SEMANA', 'MANHÃ', 'TARDE', 'NOITE']],
    ['TRAUMA', ['DATA', 'DIA DA SEMANA', 'MANHÃ', 'TARDE', 'NOITE']],
    ['UROLOGIA', ['DATA', 'DIA DA SEMANA', 'MANHÃ', 'TARDE', 'NOITE']],
    ['UTI 2', ['DATA', 'DIA DA SEMANA', 'MANHÃ', 'TARDE', 'NOITE']],
    ['UTI 3', ['DATA', 'DIA DA SEMANA', 'MANHÃ', 'TARDE', 'NOITE']],
    ['UTI 4', ['DATA', 'DIA DA SEMANA', 'MANHÃ', 'TARDE', 'NOITE']]
  ];
  layouts.forEach(([t, c]) => sheetDaysRows(t, c));
  // SAD
  const sad = [['Escala SAD — HMPGL']];
  // first Sunday on or before day 1
  const first = new Date(y, mo - 1, 1);
  let start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7 + 1) % 7); // messy; use Sunday
  start = new Date(first);
  start.setDate(first.getDate() - first.getDay()); // JS Sunday=0
  const wdN = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  for (let w = 0; w < 6; w++) {
    const hdr = [''];
    for (let i = 0; i < 7; i++) {
      const dt = new Date(start); dt.setDate(start.getDate() + i);
      hdr.push(dt.getMonth() === mo - 1 ? `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')} (${wdN[dt.getDay()]})` : '');
    }
    sad.push(hdr);
    ['MANHÃ', 'TARDE'].forEach(bl => {
      sad.push([bl]);
      [1, 2, 3].forEach(e => sad.push(['EMAD ' + e, '', '', '', '', '', '', '']));
    });
    sad.push([]);
    start.setDate(start.getDate() + 7);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sad), 'SAD - Melhor em Casa');
  // SVO
  const svoHead = ['NOME', 'HORÁRIO', 'FUNÇÃO'].concat(Array.from({ length: n }, (_, i) => String(i + 1)));
  const svo = [[`SERVIÇO DE VERIFICAÇÃO DE ÓBITO (SVO) — ${ym}`], ['ESCALA DE PLANTÃO MÉDICOS ESTATUTÁRIOS'], svoHead, ['', '', ''], ['', '', ''], [], ['PLANTÃO DE SOBREAVISO — MÉDICOS CREDENCIADOS'], svoHead];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(svo), 'SVO');
  // grade genérica
  const gen = [[`ESCALA · Grade genérica`], [`SETOR: (escreva o setor)`, '', `MÊS: ${ym}`], [], ['HORÁRIO'].concat(Array.from({ length: n }, (_, i) => i + 1)), ['07:00-13:00'], ['13:00-19:00'], ['19:00-07:00']];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(gen), 'Grade genérica');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Modelo_Escala_EscalaMed.xlsx';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Modelo baixado.');
}

async function escReadFile(file) {
  if (!file) return;
  const fname = file.name || '';
  if (/\.pdf$/i.test(fname) || file.type === 'application/pdf') return escImportPdf(file);
  if (/\.docx$/i.test(fname) || /wordprocessingml/.test(file.type || '')) return escImportDocx(file);
  if (/\.doc$/i.test(fname)) { toast('O .doc antigo não é suportado. Salve como .docx, Excel ou PDF de texto.', true); return; }
  await ensureXlsx();
  if (!window.XLSX) { toast('Não foi possível ler a planilha neste aparelho.', true); return; }
  let wb;
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') { // CSV do Excel brasileiro costuma usar “;”
    const txt = await file.text();
    const first = txt.split(/\r?\n/)[0] || '';
    const FS = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
    wb = XLSX.read(txt, { type: 'string', FS, raw: true });
    wb.SheetNames = wb.SheetNames.map(() => file.name.replace(/\.csv$/i, ''));
    wb.Sheets = { [wb.SheetNames[0]]: Object.values(wb.Sheets)[0] };
  } else {
    wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  }
  if (typeof escIsModeloPadrao === 'function' && escIsModeloPadrao(wb)) {
    const prev = escParseModeloPadrao(wb);
    S.esc.preview = prev;
    S.esc.mapSheet = null;
    S.esc.view = 'import';
    S.esc.sectorId = prev.groups[0]?.setorId || prev.groups[0]?.setorNome || '';
    toast(prev.groups.length ? 'Modelo padrão lido. Confira os nomes e toque em “Usar esta escala”.' : 'Não achei plantões neste modelo padrão.', !prev.groups.length);
    render();
    return;
  }
  const ym = escYm();
  const groups = [];
  const pendingMap = [];
  wb.SheetNames.forEach(name => {
    if (/instru|m[eé]dicos|_listas/i.test(name)) return;
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    if (!aoa.length) return;
    const det = escDetectSheet(aoa, name);
    if (det.kind === 'unknown' || det.conf < 0.6) { pendingMap.push(det); return; }
    const items = escParseSheet(det, ym);
    if (!items.length && det.kind !== 'list') { pendingMap.push(det); return; }
    escGroupPreview(items).forEach(g => { g.sheetName = name; g.det = det; groups.push(g); });
  });
  S.esc.preview = { groups, fileName: file.name };
  if (pendingMap.length) {
    S.esc.mapSheet = pendingMap[0];
    S.esc.view = 'map';
    toast('Algumas abas precisam que você diga como ler. Começando pela aba “' + pendingMap[0].sheetName + '”.');
  } else {
    S.esc.view = 'import';
    toast('Planilha lida. Confira os nomes destacados e toque em “Usar esta escala”.');
  }
  S.esc.sectorId = groups[0]?.setorId || groups[0]?.setorNome || '';
  render();
}

// soltar arquivo
document.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files') && S.page === 'montar') { e.preventDefault(); $('#escDrop')?.classList.add('over'); } });
document.addEventListener('dragleave', e => { if (e.target.id === 'escDrop') e.target.classList.remove('over'); });
document.addEventListener('drop', e => {
  if (S.page !== 'montar' || S.esc.view !== 'import') return;
  const f = e.dataTransfer?.files?.[0]; if (!f) return;
  e.preventDefault();
  run(() => escReadFile(f));
});
// ── Habilitações, modelo padrão HMPGL_v1, repetir médico na grade ──

function escDoctorsHabilitados(sectorId) {
  return (S.data.doctors || []).filter(d => (d.sector_ids || []).includes(sectorId))
    .slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

async function escSetHabilitacao(doctorId, sectorId, on) {
  const d = doc(doctorId);
  if (!d || !sectorId) return;
  const set = new Set(d.sector_ids || []);
  if (on) set.add(sectorId); else set.delete(sectorId);
  d.sector_ids = [...set];
  if (!REAL) { demoSave(); return; }
  try {
    if (typeof rpc === 'function') await rpc('set_doctor_sector', { p_doctor: doctorId, p_sector: sectorId, p_on: on });
    else if (S.sb) {
      if (on) await S.sb.from('doctor_sectors').insert({ doctor_id: doctorId, sector_id: sectorId });
      else await S.sb.from('doctor_sectors').delete().match({ doctor_id: doctorId, sector_id: sectorId });
    }
  } catch (e) { toast('Não foi possível salvar a habilitação: ' + (e.message || e), true); }
}

PAGES.habilitacoes = () => {
  const setores = escSetores().filter(s => s.name !== 'TESTE');
  const sid = S.esc.habSectorId || S.esc.sectorId || setores[0]?.id;
  S.esc.habSectorId = sid;
  const list = sid ? escDoctorsHabilitados(sid) : [];
  const q = S.esc.habQ || '';
  const nq = escNormName(q);
  const cand = nq ? (S.data.doctors || []).filter(d => d.active !== false && !list.some(x => x.id === d.id) && (escNormName(d.name).includes(nq) || String(d.matricula || '').includes(q.replace(/\D/g, '')))).slice(0, 12) : [];
  const addBtn = isEscalista() ? '<button type="button" class="btn primary" data-act="escHabNovoMed" id="escHabNovoMed">Adicionar médico</button>' : '';
  const row = d => {
    const ced = typeof escDocCedido === 'function' && escDocCedido(d);
    const meta = typeof escHabListMeta === 'function' ? escHabListMeta(d) : ('matrícula ' + (d.matricula || '—'));
    const tagCed = ced ? ' ' + tag('cedido', 'blue', d.vinculo || 'Cedido pela prefeitura') : '';
    const inat = d.active === false ? ' ' + tag('inativo', 'gray') : '';
    let acts = `<button type="button" class="btn link small" data-act="escHabDel" data-id="${d.id}">Tirar</button>`;
    if (typeof escPodeEditarCedido === 'function' && escPodeEditarCedido(d)) {
      acts = `<span class="esc-hab-actions"><button type="button" class="btn link small" data-act="escHabEditMed" data-id="${d.id}">Editar</button><button type="button" class="btn link small" data-act="escHabDelMed" data-id="${d.id}">Excluir</button>${acts}</span>`;
    }
    return `<li><span><b>${esc(d.name)}</b>${tagCed}${inat}<small>${esc(meta)}</small></span>${acts}</li>`;
  };
  return header('Quem pode ser escalado', 'Esta lista é a que aparece ao escolher o médico na grade. Começa com o contrato e com quem já entra na escala; você inclui ou tira alguém quando precisar. Médicos cedidos pela prefeitura, que não estão nos contratos, podem ser cadastrados aqui.', addBtn) + `
    <div class="esc-bar">
      <label>Setor <select data-act="escHabSetor">${setores.map(s => opt(s.id, s.name, sid)).join('')}</select></label>
      <span class="muted">${list.length} médico(s) habilitado(s)</span>
    </div>
    <div class="esc-hab">
      <div class="esc-hab-add">
        <input type="search" placeholder="Incluir: buscar por nome ou matrícula" data-act="escHabQ" value="${esc(q)}">
        ${cand.length ? `<div class="lst">${cand.map(d => `<button type="button" data-act="escHabAdd" data-id="${d.id}"><b>${esc(d.name)}</b><small>${esc(typeof escHabListMeta === 'function' ? escHabListMeta(d) : ('matrícula ' + (d.matricula || '—')))}</small></button>`).join('')}</div>` : (nq ? '<p class="muted">Nenhum médico fora da lista com esse nome.</p>' : '<p class="muted">Digite um nome para incluir alguém neste setor, ou use Adicionar médico para cadastrar um cedido da prefeitura.</p>')}
      </div>
      <ul class="esc-hab-list">${list.map(row).join('') || '<li class="muted">Ninguém habilitado neste setor ainda.</li>'}</ul>
    </div>`;
};

function escWeekdayName(ym, day) {
  const w = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const dt = new Date(ym + '-' + String(day).padStart(2, '0') + 'T12:00:00-03:00');
  return w[dt.getDay()] || '';
}
function escDow(ym, day) {
  return new Date(ym + '-' + String(day).padStart(2, '0') + 'T12:00:00-03:00').getDay();
}
function escRepeatDays(ym, day, mode, ate) {
  const n = escDays(ym);
  const days = [];
  const dow0 = escDow(ym, day);
  const last = (mode === 'ate') ? Math.min(n, Math.max(day, +ate || day)) : n;
  for (let d = 1; d <= n; d++) {
    const dow = escDow(ym, d);
    const util = dow >= 1 && dow <= 5;
    if (mode === 'one' && d === day) days.push(d);
    else if (mode === 'all') days.push(d);
    else if (mode === 'uteis' && util) days.push(d);
    else if (mode === 'fds' && (dow === 0 || dow === 6)) days.push(d);
    else if (mode === 'dow' && dow === dow0) days.push(d);
    else if (mode === 'ate' && d >= day && d <= last) days.push(d);
  }
  return days;
}
function escRepeatHtml(opts) {
  if (!opts.repeatable) return '';
  const day = opts.day, ym = opts.ym || escYm();
  const wd = escWeekdayName(ym, day);
  return `<div class="esc-rep">
    <div class="esc-rep-lab">Repetir neste horário:</div>
    <label><input type="radio" name="escRep" value="one" checked> só este dia</label>
    <label><input type="radio" name="escRep" value="all"> todos os dias do mês</label>
    <label><input type="radio" name="escRep" value="uteis"> dias úteis (seg–sex)</label>
    <label><input type="radio" name="escRep" value="fds"> fins de semana</label>
    <label><input type="radio" name="escRep" value="dow"> toda ${esc(wd)}</label>
    <label><input type="radio" name="escRep" value="ate"> até o dia <input type="number" id="escRepAte" min="${day}" max="31" value="${escDays(ym)}"></label>
    <label class="esc-rep-ow"><input type="checkbox" id="escRepOverwrite"> substituir quem já está</label>
  </div>`;
}

async function escApplyRepeat({ doctorId, mode, ate, overwrite, ym, sectorId, turno, day }) {
  const g = escGrid(ym, sectorId, S.esc.escalaId);
  const t = turno;
  const days = escRepeatDays(ym, day, mode || 'one', ate);
  const changes = [];
  const conflicts = [];
  days.forEach(d => {
    const key = t.key + '|' + d;
    const arr = g.cells[key] || [];
    const filled = arr.some(c => c.doctorId || (c.raw && String(c.raw).trim()));
    if (filled && !overwrite && d !== day) return;
    const ef = typeof escTurnoEf === "function" ? escTurnoEf(t, d, ym, sectorId, S.esc.escalaId) : t;
    const rng = escRange(ym, d, ef.start, ef.end);
    const others = escConflictsFor(doctorId, rng.starts_at, rng.ends_at, s => escSameSlot(s, sectorId, rng.starts_at, rng.ends_at, t.local || ''));
    if (others.length) conflicts.push({ day: d, others });
    changes.push({ day: d, prev: (arr || []).map(c => ({ ...c })), rng });
  });
  if (!changes.length) { toast('Nenhum dia para preencher (os outros já têm médico).', true); return false; }
  if (conflicts.length) {
    const lines = conflicts.slice(0, 8).map(c => `dia ${c.day}: ${escConflictMsg(docName(doctorId), c.others)}`);
    const extra = conflicts.length > 8 ? `\n… e mais ${conflicts.length - 8}` : '';
    if (!confirm(`${docName(doctorId)} já está escalado em outro lugar em ${conflicts.length} dia(s):\n\n${lines.join('\n')}${extra}\n\nColocar mesmo assim?`)) return false;
  } else if (changes.length > 1) {
    if (!confirm(`Colocar ${docName(doctorId)} em ${changes.length} dias neste horário?`)) return false;
  }
  S.esc.undoRepeat = { ym, sectorId, tk: t.key, start: t.start, end: t.end, local: t.local || '', changes };
  changes.forEach(ch => {
    g.cells[t.key + '|' + ch.day] = [{ doctorId, raw: docName(doctorId), kind: 'exact' }];
  });
  await escWriteGrid(ym, sectorId, g, S.esc.escalaId);
  const msg = changes.length === 1 ? 'Médico colocado.' : `${docName(doctorId)} colocado em ${changes.length} dias.`;
  toast(msg + (conflicts.length ? ' Há conflito em ' + conflicts.length + ' dia(s).' : ''));
  return true;
}

async function escUndoRepeat() {
  const u = S.esc.undoRepeat;
  if (!u) { toast('Nada para desfazer.', true); return; }
  if (u.kind === 'horario' && typeof escUndoHorario === 'function') { return escUndoHorario(u); }
  if (u.kind === 'clear') {
    const items = (u.prevShifts || []).map(s => {
      const day = +dayKey(s.starts_at).slice(8);
      const kind = (!s.doctor_id || s.match_conf === 'fora_cadastro') ? 'fora' : (s.match_conf === 'media' ? 'similar' : 'exact');
      return {
        doctorId: s.doctor_id || null,
        raw: s.source_text || (s.doctor_id ? docName(s.doctor_id) : ''),
        kind, day, type: s.type, local: s.local || '',
        escala_id: s.escala_id || u.escalaId || null,
        starts_at: s.starts_at, ends_at: s.ends_at
      };
    });
    await escSaveSectorDraft(u.ym, u.sectorId, items, u.escalaId || null);
    const sch = (S.data.schedules || []).find(s => s.month_ref === u.ym && s.sector_id === u.sectorId);
    if (sch && u.prevStatus) {
      sch.status = u.prevStatus;
      if (!REAL) demoSave();
      else if (u.prevStatus === 'published' && S.sb) {
        const { error } = await S.sb.from('schedules').update({ status: 'published' }).eq('id', sch.id);
        if (error) console.warn('Não foi possível devolver o status publicado:', error.message);
      }
    }
    S.esc.undoRepeat = null;
    toast('Limpeza desfeita.');
    render();
    return;
  }
  const g = escGrid(u.ym, u.sectorId, S.esc.escalaId);
  const keys = g.turnos.filter(t => t.key === u.tk || (u.start && t.start === u.start && t.end === u.end)).map(t => t.key);
  if (u.tk && !keys.includes(u.tk)) keys.push(u.tk);
  u.changes.forEach(ch => { keys.forEach(k => { g.cells[k + '|' + ch.day] = ch.prev; }); });
  await escWriteGrid(u.ym, u.sectorId, g, S.esc.escalaId);
  S.esc.undoRepeat = null;
  toast('Repetição desfeita.');
  render();
}

async function escCopyNextDay(tk, day) {
  const ym = escYm(), sid = S.esc.sectorId, eid = S.esc.escalaId, g = escGrid(ym, sid, eid);
  const t = g.turnos.find(x => x.key === tk);
  if (!t) return;
  const n = escDays(ym);
  if (day >= n) { toast('Não há próximo dia neste mês.', true); return; }
  const src = g.cells[tk + '|' + day] || [];
  if (!src.length || !src[0].doctorId) { toast('Esta célula está vazia.', true); return; }
  const dest = g.cells[tk + '|' + (day + 1)] || [];
  if (dest.some(c => c.doctorId || (c.raw && String(c.raw).trim()))) {
    if (!confirm('O próximo dia já tem médico. Substituir?')) return;
  }
  const id = src[0].doctorId;
  const rng = escRange(ym, day + 1, t.start, t.end);
  const others = escConflictsFor(id, rng.starts_at, rng.ends_at, s => escSameSlot(s, sid, rng.starts_at, rng.ends_at, t.local || ''));
  if (others.length && !confirm(escConflictMsg(docName(id), others) + '\n\nCopiar mesmo assim?')) return;
  S.esc.undoRepeat = { ym, sectorId: sid, tk, changes: [{ day: day + 1, prev: dest.map(c => ({ ...c })) }] };
  g.cells[tk + '|' + (day + 1)] = src.map(c => ({ ...c }));
  await escWriteGrid(ym, sid, g, eid);
  toast('Copiado para o dia ' + (day + 1) + '.');
  render();
}

// ── Modelo padrão HMPGL_v1 ──
function escIsModeloPadrao(wb) {
  const names = (wb.Workbook && wb.Workbook.Names) || [];
  if (names.some(n => /MODELO_PADRAO/i.test(n.Name || n.name || '') && /HMPGL_v1/i.test(String(n.Ref || n.ref || '')))) return true;
  const sh = wb.Sheets && (wb.Sheets.Escala || wb.Sheets[wb.SheetNames.find(n => /^escala$/i.test(n)) || '']);
  if (!sh) return false;
  const aoa = XLSX.utils.sheet_to_json(sh, { header: 1, raw: true, defval: '' });
  return /modelo padr[aã]o/i.test(String((aoa[0] || [])[0] || ''));
}
function escModeloField(aoa, labels) {
  const want = labels.map(escNormName);
  const skip = new Set(['setor', 'mes', 'ano', 'responsavel', 'local', 'local area opcional', 'area'].concat(want));
  for (let r = 0; r < Math.min(8, aoa.length); r++) {
    const row = aoa[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (!want.includes(escNormName(row[c]))) continue;
      for (let k = c + 1; k < Math.min(c + 5, row.length); k++) {
        const v = row[k];
        if (v === '' || v == null) continue;
        if (skip.has(escNormName(v))) continue;
        return v;
      }
    }
  }
  return '';
}
function escParseMesNome(v) {
  const t = escNormName(v);
  const meses = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const i = meses.indexOf(t);
  if (i >= 0) return i + 1;
  if (v instanceof Date && !isNaN(v)) return v.getMonth() + 1;
  const n = parseInt(t, 10);
  if (n >= 1 && n <= 12) return n;
  const m = String(v || '').match(/(\d{1,2})\s*[\/\-]\s*(\d{4})/);
  if (m) return +m[1];
  return null;
}
function escParseNomeMat(s) {
  const t = String(s || '').trim();
  const m = t.match(/^(.*?)\s*[—–−-]\s*(\d{1,8})\s*$/);
  if (m) return { raw: t, nome: m[1].trim(), mat: m[2] };
  return { raw: t, nome: t, mat: null };
}
function escParseModeloPadrao(wb) {
  const name = (wb.SheetNames || []).find(n => /^escala$/i.test(n)) || wb.SheetNames[0];
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
  const setorNome = String(escModeloField(aoa, ['Setor']) || '').trim();
  const mesN = escParseMesNome(escModeloField(aoa, ['Mês', 'Mes']));
  let ano = escModeloField(aoa, ['Ano']);
  if (ano instanceof Date) ano = ano.getFullYear();
  ano = parseInt(ano, 10) || null;
  const local = String(escModeloField(aoa, ['Local / área (opcional)', 'Local / area (opcional)', 'Local', 'Área']) || '').trim();
  const locOk = local && !/^local/.test(escNormName(local)) ? local : '';
  if (mesN && ano) {
    const ym = ano + '-' + String(mesN).padStart(2, '0');
    S.esc.month = ym; S.f.month = ym;
  }
  const ym = escYm();
  const setor = escGuessSetor(setorNome, aoa) || escSetores().find(s => escNormName(s.name) === escNormName(setorNome));
  let headerRow = aoa.findIndex(r => {
    const cells = (r || []).map(c => escNormName(c)).filter(Boolean);
    if (cells.length < 2) return false; // ignora o parágrafo de ajuda, que cita “Diurno (07:00-19:00)” numa célula só
    const hasData = cells.some(n => n === 'data' || n === 'dia' || n === 'dia do mes' || n === 'dia da semana');
    const hasTurno = cells.some(n => /manha|tarde|noite|diurno|noturno|turno /.test(n) || /\d{1,2}\s*[:h]\s*\d{0,2}/.test(n));
    return hasData && hasTurno;
  });
  if (headerRow < 0) headerRow = 6;
  const head = aoa[headerRow] || [];
  const turnos = [];
  let dayCol = 0;
  head.forEach((c, i) => {
    const n = escNormName(c);
    if (n === 'data' || n === 'dia' || n === 'dia do mes') { dayCol = i; return; }
    if (/semana/.test(n) || !n) return;
    if (/^turno [456]/.test(n) || /opcional/.test(n)) {
      turnos.push({ col: i, label: String(c), start: null, end: null, type: 'Plantão', optional: true });
      return;
    }
    const hor = escParseHorario(c, setorNome || setor?.name);
    if (hor) turnos.push({ col: i, label: String(c), start: hor.start, end: hor.end, type: /sobreaviso/i.test(n) ? 'Sobreaviso' : (hor.type || 'Plantão'), optional: false });
  });
  const items = [];
  const nDays = escDays(ym);
  for (let r = headerRow + 1, i = 1; r < aoa.length && i <= 31; r++, i++) {
    const row = aoa[r] || [];
    let day = i;
    const dv = row[dayCol];
    if (dv instanceof Date && !isNaN(dv)) day = dv.getDate();
    else if (typeof dv === 'number' && dv > 20000) { // serial excel
      const d0 = new Date(Date.UTC(1899, 11, 30) + dv * 86400e3);
      day = d0.getUTCDate();
    }
    if (day < 1 || day > nDays) continue;
    turnos.forEach(t => {
      const raw = row[t.col];
      if (raw === '' || raw == null) return;
      if (t.optional && !t.start) { t.start = '07:00'; t.end = '19:00'; }
      if (!t.start) return;
      const turno = { key: t.start + '-' + t.end + (locOk || ''), label: t.label, start: t.start, end: t.end, type: t.type, local: locOk };
      String(raw).split(/\s*;\s*|\n+|\r+/).map(s => s.trim()).filter(Boolean).forEach(part => {
        const nm = escParseNomeMat(part);
        let m;
        if (nm.mat) {
          const id = (S.data.doctors || []).find(d => normMatricula(d.matricula) === normMatricula(nm.mat))?.id;
          m = id ? { kind: 'exact', raw: nm.raw, doctorId: id, score: 1, via: 'matricula' } : escMatchOne(nm.nome, setor?.id);
          if (!id && m.kind === 'unmatched') m.raw = nm.raw;
        } else m = escMatchOne(nm.nome, setor?.id);
        const rng = escRange(ym, day, t.start, t.end);
        items.push({ ...m, day, turno, type: t.type, local: locOk, setorId: setor?.id, setorNome: setor?.name || setorNome, ...rng });
      });
    });
  }
  const groups = escGroupPreview(items);
  groups.forEach(g => { g.sheetName = name; g.det = { kind: 'modelo_padrao', conf: 1, sheetName: name, setor }; });
  return { groups, fileName: 'Modelo padrão', modeloPadrao: true };
}
function escBaixarModeloPadrao() {
  const b64 = window.ESCALAMED_MODELO_PADRAO_B64;
  if (!b64) { toast('O modelo padrão não está nesta cópia do app.', true); return; }
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const blob = new Blob([bin], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Modelo_Padrao_Escala_HMPGL.xlsx';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Modelo padrão baixado.');
}

Object.assign(EscAct, {
  escHabSetor: el => { S.esc.habSectorId = el.value; render(); },
  escHabQ: (el, e) => { if (e && e.type !== 'input') return; S.esc.habQ = el.value; const box = el.closest('.esc-hab-add'); if (!box) return render();
    const keep = el.selectionStart; render(); const nx = document.querySelector('[data-act=escHabQ]'); if (nx) { nx.focus(); try { nx.setSelectionRange(keep, keep); } catch (err) { /* */ } }
  },
  escHabAdd: async el => { await escSetHabilitacao(el.dataset.id, S.esc.habSectorId, true); S.esc.habQ = ''; toast('Médico incluído neste setor.'); render(); },
  escHabDel: async el => { await escSetHabilitacao(el.dataset.id, S.esc.habSectorId, false); toast('Médico retirado deste setor.'); render(); },
  escBaixarModeloPadrao: () => escBaixarModeloPadrao(),
  escUndoRepeat: () => escUndoRepeat(),
  escCopyNext: el => escCopyNextDay(el.dataset.tk, +el.dataset.day)
});
// ── Importar de um arquivo: Excel/CSV (já existente), Word (.docx) e PDF de texto ──
// PDF escaneado: não embutimos Tesseract (o motor + idioma pesam dezenas de MB).
// Nesse caso mostramos: "PDF escaneado: não dá para ler com segurança — use o modelo Excel".

function escSetupPdfWorker() {
  const lib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
  if (!lib) return null;
  window.pdfjsLib = lib;
  if (!lib.GlobalWorkerOptions.workerSrc) {
    if (window.PDFJS_WORKER_SRC) {
      const blob = new Blob([window.PDFJS_WORKER_SRC], { type: 'application/javascript' });
      lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
    } else {
      lib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    }
  }
  return lib;
}
function ensurePdfJs() {
  if (escSetupPdfWorker()) return Promise.resolve(true);
  return new Promise(res => {
    const sc = document.createElement('script');
    sc.src = 'vendor/pdf.min.js';
    const t = setTimeout(() => res(!!escSetupPdfWorker()), 4000);
    sc.onload = () => { clearTimeout(t); res(!!escSetupPdfWorker()); };
    sc.onerror = () => { clearTimeout(t); res(false); };
    document.head.appendChild(sc);
  });
}

async function escZipRead(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const view = new DataView(u.buffer, u.byteOffset, u.byteLength);
  const u16 = i => view.getUint16(i, true), u32 = i => view.getUint32(i, true);
  let eocd = -1;
  for (let i = u.length - 22; i >= Math.max(0, u.length - 22 - 65536); i--) {
    if (u32(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Arquivo .docx inválido (não é um ZIP).');
  const n = u16(eocd + 10);
  let off = u32(eocd + 16);
  const files = {};
  for (let i = 0; i < n; i++) {
    if (u32(off) !== 0x02014b50) break;
    const method = u16(off + 10), cs = u32(off + 20), nl = u16(off + 28), xl = u16(off + 30), cl = u16(off + 32);
    const name = new TextDecoder('utf-8').decode(u.subarray(off + 46, off + 46 + nl));
    const loff = u32(off + 42);
    const ln = u16(loff + 26), lx = u16(loff + 28);
    files[name] = { method, data: u.subarray(loff + 30 + ln + lx, loff + 30 + ln + lx + cs) };
    off += 46 + nl + xl + cl;
  }
  return {
    files,
    async get(name) {
      const f = files[name];
      if (!f) return null;
      if (f.method === 0) return f.data;
      if (f.method !== 8) throw new Error('Compressão do Word não suportada.');
      const ds = new DecompressionStream('deflate-raw');
      const stream = new Blob([f.data]).stream().pipeThrough(ds);
      const ab = await new Response(stream).arrayBuffer();
      return new Uint8Array(ab);
    }
  };
}
function escXmlLocal(el, name) {
  return [...(el.getElementsByTagName ? el.getElementsByTagName('*') : [])].filter(x => x.localName === name);
}
function escDocxCellText(tc) {
  const parts = [];
  const walk = n => {
    if (!n) return;
    if (n.localName === 't') parts.push(n.textContent || '');
    else if (n.localName === 'br' || n.localName === 'cr' || n.localName === 'tab') parts.push(n.localName === 'tab' ? ' ' : '\n');
    for (const c of n.childNodes || []) walk(c);
  };
  walk(tc);
  return parts.join('').replace(/\n+/g, '\n').trim();
}
function escDocxToSheets(xmlStr) {
  const doc = new DOMParser().parseFromString(xmlStr, 'application/xml');
  const body = escXmlLocal(doc, 'body')[0] || doc;
  const title = [];
  const sheets = [];
  let pendingTitle = [];
  for (const ch of body.childNodes || []) {
    if (ch.localName === 'p') {
      const t = escDocxCellText(ch);
      if (t) pendingTitle.push([t]);
    } else if (ch.localName === 'tbl') {
      const aoa = pendingTitle.splice(0);
      escXmlLocal(ch, 'tr').forEach(tr => {
        const row = [];
        // only direct cells: tr > tc
        [...tr.childNodes].forEach(tc => {
          if (tc.localName === 'tc') row.push(escDocxCellText(tc));
        });
        if (row.some(c => String(c).trim())) aoa.push(row);
      });
      if (aoa.length) sheets.push({ name: title.length ? ('Tabela ' + (sheets.length + 1)) : 'Documento', aoa });
    }
  }
  if (!sheets.length && pendingTitle.length) sheets.push({ name: 'Documento', aoa: pendingTitle });
  return sheets;
}

function escPdfItemsToAoa(items) {
  const pts = items.map(it => {
    const tr = it.transform || [1, 0, 0, 1, 0, 0];
    return { t: String(it.str || ''), x: tr[4], y: tr[5], w: it.width || 0, h: Math.abs(tr[3] || it.height || 10) };
  }).filter(p => p.t.trim());
  if (!pts.length) return [];
  pts.sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const med = arr => { const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)] || 10; };
  const clusters = [];
  pts.forEach(p => {
    const last = clusters[clusters.length - 1];
    const tol = Math.max(5, med((last || [p]).map(x => x.h)) * 0.65);
    if (last && Math.abs(last[0].y - p.y) <= tol) last.push(p);
    else clusters.push([p]);
  });
  return clusters.map(row => {
    row.sort((a, b) => a.x - b.x);
    const cells = [];
    let cur = row[0].t, px = row[0].x + (row[0].w || 0);
    for (let i = 1; i < row.length; i++) {
      const gap = row[i].x - px;
      if (gap < Math.max(8, row[i].h * 0.9)) {
        const needSp = !/\s$/.test(cur) && !/^\s/.test(row[i].t);
        cur += (needSp && gap > 1.5 ? ' ' : '') + row[i].t;
      } else {
        cells.push(cur.replace(/\s+/g, ' ').trim());
        cur = row[i].t;
      }
      px = row[i].x + (row[i].w || 0);
    }
    cells.push(cur.replace(/\s+/g, ' ').trim());
    return cells;
  });
}

async function escPdfToSheets(buf) {
  const lib = escSetupPdfWorker();
  if (!lib) throw new Error('Leitor de PDF não está nesta cópia do app.');
  const data = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const pdf = await lib.getDocument({ data, verbosity: 0 }).promise;
  const sheets = [];
  let textChars = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent({ disableCombineTextItems: false });
    const items = (tc.items || []).filter(it => (it.str || '').trim());
    textChars += items.reduce((n, it) => n + String(it.str).trim().length, 0);
    const aoa = escPdfItemsToAoa(items);
    if (aoa.length) sheets.push({ name: pdf.numPages === 1 ? 'PDF' : ('Página ' + p), aoa });
  }
  return { sheets, textChars, pages: pdf.numPages };
}

function escPreviewFromSheets(sheets, fileName) {
  const ym = escYm();
  const groups = [];
  const pendingMap = [];
  (sheets || []).forEach(sh => {
    const name = sh.name || 'Arquivo';
    const aoa = sh.aoa || [];
    if (!aoa.length) return;
    const det = escDetectSheet(aoa, name);
    if (det.kind === 'unknown' || det.conf < 0.6) { pendingMap.push(det); return; }
    const items = escParseSheet(det, ym);
    if (!items.length && det.kind !== 'list') { pendingMap.push(det); return; }
    escGroupPreview(items).forEach(g => { g.sheetName = name; g.det = det; groups.push(g); });
  });
  S.esc.preview = { groups, fileName };
  S.esc.importNote = '';
  if (pendingMap.length) {
    S.esc.mapSheet = pendingMap[0];
    S.esc.view = 'map';
    toast('Algumas páginas/abas precisam que você diga como ler. Começando por “' + pendingMap[0].sheetName + '”.');
  } else {
    S.esc.mapSheet = null;
    S.esc.view = 'import';
    toast(groups.length ? 'Arquivo lido. Confira os nomes destacados e toque em “Usar esta escala”.' : 'Não encontrei plantões neste arquivo.', !groups.length);
  }
  S.esc.sectorId = groups[0]?.setorId || groups[0]?.setorNome || '';
  render();
}

async function escImportDocx(file) {
  try {
    const zip = await escZipRead(await file.arrayBuffer());
    const xml = await zip.get('word/document.xml');
    if (!xml) throw new Error('Não achei o conteúdo do Word (document.xml).');
    const txt = new TextDecoder('utf-8').decode(xml);
    const sheets = escDocxToSheets(txt);
    if (!sheets.length) { toast('Não achei tabela neste Word. Use o modelo Excel ou uma tabela no documento.', true); return; }
    escPreviewFromSheets(sheets, file.name);
  } catch (e) {
    console.error(e);
    toast(e.message || 'Não foi possível ler o Word.', true);
  }
}

const ESC_PDF_SCANNED = 'PDF escaneado: não dá para ler com segurança — use o modelo Excel';

async function escImportPdf(file) {
  S.esc.importNote = '';
  try {
    const ok = await ensurePdfJs();
    if (!ok) { toast('Não foi possível ler o PDF neste aparelho.', true); return; }
    const { sheets, textChars, pages } = await escPdfToSheets(await file.arrayBuffer());
    if (textChars < Math.max(80, 25 * (pages || 1))) {
      S.esc.preview = null;
      S.esc.mapSheet = null;
      S.esc.importNote = ESC_PDF_SCANNED;
      S.esc.view = 'import';
      toast(ESC_PDF_SCANNED, true);
      render();
      return;
    }
    escPreviewFromSheets(sheets, file.name);
  } catch (e) {
    console.error(e);
    toast(e.message || 'Não foi possível ler o PDF.', true);
  }
}

function escFileTypeIcons() {
  return `<span class="esc-ftypes" aria-hidden="true">
    <span class="ft pdf" title="PDF">PDF</span>
    <span class="ft xlsx" title="Excel">XLSX</span>
    <span class="ft docx" title="Word">DOCX</span>
    <span class="ft csv" title="CSV">CSV</span>
  </span>`;
}
// ── Cabeçalho/rodapé oficiais (logos, coordenador, diretor técnico) e tipo por horário ──
function escCoord(sid, escalaId) {
  const e = escalaId && (S.data.escalas || []).find(x => x.id === escalaId);
  if (e && e.coordenador) return e.coordenador;
  const ov = ((S.data.settings || {}).coordenadores || {})[sid];
  if (ov != null && ov !== '') return ov;
  return (S.data.sectors || []).find(s => s.id === sid)?.coordenador || '';
}
function escDiretor() {
  const v = (S.data.settings || {}).diretor_tecnico;
  return v != null ? v : (((window.ESCALAMED_SEED || {}).settings || {}).diretor_tecnico || 'Dra. Barbara Castro');
}
function escOfficialHeader(sid, ym) {
  const L = window.ESCALAMED_LOGO_HMPGL || '', R = window.ESCALAMED_LOGO_FMS || '';
  return `<div class="esc-ofi-head">
    ${L ? `<img class="lg" src="${L}" alt="HMPGL">` : '<span></span>'}
    <div class="tx"><b>HOSPITAL MUNICIPAL PADRE GERMANO LAUCK</b><b>FUNDAÇÃO MUNICIPAL DE SAÚDE</b>
      <span>Setor: <b>${esc(secName(sid))}${S.esc?.escalaId && escEscalaName(S.esc.escalaId) ? ' · ' + esc(escEscalaName(S.esc.escalaId)) : ''}</b> · Mês/ano: <b>${esc(fmtMonth(ym))}</b></span></div>
    ${R ? `<img class="lg" src="${R}" alt="Fundação Municipal de Saúde">` : '<span></span>'}
  </div>`;
}
function escOfficialFooter(sid) {
  const c = escCoord(sid, S.esc?.escalaId), d = escDiretor();
  return `<div class="esc-ofi-foot">
    <div><span class="ln"></span>Coordenador(a) da especialidade: <b>${esc(c || '______________________')}</b></div>
    <div><span class="ln"></span>Diretor(a) Técnico(a): <b>${esc(d || '______________________')}</b></div>
  </div>`;
}
function escTipoOf(t) { return t === 'Sobreaviso' ? 'Sobreaviso' : 'Plantão'; } // Visita é plantão presencial
function escTipoLabel(t) { return t === 'Visita' ? 'Plantão · visita' : escTipoOf(t); }
async function escSetTurnoTipo(ym, sid, tk, tipo) {
  const list = escShiftsOf(ym, sid, S.esc.escalaId).filter(s => (fmtH(s.starts_at) + '-' + fmtH(s.ends_at) + (s.local || '')) === tk);
  if (REAL && list.length) {
    await rpc('set_shifts_type', { p_ids: list.map(s => s.id), p_type: tipo });
  }
  list.forEach(s => { if (!(tipo === 'Plantão' && s.type === 'Visita')) s.type = tipo; });
  const k = typeof escTurnoStoreKey === 'function' ? escTurnoStoreKey(ym, sid, S.esc.escalaId) : (ym + '|' + sid);
  ((S.data.extraTurnos || {})[k] || []).forEach(x => { if (x.key === tk) x.type = tipo; });
  if (!REAL) { reindex(); demoSave(); }
  toast(`Horário marcado como ${tipo}.`);
  render();
}
async function escSaveCoord(sid, v) {
  v = String(v || '').replace(/\bCRM[\s\-:/]*\w*[\s\-/]*\d+/gi, '').trim();
  S.data.settings.coordenadores = S.data.settings.coordenadores || {};
  S.data.settings.coordenadores[sid] = v;
  if (REAL) await rpc('set_sector_coordenador', { p_sector: sid, p_nome: v });
  else demoSave();
  toast('Coordenador salvo.');
}
async function escSaveDiretor(v) {
  v = String(v || '').replace(/\bCRM[\s\-:/]*\w*[\s\-/]*\d+/gi, '').trim();
  S.data.settings.diretor_tecnico = v;
  if (REAL) await rpc('set_diretor_tecnico', { p_nome: v });
  else demoSave();
  toast('Diretor(a) técnico(a) salvo.');
}
function escAssinaturasBar(sid) {
  return `<div class="esc-assin">
    <label>Coordenador(a) da especialidade <input type="text" data-act="escCoordIn" data-sid="${esc(sid)}" value="${esc(escCoord(sid))}" placeholder="Nome (sem CRM)" maxlength="120"></label>
    <label>Diretor(a) Técnico(a) <input type="text" data-act="escDiretorIn" value="${esc(escDiretor())}" placeholder="Nome (sem CRM)" maxlength="120"></label>
  </div>`;
}
if (typeof EscAct !== 'undefined') Object.assign(EscAct, {
  escTurnoTipo: el => escSetTurnoTipo(escYm(), S.esc.sectorId, el.dataset.tk, el.value),
  escCoordIn: (el, e) => { if (e && e.type === 'change') return escSaveCoord(el.dataset.sid, el.value); },
  escDiretorIn: (el, e) => { if (e && e.type === 'change') return escSaveDiretor(el.value); }
});
// ── Conferência clicável: confirmar nome provável / casar fora do cadastro ──
function escShiftById(id) { return (S.data.shifts || []).find(s => s.id === id); }

async function escAssignShiftNames({ shiftIds, doctorId, applyAll, raw, sectorId, confirmOnly }) {
  if (!isEscalista()) { toast('Só quem monta a escala pode conferir nomes.', true); return 0; }
  const ym = escYm();
  const first = escShiftById(shiftIds[0]);
  if (!first) { toast('Plantão não encontrado.', true); return 0; }
  const sid = sectorId || first.sector_id;
  const alias = String(raw || first.source_text || '').trim();
  const norm = escNormName(alias);
  let list;
  if (confirmOnly) {
    list = (S.data.shifts || []).filter(s => shiftIds.includes(s.id));
  } else if (applyAll && norm) {
    list = (S.data.shifts || []).filter(s => s.sector_id === sid && monthOf(s.starts_at) === ym && escNormName(s.source_text || '') === norm);
    if (!list.some(s => shiftIds.includes(s.id))) {
      const t = escShiftById(shiftIds[0]); if (t) list.push(t);
    }
  } else {
    list = (S.data.shifts || []).filter(s => shiftIds.includes(s.id));
  }
  if (REAL) {
    await rpc('confirm_shift_names', { p_ids: list.map(s => s.id), p_doctor: doctorId, p_alias: alias || null, p_sector: sid });
  }
  list.forEach(s => {
    s.doctor_id = doctorId;
    if (!s.original_doctor_id) s.original_doctor_id = doctorId;
    s.match_conf = 'manual';
  });
  if (alias) escRememberAlias(alias, doctorId, sid);
  if (norm) S.data.importNotes = (S.data.importNotes || []).filter(n => !(n.month === ym && n.setorId === sid && escNormName(n.raw || '') === norm));
  reindex();
  if (!REAL) demoSave();
  return list.length;
}

function escOpenConfPicker(shift, { trocar } = {}) {
  const raw = shift.source_text || '';
  const rng = { starts_at: shift.starts_at, ends_at: shift.ends_at };
  escOpenPicker({
    title: `${secName(shift.sector_id)} · dia ${+dayKey(shift.starts_at).slice(8)} · ${fmtH(shift.starts_at)}–${fmtH(shift.ends_at)}`,
    raw,
    q: trocar ? '' : raw,
    doctorId: shift.doctor_id || null,
    shiftId: shift.id,
    ym: monthOf(shift.starts_at),
    sectorId: shift.sector_id,
    local: shift.local || '',
    starts_at: rng.starts_at,
    ends_at: rng.ends_at,
    askApplyAll: true,
    allowClear: false,
    onPick: async (id, opts) => {
      const n = await escAssignShiftNames({
        shiftIds: [shift.id],
        doctorId: id,
        applyAll: !!(opts && opts.applyAll),
        raw,
        sectorId: shift.sector_id
      });
      toast(n > 1 ? `${docName(id)} em ${n} plantões deste setor.` : 'Nome conferido: ' + docName(id));
    }
  });
}

Object.assign(EscAct, {
  escConfRow: el => {
    if (!isEscalista()) return;
    const kind = el.dataset.kind, id = el.dataset.shift;
    const sh = escShiftById(id);
    if (!sh) return;
    if (kind === 'fora' || kind === 'nome' || kind === 'incorreta') { escOpenConfPicker(sh); return; }
    const pop = el.querySelector('.esc-conf-pop');
    if (!pop) return;
    const open = pop.classList.contains('hidden');
    document.querySelectorAll('.esc-conf-pop').forEach(p => p.classList.add('hidden'));
    if (open) pop.classList.remove('hidden');
  },
  escConfConfirm: async el => {
    const sh = escShiftById(el.dataset.shift);
    if (!sh || !sh.doctor_id) return;
    const n = await escAssignShiftNames({ shiftIds: [sh.id], doctorId: sh.doctor_id, applyAll: true, raw: sh.source_text || '', sectorId: sh.sector_id, confirmOnly: false });
    toast(n > 1 ? `Confirmado em ${n} plantões com o mesmo nome neste setor.` : 'Nome confirmado.');
    render();
  },
  escConfConfirmAll: async el => {
    const docId = el.dataset.doc, ym = escYm();
    const list = (S.data.shifts || []).filter(s => s.doctor_id === docId && (s.match_conf === 'media' || s.match_conf === 'baixa') && monthOf(s.starts_at) === ym);
    if (!list.length) { toast('Nenhum nome provável deste médico neste mês.'); return; }
    const n = await escAssignShiftNames({ shiftIds: list.map(s => s.id), doctorId: docId, confirmOnly: true });
    toast(`Confirmados ${n} plantão(ões) de ${docName(docId)}.`);
    render();
  },
  escConfTrocar: el => {
    const sh = escShiftById(el.dataset.shift);
    if (sh) escOpenConfPicker(sh, { trocar: true });
  },
  escPickApply: async () => {
    const p = S.esc.pick, id = p && p._pendingId;
    if (!p || !id) { toast('Escolha um médico na lista.', true); return; }
    const applyAll = !!document.querySelector('#escApplyAllAlias')?.checked;
    if (p.raw) escRememberAlias(p.raw, id, p.sectorId);
    if (p.starts_at && p.ends_at) {
      const others = escConflictsFor(id, p.starts_at, p.ends_at, escPickerExcept(p));
      if (others.length && !confirm(escConflictMsg(docName(id), others) + '\n\nColocar mesmo assim?')) return;
    }
    if (p.onPick) await p.onPick(id, { applyAll });
    closeModal(); render();
  }
});

// quando o picker pede “aplicar a todos”, o clique no nome só seleciona
const _escPickDoc = EscAct.escPickDoc;
EscAct.escPickDoc = async el => {
  const p = S.esc.pick;
  if (p && p.askApplyAll) {
    const id = el.dataset.id;
    p._pendingId = id;
    el.closest('.lst')?.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el));
    const box = document.getElementById('escApplyAllBox');
    const lab = document.getElementById('escApplyAllLab');
    const raw = p.raw || '';
    if (lab) lab.textContent = raw
      ? `Aplicar a todos os plantões com “${raw}” neste setor`
      : 'Aplicar só neste plantão';
    if (box) {
      box.classList.remove('hidden');
      const cb = document.getElementById('escApplyAllAlias');
      if (cb) cb.checked = !!raw;
      box.querySelector('label')?.classList.toggle('hidden', !raw);
    }
    return;
  }
  return _escPickDoc(el);
};
// ───────── Contratos (v4.1): modelo CONTRATOS MÉDICOS, áreas × setores e cruzamento escala × contrato ─────────
// Regra do alerta (igual a build/gen_modelo_contratos.py e à função SQL shift_contract_issue):
//   cada plantão precisa de um vínculo médico × contrato × área cuja área cubra o setor e que esteja vigente na data.
//   Motivos: informação incorreta (nome incompleto) · fora do cadastro · sem contrato · contrato de outra área · contrato vencido · contrato ainda não vigente · setor sem área de contrato.
// Conta de teste (matrícula 1988) nunca entra. Nome parecido NUNCA é casado nem sugerido.
// Linha vermelha da planilha = “não está vindo” (nao_vindo): o médico continua no sistema; é só uma marca filtrável.
const CTR_TESTE_MAT = '1988';
const CTR_STOP = new Set(['DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'DR', 'DRA']);
const CTR_SUF = ['JUNIOR', 'JR', 'FILHO', 'NETO', 'SOBRINHO'];
const ctrUp = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const ctrToks = s => (ctrUp(s).match(/[A-Z]+/g) || []).filter(t => !CTR_STOP.has(t));
const ctrCompact = s => ctrToks(s).join('');
const ctrSuf = s => { const t = ctrToks(s); return t.some(x => ['JUNIOR', 'JR', 'JUNIO', 'JINIOR'].includes(x)) ? 'JUNIOR' : (t.find(x => CTR_SUF.includes(x)) || ''); };
const CTR_MOTIVO = {
  incorreta: ['informação incorreta', 'red'], fora: ['fora do cadastro', 'red'], sem: ['sem contrato', 'red'], area: ['contrato de outra área', 'orange'],
  vencido: ['contrato vencido', 'red'], futuro: ['contrato ainda não vigente', 'orange'], setor: ['setor sem área de contrato', 'gray'], cedido: ['cedido pela prefeitura', 'blue']
};
let CTRX = null;
function ctrBump() { if (S.data) S.data._ctrVer = (S.data._ctrVer || 0) + 1; CTRX = null; }
function ctrHasData() { return ((S.data && S.data.ctrLinks) || []).length > 0; }
function ctrIdx() {
  const d = S.data, ver = d._ctrVer || 0;
  if (CTRX && CTRX.ver === ver && CTRX.d === d) return CTRX;
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  const areas = new Map((d.ctrAreas || []).map(a => [a.id, a]));
  const secAreas = new Map();
  (d.ctrAreas || []).forEach(a => { if (a.cobre_plantao) (a.sector_ids || []).forEach(s => { if (!secAreas.has(s)) secAreas.set(s, new Set()); secAreas.get(s).add(a.id); }); });
  const byDoc = new Map(), byCompact = new Map(), byFirst = new Map(), byCt = new Map();
  (d.ctrLinks || []).forEach(l => {
    if (l.doctor_id) push(byDoc, l.doctor_id, l); else push(byCompact, ctrCompact(l.nome), l);
    const t = ctrToks(l.nome); if (t[0]) push(byFirst, t[0], l);
    push(byCt, l.contract_id, l);
  });
  CTRX = { ver, d, areas, secAreas, byDoc, byCompact, byFirst, byCt, memo: new Map() };
  return CTRX;
}
const ctrAreaName = id => { const a = ctrIdx().areas.get(id); return a ? a.nome : 'lote não informado'; };
const ctrAreaLbl = a => (a.codigo === a.nome ? a.nome : a.codigo + ' - ' + a.nome);
const CTR_SEM_LOTE = 'SEM LOTE';
// nome da escala que não identifica ninguém (só um nome: JORGE, Lorena, Dr Roger…) — mesma regra do SQL nome_incompleto()
const ctrNomeIncompleto = raw => ctrToks(raw).length < 2;
const CTR_INCORRETA_TXT = 'nome incompleto — não dá para identificar o médico; corrija a escala com o nome completo';
// day: 'YYYY-MM-DD'
function ctrCheck(docId, raw, sectorId, day) {
  const X = ctrIdx(), mk = (docId || 'txt:' + raw) + '|' + sectorId + '|' + day;
  if (X.memo.has(mk)) return X.memo.get(mk);
  const r = ctrCheck0(docId, raw, sectorId, day);
  X.memo.set(mk, r); return r;
}
function ctrCheck0(docId, raw, sectorId, day) {
  const X = ctrIdx(), sa = X.secAreas.get(sectorId) || new Set();
  const R = (k, detalhe) => ({ k, motivo: CTR_MOTIVO[k][0], color: CTR_MOTIVO[k][1], detalhe });
  if (!docId) {
    if (ctrNomeIncompleto(raw)) return R('incorreta', CTR_INCORRETA_TXT);
    const c = X.byCompact.get(ctrCompact(raw)) || [];
    if (c.length) return R('fora', 'consta na planilha de contratos sem matrícula: ' + [...new Set(c.map(l => l.nome))].join(', '));
    return R('fora', 'sem contrato correspondente na planilha');
  }
  const d = doc(docId);
  if (d && d.matricula === CTR_TESTE_MAT) return null;
  if (d && typeof escDocCedido === 'function' && escDocCedido(d)) return R('cedido', d.vinculo || 'Cedido pela prefeitura — não entra como sem contrato');
  const L = X.byDoc.get(docId) || [];
  if (!L.length) return R('sem', 'não aparece em nenhum contrato');
  if (!sa.size) return R('setor', 'o setor não está ligado a nenhuma área de contrato (Contratos → Áreas x setores)');
  const na = L.filter(l => sa.has(l.area_id));
  if (!na.length) return R('area', 'contrato só em: ' + [...new Set(L.map(l => l.coord_sector_id ? 'coordenação de ' + secName(l.coord_sector_id) : ctrAreaName(l.area_id)))].sort().join(', '));
  const ok = na.filter(l => (!l.inicio || l.inicio <= day) && (!l.fim || l.fim >= day));
  if (ok.length) return null;
  if (na.every(l => l.inicio && l.inicio > day)) return R('futuro', 'o contrato começa em ' + fmtDia(na.map(l => l.inicio).sort()[0]));
  const ct = IDX.ctr.get(na[0].contract_id) || {};
  return R('vencido', `contrato ${ct.numero || 's/ nº'} terminou em ${fmtDia(na.map(l => l.fim).sort().pop())}`);
}
function ctrShiftCheck(s) { return ctrCheck(s.doctor_id || null, s.source_text || '', s.sector_id, dayKey(s.starts_at)); }
// lista agregada por médico (mês, setor opcional)
function ctrSemContrato(ym, sectorId) {
  const by = new Map();
  (IDX.shiftsByMonth.get(ym) || []).forEach(s => {
    if (s.status === 'cancelled' || (sectorId && s.sector_id !== sectorId)) return;
    const r = ctrShiftCheck(s);
    if (!r || r.k === 'cedido') return;
    const k = s.doctor_id || 'txt:' + ctrCompact(s.source_text);
    let e = by.get(k);
    if (!e) by.set(k, e = { k, doctorId: s.doctor_id || null, nome: s.doctor_id ? docName(s.doctor_id) : (s.source_text || '—'), matricula: s.doctor_id ? (doc(s.doctor_id)?.matricula || '') : '', r, n: 0, setores: new Map(), first: s });
    e.n++;
    e.setores.set(s.sector_id, (e.setores.get(s.sector_id) || 0) + 1);
    if (s.starts_at < e.first.starts_at) e.first = s;
  });
  return [...by.values()].sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome));
}
function ctrMarkHtml(r) {
  if (!r || r.k === 'fora') return '';
  if (r.k === 'incorreta') return `<span class="ctr-mark erro" title="${esc(r.motivo + ': ' + r.detalhe)}">⛔ informação incorreta</span>`;
  if (r.k === 'cedido') return `<span class="ctr-mark cedido" title="${esc(r.motivo + ': ' + r.detalhe)}">cedido</span>`;
  const short = { sem: 'sem contrato', area: 'contrato de outra área', vencido: 'contrato vencido', futuro: 'contrato não vigente', setor: 'setor sem contrato' }[r.k];
  return `<span class="ctr-mark ${r.color}" title="${esc(r.motivo + ': ' + r.detalhe)}">⚠ ${esc(short)}</span>`;
}
function ctrNavCount() {
  if (!ctrHasData() || !IDX.shiftsByMonth) return 0;
  const ym = (S.me?.kind === 'escalista' ? escYm() : null) || monthOf(nowMs());
  return ctrSemContrato(ym).length;
}

// ───────── tela Contratos (MASTER e escalista) ─────────
function ctrLinksOf(cid) { return ctrIdx().byCt.get(cid) || []; }
function ctrTabs(cur, nAlert, nUnm) {
  const t = [['lista', 'Contratos'], ['alertas', `Médicos sem contrato${nAlert ? ` (${nAlert})` : ''}`], ['areas', `Áreas x setores${nUnm ? ` (${nUnm} sem setor)` : ''}`], ['modelo', 'Modelo / importar']];
  return `<div class="tabs ctr-tabs" role="tablist">${t.map(([k, l]) => `<button class="tab ${cur === k ? 'on' : ''}" data-act="tab" data-key="ctrTab" data-v="${k}" role="tab">${esc(l)}</button>`).join('')}</div>`;
}
PAGES.contratos = () => {
  const d = S.data;
  S.tabs.ctrF = Object.assign({ q: '', st: '', sec: '', area: '', nv: '' }, S.tabs.ctrF || {});
  const tab = S.tabs.ctrTab || 'lista';
  const ym = S.tabs.ctrYm || escYm();
  const nAlert = ctrHasData() ? ctrSemContrato(ym).length : 0;
  const unm = (d.ctrAreas || []).filter(a => a.cobre_plantao && !(a.sector_ids || []).length && a.codigo !== CTR_SEM_LOTE);
  const fc = d.fonteContratos, mod = d.ctrModelo;
  const desc = `Contratos médicos (PJ) por área/lote do credenciamento. A escala é cruzada com estes contratos: quem estiver escalado sem contrato que cubra o setor, ou com o contrato vencido na data, aparece em “Médicos sem contrato” e com ⚠ na grade. Fonte: ${esc(mod?.fonte || 'planilha “CONTRATOS MÉDICOS”')}${fc?.importadoEm ? ` (importada em ${fmtDia(fc.importadoEm)})` : ''}. Sem CPF, telefone ou e-mail.`;
  const body = tab === 'alertas' ? ctrPageAlertas(ym) : tab === 'areas' ? ctrPageAreas(unm) : tab === 'modelo' ? ctrPageModelo() : ctrPageLista();
  return header('Contratos', desc, `<button class="btn" data-act="ctrNew">Novo contrato</button>`) + ctrTabs(tab, nAlert, unm.length) + body;
};
function ctrPageLista() {
  const d = S.data, C = d.contracts || [], f = S.tabs.ctrF;
  const st = Object.fromEntries(C.map(c => [c.id, ctrStatus(c)]));
  const cnt = k => C.filter(c => st[c.id].k === k).length;
  const q = normTxt(f.q);
  const X = ctrIdx(), useLinks = ctrHasData();
  const CD = d.contractDoctors || [];
  const byC = CD.reduce((m, x) => ((m[x.contract_id] = m[x.contract_id] || []).push(x), m), {});
  const secsOf = c => useLinks ? ctrLinksOf(c.id).flatMap(l => (X.areas.get(l.area_id)?.cobre_plantao ? X.areas.get(l.area_id).sector_ids : []).concat(l.coord_sector_id ? [l.coord_sector_id] : [])) : (byC[c.id] || []).flatMap(x => x.lotes.map(l => l.sector_id));
  const areasOf = c => useLinks ? [...new Set(ctrLinksOf(c.id).map(l => l.area_id).filter(Boolean))] : [];
  const txtOf = c => [c.numero, c.razao_social, c.cnpj, c.processo, ...(useLinks ? ctrLinksOf(c.id).map(l => `${l.nome} ${l.matricula || ''} ${doc(l.doctor_id)?.crm || ''}`) : (byC[c.id] || []).map(x => { const m = doc(x.doctor_id); return m ? `${m.name} ${m.matricula || ''} ${m.crm || ''}` : ''; }))].join(' ');
  const nvOf = c => useLinks && ctrLinksOf(c.id).some(l => l.nao_vindo);
  const list = C.filter(c => (!f.nv || (f.nv === 'sim' ? nvOf(c) : !nvOf(c))) && (!f.st || st[c.id].k === f.st) && (!f.sec || secsOf(c).includes(f.sec)) && (!f.area || areasOf(c).includes(f.area)) && (!q || normTxt(txtOf(c)).includes(q)))
    .sort((a, b) => (st[a.id].k === 'vencido' ? 0 : st[a.id].k === 'vencendo' ? 1 : 2) - (st[b.id].k === 'vencido' ? 0 : st[b.id].k === 'vencendo' ? 1 : 2) || (a.fim || '9').localeCompare(b.fim || '9') || a.razao_social.localeCompare(b.razao_social));
  const p = pager('contratos', list.length, 25);
  const medIds = new Set(useLinks ? (d.ctrLinks || []).filter(l => l.doctor_id).map(l => l.doctor_id) : CD.map(x => x.doctor_id));
  const semMat = new Set((d.ctrLinks || []).filter(l => !l.doctor_id).map(l => ctrCompact(l.nome))).size;
  const empresas = new Set(C.map(c => c.cnpj || c.razao_social)).size;
  const usedSecs = [...new Set(C.flatMap(secsOf))].map(id => IDX.sec.get(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  const areas = (d.ctrAreas || []).slice().sort((a, b) => ctrAreaOrd(a) - ctrAreaOrd(b));
  const nvMed = new Set((d.ctrLinks || []).filter(l => l.nao_vindo).map(l => l.doctor_id || ctrCompact(l.nome)));
  const nvTag = () => tag('não está vindo', 'red', 'Linha vermelha na planilha: não está vindo (não está fazendo plantões agora). Continua no sistema, no cadastro e nas habilitações.');
  const medRow = l => {
    const m = l.doctor_id ? doc(l.doctor_id) : null, a = X.areas.get(l.area_id);
    const nm = m ? (isMaster() ? `<button class="btn link small" data-act="editDoctor" data-id="${m.id}">${esc(m.name)}</button>` : esc(m.name)) : `${esc(l.nome)} ${tag('fora do cadastro', 'gray', 'Profissional da planilha que não está no cadastro do app (sem matrícula)')}`;
    const setores = a ? (a.cobre_plantao ? (a.sector_ids || []).map(s => tag(secName(s), 'blue')).join(' ') || tag(a.codigo === CTR_SEM_LOTE ? 'sem lote' : 'área sem setor', 'orange') : tag('coordenação' + (l.coord_sector_id ? ' · ' + secName(l.coord_sector_id) : ''), 'gray')) : tag('sem lote', 'orange');
    return `<tr class="${l.nao_vindo ? 'nao-vindo' : ''}"><td>${nm}${l.nao_vindo ? ' ' + nvTag() : ''}${l.fim && l.fim < todayIso() ? `<div class="muted small">vínculo até ${fmtDia(l.fim)}</div>` : ''}</td><td class="small">${m ? 'matr. ' + esc(m.matricula || '—') : '<span class="muted">sem matrícula</span>'}</td><td class="small">${m?.crm ? esc((m.conselho || 'CRM') + ' ' + m.crm) : '—'}</td><td class="small">${esc(a ? ctrAreaLbl(a) : (l.lote || '—'))}</td><td>${setores}</td><td>${l.nao_vindo ? '<b class="red-txt">Sim</b>' : 'Não'}</td></tr>`;
  };
  return `<div class="kpis small">${kpi('Vigentes', cnt('vigente'), '', 'ok')}${kpi(`Vencem em até ${AVISO_DIAS} dias`, cnt('vencendo'), '', cnt('vencendo') ? 'warn' : '')}${kpi('Vencidos', cnt('vencido'), '', cnt('vencido') ? 'bad' : '')}${kpi('Sem vigência', cnt('sem'))}${kpi('Médicos do cadastro', medIds.size, `${semMat} sem matrícula`)}${kpi('Não está vindo', nvMed.size, 'médicos/profissionais (linha vermelha)', nvMed.size ? 'warn' : '')}${kpi('Empresas (PJ)', empresas)}</div>
  <div class="filters"><input data-cf="q" type="search" placeholder="Nº, empresa, CNPJ, médico, matrícula ou CRM" value="${esc(f.q)}" aria-label="Buscar contrato"><select data-cf="st" aria-label="Vigência">${opt('', 'Todas as vigências', f.st)}${opt('vencido', 'Vencidos', f.st)}${opt('vencendo', `Vencem em até ${AVISO_DIAS} dias`, f.st)}${opt('vigente', 'Vigentes', f.st)}${opt('sem', 'Sem vigência', f.st)}</select><select data-cf="area" aria-label="Área">${opt('', 'Todas as áreas', f.area)}${areas.map(a => opt(a.id, ctrAreaLbl(a), f.area)).join('')}</select><select data-cf="nv" aria-label="Não está vindo">${opt('', 'Todos (vindo ou não)', f.nv)}${opt('sim', 'Com médico que não está vindo', f.nv)}${opt('nao', 'Sem médico que não está vindo', f.nv)}</select><select data-cf="sec" aria-label="Setor">${opt('', 'Todos os setores', f.sec)}${usedSecs.map(s => opt(s.id, s.name, f.sec)).join('')}</select></div>
  <p class="muted small">${list.length} contrato(s) no filtro${f.q || f.st || f.sec || f.area || f.nv ? '' : ' · vencidos e a vencer aparecem primeiro'}.</p>
  ${list.slice(p.from, p.to).map(c => {
    const s = st[c.id];
    const ls = useLinks ? ctrLinksOf(c.id).slice().sort((a, b) => (a.doctor_id ? 0 : 1) - (b.doctor_id ? 0 : 1) || a.nome.localeCompare(b.nome)) : [];
    const ars = areasOf(c).map(id => X.areas.get(id)).filter(Boolean);
    const meta = [c.processo ? 'IG/processo ' + esc(c.processo) : '', c.modalidade ? esc(c.modalidade) : '', c.valor ? 'R$ ' + Number(c.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '', c.carga ? esc(c.carga) : ''].filter(Boolean).join(' · ');
    const legacy = !useLinks ? ((byC[c.id] || []).length ? `<div class="table-wrap"><table class="tbl ctr-tbl"><thead><tr><th>Médico</th><th>Acesso</th><th>CRM/CRO</th><th>Especialidade</th><th>Setores (lotes)</th></tr></thead><tbody>${(byC[c.id] || []).map(x => { const m = doc(x.doctor_id) || {}; return `<tr><td>${esc(m.name || '—')}</td><td class="small">${esc(loginTxt(m))}</td><td class="small">${m.crm ? esc((m.conselho || 'CRM') + ' ' + m.crm) : '—'}</td><td class="small">${esc(m.specialty || '—')}</td><td>${ctrSetores(x)}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted small">Nenhum médico informado na planilha para este contrato.</p>') : '';
    return `<div class="card ctr ${s.k}"><div class="card-head"><div><div class="ctr-num">Contrato ${esc(c.numero || 's/ nº')}</div><b class="ctr-emp">${esc(c.razao_social)}</b><div class="muted small">CNPJ ${esc(c.cnpj || '—')} · vigência ${fmtDia(c.inicio)} → ${fmtDia(c.fim)}${meta ? ' · ' + meta : ''}</div>
      <div class="ctr-areas">${ars.map(a => tag(ctrAreaLbl(a), a.cobre_plantao ? 'blue' : 'gray')).join(' ')}${ls.some(l => l.nao_vindo) ? ' ' + tag(`não está vindo (${new Set(ls.filter(l => l.nao_vindo).map(l => l.nome)).size})`, 'red', 'Médico(s) em linha vermelha na planilha: não está vindo. Continua(m) no sistema.') : ''}</div></div>
      <div class="ctr-head-r">${tag(s.txt, s.color)} <button class="btn small" data-act="ctrEdit" data-id="${esc(c.id)}">Editar</button></div></div>
      ${useLinks ? (ls.length ? `<div class="table-wrap"><table class="tbl ctr-tbl"><thead><tr><th>Médico</th><th>Matrícula</th><th>CRM/CRO</th><th>Área</th><th>Setores</th><th>Não está vindo</th></tr></thead><tbody>${ls.map(medRow).join('')}</tbody></table></div>` : '<p class="muted small">Nenhum médico informado na planilha para este contrato.</p>') : legacy}</div>`;
  }).join('') || '<div class="empty">Nenhum contrato no filtro.</div>'}${p.html}`;
}
const todayIso = () => dayKey(nowMs());
const ctrAreaOrd = a => (/^\d+$/.test(a.codigo) ? +a.codigo : 90 + (a.codigo || '').length);
function ctrPageAlertas(ym) {
  if (!ctrHasData()) return '<div class="callout warn">Ainda não há vínculos médico × contrato × área. Importe o modelo CONTRATOS MÉDICOS na aba “Modelo / importar”.</div>';
  const sec = S.tabs.ctrSec || '';
  const L = ctrSemContrato(ym, sec || null);
  const cnt = L.reduce((m, e) => ((m[e.r.k] = (m[e.r.k] || 0) + 1), m), {});
  const plant = L.reduce((n, e) => n + e.n, 0);
  const ms_ = months().filter(m => (IDX.shiftsByMonth.get(m) || []).length);
  const secs = [...new Set((IDX.shiftsByMonth.get(ym) || []).map(s => s.sector_id))].map(id => IDX.sec.get(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="filters"><select data-act="ctrSetYm" aria-label="Mês">${ms_.map(m => opt(m, fmtMonth(m), ym)).join('')}</select><select data-act="ctrSetSec" aria-label="Setor">${opt('', 'Todos os setores', sec)}${secs.map(s => opt(s.id, s.name, sec)).join('')}</select><button class="btn small" data-act="ctrAlertExport">Baixar lista (Excel)</button></div>
  <div class="kpis small">${kpi('Médicos com alerta', L.length, `${plant} plantão(ões)`, L.length ? 'bad' : 'ok')}${Object.entries(CTR_MOTIVO).filter(([k]) => cnt[k]).map(([k, [lab]]) => kpi(lab, cnt[k])).join('')}</div>
  <p class="muted small">Cada médico da escala de ${esc(fmtMonth(ym))} que não está num contrato vigente da área do setor. “Informação incorreta” = nome incompleto na escala (só um nome) — corrija a escala com o nome completo. “Fora do cadastro” = nome completo sem matrícula no app. O sistema não sugere nem casa nomes parecidos. A conta de teste não entra.</p>
  ${L.length ? `<div class="table-wrap"><table class="tbl ctr-alert-tbl" id="ctrAlertTbl"><thead><tr><th>Médico</th><th>Motivo</th><th>Detalhe</th><th>Setores (plantões)</th><th></th></tr></thead><tbody>${L.map(e => `<tr data-k="${esc(e.r.k)}"><td><b>${esc(e.nome)}</b>${e.matricula ? `<div class="muted small">matr. ${esc(e.matricula)}</div>` : ''}</td><td>${tag(e.r.motivo, e.r.color)}</td><td class="small">${esc(e.r.detalhe)}</td><td class="small">${[...e.setores].map(([s, n]) => `${esc(secName(s))} (${n})`).join(', ')}</td><td><button class="btn small" data-act="ctrGoEscala" data-setor="${esc(e.first.sector_id)}" data-escala="${esc(e.first.escala_id || '')}" data-ym="${esc(ym)}">Ver na escala</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="callout info">Nenhum médico sem contrato neste mês' + (sec ? ' e setor' : '') + '.</div>'}`;
}
function ctrPageAreas(unm) {
  const d = S.data, X = ctrIdx();
  const areas = (d.ctrAreas || []).slice().sort((a, b) => ctrAreaOrd(a) - ctrAreaOrd(b));
  const nCt = new Map(), nMd = new Map();
  (d.ctrLinks || []).forEach(l => { if (!l.area_id) return; (nCt.get(l.area_id) || nCt.set(l.area_id, new Set()).get(l.area_id)).add(l.contract_id); (nMd.get(l.area_id) || nMd.set(l.area_id, new Set()).get(l.area_id)).add(l.doctor_id || ctrCompact(l.nome)); });
  const withShifts = [...new Set(d.shifts.map(s => s.sector_id))].filter(s => !X.secAreas.has(s)).map(secName).filter(n => n !== 'TESTE');
  const secs = d.sectors.filter(s => s.name !== 'TESTE').slice().sort((a, b) => a.name.localeCompare(b.name));
  const conf = areas.filter(a => /a confirmar/i.test(a.observacao || ''));
  return `<p class="muted small" id="ctrAreasHelp">A ligação lote/área → setor pode ser mudada aqui por MASTER ou quem monta a escala: “+ setor…” liga, “×” tira. Vale na hora para os alertas e fica na auditoria.</p>
  ${conf.length ? `<div class="callout info" id="ctrAConfirmar"><b>A confirmar:</b> ${conf.map(a => esc(ctrAreaLbl(a))).join(' · ')} — mapeamento mantido até confirmar.</div>` : ''}
  ${unm.length ? `<div class="callout warn" id="ctrUnmapped"><b>Áreas sem setor no EscalaMed (${unm.length}) — ignoradas por enquanto:</b> ${unm.map(a => esc(a.codigo + ' - ' + a.nome)).join(' · ')}. Sem setor, essas áreas não entram no cruzamento.</div>` : ''}
  ${withShifts.length ? `<div class="callout warn"><b>Setores com escala e sem área de contrato:</b> ${withShifts.map(esc).join(', ')}.</div>` : '<p class="muted small">Todos os setores que têm escala estão ligados a pelo menos uma área de contrato.</p>'}
  <div class="table-wrap"><table class="tbl ctr-areas-tbl"><thead><tr><th>Lote</th><th>Área / especialidade</th><th>Setores do EscalaMed</th><th>Cobre plantão</th><th>Contratos</th><th>Médicos</th><th>Observação</th></tr></thead><tbody>${areas.map(a => `<tr class="${a.cobre_plantao && !(a.sector_ids || []).length && a.codigo !== CTR_SEM_LOTE ? 'warn' : ''}" data-area="${esc(a.id)}"><td>${esc(a.codigo)}</td><td><b>${esc(a.nome)}</b>${/a confirmar/i.test(a.observacao || '') ? ' ' + tag('a confirmar', 'orange') : ''}<div class="muted small">${esc(a.modalidade || '')}</div></td>
    <td>${(a.sector_ids || []).map(s => `<span class="tag blue">${esc(secName(s))} <button type="button" class="tag-x" data-act="ctrAreaDelSec" data-area="${esc(a.id)}" data-sec="${esc(s)}" aria-label="Tirar ${esc(secName(s))}">×</button></span>`).join(' ')}
      <select data-act="ctrAreaAddSec" data-area="${esc(a.id)}" aria-label="Ligar setor"><option value="">+ setor…</option>${secs.filter(s => !(a.sector_ids || []).includes(s.id)).map(s => opt(s.id, s.name, '')).join('')}</select></td>
    <td>${a.cobre_plantao ? 'Sim' : 'Não (coordenação)'}</td><td>${(nCt.get(a.id) || new Set()).size}</td><td>${(nMd.get(a.id) || new Set()).size}</td><td class="small">${esc(a.observacao || '')}</td></tr>`).join('')}</tbody></table></div>`;
}
function ctrPageModelo() {
  const imp = S.ctrImp;
  return `<div class="card"><h2>Modelo CONTRATOS MÉDICOS</h2>
    <p>Planilha padronizada com Instruções, Contratos, Contratos por área, Médicos por contrato, Áreas x Setores, Resumo por área, Revisão e Habilitações x contratos. Sem CPF, telefone ou e-mail.</p>
    <div class="esc-bar"><a class="btn primary" href="Modelo_Contratos_Medicos_HMPGL.xlsx" download id="ctrModeloLink">Baixar modelo oficial (Excel)</a><button class="btn" data-act="ctrExport">Exportar os dados atuais neste formato</button></div>
    <p class="muted small">O modelo oficial fica ao lado do EscalaMed.html (no .zip). “Exportar” gera a mesma estrutura com o que está no app agora.</p></div>
  <div class="card"><h2>Importar o modelo preenchido</h2>
    <p>Lê as abas <b>Contratos</b>, <b>Médicos por contrato</b> e <b>Áreas x Setores</b>. O médico é ligado ao cadastro <b>só pela matrícula</b>; sem matrícula ele fica pelo nome (fora do cadastro). Nome parecido não é casado.</p>
    <label class="btn"><input type="file" accept=".xlsx,.xls" data-act="ctrImportFile" hidden id="ctrImportInput">Escolher arquivo…</label>
    ${imp ? ctrImpPreviewHtml(imp) : ''}</div>`;
}

// ───────── importar / exportar (SheetJS) ─────────
const CTR_H = {
  contratos: { area: 'Lote/Área nº', numero: 'Nº contrato', processo: 'Processo / IG', razao: 'Razão social', cnpj: 'CNPJ', modalidade: 'Objeto / modalidade', inicio: 'Vigência início', fim: 'Vigência fim', valor: 'Valor (R$)', carga: 'Carga horária', destaque: 'Destaque na planilha original', obs: 'Observações', id: 'ID EscalaMed' },
  medicos: { numero: 'Nº contrato', razao: 'Razão social', area: 'Lote/Área nº', areaNome: 'Área', medico: 'Médico', matricula: 'Matrícula', inicio: 'Vigência início', fim: 'Vigência fim', destaque: 'Destaque na planilha original', naoVindo: 'Não está vindo' },
  areas: { codigo: 'Lote/Área nº', nome: 'Área / Especialidade', setor: 'Setor EscalaMed', cobre: 'Cobre plantão?', modalidade: 'Objeto / modalidade (pelas escalas)', obs: 'Observação' }
};
function ctrSheetRows(ws, must) {
  const X = window.XLSX, A = X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const hi = A.findIndex(r => must.every(m => r.map(v => String(v).trim()).includes(m)));
  if (hi < 0) return null;
  const H = A[hi].map(v => String(v).trim());
  return A.slice(hi + 1).map(r => Object.fromEntries(H.map((h, i) => [h, r[i]])));
}
function ctrDate(v) {
  if (v === '' || v == null) return null;
  if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  if (typeof v === 'number') { const d = window.XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null; }
  const m = String(v).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const m2 = String(v).trim().match(/^(\d{4}-\d{2}-\d{2})/); return m2 ? m2[1] : null;
}
const ctrNum = s => { const t = ctrUp(s).trim().replace(/\./g, '/'); return t || null; };
const ctrRazKey = s => ctrUp(s).replace(/[^A-Z0-9]/g, '');
const ctrKey = (n, r) => (ctrNum(n) || '') + '|' + ctrRazKey(r);
function ctrParseModelo(wb) {
  const sh = n => wb.Sheets[wb.SheetNames.find(x => normTxt(x) === normTxt(n))];
  if (!sh('Contratos') || !sh('Médicos por contrato')) throw new Error('Arquivo não está no modelo CONTRATOS MÉDICOS (faltam as abas “Contratos” e “Médicos por contrato”).');
  const RC = ctrSheetRows(sh('Contratos'), [CTR_H.contratos.numero, CTR_H.contratos.razao]);
  const RM = ctrSheetRows(sh('Médicos por contrato'), [CTR_H.medicos.numero, CTR_H.medicos.medico]);
  if (!RC || !RM) throw new Error('Não achei a linha de títulos (Nº contrato, Razão social, Médico) nas abas do modelo.');
  const RA = sh('Áreas x Setores') ? ctrSheetRows(sh('Áreas x Setores'), [CTR_H.areas.codigo, CTR_H.areas.setor]) : null;
  const H = CTR_H, warn = [];
  const secByName = new Map(S.data.sectors.map(s => [normTxt(s.name), s.id]));
  // áreas
  const areas = new Map((S.data.ctrAreas || []).map(a => [a.codigo, { ...a, sector_ids: [...(a.sector_ids || [])] }]));
  if (RA) {
    const seen = new Set();
    RA.forEach(r => {
      const cod = String(r[H.areas.codigo] ?? '').trim(); if (!cod || !r[H.areas.nome]) return;
      let a = areas.get(cod);
      if (!a) areas.set(cod, a = { id: rid('ar'), codigo: cod, nome: String(r[H.areas.nome]).trim(), cobre_plantao: true, sector_ids: [], modalidade: '', observacao: '' });
      if (!seen.has(cod)) { seen.add(cod); a.sector_ids = []; a.nome = String(r[H.areas.nome]).trim(); a.cobre_plantao = normTxt(r[H.areas.cobre]) !== 'nao'; a.observacao = String(r[H.areas.obs] || ''); a.modalidade = String(r[H.areas.modalidade] || ''); }
      const sn = String(r[H.areas.setor] || '').trim();
      if (sn) { const sid = secByName.get(normTxt(sn)); if (sid) { if (!a.sector_ids.includes(sid)) a.sector_ids.push(sid); } else warn.push(`Setor “${sn}” (área ${cod}) não existe no EscalaMed — ignorado.`); }
    });
  }
  // contratos
  const old = new Map((S.data.contracts || []).map(c => [ctrKey(c.numero, c.razao_social), c]));
  const cts = new Map();
  RC.forEach(r => {
    const raz = String(r[H.contratos.razao] || '').trim(); if (!raz || /^coordenador|^diretor/i.test(raz)) return;
    const k = ctrKey(r[H.contratos.numero], raz), o = old.get(k);
    cts.set(k, { ...(o || {}), id: o?.id || rid('ct'), numero: ctrNum(r[H.contratos.numero]), razao_social: raz, cnpj: String(r[H.contratos.cnpj] || '').trim() || null,
      processo: String(r[H.contratos.processo] || '').trim() || null, modalidade: String(r[H.contratos.modalidade] || '').trim() || null,
      inicio: ctrDate(r[H.contratos.inicio]), fim: ctrDate(r[H.contratos.fim]), valor: r[H.contratos.valor] === '' ? null : Number(String(r[H.contratos.valor]).replace(/\./g, '').replace(',', '.')) || null,
      carga: String(r[H.contratos.carga] || '').trim() || null, destaque: String(r[H.contratos.destaque] || '').trim() || null, observacao: String(r[H.contratos.obs] || '').trim() || null });
  });
  // vínculos
  const byMat = new Map(S.data.doctors.filter(x => x.matricula).map(x => [String(x.matricula), x]));
  const byName = new Map(); S.data.doctors.forEach(x => { const k = ctrToks(x.name).join(' '); byName.set(k, (byName.get(k) || []).concat(x)); });
  const links = []; let semMat = 0;
  RM.forEach(r => {
    const nome = String(r[H.medicos.medico] || '').trim(); if (!nome) return;
    const k = ctrKey(r[H.medicos.numero], r[H.medicos.razao]);
    let c = cts.get(k);
    if (!c) { const raz = String(r[H.medicos.razao] || '').trim(); if (!raz) return; c = { id: old.get(k)?.id || rid('ct'), numero: ctrNum(r[H.medicos.numero]), razao_social: raz, cnpj: null, inicio: null, fim: null }; cts.set(k, c); warn.push(`Contrato ${c.numero || 's/ nº'} – ${raz} só está em “Médicos por contrato” — criado sem vigência.`); }
    const cod = String(r[H.medicos.area] ?? '').trim(), a = areas.get(cod);
    if (cod && !a && cod !== '?') warn.push(`Área “${cod}” de ${nome} não existe — vínculo sem área.`);
    const mat = String(r[H.medicos.matricula] ?? '').replace(/\D/g, '');
    const m = mat ? byMat.get(mat) : null;
    if (mat && !m) warn.push(`Matrícula ${mat} (${nome}) não está no cadastro — fica pelo nome.`);
    if (!m) { semMat++; const same = byName.get(ctrToks(nome).join(' ')) || []; if (same.length) warn.push(`“${nome}” sem matrícula, mas há ${same.map(x => x.name + ' (matr. ' + x.matricula + ')').join(', ')} no cadastro — preencha a matrícula para ligar.`); }
    links.push({ id: rid('cl'), contract_id: c.id, area_id: a?.id || null, coord_sector_id: null, doctor_id: m?.id || null, nome: m ? m.name : nome, nome_planilha: nome, matricula: m ? m.matricula : null,
      inicio: ctrDate(r[H.medicos.inicio]) || c.inicio || null, fim: ctrDate(r[H.medicos.fim]) || c.fim || null, lote: cod, destaque: String(r[H.medicos.destaque] || '').trim() || null,
      nao_vindo: H.medicos.naoVindo in r && String(r[H.medicos.naoVindo]).trim() !== '' ? normTxt(r[H.medicos.naoVindo]) === 'sim' : String(r[H.medicos.destaque] || '').trim().startsWith('Vermelho') });
  });
  return { contracts: [...cts.values()], links, areas: [...areas.values()], warn, semMat, comMat: links.filter(l => l.doctor_id).length };
}
function ctrImpPreviewHtml(imp) {
  return `<div class="callout info" id="ctrImpPreview"><b>${imp.contracts.length} contratos · ${imp.links.length} vínculos (${imp.comMat} com matrícula, ${imp.semMat} sem matrícula) · ${imp.areas.length} áreas</b>
    ${imp.warn.length ? `<details><summary>${imp.warn.length} aviso(s) para conferir</summary><ul class="small">${imp.warn.slice(0, 80).map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
    <div class="esc-bar"><button class="btn primary" data-act="ctrImportApply">Substituir os contratos por este arquivo</button><button class="btn" data-act="ctrImportCancel">Cancelar</button></div></div>`;
}
function ctrExportSheets() {
  const d = S.data, X = ctrIdx();
  const areaLbl = id => X.areas.get(id) || null;
  const contratos = (d.contracts || []).map(c => { const as = [...new Set(ctrLinksOf(c.id).map(l => l.area_id).filter(Boolean))].map(areaLbl).filter(Boolean);
    return { [CTR_H.contratos.area]: as.map(a => a.codigo).join('; '), 'Área / Especialidade': as.map(a => a.nome).join('; '), 'Setor(es) EscalaMed': [...new Set(as.flatMap(a => a.cobre_plantao ? a.sector_ids.map(secName) : []))].join('; '),
      [CTR_H.contratos.numero]: c.numero || '', [CTR_H.contratos.processo]: c.processo || '', [CTR_H.contratos.razao]: c.razao_social, [CTR_H.contratos.cnpj]: c.cnpj || '', [CTR_H.contratos.modalidade]: c.modalidade || '',
      [CTR_H.contratos.inicio]: fmtDia(c.inicio).replace('—', ''), [CTR_H.contratos.fim]: fmtDia(c.fim).replace('—', ''), [CTR_H.contratos.valor]: c.valor ?? '', [CTR_H.contratos.carga]: c.carga || '', 'Situação': ctrStatus(c).txt,
      [CTR_H.contratos.destaque]: c.destaque || '', [CTR_H.contratos.obs]: c.observacao || '', [CTR_H.contratos.id]: c.id }; });
  const medicos = (d.ctrLinks || []).map(l => { const c = IDX.ctr.get(l.contract_id) || {}, a = areaLbl(l.area_id), m = l.doctor_id ? doc(l.doctor_id) : null;
    return { [CTR_H.medicos.numero]: c.numero || '', [CTR_H.medicos.razao]: c.razao_social || '', [CTR_H.medicos.area]: a ? a.codigo : '', [CTR_H.medicos.areaNome]: a ? a.nome : (l.lote || ''), 'Setor(es) EscalaMed': a && a.cobre_plantao ? a.sector_ids.map(secName).join(', ') : '',
      [CTR_H.medicos.medico]: m ? m.name : l.nome, [CTR_H.medicos.matricula]: m ? m.matricula || '' : '', 'CRM/CRO': m?.crm || '', [CTR_H.medicos.inicio]: fmtDia(l.inicio).replace('—', ''), [CTR_H.medicos.fim]: fmtDia(l.fim).replace('—', ''), [CTR_H.medicos.destaque]: l.destaque || '', [CTR_H.medicos.naoVindo]: l.nao_vindo ? 'Sim' : 'Não' }; });
  const areas = (d.ctrAreas || []).slice().sort((a, b) => ctrAreaOrd(a) - ctrAreaOrd(b)).flatMap(a => ((a.sector_ids || []).length ? a.sector_ids : ['']).map(s => ({ [CTR_H.areas.codigo]: a.codigo, [CTR_H.areas.nome]: a.nome, [CTR_H.areas.setor]: s ? secName(s) : '', 'Escala (opcional)': '', [CTR_H.areas.cobre]: a.cobre_plantao ? 'Sim' : 'Não', [CTR_H.areas.modalidade]: a.modalidade || '', [CTR_H.areas.obs]: a.observacao || '' })));
  return [{ name: 'Contratos', rows: contratos }, { name: 'Médicos por contrato', rows: medicos }, { name: 'Áreas x Setores', rows: areas }];
}
async function ctrReloadReal() {
  const [contracts, areas, as_, links] = await Promise.all([fetchAll('contracts'), fetchAll('contract_areas'), fetchAll('contract_area_sectors'), fetchAll('contract_links')]);
  const secs = as_.reduce((m, x) => ((m[x.area_id] = m[x.area_id] || []).push(x.sector_id), m), {});
  S.data.contracts = contracts.map(c => ({ ...c, carga: c.carga_horaria }));
  S.data.ctrAreas = areas.map(a => ({ ...a, sector_ids: secs[a.id] || [] }));
  S.data.ctrLinks = links;
  reindex(); ctrBump();
}
function ctrDirty() { S.data._ctrDirty = true; reindex(); ctrBump(); if (!REAL) demoSave(); }
function ctrEditModal(id) {
  const c = id ? IDX.ctr.get(id) : { id: null, numero: '', razao_social: '', cnpj: '', processo: '', modalidade: '', inicio: null, fim: null, valor: null, carga: '', observacao: '' };
  if (!c) return;
  const ls = id ? ctrLinksOf(id) : [];
  const areas = (S.data.ctrAreas || []).slice().sort((a, b) => ctrAreaOrd(a) - ctrAreaOrd(b));
  const docs = S.data.doctors.filter(x => x.matricula && x.matricula !== CTR_TESTE_MAT).slice().sort((a, b) => a.name.localeCompare(b.name));
  const f = (n, l, v, t = 'text') => `<div class="field"><label for="ctr_${n}">${l}</label><input id="ctr_${n}" name="${n}" type="${t}" value="${esc(v ?? '')}"></div>`;
  modal(id ? `Contrato ${c.numero || 's/ nº'}` : 'Novo contrato', `<form id="ctrForm" data-id="${esc(id || '')}" class="grid2">
    ${f('numero', 'Nº contrato', c.numero)}${f('processo', 'Processo / IG', c.processo)}
    <div class="field span2"><label for="ctr_razao_social">Razão social</label><input id="ctr_razao_social" name="razao_social" required value="${esc(c.razao_social || '')}"></div>
    ${f('cnpj', 'CNPJ (da empresa)', c.cnpj)}${f('modalidade', 'Objeto / modalidade', c.modalidade)}
    ${f('inicio', 'Vigência início', c.inicio, 'date')}${f('fim', 'Vigência fim', c.fim, 'date')}
    ${f('valor', 'Valor (R$)', c.valor, 'number')}${f('carga', 'Carga horária', c.carga)}
    <div class="field span2"><label for="ctr_observacao">Observações</label><input id="ctr_observacao" name="observacao" value="${esc(c.observacao || '')}"></div>
    </form>
    ${id ? `<h3>Médicos deste contrato</h3><div class="table-wrap"><table class="tbl"><tbody>${ls.map(l => `<tr><td>${esc(l.nome)}${l.doctor_id ? '' : ' ' + tag('fora do cadastro', 'gray')}${l.nao_vindo ? ' ' + tag('não está vindo', 'red') : ''}</td><td class="small">${esc(l.matricula ? 'matr. ' + l.matricula : '—')}</td><td class="small">${esc(ctrAreaName(l.area_id))}</td><td><button class="btn small" data-act="ctrToggleNV" data-id="${esc(l.id)}">${l.nao_vindo ? 'Está vindo' : 'Não está vindo'}</button></td><td><button class="btn small danger" data-act="ctrDelLink" data-id="${esc(l.id)}">Tirar</button></td></tr>`).join('') || '<tr><td class="muted">Nenhum médico.</td></tr>'}</tbody></table></div>
    <div class="esc-bar"><select id="ctrAddDoc" aria-label="Médico"><option value="">Médico do cadastro…</option>${docs.map(x => opt(x.id, `${x.name} · ${x.matricula}`, '')).join('')}</select><select id="ctrAddArea" aria-label="Área"><option value="">Área…</option>${areas.map(a => opt(a.id, ctrAreaLbl(a), '')).join('')}</select><button class="btn" data-act="ctrAddLink" data-id="${esc(id)}">Incluir médico</button></div>` : '<p class="muted small">Salve o contrato para incluir os médicos.</p>'}
    <div class="esc-bar"><button class="btn primary" data-act="ctrSave">Salvar</button><button class="btn" data-act="closeModal">Cancelar</button></div>`, { wide: true });
}
Object.assign(EscAct, {
  ctrSetYm: el => { S.tabs.ctrYm = el.value; return ensureMonth(el.value).then(() => render()); },
  ctrSetSec: el => { S.tabs.ctrSec = el.value; render(); },
  ctrGoEscala: el => { const ym = el.dataset.ym; S.esc.month = ym; S.f.month = ym; S.esc.sectorId = el.dataset.setor; S.esc.escalaId = el.dataset.escala || null; S.esc.view = 'grid'; S.page = 'montar'; render(); window.scrollTo(0, 0); },
  ctrAlertExport: () => { const ym = S.tabs.ctrYm || escYm(); const L = ctrSemContrato(ym, S.tabs.ctrSec || null);
    sheetExport([{ name: 'Médicos sem contrato', rows: L.map(e => ({ Mês: fmtMonth(ym), Médico: e.nome, Matrícula: e.matricula, Motivo: e.r.motivo, Detalhe: e.r.detalhe, Setores: [...e.setores].map(([s, n]) => `${secName(s)} (${n})`).join(', '), Plantões: e.n })) }], `medicos_sem_contrato_${ym}`); },
  ctrExport: () => { sheetExport(ctrExportSheets(), 'Contratos_Medicos_EscalaMed'); toast('Planilha exportada (abas Contratos, Médicos por contrato, Áreas x Setores).'); },
  ctrImportFile: (el, e) => {
    if (e && e.type === 'input') return;
    const file = el.files && el.files[0]; if (!file) return;
    return file.arrayBuffer().then(buf => {
      const wb = window.XLSX.read(buf, { type: 'array', cellDates: true });
      S.ctrImp = ctrParseModelo(wb); S.tabs.ctrTab = 'modelo'; render();
    });
  },
  ctrImportCancel: () => { S.ctrImp = null; render(); },
  ctrImportApply: async () => {
    const imp = S.ctrImp; if (!imp) return;
    if (!confirm(`Substituir os contratos do app por ${imp.contracts.length} contratos e ${imp.links.length} vínculos deste arquivo?`)) return;
    if (REAL) {
      const areaCod = new Map(imp.areas.map(a => [a.id, a.codigo]));
      const payload = { areas: imp.areas.map(a => ({ codigo: a.codigo, nome: a.nome, cobre_plantao: a.cobre_plantao, modalidade: a.modalidade, observacao: a.observacao, setores: a.sector_ids.map(secName) })),
        contracts: imp.contracts.map(c => ({ numero: c.numero, razao_social: c.razao_social, cnpj: c.cnpj, processo: c.processo, modalidade: c.modalidade, inicio: c.inicio, fim: c.fim, valor: c.valor, carga_horaria: c.carga, destaque: c.destaque, observacao: c.observacao,
          links: imp.links.filter(l => l.contract_id === c.id).map(l => ({ area_codigo: areaCod.get(l.area_id) || null, nome: l.nome, matricula: l.matricula, inicio: l.inicio, fim: l.fim, lote: l.lote, destaque: l.destaque, nao_vindo: !!l.nao_vindo })) })) };
      const { data, error } = await S.sb.rpc('import_contratos_modelo', { p: payload }); if (error) throw new Error(error.message);
      await ctrReloadReal(); S.ctrImp = null; render(); toast(`Importado: ${data.contratos} contratos, ${data.vinculos} vínculos.`); return;
    }
    S.data.contracts = imp.contracts; S.data.ctrLinks = imp.links; S.data.ctrAreas = imp.areas;
    S.data.fonteContratos = { ...(S.data.fonteContratos || {}), importadoEm: todayIso(), origem: 'modelo importado' };
    audit('CONTRATOS_IMPORTADOS', `Modelo CONTRATOS MÉDICOS importado: ${imp.contracts.length} contratos, ${imp.links.length} vínculos`);
    S.ctrImp = null; ctrDirty(); render(); toast('Contratos substituídos pelo arquivo.');
  },
  ctrNew: () => ctrEditModal(null),
  ctrEdit: el => ctrEditModal(el.dataset.id),
  ctrSave: async () => {
    const f = document.getElementById('ctrForm'); if (!f) return;
    const o = Object.fromEntries(new FormData(f).entries()), id = f.dataset.id || null;
    if (!o.razao_social.trim()) { toast('Informe a razão social.', true); return; }
    const row = { numero: o.numero.trim() || null, razao_social: o.razao_social.trim(), cnpj: o.cnpj.trim() || null, processo: o.processo.trim() || null, modalidade: o.modalidade.trim() || null, inicio: o.inicio || null, fim: o.fim || null, valor: o.valor ? Number(o.valor) : null, carga: o.carga.trim() || null, observacao: o.observacao.trim() || null };
    if (row.inicio && row.fim && row.fim < row.inicio) { toast('A data final é antes da inicial.', true); return; }
    if (REAL) {
      const db = { ...row, carga_horaria: row.carga, updated_at: new Date().toISOString() }; delete db.carga;
      const r = id ? await S.sb.from('contracts').update(db).eq('id', id) : await S.sb.from('contracts').insert(db);
      if (r.error) throw new Error(r.error.message);
      if (id) { const c0 = IDX.ctr.get(id); for (const l of ctrLinksOf(id)) { const up = {}; if (l.fim === c0.fim) up.fim = row.fim; if (l.inicio === c0.inicio) up.inicio = row.inicio; if (Object.keys(up).length) await S.sb.from('contract_links').update(up).eq('id', l.id); } }
      await ctrReloadReal();
    } else if (id) {
      const c0 = IDX.ctr.get(id);
      ctrLinksOf(id).forEach(l => { if (l.fim === c0.fim) l.fim = row.fim; if (l.inicio === c0.inicio) l.inicio = row.inicio; }); // vínculo que seguia a vigência do contrato acompanha
      Object.assign(c0, row);
    }
    else S.data.contracts.push({ id: rid('ct'), ...row });
    if (!REAL) { audit('CONTRATO_EDITADO', `Contrato ${row.numero || 's/ nº'} – ${row.razao_social}`); ctrDirty(); }
    closeModal(); render(); toast('Contrato salvo.');
  },
  ctrAddLink: async el => {
    const cid = el.dataset.id, did = document.getElementById('ctrAddDoc')?.value, aid = document.getElementById('ctrAddArea')?.value;
    if (!did || !aid) { toast('Escolha o médico e a área.', true); return; }
    const m = doc(did), c = IDX.ctr.get(cid);
    const l = { id: rid('cl'), contract_id: cid, area_id: aid, coord_sector_id: null, doctor_id: did, nome: m.name, matricula: m.matricula, inicio: c.inicio || null, fim: c.fim || null, lote: '', destaque: null, nao_vindo: false };
    if (REAL) { const db = { ...l }; delete db.id; const r = await S.sb.from('contract_links').insert(db); if (r.error) throw new Error(r.error.message); await ctrReloadReal(); }
    else { S.data.ctrLinks.push(l); audit('CONTRATO_MEDICO_INCLUIDO', `${m.name} no contrato ${c.numero || 's/ nº'} (${ctrAreaName(aid)})`); ctrDirty(); }
    render(); ctrEditModal(cid);
  },
  ctrToggleNV: async el => {
    const l = (S.data.ctrLinks || []).find(x => x.id === el.dataset.id); if (!l) return;
    const v = !l.nao_vindo;
    if (REAL) { const r = await S.sb.from('contract_links').update({ nao_vindo: v }).eq('id', l.id); if (r.error) throw new Error(r.error.message); await ctrReloadReal(); }
    else { S.data.ctrLinks.filter(x => x.contract_id === l.contract_id && (x.doctor_id ? x.doctor_id === l.doctor_id : x.nome === l.nome)).forEach(x => { x.nao_vindo = v; }); audit('CONTRATO_NAO_VINDO', `${l.nome}: ${v ? 'não está vindo' : 'está vindo'}`); ctrDirty(); }
    render(); ctrEditModal(l.contract_id);
  },
  ctrDelLink: async el => {
    const l = (S.data.ctrLinks || []).find(x => x.id === el.dataset.id); if (!l) return;
    if (!confirm(`Tirar ${l.nome} deste contrato (${ctrAreaName(l.area_id)})?`)) return;
    if (REAL) { const r = await S.sb.from('contract_links').delete().eq('id', l.id); if (r.error) throw new Error(r.error.message); await ctrReloadReal(); }
    else { S.data.ctrLinks = S.data.ctrLinks.filter(x => x !== l); audit('CONTRATO_MEDICO_RETIRADO', `${l.nome} retirado do contrato`); ctrDirty(); }
    render(); ctrEditModal(l.contract_id);
  },
  ctrAreaAddSec: async (el, e) => {
    if (e && e.type === 'input') return;
    const a = (S.data.ctrAreas || []).find(x => x.id === el.dataset.area), sid = el.value; if (!a || !sid) return;
    if (REAL) { const r = await S.sb.from('contract_area_sectors').insert({ area_id: a.id, sector_id: sid }); if (r.error) throw new Error(r.error.message); await ctrReloadReal(); }
    else { a.sector_ids = [...new Set([...(a.sector_ids || []), sid])]; audit('CONTRATO_AREA_SETOR', `${a.nome} → ${secName(sid)}`); ctrDirty(); }
    render();
  },
  ctrAreaDelSec: async el => {
    const a = (S.data.ctrAreas || []).find(x => x.id === el.dataset.area), sid = el.dataset.sec; if (!a) return;
    if (REAL) { const r = await S.sb.from('contract_area_sectors').delete().eq('area_id', a.id).eq('sector_id', sid); if (r.error) throw new Error(r.error.message); await ctrReloadReal(); }
    else { a.sector_ids = (a.sector_ids || []).filter(x => x !== sid); audit('CONTRATO_AREA_SETOR', `${a.nome} sem ${secName(sid)}`); ctrDirty(); }
    render();
  }
});
// ── v4.4 · “FAZER PARA TODOS OS OUTROS IGUAIS” ──
// Ao escolher o médico certo para um nome “fora do cadastro” / “informação incorreta” (ex.: “Dr Roger”),
// a mesma escolha pode ser aplicada a todos os outros plantões com o MESMO nome escrito
// (comparação normalizada: maiúsculas, acentos, espaços e Dr/Dra — “Dr Roger” = “Dr roger” = “DrRoger”).
// Regras: só plantões SEM médico do cadastro; nunca mexe em plantão já ligado a um médico;
// Junior/Filho/Neto/Sobrinho são outras pessoas (o texto normalizado tem de ser igual);
// padrão seguro = mesmo setor, todos os meses carregados; “todos os setores” só com aviso.
// O apelido fica lembrado POR SETOR (upsert_name_alias / confirm_shift_names). Desfazer volta o lote inteiro.

const ESC_IGUAIS_SCOPES = [
  ['month', 'Neste setor, só neste mês'],
  ['setor', 'Neste setor, em todos os meses'],
  ['all', 'Em todos os setores e meses']
];
function escIguaisKey(raw) { return escNormName(raw || ''); }
function escIguaisTargets({ raw, sectorId, ym, scope, exclude }) {
  const k = escIguaisKey(raw);
  if (!k) return [];
  return (S.data.shifts || []).filter(s =>
    !s.doctor_id && s.status !== 'cancelled' && s.source_text && escIguaisKey(s.source_text) === k &&
    (scope === 'all' || s.sector_id === sectorId) &&
    (scope !== 'month' || monthOf(s.starts_at) === ym) &&
    !(exclude && exclude(s)));
}
function escIguaisExclude(p) {
  const same = escPickerExcept(p);
  return s => (p.shiftId && s.id === p.shiftId) || same(s);
}
function escIguaisGroups(list) {
  const m = new Map();
  list.forEach(s => {
    const ym = monthOf(s.starts_at);
    const k = ym + '|' + s.sector_id + '|' + (s.escala_id || '');
    const g = m.get(k) || m.set(k, { ym, sectorId: s.sector_id, escalaId: s.escala_id || null, n: 0 }).get(k);
    g.n++;
  });
  return [...m.values()].sort((a, b) => a.ym.localeCompare(b.ym) || secName(a.sectorId).localeCompare(secName(b.sectorId), 'pt-BR'));
}
function escIguaisGroupLabel(g) {
  const pub = (S.data.schedules || []).some(s => s.month_ref === g.ym && s.sector_id === g.sectorId && s.status === 'published');
  const esc_ = g.escalaId ? escEscalaName(g.escalaId) : '';
  return `${fmtMonth(g.ym)} · ${secName(g.sectorId)}${esc_ ? ' · ' + esc_ : ''}: ${g.n} plantão(ões)${pub ? ' (escala já salva)' : ''}`;
}
function escIguaisMonthsTxt(list) {
  const by = {};
  list.forEach(s => { const ym = monthOf(s.starts_at); by[ym] = (by[ym] || 0) + 1; });
  return Object.keys(by).sort().map(ym => `${escMonthShort(ym)}/${ym.slice(0, 4)}: ${by[ym]}`).join(' · ');
}
// conflitos que a troca criaria (com plantões que o médico já tem e entre os próprios plantões do lote)
function escIguaisConflicts(doctorId, list) {
  if (!doctorId) return [];
  const ids = new Set(list.map(s => s.id));
  return list.filter(t => {
    const ex = x => x.id === t.id;
    if (escConflictsFor(doctorId, t.starts_at, t.ends_at, ex).length) return true;
    return list.some(o => o.id !== t.id && ids.has(o.id) && overlap(t, o));
  });
}

function escIguaisHtml(p) {
  if (!p || !p.raw || p.doctorId || !p.sectorId || !isEscalista()) return '';
  const ym = p.ym || (p.starts_at ? monthOf(p.starts_at) : escYm());
  const ex = escIguaisExclude(p);
  const cnt = Object.fromEntries(ESC_IGUAIS_SCOPES.map(([k]) => [k, escIguaisTargets({ raw: p.raw, sectorId: p.sectorId, ym, scope: k, exclude: ex }).length]));
  if (!cnt.all) return '';
  const scope = cnt.setor ? 'setor' : 'all';
  p.iguais = { scope, ym };
  return `<div class="esc-iguais" id="escIguaisBox">
    <label class="esc-iguais-main"><input type="checkbox" id="escIguaisOn" ${cnt.setor ? 'checked' : ''}> <span><b>FAZER PARA TODOS OS OUTROS IGUAIS</b><br><small>Trocar “${esc(p.raw)}” pelo médico escolhido em <b id="escIguaisN">${cnt[scope]}</b> outro(s) plantão(ões).</small></span></label>
    <div class="esc-iguais-scope">${ESC_IGUAIS_SCOPES.map(([k, lab]) => `<label class="${cnt[k] ? '' : 'off'}"><input type="radio" name="escIguaisScope" value="${k}" ${k === scope ? 'checked' : ''} ${cnt[k] ? '' : 'disabled'}> ${esc(lab)} <span class="muted">(${cnt[k]})</span></label>`).join('')}</div>
    <div class="esc-iguais-warn ${scope === 'all' ? '' : 'hidden'}" id="escIguaisWarn">⚠ Cuidado: nome curto pode ser OUTRA pessoa em outro setor. Confira a lista abaixo antes de escolher.</div>
    <div class="esc-iguais-prev" id="escIguaisPrev">${escIguaisPrevHtml(p)}</div>
    <p class="muted small">Só troca plantões com esse mesmo nome escrito e ainda sem médico do cadastro. Nomes com Junior/Filho/Neto/Sobrinho são outras pessoas e não entram. O nome fica lembrado neste setor para as próximas importações. Dá para desfazer tudo de uma vez.</p>
  </div>`;
}
function escIguaisPrevHtml(p) {
  const st = p.iguais || {};
  const list = escIguaisTargets({ raw: p.raw, sectorId: p.sectorId, ym: st.ym, scope: st.scope, exclude: escIguaisExclude(p) });
  const groups = escIguaisGroups(list);
  const sel = p._pendingId || null;
  const conf = sel ? escIguaisConflicts(sel, list) : [];
  return `<ul>${groups.map(g => `<li>${esc(escIguaisGroupLabel(g))}</li>`).join('')}</ul>` +
    (sel ? `<div class="${conf.length ? 'esc-iguais-conf' : 'muted small'}">${conf.length ? `⚠ ${esc(docName(sel))} ficaria em dois lugares no mesmo horário em ${conf.length} desses plantões (aparece em Conferir avisos).` : `Sem conflito de horário para ${esc(docName(sel))}.`}</div>` : '');
}
function escIguaisReadDom() {
  const on = !!document.getElementById('escIguaisOn')?.checked;
  const scope = document.querySelector('input[name=escIguaisScope]:checked')?.value || 'setor';
  const p = S.esc.pick;
  // apelido antes da escolha (o clique já grava o apelido do setor; o Desfazer volta a este valor)
  const prevAlias = p && p.raw ? ((S.data.aliasesNomes || {})[escIguaisKey(p.raw) + '@' + p.sectorId] || null) : null;
  return { on, scope, prevAlias };
}
function escIguaisRefresh() {
  const p = S.esc.pick; if (!p || !p.iguais) return;
  const { on, scope } = escIguaisReadDom();
  p.iguais.scope = scope;
  const n = escIguaisTargets({ raw: p.raw, sectorId: p.sectorId, ym: p.iguais.ym, scope, exclude: escIguaisExclude(p) }).length;
  const el = document.getElementById('escIguaisN'); if (el) el.textContent = n;
  document.getElementById('escIguaisWarn')?.classList.toggle('hidden', scope !== 'all');
  const pv = document.getElementById('escIguaisPrev'); if (pv) { pv.innerHTML = escIguaisPrevHtml(p); pv.classList.toggle('dim', !on); }
}
document.addEventListener('change', e => { if (e.target.closest && e.target.closest('#escIguaisBox')) escIguaisRefresh(); });

function escIguaisSlotKey(s) { return [s.sector_id, ms(s.starts_at), ms(s.ends_at), s.local || '', s.escala_id || ''].join('|'); }

// aplica o lote. Retorna { n, conflicts } ou null.
async function escApplyIguais({ raw, doctorId, sectorId, ym, scope, clicked, prevAlias }) {
  if (!isEscalista()) { toast('Só quem monta a escala pode trocar nomes.', true); return null; }
  if (REAL && typeof realLoad === 'function') await realLoad(); // ids reais depois de regravar a grade
  const list = escIguaisTargets({ raw, sectorId, ym, scope });
  if (!list.length) return { n: 0, conflicts: 0 };
  const otherSec = [...new Set(list.filter(s => s.sector_id !== sectorId).map(s => s.sector_id))];
  if (otherSec.length && !confirm(`Trocar “${raw}” por ${docName(doctorId)} também em ${otherSec.map(secName).join(', ')}?\n\nNome curto pode ser OUTRA pessoa em outro setor.\n\n${escIguaisGroups(list).map(escIguaisGroupLabel).join('\n')}`)) return null;
  const aliasNorm = escIguaisKey(raw);
  const aliasKey = aliasNorm + '@' + sectorId;
  const undo = {
    raw, doctorId, sectorId, aliasKey, prevAlias: prevAlias !== undefined ? prevAlias : ((S.data.aliasesNomes || {})[aliasKey] || null),
    items: list.map(s => ({ slot: escIguaisSlotKey(s), id: s.id, prevRaw: s.source_text, prevConf: s.match_conf || null, prevOrig: s.original_doctor_id || null })),
    months: escIguaisMonthsTxt(list), at: Date.now()
  };
  if (clicked) undo.items.push({ slot: clicked.slot, prevRaw: raw, prevConf: 'fora_cadastro', prevOrig: null, clicked: true });
  if (REAL) await rpc('confirm_shift_names', { p_ids: list.map(s => s.id), p_doctor: doctorId, p_alias: aliasNorm, p_sector: sectorId });
  list.forEach(s => { s.doctor_id = doctorId; if (!s.original_doctor_id) s.original_doctor_id = doctorId; s.match_conf = 'manual'; });
  S.data.aliasesNomes = S.data.aliasesNomes || {};
  S.data.aliasesNomes[aliasKey] = doctorId;
  S.data.importNotes = (S.data.importNotes || []).filter(n => !((scope === 'all' || n.setorId === sectorId) && escIguaisKey(n.raw || '') === aliasNorm));
  reindex();
  const conflicts = list.filter(s => escConflictsFor(doctorId, s.starts_at, s.ends_at, x => x.id === s.id).length).length;
  undo.conflicts = conflicts;
  S.esc.undoIguais = undo;
  audit('NOMES_TROCADOS', `“${raw}” → ${docName(doctorId)} em ${list.length} plantão(ões) (${undo.months})`);
  if (!REAL) demoSave();
  return { n: list.length, conflicts, months: undo.months };
}

async function escUndoIguais() {
  const u = S.esc.undoIguais;
  if (!u) { toast('Nada para desfazer.', true); return; }
  const bySlot = new Map();
  (S.data.shifts || []).forEach(s => { if (s.doctor_id === u.doctorId) (bySlot.get(escIguaisSlotKey(s)) || bySlot.set(escIguaisSlotKey(s), []).get(escIguaisSlotKey(s))).push(s); });
  const hits = [];
  u.items.forEach(it => { const arr = bySlot.get(it.slot); const s = arr && (arr.find(x => x.id === it.id) || arr[0]); if (s && !hits.some(h => h.s === s)) hits.push({ s, it }); });
  if (REAL && hits.length) await rpc('undo_shift_names', { p_ids: hits.map(h => h.s.id), p_alias: escIguaisKey(u.raw), p_sector: u.sectorId, p_raw: u.raw, p_raw_ids: hits.filter(h => h.it.clicked).map(h => h.s.id) });
  hits.forEach(({ s, it }) => { s.doctor_id = null; s.source_text = it.prevRaw || u.raw; s.match_conf = 'fora_cadastro'; s.original_doctor_id = it.prevOrig; });
  if (u.prevAlias) S.data.aliasesNomes[u.aliasKey] = u.prevAlias; else if (S.data.aliasesNomes) delete S.data.aliasesNomes[u.aliasKey];
  S.esc.undoIguais = null;
  reindex();
  audit('NOMES_TROCADOS_DESFEITO', `Desfeita a troca de “${u.raw}” (${hits.length} plantão(ões))`);
  if (!REAL) demoSave();
  toast(`Desfeito: “${u.raw}” voltou em ${hits.length} plantão(ões).`);
  render();
}

function escIguaisBanner() {
  const u = S.esc.undoIguais;
  if (!u) return '';
  return `<div class="callout info esc-iguais-undo" id="escIguaisUndo"><span>“${esc(u.raw)}” → <b>${esc(docName(u.doctorId))}</b> em ${u.items.filter(i => !i.clicked).length} outro(s) plantão(ões) (${esc(u.months)})${u.items.some(i => i.clicked) ? ' e no plantão escolhido' : ''}.${u.conflicts ? ` <b class="red">${u.conflicts} ficou(aram) em conflito de horário.</b>` : ''}</span>
    <button class="btn" data-act="escUndoIguais">Desfazer</button><button class="btn" data-act="escUndoIguaisOk">OK</button></div>`;
}

// ── ligações com o picker (grade e conferência) ──
const _escOpenPicker0 = escOpenPicker;
escOpenPicker = function (opts) {
  _escOpenPicker0(opts);
  const p = S.esc.pick, box = document.querySelector('.esc-pick');
  if (!p || !box) return;
  const html = escIguaisHtml(p);
  if (!html) return;
  const anchor = box.querySelector('.esc-apply-all') || box.querySelector('.form-actions');
  anchor.insertAdjacentHTML('beforebegin', html);
};

function escIguaisFindApplied(p, id) {
  return (S.data.shifts || []).find(s => s.doctor_id === id && p.starts_at && escSameSlot(s, p.sectorId, p.starts_at, p.ends_at, p.local || ''));
}
async function escIguaisAfterPick(p, st, id) {
  if (!st || !st.on || !id) return;
  const hit = escIguaisFindApplied(p, id);
  if (!hit) return; // a escolha foi cancelada
  const r = await escApplyIguais({ raw: p.raw, doctorId: id, sectorId: p.sectorId, ym: p.iguais.ym, scope: st.scope, prevAlias: st.prevAlias, clicked: { slot: escIguaisSlotKey(hit) } });
  if (r && r.n) toast(`Feito: “${p.raw}” → ${docName(id)} em mais ${r.n} plantão(ões) (${r.months}).${r.conflicts ? ` ${r.conflicts} em conflito de horário — veja em Conferir avisos.` : ''} Nome lembrado neste setor.`, !!r.conflicts);
  render();
}
const _escPickDoc1 = EscAct.escPickDoc;
EscAct.escPickDoc = async el => {
  const p = S.esc.pick;
  const st = p && p.iguais ? escIguaisReadDom() : null;
  if (p && p.askApplyAll && p.iguais) {
    await _escPickDoc1(el);
    const lab = document.querySelector('#escApplyAllBox label');
    const cb = document.getElementById('escApplyAllAlias');
    if (cb) cb.checked = false;
    if (lab) lab.classList.add('hidden');
    escIguaisRefresh();
    return;
  }
  await _escPickDoc1(el);
  if (p && p.iguais) await escIguaisAfterPick(p, st, el.dataset.id);
};
const _escPickApply1 = EscAct.escPickApply;
EscAct.escPickApply = async el => {
  const p = S.esc.pick;
  const st = p && p.iguais ? escIguaisReadDom() : null;
  const id = p && p._pendingId;
  await _escPickApply1(el);
  if (p && p.iguais) await escIguaisAfterPick(p, st, id);
};
Object.assign(EscAct, {
  escUndoIguais: () => escUndoIguais(),
  escUndoIguaisOk: () => { S.esc.undoIguais = null; render(); }
});

// faixa “Desfazer” na grade e na conferência
const _escPageGrid0 = escPageGrid;
escPageGrid = function () { const h = _escPageGrid0(); const b = escIguaisBanner(); return b ? h.replace('<span class="esc-badge', b + '<span class="esc-badge') : h; };
const _escPageConf0 = escPageConf;
escPageConf = function () { const h = _escPageConf0(); const b = escIguaisBanner(); return b ? h.replace('<div class="esc-status">', b + '<div class="esc-status">') : h; };
// ── v4.7 · Assistente (só leitura, estágio 1) ──
// Conversas com o Google AI Studio (Gemini) direto do navegador.
// O modelo é escolhido pela lista oficial (GET /v1beta/models), preferindo Flash-Lite estável.
// A chave fica SÓ no localStorage deste navegador — nunca no código, no seed, no zip ou no banco.
// Padrão: só o MASTER vê a tela. Para liberar também à escalista, mude a flag abaixo para true.
// O contexto é montado conforme a pergunta (escala, trocas, cadastro, contratos, alertas, ponto),
// sem CPF, telefone, e-mail, CRM ou matrícula. “Acesso a tudo” fica para uma versão futura.
const ASSISTENTE_PARA_ESCALISTA = false;
const AI_LS_KEY = 'escalamed_gemini_api_key';
const AI_LS_MODEL = 'escalamed_gemini_model';
const AI_API = 'https://generativelanguage.googleapis.com/v1beta';
const AI_CTX_MAX = 24000;
const AI_SILENCE_MS = 8000;
const AI_SYSTEM = `Você é o assistente de escalas do Hospital Municipal Padre Germano Lauck (HMPGL), em Foz do Iguaçu.
Responda em português, de forma curta e clara, só com base nos dados enviados nesta conversa.
Se a informação não estiver nos dados, diga exatamente o que faltou (por exemplo: “não recebi as trocas de outubro” ou “não recebi os contratos”). Não diga só “não sei” ou “essa informação não consta”.
Não invente nomes, horários, plantões, trocas, contratos, cadastro ou ponto.
Não altere nada: você só consulta. Não peça e não use dados pessoais sensíveis.
Nomes com Junior, Jr, Filho, Neto ou Sobrinho são pessoas diferentes; nunca junte com o homônimo sem esse sufixo.
Se houver alerta (fora do cadastro, informação incorreta, sem contrato, conflito de horário, não está vindo, contrato vencido), mencione.
Pode usar listas simples e negrito com **texto**.`;

function aiAllowed() {
  if (isMaster()) return true;
  return !!(ASSISTENTE_PARA_ESCALISTA && S.me?.kind === 'escalista');
}
function aiState() {
  if (!S.ai) S.ai = { msgs: [], speak: false, speaking: false, listening: false, ficticio: true, err: '', draft: '', busy: false, cfgOpen: false };
  return S.ai;
}
function aiGetKey() { try { return (localStorage.getItem(AI_LS_KEY) || '').trim(); } catch (e) { return ''; } }
function aiSetKey(k) { try { if (k) localStorage.setItem(AI_LS_KEY, k); else localStorage.removeItem(AI_LS_KEY); } catch (e) { throw new Error('Não foi possível guardar a chave neste navegador.'); } }
function aiGetModel() { try { return (localStorage.getItem(AI_LS_MODEL) || '').trim(); } catch (e) { return ''; } }
function aiSetModel(id) {
  id = (id || '').trim();
  try { if (id) localStorage.setItem(AI_LS_MODEL, id); else localStorage.removeItem(AI_LS_MODEL); } catch (e) { /* ignore */ }
  const st = S.ai; if (st) st.model = id;
}
function aiSpeechOn() { return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
function aiSpeakOn() { return typeof window !== 'undefined' && 'speechSynthesis' in window; }

// retira e-mail, CPF formatado, telefone BR e CRM/CRO etiquetados — nunca envia isso à IA
function aiStripPii(s) {
  return String(s || '')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi, '[retirado]')
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[retirado]')
    .replace(/\b(?:[+]55\s*)?(?:\(?\d{2}\)?\s*)?(?:9\d{4}|\d{4})-?\d{4}\b/g, '[retirado]')
    .replace(/\bCR[MO]\/?[A-Z]{0,2}\s*n?º?\s*\d{3,7}(?:-[A-Z]{2})?\b/gi, '[retirado]');
}

const AI_MES_NOME = [['janeiro','01'],['fevereiro','02'],['marco','03'],['março','03'],['abril','04'],['maio','05'],['junho','06'],['julho','07'],['agosto','08'],['setembro','09'],['outubro','10'],['novembro','11'],['dezembro','12']];
function aiDefaultMonth(fallback) {
  return fallback || (S.f && S.f.month) || (typeof monthOf === 'function' && typeof nowMs === 'function' ? monthOf(nowMs()) : '') || '2026-11';
}
function aiMonthsFromQuestion(q, fallback) {
  const t = normTxt(q || '');
  const found = new Set();
  const yDefault = String(aiDefaultMonth(fallback).slice(0, 4));
  AI_MES_NOME.forEach(([n, m]) => { if (t.includes(n)) found.add(yDefault + '-' + m); });
  for (const m of t.matchAll(/\b(20\d{2})-(\d{2})\b/g)) found.add(m[1] + '-' + m[2]);
  for (const m of t.matchAll(/\b(\d{1,2})\/(20\d{2})\b/g)) found.add(m[2] + '-' + String(m[1]).padStart(2, '0'));
  if (/(neste|este|esse|nesta|esta|essa) mes/.test(t)) found.add(aiDefaultMonth(fallback));
  if (/todos os meses|o ano todo/.test(t) && !found.size) {
    const all = (typeof months === 'function' ? months() : []).filter(ym => (IDX.shiftsByMonth && IDX.shiftsByMonth.get(ym) || []).length);
    if (all.length) return all;
  }
  if (found.size) return [...found].sort();
  return [aiDefaultMonth(fallback)];
}
function aiSufixo(n) { return /\b(junior|jr|filho|neto|sobrinho)\b/.test(normTxt(n || '')); }
function aiNameMentionedIn(q, name) {
  const nq = normTxt(q || ''), nn = normTxt(name || '');
  if (nn.length < 5) return false;
  const stop = new Set(['dos','das','do','da','de','dr','dra','junior','filho','neto','sobrinho']);
  const toks = nn.split(/\s+/).filter(w => w.length > 2 && !stop.has(w));
  if (toks.length < 2) return nq.includes(nn) && aiSufixo(name) === aiSufixo(q);
  if (!(nq.includes(toks[0]) && nq.includes(toks[1]))) return nq.includes(nn);
  return aiSufixo(name) === aiSufixo(q); // Junior/Filho nunca se funde com o homônimo
}
function aiDocsMentioned(q) { return (S.data.doctors || []).filter(d => aiNameMentionedIn(q, d.name)); }
function aiSetoresMentioned(q) {
  const nq = normTxt(q || '');
  return (S.data.sectors || []).filter(s => { const n = normTxt(s.name); return n.length >= 4 && nq.includes(n); });
}
function aiTipo(s) { return s.type === 'Visita' ? 'Plantão (visita)' : (s.type || 'Plantão'); }
function aiNomeShift(s) { return s.doctor_id ? docName(s.doctor_id) : (s.source_text || 'sem nome'); }
function aiContratoTxt(s) {
  const r = typeof ctrShiftCheck === 'function' ? ctrShiftCheck(s) : null;
  if (r) return r.motivo;
  if (!s.doctor_id) return 'sem médico do cadastro';
  if (typeof ctrIdx !== 'function') return 'sim';
  const day = dayKey(s.starts_at), X = ctrIdx();
  const sa = X.secAreas.get(s.sector_id) || new Set();
  const L = (X.byDoc.get(s.doctor_id) || []).filter(l => sa.has(l.area_id) && (!l.inicio || l.inicio <= day) && (!l.fim || l.fim >= day));
  if (!L.length) return 'sim';
  const l = L[0], area = typeof ctrAreaName === 'function' ? ctrAreaName(l.area_id) : '';
  const fim = l.fim || (IDX.ctr && IDX.ctr.get(l.contract_id) || {}).fim;
  return 'sim' + (area ? ' · ' + area : '') + (fim ? ' · até ' + fmtDia(fim) : '');
}
function aiConflictIds(ym) {
  const list = (IDX.shiftsByMonth.get(ym) || []).filter(s => s.doctor_id && s.status !== 'cancelled');
  const byDoc = new Map();
  list.forEach(s => { (byDoc.get(s.doctor_id) || byDoc.set(s.doctor_id, []).get(s.doctor_id)).push(s); });
  const ids = new Set();
  list.forEach(s => { if (s.status === 'conflito') ids.add(s.id); });
  byDoc.forEach(arr => {
    arr.sort((a, b) => ms(a.starts_at) - ms(b.starts_at));
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      if (ms(arr[j].starts_at) >= ms(arr[i].ends_at)) break;
      if (overlap(arr[i], arr[j])) { ids.add(arr[i].id); ids.add(arr[j].id); }
    }
  });
  return ids;
}

function aiClassify(q) {
  const t = normTxt(q || '');
  const topics = new Set();
  if (/troca|permuta|whatsapp/.test(t)) topics.add('trocas');
  if (/contrato|lote|vencid|nao esta vindo|sem contrato|vigente|nao vigente/.test(t)) topics.add('contratos');
  if (/medico|medicos|cadastro|habilit|pode assumir|pode atuar|pode ser escalad|quem esta cadastrad/.test(t)) topics.add('cadastro');
  if (/conflito|inconsistenc|alerta|aviso|fora do cadastro|informacao incorreta/.test(t)) topics.add('alertas');
  if (/\bponto\b|cartao ponto|cruzamento|faltas?\b|atrasos?\b|cumprid/.test(t)) topics.add('ponto');
  if (/escala|plantao|plantoes|sobreaviso|\bvisita\b|quem (esta|ta|fica|planta)|horario/.test(t)) topics.add('escala');
  if (!topics.size) topics.add('escala');
  return topics;
}

const AI_WA_ST = { importada: 'pronta para aplicar', a_revisar: 'a revisar', aplicada: 'aplicada', descartada: 'descartada' };
const AI_SW_ST = { pending: 'aguarda o colega', needs_master: 'aguarda MASTER', completed: 'concluída', rejected: 'recusada', cancelled: 'cancelada', conflict: 'conflito' };

// Mundo fictício coerente (setembro, outubro e novembro de 2026). Só usado no modo demonstração.
const AI_FIC_MESES = ['2026-09', '2026-10', '2026-11'];
const AI_FIC = {
  medicos: [
    { nome: 'Ana Exemplo', setores: ['Cirurgia Geral'], contrato: true, naoVindo: false },
    { nome: 'Bruno Demonstração', setores: ['Cirurgia Geral'], contrato: true, naoVindo: false },
    { nome: 'Carla Fictícia', setores: ['Cirurgia Geral', 'UTI 1'], contrato: true, naoVindo: false },
    { nome: 'Diego Teste', setores: ['UTI 1'], contrato: true, naoVindo: false },
    { nome: 'Elena Ilustração', setores: ['Ortopedia / Pronto-Socorro'], contrato: false, naoVindo: false },
    { nome: 'Fabio Modelo', setores: ['Pediatria'], contrato: true, naoVindo: true },
    { nome: 'Helena Ausente', setores: ['UTI 1'], contrato: true, naoVindo: true }
  ],
  contratos: [
    { numero: '9001', area: 'Cirurgia Geral', inicio: '01/01/2026', fim: '31/12/2026', situacao: 'vigente', medicos: 3, nomes: ['Ana Exemplo', 'Bruno Demonstração', 'Carla Fictícia'] },
    { numero: '9002', area: 'UTI', inicio: '01/01/2026', fim: '31/12/2026', situacao: 'vigente', medicos: 3, nomes: ['Carla Fictícia', 'Diego Teste', 'Helena Ausente'], naoVindo: ['Helena Ausente'] },
    { numero: '9003', area: 'Ortopedia', inicio: '01/01/2025', fim: '30/06/2026', situacao: 'vencido', medicos: 0, nomes: [] },
    { numero: '9004', area: 'Pediatria', inicio: '01/07/2026', fim: '30/06/2027', situacao: 'vigente', medicos: 1, nomes: ['Fabio Modelo'], naoVindo: ['Fabio Modelo'] },
    { numero: '9005', area: 'Radiologia', inicio: '01/01/2027', fim: '31/12/2027', situacao: 'ainda não vigente', medicos: 0, nomes: [] }
  ],
  semContrato: ['Elena Ilustração'],
  escalas: {
    '2026-09': `Setembro de 2026: 14 lançamentos (14 plantões, 0 sobreavisos, 0 visitas). Alertas de contrato: 0. Conflitos de horário: 0. Fora do cadastro: 0. Informação incorreta: 0.

CIRURGIA GERAL · Plantão
- Ana Exemplo: 4 plantões (dias 1, 8, 15, 22 · 07:00–13:00) · contrato: sim · área Cirurgia Geral · até 31/12/2026
- Bruno Demonstração: 4 plantões (dias 2, 9, 16, 23 · 13:00–19:00) · contrato: sim · área Cirurgia Geral · até 31/12/2026

UTI 1
- Diego Teste: 6 plantões (dias 3, 4, 5, 6, 7, 8 · 07:00–19:00) · contrato: sim · área UTI · até 31/12/2026`,
    '2026-10': `Outubro de 2026: 25 lançamentos (25 plantões, 0 sobreavisos, 0 visitas). Alertas de contrato: 1. Conflitos de horário: 0. Fora do cadastro: 0. Informação incorreta: 0.

CIRURGIA GERAL · Plantão
- Ana Exemplo: 5 plantões (dias 2, 7, 9, 14, 21 · 07:00–13:00) · contrato: sim · área Cirurgia Geral · até 31/12/2026
- Bruno Demonstração: 6 plantões (dias 3, 8, 11, 15, 22, 28 · 13:00–19:00) · contrato: sim · área Cirurgia Geral · até 31/12/2026

UTI 1
- Carla Fictícia: 3 plantões (dias 10, 17, 24 · 19:00–07:00) · contrato: sim · área UTI · até 31/12/2026
- Diego Teste: 7 plantões (dias 1, 2, 3, 4, 5, 6, 7 · 07:00–19:00) · contrato: sim · área UTI · até 31/12/2026

ORTOPEDIA / PRONTO-SOCORRO
- Elena Ilustração: 4 plantões (dias 5, 12, 19, 26 · 13:00–19:00) · alerta: sem contrato`,
    '2026-11': `Novembro de 2026: 32 lançamentos (30 plantões, 2 sobreavisos, 0 visitas). Alertas de contrato: 2. Conflitos de horário: 2. Fora do cadastro: 0. Informação incorreta: 1.

CIRURGIA GERAL · Plantão
- Ana Exemplo: 6 plantões (dias 1, 3, 5, 8, 12, 19 · 07:00–13:00) · contrato: sim · área Cirurgia Geral · até 31/12/2026
- Bruno Demonstração: 5 plantões (dias 2, 6, 10, 16, 24 · 13:00–19:00) · contrato: sim · área Cirurgia Geral · até 31/12/2026
- Carla Fictícia: 2 plantões (dia 4 19:00–07:00; dia 4 também na UTI 1 19:00–07:00) · alerta: conflito de horário · contrato: sim · área Cirurgia Geral · até 31/12/2026

UTI 1
- Carla Fictícia: 1 plantão (dia 4 19:00–07:00) · alerta: conflito de horário com Cirurgia Geral · contrato: sim · área UTI · até 31/12/2026
- Diego Teste: 8 plantões (dias 1, 2, 3, 5, 6, 7, 8, 9 · 07:00–19:00) · contrato: sim · área UTI · até 31/12/2026

ORTOPEDIA / PRONTO-SOCORRO
- Dr Nome Curto: 4 plantões (dias 7, 11, 14, 21 · 07:00–13:00) · alerta: informação incorreta
- Elena Ilustração: 6 plantões (dias 1, 2, 3, 4, 5, 6 · 13:00–19:00) · alerta: sem contrato`
  },
  trocas: {
    '2026-09': [
      { data: '08/09/2026', setor: 'Cirurgia Geral', horario: '07:00–13:00', sai: 'Ana Exemplo', entra: 'Bruno Demonstração', status: 'aplicada', origem: 'WhatsApp' }
    ],
    '2026-10': [
      { data: '14/10/2026', setor: 'Cirurgia Geral', horario: '07:00–13:00', sai: 'Ana Exemplo', entra: 'Bruno Demonstração', status: 'aplicada', origem: 'WhatsApp' },
      { data: '17/10/2026', setor: 'UTI 1', horario: '19:00–07:00', sai: 'Carla Fictícia', entra: 'Diego Teste', status: 'concluída', origem: 'app' },
      { data: '22/10/2026', setor: 'Cirurgia Geral', horario: '13:00–19:00', sai: 'Bruno Demonstração', entra: 'Ana Exemplo', status: 'a revisar', origem: 'WhatsApp' }
    ],
    '2026-11': [
      { data: '08/11/2026', setor: 'UTI 1', horario: '19:00–07:00', sai: 'Diego Teste', entra: 'Bruno Demonstração', status: 'pronta para aplicar', origem: 'WhatsApp' },
      { data: '12/11/2026', setor: 'Ortopedia / Pronto-Socorro', horario: '13:00–19:00', sai: 'Elena Ilustração', entra: 'Ana Exemplo', status: 'a revisar', origem: 'WhatsApp' },
      { data: '19/11/2026', setor: 'Cirurgia Geral', horario: '07:00–13:00', sai: 'Ana Exemplo', entra: 'Carla Fictícia', status: 'aguarda o colega', origem: 'app' }
    ]
  },
  alertas: {
    '2026-09': 'Nenhum alerta de escala em setembro.',
    '2026-10': 'Outubro: 1 sem contrato (Elena Ilustração, 4 plantões em Ortopedia / Pronto-Socorro). 0 conflito de horário. 0 informação incorreta. 0 fora do cadastro.',
    '2026-11': 'Novembro: 1 informação incorreta (Dr Nome Curto, 4 plantões em Ortopedia / Pronto-Socorro). 1 sem contrato (Elena Ilustração, 6 plantões em Ortopedia / Pronto-Socorro). 1 conflito de horário (Carla Fictícia, Cirurgia Geral e UTI 1 no dia 4, 19:00–07:00). 0 fora do cadastro.'
  },
  ponto: {
    '2026-09': [
      { nome: 'Ana Exemplo', plantoes: 4, cumpridos: 4, faltas: 0, atrasos: 0, saidas: 0 },
      { nome: 'Bruno Demonstração', plantoes: 4, cumpridos: 4, faltas: 0, atrasos: 0, saidas: 0 },
      { nome: 'Diego Teste', plantoes: 6, cumpridos: 5, faltas: 1, atrasos: 0, saidas: 0 }
    ],
    '2026-10': [
      { nome: 'Ana Exemplo', plantoes: 5, cumpridos: 5, faltas: 0, atrasos: 0, saidas: 0 },
      { nome: 'Bruno Demonstração', plantoes: 6, cumpridos: 5, faltas: 0, atrasos: 1, saidas: 0 },
      { nome: 'Carla Fictícia', plantoes: 3, cumpridos: 3, faltas: 0, atrasos: 0, saidas: 0 },
      { nome: 'Diego Teste', plantoes: 7, cumpridos: 6, faltas: 1, atrasos: 0, saidas: 0 },
      { nome: 'Elena Ilustração', plantoes: 4, cumpridos: 3, faltas: 0, atrasos: 0, saidas: 1 }
    ],
    '2026-11': [
      { nome: 'Ana Exemplo', plantoes: 6, cumpridos: 6, faltas: 0, atrasos: 0, saidas: 0 },
      { nome: 'Bruno Demonstração', plantoes: 5, cumpridos: 4, faltas: 0, atrasos: 1, saidas: 0 },
      { nome: 'Carla Fictícia', plantoes: 3, cumpridos: 3, faltas: 0, atrasos: 0, saidas: 0 },
      { nome: 'Diego Teste', plantoes: 8, cumpridos: 7, faltas: 0, atrasos: 1, saidas: 0 },
      { nome: 'Elena Ilustração', plantoes: 6, cumpridos: 4, faltas: 1, atrasos: 0, saidas: 1 }
    ]
  }
};

function aiFmtTroca(t) {
  return '- ' + t.data + ' · ' + t.setor + (t.horario ? ' ' + t.horario : '') + ' · sai ' + t.sai + ' · entra ' + t.entra + ' · ' + t.status + (t.origem ? ' (' + t.origem + ')' : '');
}
function aiFmtPonto(p) {
  const bits = [p.plantoes + ' plantão(ões)', p.cumpridos + ' cumprido(s)'];
  if (p.faltas) bits.push(p.faltas + ' falta(s)');
  if (p.atrasos) bits.push(p.atrasos + ' atraso(s)');
  if (p.saidas) bits.push(p.saidas + ' saída(s) antecipada(s)');
  if (p.incompletos) bits.push(p.incompletos + ' incompleto(s)');
  return '- ' + p.nome + ': ' + bits.join(', ');
}
function aiFmtCadastro(m) {
  return '- ' + m.nome + ': setores ' + (m.setores.length ? m.setores.join(', ') : 'nenhum') + ' · contrato: ' + (m.contrato ? 'sim' : 'não') + ' · não está vindo: ' + (m.naoVindo ? 'sim' : 'não');
}

function aiSecTrocasFic(yms) {
  const lines = ['TROCAS DE PLANTÃO (dados fictícios; fontes equivalentes à aba Trocas de plantão e Trocas do WhatsApp):'];
  let n = 0;
  yms.forEach(ym => {
    const list = AI_FIC.trocas[ym] || [];
    if (!list.length) {
      if (AI_FIC_MESES.includes(ym)) lines.push(fmtMonth(ym) + ': nenhuma troca registrada.');
      else lines.push(fmtMonth(ym) + ': não recebi as trocas de ' + fmtMonth(ym).toLowerCase() + ' (modo demonstração cobre setembro, outubro e novembro).');
      return;
    }
    lines.push(fmtMonth(ym) + ': ' + list.length + ' troca(s).');
    list.forEach(t => { lines.push(aiFmtTroca(t)); n++; });
  });
  return { name: 'as trocas de ' + yms.map(fmtMonth).join(', '), text: lines.join('\n'), short: lines[0] + '\n' + yms.map(ym => fmtMonth(ym) + ': ' + (AI_FIC.trocas[ym] || []).length + ' troca(s).').join(' '), n };
}
function aiSecCadastroFic(q) {
  const all = AI_FIC.medicos;
  const nv = all.filter(m => m.naoVindo), sem = all.filter(m => !m.contrato);
  const cited = all.filter(m => aiNameMentionedIn(q, m.nome));
  const lines = ['CADASTRO DE MÉDICOS (dados fictícios; nome, setores em que podem ser escalados, contrato sim/não, não está vindo):'];
  lines.push(all.length + ' médicos no cadastro. Com contrato: ' + all.filter(m => m.contrato).length + '. Sem contrato: ' + sem.length + ' (' + (sem.map(m => m.nome).join(', ') || '—') + '). Não está vindo: ' + nv.length + ' (' + (nv.map(m => m.nome).join(', ') || '—') + ').');
  const show = cited.length ? cited : all;
  if (cited.length) lines.push('Citados na pergunta:');
  show.forEach(m => lines.push(aiFmtCadastro(m)));
  return { name: 'o cadastro de médicos', text: lines.join('\n'), short: lines.slice(0, 2).join('\n') };
}
function aiSecContratosFic(yms) {
  const C = AI_FIC.contratos;
  const lines = ['CONTRATOS POR ÁREA/LOTE (dados fictícios; nº, validade, quantidade de médicos, situação):'];
  lines.push('Total: ' + C.length + ' contratos (' + C.filter(c => c.situacao === 'vigente').length + ' vigentes, ' + C.filter(c => c.situacao === 'vencido').length + ' vencido(s), ' + C.filter(c => c.situacao === 'ainda não vigente').length + ' ainda não vigente(s)). Médicos sem contrato: ' + AI_FIC.semContrato.join(', ') + '.');
  C.forEach(c => {
    lines.push('- Contrato ' + c.numero + ' · ' + c.area + ' · ' + c.inicio + ' a ' + c.fim + ' · ' + c.situacao + ' · ' + c.medicos + ' médico(s)' + (c.nomes && c.nomes.length ? ': ' + c.nomes.join(', ') : '') + (c.naoVindo && c.naoVindo.length ? ' · não está vindo: ' + c.naoVindo.join(', ') : ''));
  });
  yms.forEach(ym => {
    if (AI_FIC.alertas[ym]) lines.push('Na escala de ' + fmtMonth(ym).toLowerCase() + ': ' + (AI_FIC.semContrato.length ? AI_FIC.semContrato.join(', ') + ' aparece sem contrato.' : 'ninguém da escala fictícia está sem contrato.'));
  });
  return { name: 'os contratos', text: lines.join('\n'), short: lines.slice(0, 2).join('\n') };
}
function aiSecAlertasFic(yms) {
  const lines = ['ALERTAS DA ESCALA (dados fictícios):'];
  yms.forEach(ym => {
    if (AI_FIC.alertas[ym]) lines.push(AI_FIC.alertas[ym]);
    else lines.push(fmtMonth(ym) + ': não recebi os alertas de ' + fmtMonth(ym).toLowerCase() + ' (modo demonstração cobre setembro, outubro e novembro).');
  });
  return { name: 'os alertas de ' + yms.map(fmtMonth).join(', '), text: lines.join('\n'), short: lines.join('\n') };
}
function aiSecPontoFic(yms) {
  const lines = ['CARTÃO PONTO / CRUZAMENTO (dados fictícios; nome e totais por médico):'];
  yms.forEach(ym => {
    const list = AI_FIC.ponto[ym];
    if (!list) { lines.push(fmtMonth(ym) + ': não recebi o cartão ponto de ' + fmtMonth(ym).toLowerCase() + ' (modo demonstração cobre setembro, outubro e novembro).'); return; }
    lines.push(fmtMonth(ym) + ':');
    list.forEach(p => lines.push(aiFmtPonto(p)));
  });
  return { name: 'o cartão ponto de ' + yms.map(fmtMonth).join(', '), text: lines.join('\n'), short: lines[0] + '\n' + yms.map(ym => fmtMonth(ym) + ': ' + (AI_FIC.ponto[ym] ? (AI_FIC.ponto[ym].length + ' médico(s)') : 'não recebi')).join(' ') };
}
function aiSecEscalaFic(yms) {
  const parts = [];
  yms.forEach(ym => {
    if (AI_FIC.escalas[ym]) parts.push(AI_FIC.escalas[ym]);
    else parts.push(fmtMonth(ym) + ': não recebi a escala de ' + fmtMonth(ym).toLowerCase() + ' (modo demonstração cobre setembro, outubro e novembro).');
  });
  const text = parts.join('\n\n');
  const short = yms.map(ym => {
    const raw = AI_FIC.escalas[ym];
    if (!raw) return fmtMonth(ym) + ': escala não enviada neste resumo.';
    return raw.split('\n')[0];
  }).join('\n');
  return { name: 'as escalas de ' + yms.map(fmtMonth).join(', '), text, short, flex: true, clip: n => aiClipEscala(text, n) };
}

function aiShiftMonth(s) { return s && (s._month || monthOf(s.starts_at)); }
function aiRealTrocas(yms) {
  const set = new Set(yms);
  const lines = ['TROCAS DE PLANTÃO (fontes: aba Trocas de plantão e Trocas do WhatsApp):'];
  let n = 0;
  yms.forEach(ym => {
    const app = (S.data.swaps || []).filter(x => {
      const a = x.shift_from_id && shiftById(x.shift_from_id);
      const b = x.shift_to_id && shiftById(x.shift_to_id);
      return (a && aiShiftMonth(a) === ym) || (b && aiShiftMonth(b) === ym);
    });
    const wa = (S.data.whatsapp || []).filter(w => monthOf(w.starts_at || w.data_plantao) === ym);
    if (!app.length && !wa.length) {
      lines.push(fmtMonth(ym) + ': nenhuma troca registrada.');
      return;
    }
    lines.push(fmtMonth(ym) + ': ' + (app.length + wa.length) + ' troca(s) (' + app.length + ' no app, ' + wa.length + ' do WhatsApp).');
    app.forEach(x => {
      const a = x.shift_from_id && shiftById(x.shift_from_id);
      const b = x.shift_to_id && shiftById(x.shift_to_id);
      const dt = a ? (fmtD(a.starts_at) + ' · ' + secName(a.sector_id) + ' ' + fmtH(a.starts_at) + '–' + fmtH(a.ends_at)) : 'plantão não carregado';
      const extra = b ? ' (recíproca com ' + fmtD(b.starts_at) + ' · ' + secName(b.sector_id) + ')' : '';
      lines.push('- ' + dt + ' · sai ' + docName(x.requester_id) + ' · entra ' + docName(x.target_id) + extra + ' · ' + (AI_SW_ST[x.status] || x.status) + ' (app)');
      n++;
    });
    wa.forEach(w => {
      const sai = (w.sai_doctor_id ? docName(w.sai_doctor_id) : (w.sai_texto || 'não identificado'));
      const entra = (w.entra_doctor_id ? docName(w.entra_doctor_id) : (w.entra_texto || 'não identificado'));
      const setor = w.setor_texto || '';
      const when = (w.starts_at ? fmtD(w.starts_at) : (w.data_plantao || '')) + (w.horario ? ' ' + w.horario : '');
      lines.push('- ' + when + (setor ? ' · ' + setor : '') + ' · sai ' + sai + ' · entra ' + entra + ' · ' + (AI_WA_ST[w.status] || w.status) + ' (WhatsApp)');
      n++;
    });
  });
  const short = lines.filter(l => !l.startsWith('- ')).join('\n');
  return { name: 'as trocas de ' + yms.map(fmtMonth).join(', '), text: lines.join('\n'), short, n };
}
function aiDocFlag(d) {
  const L = (typeof ctrIdx === 'function' ? (ctrIdx().byDoc.get(d.id) || []) : []);
  const has = L.length > 0 || !!d.em_contrato;
  const nv = L.some(l => l.nao_vindo);
  const setores = (d.sector_ids || []).map(secName).filter(Boolean);
  return { nome: d.name, setores, contrato: has, naoVindo: nv };
}
function aiRealCadastro(q) {
  const teste = typeof CTR_TESTE_MAT !== 'undefined' ? CTR_TESTE_MAT : '1988';
  const all = (S.data.doctors || []).filter(d => d.active !== false && d.matricula !== teste);
  const flags = all.map(aiDocFlag);
  const nv = flags.filter(m => m.naoVindo), sem = flags.filter(m => !m.contrato);
  const cited = flags.filter(m => aiNameMentionedIn(q, m.nome));
  const secs = aiSetoresMentioned(q);
  const ofSec = secs.length ? flags.filter(m => m.setores.some(n => secs.some(s => s.name === n))) : [];
  const lines = ['CADASTRO DE MÉDICOS (nome, setores em que podem ser escalados, contrato sim/não, não está vindo):'];
  lines.push(flags.length + ' médicos no cadastro. Com contrato: ' + flags.filter(m => m.contrato).length + '. Sem contrato: ' + sem.length + '. Não está vindo: ' + nv.length + '.');
  if (nv.length) lines.push('Não está vindo (' + nv.length + '): ' + nv.map(m => m.nome).join(', ') + '.');
  if (sem.length && sem.length <= 80) lines.push('Sem contrato (' + sem.length + '): ' + sem.map(m => m.nome).join(', ') + '.');
  else if (sem.length) lines.push('Sem contrato: ' + sem.length + ' médicos (pergunte por um setor ou um nome para ver a lista).');
  const detail = cited.length ? cited : (ofSec.length ? ofSec : []);
  if (detail.length) {
    lines.push(cited.length ? 'Citados na pergunta:' : 'Do setor citado:');
    detail.forEach(m => lines.push(aiFmtCadastro(m)));
  } else {
    const bySec = new Map();
    flags.forEach(m => {
      (m.setores.length ? m.setores : ['(sem setor)']).forEach(s => { (bySec.get(s) || bySec.set(s, []).get(s)).push(m.nome); });
    });
    lines.push('Por setor em que podem ser escalados:');
    [...bySec.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach(s => {
      const nomes = bySec.get(s);
      lines.push('- ' + s + ' (' + nomes.length + '): ' + nomes.join(', '));
    });
  }
  const short = lines.slice(0, 3).join('\n') + (nv.length ? '\nNão está vindo: ' + nv.map(m => m.nome).join(', ') : '');
  return { name: 'o cadastro de médicos (lista por setor)', text: lines.join('\n'), short };
}
function aiRealContratos(yms) {
  const lines = ['CONTRATOS POR ÁREA/LOTE (nº, validade, quantidade de médicos, situação):'];
  if (typeof ctrHasData === 'function' && !ctrHasData() && !(S.data.contracts || []).length) {
    lines.push('Não recebi os contratos (ainda não há planilha importada nesta sessão).');
    return { name: 'os contratos', text: lines.join('\n'), short: lines.join('\n') };
  }
  const C = S.data.contracts || [];
  const st = {};
  C.forEach(c => { st[c.id] = typeof ctrStatus === 'function' ? ctrStatus(c) : { k: 'vigente', txt: 'vigente' }; });
  const cnt = k => C.filter(c => st[c.id].k === k).length;
  const X = typeof ctrIdx === 'function' ? ctrIdx() : { byCt: new Map(), areas: new Map() };
  const teste = typeof CTR_TESTE_MAT !== 'undefined' ? CTR_TESTE_MAT : '1988';
  const docs = (S.data.doctors || []).filter(d => d.active !== false && d.matricula !== teste);
  const com = docs.filter(d => (X.byDoc && X.byDoc.get(d.id) || []).length || d.em_contrato);
  const semCad = docs.filter(d => !((X.byDoc && X.byDoc.get(d.id) || []).length || d.em_contrato));
  const nvLinks = (S.data.ctrLinks || []).filter(l => l.nao_vindo);
  const nvNomes = [...new Set(nvLinks.map(l => l.doctor_id ? docName(l.doctor_id) : l.nome).filter(Boolean))];
  lines.push('Total: ' + C.length + ' contratos (' + cnt('vigente') + ' vigentes, ' + cnt('vencendo') + ' vencendo em até 60 dias, ' + cnt('vencido') + ' vencido(s), ' + cnt('futuro') + ' ainda não vigente(s), ' + cnt('sem') + ' sem vigência). Médicos do cadastro com contrato: ' + com.length + '. Sem contrato: ' + semCad.length + '. Não está vindo: ' + nvNomes.length + '.');
  if (nvNomes.length) lines.push('Não está vindo: ' + nvNomes.join(', ') + '.');
  if (semCad.length && semCad.length <= 80) lines.push('Médicos do cadastro sem contrato: ' + semCad.map(d => d.name).join(', ') + '.');
  const byArea = new Map();
  C.forEach(c => {
    const ls = (X.byCt && X.byCt.get(c.id)) || [];
    const areaIds = [...new Set(ls.map(l => l.area_id).filter(Boolean))];
    const areaNames = areaIds.length ? areaIds.map(id => (typeof ctrAreaName === 'function' ? ctrAreaName(id) : id)) : ['(sem área)'];
    const meds = new Set(ls.map(l => l.doctor_id || l.nome));
    areaNames.forEach(nome => {
      const e = byArea.get(nome) || byArea.set(nome, { nome, n: 0, vigentes: 0, vencidos: 0, futuros: 0, vencendo: 0, meds: new Set(), vencList: [] }).get(nome);
      e.n++; meds.forEach(x => e.meds.add(x));
      const k = st[c.id].k;
      if (k === 'vigente') e.vigentes++;
      else if (k === 'vencido') { e.vencidos++; e.vencList.push('nº ' + (c.numero || 's/ nº') + ' até ' + (typeof fmtDia === 'function' ? fmtDia(c.fim) : c.fim)); }
      else if (k === 'vencendo') { e.vencendo++; e.vencList.push('nº ' + (c.numero || 's/ nº') + ' até ' + (typeof fmtDia === 'function' ? fmtDia(c.fim) : c.fim)); }
      else if (k === 'futuro') e.futuros++;
    });
  });
  lines.push('Por área/lote:');
  [...byArea.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).forEach(e => {
    lines.push('- ' + e.nome + ': ' + e.n + ' contrato(s) (' + e.vigentes + ' vigente(s)' + (e.vencendo ? ', ' + e.vencendo + ' vencendo' : '') + (e.vencidos ? ', ' + e.vencidos + ' vencido(s)' : '') + (e.futuros ? ', ' + e.futuros + ' ainda não vigente(s)' : '') + '), ' + e.meds.size + ' médico(s)' + (e.vencList.length ? ' · ' + e.vencList.join('; ') : ''));
  });
  yms.forEach(ym => {
    if (typeof ctrSemContrato !== 'function') return;
    const L = ctrSemContrato(ym);
    if (!L.length) { lines.push('Na escala de ' + fmtMonth(ym) + ': ninguém com alerta de contrato.'); return; }
    const byK = {};
    L.forEach(e => { (byK[e.r.motivo] = byK[e.r.motivo] || []).push(e.nome + ' (' + e.n + ' plantão(ões))'); });
    lines.push('Na escala de ' + fmtMonth(ym) + ', médicos com alerta de contrato (' + L.length + '): ' + Object.entries(byK).map(([k, v]) => k + ' — ' + v.join(', ')).join('; ') + '.');
  });
  const short = lines.slice(0, 2).join('\n') + '\nPor área/lote: ' + [...byArea.values()].map(e => e.nome + ' (' + e.n + ' contrato(s), ' + e.meds.size + ' médico(s))').join('; ') + '.';
  return { name: 'os contratos (detalhe por área)', text: lines.join('\n'), short };
}
function aiRealAlertas(yms) {
  const lines = ['ALERTAS DA ESCALA:'];
  yms.forEach(ym => {
    const list = (IDX.shiftsByMonth.get(ym) || []).filter(s => s.status !== 'cancelled' && (typeof pubShift !== 'function' || pubShift(s)));
    if (!list.length) { lines.push(fmtMonth(ym) + ': mês sem escala carregada — não recebi os alertas desse mês.'); return; }
    const confIds = aiConflictIds(ym);
    const confNomes = new Set(), fora = new Set(), inc = new Set(), outros = [];
    list.forEach(s => {
      if (confIds.has(s.id)) confNomes.add(aiNomeShift(s) + ' (' + secName(s.sector_id) + ', dia ' + (+dayKey(s.starts_at).slice(8)) + ')');
      const r = typeof ctrShiftCheck === 'function' ? ctrShiftCheck(s) : null;
      if (!r) return;
      if (r.k === 'fora') fora.add(aiNomeShift(s));
      else if (r.k === 'incorreta') inc.add(aiNomeShift(s));
      else outros.push(aiNomeShift(s) + ' · ' + r.motivo);
    });
    lines.push(fmtMonth(ym) + ': ' + confNomes.size + ' conflito(s) de horário, ' + inc.size + ' informação incorreta, ' + fora.size + ' fora do cadastro, ' + new Set(outros).size + ' outro(s) alerta(s) de contrato.');
    if (confNomes.size) lines.push('Conflitos: ' + [...confNomes].join('; ') + '.');
    if (inc.size) lines.push('Informação incorreta: ' + [...inc].join(', ') + '.');
    if (fora.size) lines.push('Fora do cadastro: ' + [...fora].join(', ') + '.');
    if (outros.length) {
      const u = [...new Set(outros)];
      lines.push('Outros alertas: ' + (u.length > 80 ? u.slice(0, 80).join('; ') + ' …' : u.join('; ')) + '.');
    }
  });
  return { name: 'os alertas de ' + yms.map(fmtMonth).join(', '), text: lines.join('\n'), short: lines.filter(l => !l.startsWith('Conflitos') && !l.startsWith('Informação') && !l.startsWith('Fora') && !l.startsWith('Outros')).join('\n') };
}
function aiRealPonto(yms) {
  const lines = ['CARTÃO PONTO / CRUZAMENTO (nome e totais por médico):'];
  const miss = [];
  yms.forEach(ym => {
    if (typeof pontoRows !== 'function') { lines.push(fmtMonth(ym) + ': não recebi o cruzamento de ponto (função indisponível).'); miss.push(ym); return; }
    let c;
    try { c = pontoRows(ym); } catch (e) { lines.push(fmtMonth(ym) + ': não consegui ler o cruzamento de ponto.'); miss.push(ym); return; }
    if (c && c.loading) { lines.push(fmtMonth(ym) + ': o cruzamento de ponto ainda não foi carregado nesta sessão (abra a tela Escala x Ponto nesse mês).'); miss.push(ym); return; }
    const rows = (c && c.rows) || [];
    if (!rows.length) { lines.push(fmtMonth(ym) + ': não recebi o cartão ponto / cruzamento desse mês (não há marcações carregadas).'); miss.push(ym); return; }
    const by = new Map();
    rows.forEach(r => {
      const e = by.get(r.doctorName) || by.set(r.doctorName, { nome: r.doctorName, plantoes: 0, cumpridos: 0, faltas: 0, atrasos: 0, saidas: 0, incompletos: 0 }).get(r.doctorName);
      e.plantoes++;
      const oc = (r.ocorrencias && r.ocorrencias.length) ? r.ocorrencias : [r.status];
      if (oc.includes('falta')) e.faltas++;
      else if (r.status === 'cumprido' || oc.includes('cumprido')) e.cumpridos++;
      if (oc.includes('atraso')) e.atrasos++;
      if (oc.includes('saida_antecipada')) e.saidas++;
      if (oc.includes('incompleto')) e.incompletos++;
    });
    const list = [...by.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    lines.push(fmtMonth(ym) + ': ' + list.length + ' médico(s) no cruzamento.');
    list.forEach(p => lines.push(aiFmtPonto(p)));
  });
  const short = lines.filter(l => !l.startsWith('- ')).join('\n');
  return { name: 'o cartão ponto de ' + yms.map(fmtMonth).join(', '), text: lines.join('\n'), short };
}
function aiRealEscala(yms, q) {
  const docs = aiDocsMentioned(q);
  const nomesMen = (() => {
    const names = new Set();
    (S.data.doctors || []).forEach(d => { if (d.name) names.add(d.name); });
    (S.data.shifts || []).forEach(s => { if (s.source_text) names.add(s.source_text); });
    return [...names].filter(n => aiNameMentionedIn(q, n));
  })();
  const secs = aiSetoresMentioned(q);
  const docIds = new Set(docs.map(d => d.id));
  const secIds = new Set(secs.map(s => s.id));
  const parts = [];
  yms.forEach(ym => {
    let list = (IDX.shiftsByMonth.get(ym) || []).filter(s => s.status !== 'cancelled' && (typeof pubShift !== 'function' || pubShift(s)));
    if (!list.length) { parts.push(fmtMonth(ym) + ': mês sem escala carregada.'); return; }
    const confIds = aiConflictIds(ym);
    const tot = list.length, nP = list.filter(s => s.type === 'Plantão').length, nS = list.filter(s => s.type === 'Sobreaviso').length, nV = list.filter(s => s.type === 'Visita').length;
    let nAlert = 0, nConf = 0, nFora = 0, nInc = 0;
    list.forEach(s => {
      if (confIds.has(s.id)) nConf++;
      const r = typeof ctrShiftCheck === 'function' ? ctrShiftCheck(s) : null;
      if (r) { nAlert++; if (r.k === 'fora') nFora++; if (r.k === 'incorreta') nInc++; }
    });
    parts.push(fmtMonth(ym) + ': ' + tot + ' lançamentos (' + nP + ' plantões, ' + nS + ' sobreavisos, ' + nV + ' visitas). Alertas de contrato: ' + nAlert + '. Conflitos de horário: ' + nConf + '. Fora do cadastro: ' + nFora + '. Informação incorreta: ' + nInc + '.');
    let use = list;
    if (nomesMen.length) use = use.filter(s => aiNameMentionedIn(q, aiNomeShift(s)));
    else if (docIds.size) use = use.filter(s => docIds.has(s.doctor_id));
    if (secIds.size) use = use.filter(s => secIds.has(s.sector_id));
    const bySec = new Map();
    use.forEach(s => {
      const sk = (secName(s.sector_id) || '—') + (s.escala_id && typeof escEscalaName === 'function' && escEscalaName(s.escala_id) ? ' · ' + escEscalaName(s.escala_id) : '');
      (bySec.get(sk) || bySec.set(sk, []).get(sk)).push(s);
    });
    [...bySec.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach(sk => {
      parts.push('\n' + sk);
      const groups = new Map();
      bySec.get(sk).forEach(s => {
        const nome = aiNomeShift(s), tipo = aiTipo(s), hh = fmtH(s.starts_at) + '–' + fmtH(s.ends_at), ctr = aiContratoTxt(s), conf = confIds.has(s.id) ? 'conflito de horário' : '';
        const gk = [nome, tipo, hh, ctr, conf].join('|');
        const g = groups.get(gk) || groups.set(gk, { nome, tipo, hh, ctr, conf, days: [] }).get(gk);
        g.days.push(+dayKey(s.starts_at).slice(8));
      });
      [...groups.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).forEach(g => {
        const days = [...new Set(g.days)].sort((a, b) => a - b);
        let alerta = [];
        if (g.conf) alerta.push(g.conf);
        if (g.ctr && g.ctr !== 'sim' && !g.ctr.startsWith('sim ')) alerta.push(g.ctr);
        const ctrPart = g.ctr && g.ctr.startsWith('sim') ? ' · contrato: ' + g.ctr : '';
        const alPart = alerta.length ? ' · alerta: ' + alerta.join('; ') : '';
        parts.push('- ' + g.nome + ': ' + days.length + ' ' + (g.tipo.toLowerCase().includes('sobreaviso') ? 'sobreaviso(s)' : 'plantão(ões)') + ' (dias ' + days.join(', ') + ' · ' + g.hh + ')' + ctrPart + alPart);
      });
    });
  });
  const text = parts.join('\n');
  const short = parts.filter(l => /lançamentos|mês sem escala/.test(l)).join('\n') || parts.slice(0, 3).join('\n');
  return { name: 'as escalas de ' + yms.map(fmtMonth).join(', '), text, short, flex: true, clip: n => aiClipEscala(text, n) };
}

// Encaixa o detalhe da escala no espaço que restou, priorizando setores com alerta.
function aiClipEscala(text, max) {
  if (!text || text.length <= max) return text;
  const lines = String(text).split('\n');
  const blocks = [];
  let cur = { alert: false, lines: [] };
  const isHead = ln => ln && !ln.startsWith('- ') && !ln.startsWith('…') && !/lançamentos|mês sem escala/.test(ln) && !/^\s*$/.test(ln);
  const isSum = ln => /lançamentos|mês sem escala/.test(ln);
  const flush = () => { if (cur.lines.length) blocks.push(cur); cur = { alert: false, lines: [] }; };
  const keep = [];
  lines.forEach(ln => {
    if (isSum(ln)) { flush(); keep.push(ln); return; }
    if (isHead(ln) && cur.lines.length) flush();
    cur.lines.push(ln);
    if (/alerta:/.test(ln)) cur.alert = true;
  });
  flush();
  let used = keep.join('\n').length;
  const cut = [];
  const add = b => {
    const t = b.lines.join('\n');
    if (used + t.length + 1 <= max - 180) { keep.push(t); used += t.length + 1; return true; }
    const head = (b.lines[0] || '').trim();
    if (head) cut.push(head);
    return false;
  };
  blocks.filter(b => b.alert).forEach(add);
  blocks.filter(b => !b.alert).forEach(add);
  if (cut.length) keep.push('… (não coube o detalhe de: ' + cut.slice(0, 12).join('; ') + (cut.length > 12 ? ' e mais ' + (cut.length - 12) : '') + '. Pergunte por um setor ou um médico.)');
  let out = keep.join('\n');
  if (out.length > max) out = out.slice(0, Math.max(0, max - 80)) + '\n… (contexto cortado; pergunte por um setor ou um médico).';
  return out;
}

function aiPack(header, sections, max) {
  const cut = [];
  const out = header.slice();
  let used = header.join('\n').length;
  const room = () => max - used - 220;
  const flexible = [];
  sections.forEach(s => {
    if (!s || !s.text) return;
    if (s.flex) { flexible.push(s); return; }
    const t = s.text, sh = s.short || (t.split('\n').slice(0, 4).join('\n'));
    if (t.length + 2 <= room()) { out.push(t); used += t.length + 2; }
    else if (sh.length + 2 <= room()) { out.push(sh); used += sh.length + 2; cut.push('o detalhe de ' + s.name); }
    else cut.push(s.name);
  });
  flexible.forEach(s => {
    const r = Math.max(400, room());
    let t = s.text;
    if (t.length + 2 > r) {
      t = typeof s.clip === 'function' ? s.clip(r) : (s.short || t.slice(0, r));
      cut.push('parte do detalhe de ' + s.name + ' (pergunte por um setor ou um médico para ver o resto)');
    }
    if (t) { out.push(t); used += t.length + 2; }
  });
  let txt = out.join('\n\n');
  if (cut.length) {
    txt += '\n\n[aviso ao assistente] O contexto foi cortado para caber no pedido. Não foram enviados: ' + cut.join('; ') + '. Diga exatamente o que não recebeu (por exemplo: “não recebi as trocas de outubro”).';
  }
  if (txt.length > max) txt = txt.slice(0, max) + '\n\n[aviso ao assistente] O contexto foi cortado para caber no pedido. Diga o que não recebeu, se faltar informação.';
  return txt;
}

function aiBuildContext(question, opts = {}) {
  const ficticio = opts.ficticio != null ? opts.ficticio : aiState().ficticio;
  const topics = opts.topics || aiClassify(question);
  let yms = opts.months || aiMonthsFromQuestion(question, opts.month || (S.f && S.f.month));
  if (ficticio) {
    if (/todos os meses|o ano todo/.test(normTxt(question || '')) && !(opts.months || []).length) yms = AI_FIC_MESES.slice();
  }
  const max = opts.max || AI_CTX_MAX;
  const pri = (name, fn) => (topics.has(name) ? 0 : 1);
  const makers = [];
  const add = (topic, fn) => { if (topics.has(topic)) makers.push([topic, fn]); };
  add('escala', () => ficticio ? aiSecEscalaFic(yms) : aiRealEscala(yms, question));
  add('trocas', () => ficticio ? aiSecTrocasFic(yms) : aiRealTrocas(yms));
  add('cadastro', () => ficticio ? aiSecCadastroFic(question) : aiRealCadastro(question));
  add('contratos', () => ficticio ? aiSecContratosFic(yms) : aiRealContratos(yms));
  add('alertas', () => ficticio ? aiSecAlertasFic(yms) : aiRealAlertas(yms));
  add('ponto', () => ficticio ? aiSecPontoFic(yms) : aiRealPonto(yms));
  makers.sort((a, b) => pri(a[0]) - pri(b[0]));
  const header = [
    'Hospital Municipal Padre Germano Lauck — dados de consulta (' + (ficticio ? 'DADOS FICTÍCIOS para teste, não são médicos nem escalas reais' : 'somente o que o MASTER já vê; sem dados pessoais') + ').',
    'Meses: ' + yms.map(fmtMonth).join(', ') + '. Pedidos nesta pergunta: ' + [...topics].join(', ') + '.'
  ];
  const sections = makers.map(([, fn]) => fn());
  return aiStripPii(aiPack(header, sections, max));
}

function aiFicticioTexto() {
  return aiBuildContext('escala trocas contratos cadastro alertas ponto de setembro outubro e novembro', { ficticio: true, months: AI_FIC_MESES.slice(), topics: new Set(['escala', 'trocas', 'cadastro', 'contratos', 'alertas', 'ponto']) });
}

// Renderiza **negrito** e listas simples, escapando qualquer HTML da resposta.
function aiRenderHtml(text) {
  const raw = String(text || '');
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const lines = raw.split('\n');
  const out = [];
  let list = [], ordered = false;
  const flush = () => {
    if (!list.length) return;
    const tag = ordered ? 'ol' : 'ul';
    out.push('<' + tag + '>' + list.map(li => '<li>' + inline(li) + '</li>').join('') + '</' + tag + '>');
    list = []; ordered = false;
  };
  lines.forEach(ln => {
    const ul = ln.match(/^\s*(?:[-*•])\s+(.*)$/);
    const ol = ln.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul) { if (list.length && ordered) flush(); ordered = false; list.push(ul[1]); return; }
    if (ol) { if (list.length && !ordered) flush(); ordered = true; list.push(ol[1]); return; }
    flush();
    out.push(ln === '' ? '<div class="ai-gap"></div>' : '<div class="ai-line">' + inline(ln) + '</div>');
  });
  flush();
  return out.join('');
}


function aiSafeText(s) {
  return String(s || '')
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, '[chave]')
    .replace(/([?&]key=)[^&\s"'<>]+/gi, '$1[chave]')
    .replace(/(x-goog-api-key["'\s:=]+)[^\s"'&<]+/gi, '$1[chave]');
}
function aiGoogleMessage(raw) {
  try {
    const j = JSON.parse(String(raw || ''));
    const m = j && j.error && (j.error.message || j.error.status);
    if (m) return aiSafeText(m);
  } catch (e) { /* texto puro */ }
  return aiSafeText(String(raw || '').slice(0, 300));
}
function aiHeaders(key, json) {
  const h = { 'x-goog-api-key': key };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}
async function aiFetchGoogle(path, key, opts) {
  const url = AI_API + path; // a chave vai no cabeçalho, nunca na URL
  let res;
  try {
    res = await fetch(url, {
      method: (opts && opts.method) || 'GET',
      headers: aiHeaders(key, !!(opts && opts.body)),
      body: opts && opts.body != null ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new Error('Não foi possível falar com o Google. Confira a internet. Se a mensagem continuar, o navegador pode estar bloqueando a conexão (CORS).');
  }
  const raw = await res.text();
  return { res, raw };
}
function aiModelId(m) { return String((m && m.name) || m || '').replace(/^models\//, ''); }
function aiCanGenerate(m) { return ((m && (m.supportedGenerationMethods || m.supported_generation_methods)) || []).indexOf('generateContent') >= 0; }
function aiModelAvoid(id) { return /preview|\bexp\b|experimental|tts|image|imagen|veo|thinking-only|embedding|aqa|bison|gecko|learnlm|gemma/i.test(id || ''); }
function aiPreferModel(models) {
  const ids = (models || []).filter(aiCanGenerate).map(aiModelId).filter(Boolean);
  const ver = id => { const m = String(id).match(/gemini-(\d+(?:\.\d+)?)/i); return m ? parseFloat(m[1]) : 0; };
  const kind = id => /flash-lite/i.test(id) ? 3 : (/flash/i.test(id) ? 2 : (/pro/i.test(id) ? 1 : 0));
  const stable = id => (/-\d{2}-\d{2}$/.test(id) || /-\d{3}$/.test(id)) ? 0 : 1;
  const score = id => [aiModelAvoid(id) ? 0 : 1, kind(id), ver(id), stable(id)];
  const cmp = (a, b) => { const sa = score(a), sb = score(b); for (let i = 0; i < sa.length; i++) if (sb[i] !== sa[i]) return sb[i] - sa[i]; return a.localeCompare(b); };
  const preferred = ids.filter(id => !aiModelAvoid(id));
  return (preferred.length ? preferred : ids).sort(cmp)[0] || '';
}
function aiErrHttp(status, body, model) {
  const g = aiGoogleMessage(body);
  if (status === 401 || status === 403 || /API[_ ]KEY|api key|PERMISSION_DENIED/i.test(body || ''))
    return 'A chave não foi aceita (erro ' + status + ').' + (g ? ' O Google disse: “' + g + '”.' : ' Confira se copiou certa no Google AI Studio.');
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(body || ''))
    return 'A cota gratuita esgotou por agora (erro 429).' + (g ? ' O Google disse: “' + g + '”.' : ' Tente de novo mais tarde.');
  if (status === 404)
    return 'O modelo “' + (model || 'desconhecido') + '” não foi encontrado (404).' + (g ? ' O Google disse: “' + g + '”.' : ' Toque em Testar chave para escolher outro modelo disponível.');
  if (status === 400)
    return 'O Google não aceitou o pedido (erro 400).' + (g ? ' Disse: “' + g + '”.' : ' Tente de novo ou confira a chave e o modelo.');
  return 'O Google respondeu com um erro (' + status + ')' + (model ? ' no modelo “' + model + '”' : '') + '.' + (g ? ' Disse: “' + g + '”.' : ' Tente de novo em alguns minutos.');
}
async function aiListModels(key) {
  const models = [];
  let token = '';
  for (let i = 0; i < 5; i++) {
    const q = '?pageSize=1000' + (token ? '&pageToken=' + encodeURIComponent(token) : '');
    const { res, raw } = await aiFetchGoogle('/models' + q, key);
    if (!res.ok) throw new Error(aiErrHttp(res.status, raw));
    let data; try { data = JSON.parse(raw); } catch (e) { throw new Error('A lista de modelos não pôde ser lida.'); }
    (data.models || []).forEach(m => models.push(m));
    token = data.nextPageToken || '';
    if (!token) break;
  }
  const ids = models.filter(aiCanGenerate).map(aiModelId);
  aiState().models = ids;
  return { models, ids };
}
async function aiEnsureModel(key) {
  const listed = await aiListModels(key);
  const saved = aiGetModel();
  const pick = (saved && listed.ids.includes(saved)) ? saved : aiPreferModel(listed.models);
  if (!pick) throw new Error('Nenhum modelo de texto está disponível nesta chave. Confira o Google AI Studio.');
  aiSetModel(pick);
  return pick;
}
async function aiCallGemini(key, contents, system) {
  let model = aiGetModel();
  if (!model || !((aiState().models || []).length)) model = await aiEnsureModel(key);
  const body = { systemInstruction: { parts: [{ text: system || AI_SYSTEM }] }, contents, generationConfig: { temperature: 0.2, maxOutputTokens: 2048 } };
  const once = async mid => aiFetchGoogle('/models/' + mid + ':generateContent', key, { method: 'POST', body });
  let { res, raw } = await once(model);
  if (res.status === 404) {
    const again = await aiEnsureModel(key);
    if (again && again !== model) { model = again; ({ res, raw } = await once(model)); }
  }
  if (!res.ok) throw new Error(aiErrHttp(res.status, raw, model));
  let data; try { data = JSON.parse(raw); } catch (e) { throw new Error('A resposta do Google não pôde ser lida.'); }
  const text = ((data.candidates || [])[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
  if (!text) throw new Error('A IA não devolveu texto. Tente perguntar de outro jeito.');
  return text;
}

async function aiEnsureMonths(yms) {
  if (typeof ensureMonth !== 'function') return;
  for (const ym of yms) { try { await ensureMonth(ym); } catch (e) { /* mês pode não existir no modo real */ } }
}

PAGES.assistente = () => {
  if (!aiAllowed()) return header('Assistente', '') + '<div class="empty">Só a coordenação (MASTER) vê esta tela.</div>';
  const st = aiState(), key = aiGetKey();
  const desc = 'Pergunte sobre a escala. O assistente <b>só consulta</b> — não altera plantão, contrato nem envia mensagem no WhatsApp.';
  const aviso = `<div class="callout warn" id="aiAvisoTreino"><b>Atenção sobre o plano gratuito do Google:</b> ele pode usar os dados para treino. Use dados fictícios (modo demonstração) até decidir. Não cole CPF, telefone, e-mail ou CRM.</div>`;
  const cfg = `<div class="card ai-cfg" id="aiCfg">
    <div class="card-head"><h2>Chave do Google AI Studio</h2></div>
    <p class="hint">Crie uma chave em <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> e cole aqui. Ela fica <b>somente neste navegador</b> (não vai para o sistema, nem para o banco).</p>
    ${key ? `<p class="ai-key-ok" id="aiKeyStatus">Chave guardada neste navegador.</p>` : `<p class="muted" id="aiKeyStatus">Nenhuma chave neste navegador. Cole a chave para começar.</p>`}
    <div class="field"><label for="aiKey">Chave de API</label><input id="aiKey" type="password" autocomplete="off" spellcheck="false" placeholder="${key ? '••••••••  (deixe em branco para manter a atual)' : 'Cole a chave aqui'}"></div>
    <div class="row-actions">
      <button class="btn primary" type="button" data-act="aiSaveKey" id="aiSaveKey">Guardar neste navegador</button>
      <button class="btn" type="button" data-act="aiTestKey" id="aiTestKey">Testar chave</button>
      ${key ? `<button class="btn danger" type="button" data-act="aiRemoveKey" id="aiRemoveKey">Remover chave</button>` : ''}
    </div>
    <p class="muted small" id="aiTestMsg">${esc(st.testMsg || '')}</p>
    ${key ? `<div class="field" id="aiModelBox"><label for="aiModel">Modelo em uso</label>
      ${(st.models || []).length ? `<select id="aiModel" data-act="aiSetModel" aria-label="Modelo em uso">${(st.models || []).map(id => opt(id, id, aiGetModel())).join('')}</select>` : `<p class="muted" id="aiModelStatus">Modelo: <b>${esc(aiGetModel() || 'ainda não escolhido')}</b>. Ele é definido ao testar a chave ou na primeira pergunta.</p>`}
      ${aiGetModel() ? `<p class="hint" id="aiModelHint">Em uso: <b>${esc(aiGetModel())}</b>. A escolha automática prefere o Flash-Lite estável mais novo da sua conta (evita preview, TTS e imagem quando há alternativa).</p>` : ''}</div>` : ''}
    <label class="chk ai-ficticio"><input type="checkbox" id="aiFicticio" data-act="aiToggleFicticio" ${st.ficticio ? 'checked' : ''}> Usar dados fictícios (modo demonstração)</label>
    ${st.ficticio ? '<p class="hint">As perguntas usam dados inventados (Ana Exemplo, Bruno Demonstração…), com escala, trocas, cadastro, contratos, alertas e ponto fictícios de setembro, outubro e novembro. Nada da escala real é enviado.</p>' : '<p class="hint warn-txt">Modo real: o pedido leva o que a pergunta pede (escala, trocas, cadastro, contratos, alertas, ponto), só com o que você já vê, sem dados pessoais. No plano gratuito do Google isso pode ir para treino.</p>'}
  </div>`;
  const msgs = (st.msgs || []).map(m => `<div class="ai-msg ${esc(m.role)}${m.err ? ' err' : ''}" data-role="${esc(m.role)}">${m.role === 'model' && !m.err ? aiRenderHtml(m.text) : esc(m.text)}</div>`).join('') || `<div class="ai-empty muted">${key ? 'Faça uma pergunta sobre a escala, as trocas ou os contratos. Ex.: “Quem está de plantão na Cirurgia Geral no dia 10 de novembro?” ou “Quais trocas foram feitas neste mês?”' : 'Cole e teste a chave acima para começar a conversar.'}</div>`;
  const mic = aiSpeechOn()
    ? `<button class="btn ai-mic ${st.listening ? 'on' : ''}" type="button" data-act="aiMic" id="aiMic" aria-pressed="${st.listening ? 'true' : 'false'}" title="${st.listening ? 'Desligar o ditado' : 'Ligar o ditado'}">${st.listening ? 'Ditado: ligado' : 'Ditado: desligado'}</button>`
    : `<span class="hint ai-mic-tip" id="aiMicTip">Para ditar, use o Chrome ou o Edge.</span>`;
  const speak = aiSpeakOn()
    ? `<label class="chk"><input type="checkbox" id="aiSpeak" data-act="aiToggleSpeak" ${st.speak ? 'checked' : ''}> Ler resposta em voz alta</label>
       <button class="btn small ${st.speaking ? '' : 'hidden'}" type="button" data-act="aiStopSpeak" id="aiStopSpeak">Parar leitura</button>`
    : `<span class="hint">Para ouvir a resposta, use o Chrome ou o Edge.</span>`;
  const chat = `<div class="card ai-chat-card">
    <div class="ai-chat" id="aiChat">${msgs}</div>
    <div class="ai-compose">
      <textarea id="aiInput" data-act="aiDraft" rows="2" ${key ? '' : 'disabled'} placeholder="${key ? 'Escreva a pergunta…' : 'Cole a chave primeiro'}" aria-label="Pergunta para o assistente">${esc(st.draft || '')}</textarea>
      ${mic}
      <button class="btn primary" type="button" data-act="aiSend" id="aiSend" ${key && !st.busy ? '' : 'disabled'}>${st.busy ? 'Aguarde…' : 'Enviar'}</button>
    </div>
    <div class="ai-voice">${speak}</div>
    <p class="hint small" id="aiDitadoAviso">O ditado do Chrome envia o áudio para servidores do Google. Não dite dados pessoais (CPF, telefone, e-mail, CRM).</p>
    ${typeof location !== 'undefined' && location.protocol === 'file:' ? '<div class="callout info small-callout" id="aiFileTip">No Chrome, abrir o sistema como arquivo local (<code>file://</code>) faz o navegador pedir o microfone de novo a cada uso. Isso some quando o EscalaMed estiver hospedado em <b>HTTPS</b>, ou se você abrir por <b>http://localhost</b> (servidor local).</div>' : ''}
  </div>`;
  queueMicrotask(aiAfterRender);
  return header('Assistente', desc) + (typeof demoBanner === 'function' ? demoBanner() : '') + aviso + cfg + chat;
};
function aiAfterRender() {
  const box = $('#aiChat'); if (box) box.scrollTop = box.scrollHeight;
  const inp = $('#aiInput'); if (inp) { inp.value = aiState().draft || inp.value; }
}

function aiReadKeyField() { return (($('#aiKey') && $('#aiKey').value) || '').trim(); }
function aiSaveDraft() { const inp = $('#aiInput'); if (inp) aiState().draft = inp.value; }

EscAct.aiSaveKey = () => run(async () => {
  const k = aiReadKeyField() || aiGetKey();
  if (!k) return toast('Cole a chave no campo antes de guardar.', true);
  aiSetKey(k);
  try { await aiEnsureModel(k); toast('Chave guardada só neste navegador. Modelo: ' + aiGetModel()); }
  catch (e) { toast('Chave guardada. ' + e.message, true); }
  render();
});
EscAct.aiTestKey = () => run(async () => {
  const k = aiReadKeyField() || aiGetKey();
  if (!k) return toast('Cole a chave no campo antes de testar.', true);
  const el = $('#aiTestMsg'); if (el) el.textContent = 'Testando…';
  try {
    await aiEnsureModel(k);
    const txt = await aiCallGemini(k, [{ role: 'user', parts: [{ text: 'Responda exatamente: ok' }] }], 'Responda só com a palavra pedida.');
    aiSetKey(k);
    aiState().testMsg = 'Chave ok. Modelo: ' + aiGetModel() + '. Resposta: ' + txt.slice(0, 80);
    toast('Chave aceita e guardada neste navegador.');
    render();
  } catch (e) { aiState().testMsg = e.message; if (el) el.textContent = e.message; toast(e.message, true); }
});
EscAct.aiRemoveKey = () => {
  aiSetKey(''); toast('Chave removida deste navegador.'); render();
};
EscAct.aiSetModel = el => { aiSetModel(el.value); toast('Modelo em uso: ' + el.value); };
EscAct.aiToggleFicticio = el => { aiState().ficticio = !!el.checked; render(); };
EscAct.aiToggleSpeak = el => { aiState().speak = !!el.checked; if (!el.checked) aiStopSpeak(); };
EscAct.aiStopSpeak = () => aiStopSpeak();
EscAct.aiMic = () => aiMicToggle();
EscAct.aiSend = () => run(aiSend);
EscAct.aiDraft = el => { aiState().draft = el.value; };
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && e.target && e.target.id === 'aiInput') { e.preventDefault(); run(aiSend); }
});

async function aiSend() {
  const st = aiState();
  const key = aiGetKey();
  const inp = $('#aiInput');
  const q = ((inp && inp.value) || st.draft || '').trim();
  if (!key) return toast('Cole a chave do Google AI Studio para conversar.', true);
  if (!q) return toast('Escreva a pergunta (ou dite e confira antes de enviar).', true);
  if (st.busy) return;
  st.draft = ''; st.busy = true; st.err = '';
  st.msgs.push({ role: 'user', text: q });
  render();
  try {
    const yms = aiMonthsFromQuestion(q);
    await aiEnsureMonths(yms);
    const ctx = aiBuildContext(q, { months: yms, ficticio: st.ficticio });
    const history = st.msgs.filter(m => !m.err).slice(-8, -1).map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }));
    const userTurn = 'Dados da escala (só consulta):\n' + ctx + '\n\nPergunta: ' + aiStripPii(q);
    const text = await aiCallGemini(key, history.concat([{ role: 'user', parts: [{ text: userTurn }] }]));
    st.msgs.push({ role: 'model', text });
    st.busy = false;
    render();
    aiSpeakIfOn(text);
  } catch (e) {
    st.busy = false;
    st.msgs.push({ role: 'model', text: e.message, err: true });
    render();
    toast(e.message, true);
  }
}

function aiSpeakIfOn(text) {
  const st = aiState();
  if (!st.speak || !aiSpeakOn()) return;
  aiStopSpeak();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'pt-BR';
  try {
    const vs = speechSynthesis.getVoices() || [];
    const v = vs.find(x => /pt-BR/i.test(x.lang)) || vs.find(x => /^pt/i.test(x.lang));
    if (v) u.voice = v;
  } catch (e) { /* sem vozes listadas */ }
  u.onend = u.onerror = () => { st.speaking = false; const b = $('#aiStopSpeak'); if (b) b.classList.add('hidden'); };
  st.speaking = true;
  const b = $('#aiStopSpeak'); if (b) b.classList.remove('hidden');
  speechSynthesis.speak(u);
}
function aiStopSpeak() {
  aiState().speaking = false;
  try { if (aiSpeakOn()) speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  const b = $('#aiStopSpeak'); if (b) b.classList.add('hidden');
}

let aiRec = null, aiWantListen = false, aiDenied = false, aiSilenceT = null, aiPrefix = '';
function aiMicLabel(on) {
  const b = $('#aiMic');
  if (!b) return;
  b.classList.toggle('on', !!on);
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.textContent = on ? 'Ditado: ligado' : 'Ditado: desligado';
  b.title = on ? 'Desligar o ditado' : 'Ligar o ditado';
}
function aiClearSilence() { if (aiSilenceT) { clearTimeout(aiSilenceT); aiSilenceT = null; } }
function aiArmSilence() {
  aiClearSilence();
  aiSilenceT = setTimeout(() => { if (aiWantListen) aiMicStop('silêncio'); }, AI_SILENCE_MS);
}
function aiEnsureRec() {
  if (aiRec) return aiRec;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new SR();
  r.lang = 'pt-BR';
  r.continuous = true;
  r.interimResults = true;
  r.onresult = ev => {
    if (!aiWantListen) return;
    let out = '';
    try { for (let i = 0; i < ev.results.length; i++) out += ev.results[i][0].transcript; } catch (e) { out = ''; }
    const text = [aiPrefix, out].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const inp = $('#aiInput');
    if (inp) inp.value = text;
    aiState().draft = text;
    aiArmSilence();
  };
  r.onerror = ev => {
    const err = ev && ev.error;
    if (err === 'not-allowed' || err === 'service-not-allowed') {
      aiDenied = true;
      aiWantListen = false;
      aiClearSilence();
      aiState().listening = false;
      aiMicLabel(false);
      toast('O navegador não liberou o microfone. Autorize o microfone para este site.', true);
      return; // sem loop de religar
    }
    if (err === 'no-speech' || err === 'aborted') return;
    if (err !== 'network') toast('Não foi possível ditar. Tente de novo ou escreva a pergunta.', true);
  };
  r.onend = () => {
    if (!aiWantListen || aiDenied) {
      aiState().listening = false;
      aiMicLabel(false);
      return;
    }
    setTimeout(() => {
      if (!aiWantListen || aiDenied || r !== aiRec) return;
      try { r.start(); } catch (e) { aiWantListen = false; aiState().listening = false; aiMicLabel(false); }
    }, 200);
  };
  aiRec = r;
  return r;
}
function aiMicToggle() {
  if (!aiSpeechOn()) return toast('Para ditar, use o Chrome ou o Edge.', true);
  if (aiWantListen) return aiMicStop();
  toast('O ditado do Chrome envia o áudio para servidores do Google. Não dite dados pessoais.');
  const inp = $('#aiInput');
  aiPrefix = ((inp && inp.value) || aiState().draft || '').trim();
  aiDenied = false;
  aiWantListen = true;
  aiState().listening = true;
  const r = aiEnsureRec();
  try {
    r.start();
    aiMicLabel(true);
    aiArmSilence();
  } catch (e) {
    aiWantListen = false;
    aiState().listening = false;
    aiMicLabel(false);
    toast('Não foi possível ligar o microfone. Tente de novo ou escreva a pergunta.', true);
  }
}
function aiMicStop(reason) {
  aiWantListen = false;
  aiClearSilence();
  aiState().listening = false;
  aiSaveDraft();
  try { if (aiRec) aiRec.stop(); } catch (e) { /* ignore */ }
  aiMicLabel(false);
  if (reason === 'silêncio') toast('Ditado desligado por silêncio. Toque em “Ditado: desligado” para ligar de novo.');
}

const Assistente = {
  allowed: aiAllowed, buildContext: aiBuildContext, monthsFromQuestion: aiMonthsFromQuestion,
  classify: aiClassify, renderHtml: aiRenderHtml, stripPii: aiStripPii,
  lsKey: AI_LS_KEY, lsModelKey: AI_LS_MODEL, flagEscalista: () => ASSISTENTE_PARA_ESCALISTA,
  ficticioTexto: typeof AI_FIC !== 'undefined' ? AI_FIC : null, systemPrompt: AI_SYSTEM, apiBase: AI_API,
  preferModel: aiPreferModel, getModel: aiGetModel, safeText: aiSafeText, errHttp: aiErrHttp,
  ctxMax: AI_CTX_MAX, ficMeses: AI_FIC_MESES
};
// ───────── Eventos adversos (memorandos SID) ─────────
// No relatório de inconsistências e no cartão ponto: “Evento adverso – memorando nº xxxx/aaaa”.
// Nomes a revisar: mesma UI de correção de nome, com “Fazer para todos os outros iguais”.
const EV_DEMO_DOC = {
  id: 'doc-demo-evento', name: 'Carlos Demonstração', matricula: '', empresa: 'Empresa demonstração',
  active: true, sector_ids: [], cadastro_fms: false, specialty: null, crm: null, origem: 'demo'
};
function evSeedDemo() {
  const evs = [
    { id: 'ev-demo-1', numero_memorando: '10001/2026', cadastro: '2026-09-01', data_evento: '2026-09-10', unidade: 'Pronto Socorro', tipo: 'EVENTO ADVERSO LEVE', resumo: 'Atraso de interconsulta (exemplo da demonstração).', medico_texto: 'Dr Carlos Demonstração', staff_id: EV_DEMO_DOC.id, status_vinculo: 'vinculado' },
    { id: 'ev-demo-2', numero_memorando: '10002/2026', cadastro: '2026-09-01', data_evento: '2026-09-12', unidade: 'Pronto Socorro', tipo: 'NÃO CONFORMIDADE', resumo: 'Comunicação incompleta no plantão (exemplo da demonstração).', medico_texto: 'Dra Ana Exemplo', staff_id: null, status_vinculo: 'a revisar' },
    { id: 'ev-demo-3', numero_memorando: '10002/2026', cadastro: '2026-09-01', data_evento: '2026-09-18', unidade: 'Pediatria', tipo: 'NÃO CONFORMIDADE', resumo: 'Registro de passagem de plantão em atraso (exemplo da demonstração).', medico_texto: 'Dra Ana Exemplo', staff_id: null, status_vinculo: 'a revisar' },
    { id: 'ev-demo-4', numero_memorando: '10000/2026', cadastro: '2026-09-01', data_evento: '2026-08-20', unidade: 'Pediatria', tipo: 'NÃO CONFORMIDADE', resumo: 'Exemplo da demonstração em outro mês.', medico_texto: 'Dr Bruno Demonstração', staff_id: null, status_vinculo: 'a revisar' }
  ];
  return evs;
}
function evEnsureDemo() {
  if (REAL || !S.data) return;
  if (!S.data.eventosAdversos || !S.data.eventosAdversos.length) S.data.eventosAdversos = evSeedDemo();
}
function evAll() { return S.data?.eventosAdversos || []; }
function evMonthOf(e) { return String(e.data_evento || '').slice(0, 7); }
function evDayOf(e) { return String(e.data_evento || '').slice(0, 10); }
function evOfMonth(m) { return evAll().filter(e => evMonthOf(e) === m); }
function evTodosMeses() { return !!(S.ponto?.f?.todosMeses); }
function evSoAtivo() { return !!(S.ponto?.f?.soEventos || S.ponto?.f?.todosMeses); }
function evList(m, f) {
  const todos = !m || m === '__todos__' || (f && f.todosMeses);
  const list = (todos ? evAll() : evOfMonth(m)).filter(e => evFilterOk(e, f));
  return list.sort((a, b) => evDayOf(a).localeCompare(evDayOf(b)) || (a.numero_memorando || '').localeCompare(b.numero_memorando || '') || (a.medico_texto || '').localeCompare(b.medico_texto || '', 'pt-BR'));
}
function evUnidades(list) {
  return [...new Set((list || evAll()).map(e => e.unidade).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
function evMesLabel(m, f) {
  return (f && f.todosMeses) || !m || m === '__todos__' ? 'Todos os meses' : fmtMonth(m);
}
function evMedicoCel(e, tela) {
  const linked = e.staff_id ? (doc(e.staff_id)?.name || '') : '';
  const aRev = e.status_vinculo !== 'vinculado';
  const btn = tela && aRev ? ` <button type="button" class="btn small ev-no-print" data-act="evFix" data-id="${esc(e.id)}">Vincular médico</button>` : '';
  if (aRev) return `${esc(e.medico_texto || '—')} ${tag('A revisar', 'orange')}${btn}`;
  const nome = linked || e.medico_texto || '—';
  const extra = linked && e.medico_texto && evNormName(linked) !== evNormName(e.medico_texto) ? `<div class="muted small">${esc(e.medico_texto)}</div>` : '';
  return `${esc(nome)}${extra}`;
}
function evSoReportHtml(m, f, { tela } = {}) {
  const list = evList(m, f);
  const rev = list.filter(e => e.status_vinculo !== 'vinculado').length;
  const vinc = list.length - rev;
  const mes = evMesLabel(m, f);
  const filt = [f && f.empresa && 'Empresa: ' + f.empresa, f && f.setor && 'Unidade/setor: ' + f.setor].filter(Boolean);
  const rows = list.map(e => `<tr>
    <td class="nowrap">${esc(e.numero_memorando || '')}</td>
    <td class="nowrap">${esc(evFmtDay(e))}</td>
    <td>${esc(e.unidade || '—')}</td>
    <td>${esc(e.tipo || '—')}</td>
    <td>${evMedicoCel(e, tela)}</td>
    <td class="small">${esc(e.resumo || '—')}</td>
  </tr>`).join('');
  return `<div class="ponto-print-head">
    <p class="ponto-print-hosp">Hospital Municipal Padre Germano Lauck (HMPGL) · Foz do Iguaçu</p>
    <h1>Eventos adversos</h1>
    <p>${esc(mes)}${filt.length ? ' · ' + esc(filt.join(' · ')) : ''}</p>
    <p class="muted">Memorandos de eventos adversos e não conformidades. A anotação no cartão ponto é “Evento adverso – memorando nº …”.</p>
  </div>
  <p class="ponto-print-kpis ev-so-count" id="evSoKpis"><b>Eventos:</b> ${list.length} · <b>Vinculados:</b> ${vinc} · <b>A revisar:</b> ${rev}</p>
  <div class="table-wrap ev-so-wrap" id="evSecao"><table class="tbl ev-so-tbl"><thead><tr><th>Memorando</th><th>Data</th><th>Unidade</th><th>Tipo</th><th>Médico</th><th>Resumo</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="6" class="empty">Nenhum evento adverso neste recorte.</td></tr>'}</tbody></table></div>`;
}
function monthSelectRelatorio() {
  const f = S.ponto.f || {};
  const val = f.todosMeses ? '__todos__' : (S.f.month || '');
  return `<select data-rf="mesRel" aria-label="Mês">${opt('__todos__', 'Todos os meses', val)}${months().map(m => opt(m, fmtMonth(m), val)).join('')}</select>`;
}
function evLabel(e) { return 'Evento adverso – memorando nº ' + (e.numero_memorando || ''); }
function evNormName(s) { return typeof escNormName === 'function' ? escNormName(s) : normTxt(s); }
function evFmtDay(e) {
  const d = evDayOf(e);
  if (!d || d.length < 10) return d || '—';
  return d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);
}
function evLinha(e) {
  return evFmtDay(e) + (e.unidade ? ' · ' + e.unidade : '') + ' · ' + evLabel(e) + (e.tipo ? ' · ' + e.tipo : '') + (e.resumo ? ' — ' + e.resumo : '');
}
function evVinculadosDoDia(doctorId, dayIso) {
  if (!doctorId || !dayIso) return [];
  return evAll().filter(e => e.status_vinculo === 'vinculado' && e.staff_id === doctorId && evDayOf(e) === dayIso);
}
function evNotasPonto(r) {
  const day = r.startTs != null ? dayKey(r.startTs) : '';
  return evVinculadosDoDia(r.doctorId, day);
}
function evNotaHtml(list) {
  if (!list || !list.length) return '';
  return list.map(e => `<div class="ev-note">${esc(evLabel(e))}${e.tipo ? ` <span class="muted">${esc(e.tipo)}</span>` : ''}${e.resumo ? `<div class="muted small">${esc(e.resumo)}</div>` : ''}</div>`).join('');
}
function evNotaTexto(list) {
  return (list || []).map(evLinha).join(' · ');
}
function evFilterOk(e, f) {
  if (!f) return true;
  if (f.medico && !normTxt((e.medico_texto || '') + ' ' + (docName(e.staff_id) || '')).includes(normTxt(f.medico))) return false;
  if (f.setor && !normTxt(e.unidade || '').includes(normTxt(f.setor))) return false;
  if (f.empresa) {
    const d = e.staff_id && doc(e.staff_id);
    if (!d || (d.empresa || 'Empresa não informada') !== f.empresa) return false;
  }
  return true;
}
function evMergeIntoReport(m, by, f) {
  evOfMonth(m).filter(e => e.status_vinculo === 'vinculado' && e.staff_id && evFilterOk(e, f)).forEach(e => {
    const d = doc(e.staff_id);
    const name = d?.name || e.medico_texto;
    const empresa = d?.empresa || 'Empresa não informada';
    const k = e.staff_id + '|' + empresa;
    if (!by[k]) by[k] = { name, mat: d?.matricula || '', empresa, falta: [], atraso: [], saida: [], incompleto: [], visita_sem: [], extras: [], eventos: [] };
    (by[k].eventos = by[k].eventos || []).push(e);
  });
}
function evBlock(arr) {
  if (!arr || !arr.length) return '';
  return `<h4>Eventos adversos · ${arr.length}</h4><ul>${arr.map(e => `<li>${esc(evLinha(e))}</li>`).join('')}</ul>`;
}
function evIguais(e) {
  const k = evNormName(e.medico_texto);
  return evAll().filter(x => evNormName(x.medico_texto) === k);
}
function evSecaoRelatorio(m, f, { tela } = {}) {
  const list = evOfMonth(m).filter(e => evFilterOk(e, f)).sort((a, b) => evDayOf(a).localeCompare(evDayOf(b)) || (a.medico_texto || '').localeCompare(b.medico_texto || '', 'pt-BR'));
  const vinc = list.filter(e => e.status_vinculo === 'vinculado');
  const rev = list.filter(e => e.status_vinculo !== 'vinculado');
  const item = e => {
    const linked = e.staff_id ? docName(e.staff_id) : '';
    const btn = tela && e.status_vinculo !== 'vinculado' ? ` <button type="button" class="btn small ev-no-print" data-act="evFix" data-id="${esc(e.id)}">Vincular médico</button>` : '';
    return `<li>${esc(evFmtDay(e))}${e.unidade ? ' · ' + esc(e.unidade) : ''} · <b>${esc(evLabel(e))}</b> · ${esc(e.medico_texto || '')}${linked ? ' → ' + esc(linked) : ''}${e.tipo ? ' · ' + esc(e.tipo) : ''}${e.resumo ? ' — ' + esc(e.resumo) : ''}${btn}</li>`;
  };
  if (!list.length) return `<section class="ponto-print-doc ev-sec" id="evSecao"><h3>Eventos adversos</h3><p>Nenhum evento adverso neste mês.</p></section>`;
  return `<section class="ponto-print-doc ev-sec" id="evSecao">
    <h3>Eventos adversos · ${list.length}</h3>
    <p class="muted">Anotação no cartão ponto do dia: “Evento adverso – memorando nº …”, com o tipo e o resumo. A troca só entra na escala quando aplicada; o evento aparece aqui assim que o memorando é lançado.</p>
    ${vinc.length ? `<h4>Vinculados · ${vinc.length}</h4><ul>${vinc.map(item).join('')}</ul>` : ''}
    ${rev.length ? `<h4>A revisar · ${rev.length}</h4><p class="${tela ? 'ev-no-print' : ''}">Nomes do memorando ainda sem médico do cadastro. Dá para vincular um a um e usar “Fazer para todos os outros iguais”.</p><ul>${rev.map(item).join('')}</ul>` : '<p>Nenhum evento aguardando vínculo neste mês.</p>'}
  </section>`;
}
function evFix(id) {
  const e = evAll().find(x => String(x.id) === String(id));
  if (!e) return toast('Evento não encontrado.', true);
  const ds = S.data.doctors.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const nIguais = evIguais(e).length;
  modal('Vincular evento adverso', `<p class="muted small">${esc(evLabel(e))} · ${esc(evFmtDay(e))}${e.unidade ? ' · ' + esc(e.unidade) : ''}${e.tipo ? ' · ' + esc(e.tipo) : ''}</p>
    <p>Nome no memorando: <b>“${esc(e.medico_texto)}”</b></p>
    ${e.resumo ? `<p class="muted small">${esc(e.resumo)}</p>` : ''}
    <form id="evForm"><input type="hidden" name="id" value="${esc(e.id)}">
      <div class="field"><label>Médico do cadastro</label>
        <select name="staff_id" required><option value="">— escolher —</option>${ds.map(d => opt(d.id, d.name + (d.matricula ? ' · ' + d.matricula : ''), e.staff_id)).join('')}</select>
      </div>
      <label class="switch-row ev-iguais"><input type="checkbox" name="iguais" ${nIguais > 1 ? 'checked' : 'disabled'}><span><b>Fazer para todos os outros iguais</b><small>${nIguais > 1 ? nIguais + ' eventos com este mesmo nome escrito recebem o mesmo médico.' : 'Só há este evento com esse nome.'}</small></span></label>
      <div class="form-actions"><button type="button" class="btn" data-act="closeModal">Cancelar</button><button class="btn primary">Salvar vínculo</button></div>
    </form>`, { wide: true });
}
async function evSave(id, staffId, iguais) {
  const e = evAll().find(x => String(x.id) === String(id));
  if (!e) throw new Error('Evento não encontrado.');
  if (!staffId) throw new Error('Escolha o médico do cadastro.');
  const targets = iguais ? evIguais(e) : [e];
  targets.forEach(t => { t.staff_id = staffId; t.status_vinculo = 'vinculado'; });
  if (REAL) {
    const { error } = await S.sb.from('eventos_adversos').update({ staff_id: staffId, status_vinculo: 'vinculado' }).in('id', targets.map(t => t.id));
    if (error) throw new Error(error.message);
  } else demoSave();
  closeModal();
  toast(targets.length > 1 ? `Vinculado em ${targets.length} eventos com o mesmo nome.` : 'Evento vinculado ao médico.');
  S.ponto.cache = null;
  render();
}
// ── v4.13 · médicos cedidos pela prefeitura e horários editáveis na grade ──

const ESC_VINCULO_CEDIDO = 'Cedido pela prefeitura';
function escDocCedido(d) {
  if (!d) return false;
  const v = String(d.vinculo || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /cedido/.test(v);
}
function escPodeEditarCedido(d) {
  return !!(d && !d.cadastro_fms && (escDocCedido(d) || d.origem === 'cadastro'));
}
function escNomeParecidos(nome, exceptId) {
  const n = escNormName(nome);
  if (!n) return [];
  return (S.data.doctors || []).filter(d => {
    if (exceptId && d.id === exceptId) return false;
    if (!d.name) return false;
    if (!escGenOk(nome, d.name)) return false;
    const dn = escNormName(d.name);
    return dn === n || escDice(n, dn) >= 0.8;
  });
}

function escHabOpenMed(id) {
  if (!isEscalista()) { toast('Só a coordenação cadastra médicos cedidos.', true); return; }
  const d = id ? doc(id) : null;
  if (id && !escPodeEditarCedido(d)) { toast('Este cadastro não pode ser editado por aqui (vem do FMS ou dos contratos).', true); return; }
  const secs = new Set(d?.sector_ids || (S.esc.habSectorId ? [S.esc.habSectorId] : []));
  const setores = escSetores().filter(s => s.name !== 'TESTE').slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  modal(d ? 'Editar médico' : 'Adicionar médico', `<form id="cedidoForm">
    <p class="hint">Para médicos cedidos pela prefeitura que não aparecem nos contratos. Não pedimos CPF, telefone ou e-mail pessoal. O CRM, se informado, fica só no cadastro — não aparece no cabeçalho da escala.</p>
    <input type="hidden" name="id" value="${esc(d?.id || '')}">
    <div class="form-grid">
      <div class="field span2"><label>Nome completo *</label><input name="name" required minlength="3" maxlength="160" value="${esc(d?.name || '')}"></div>
      <div class="field"><label>CRM (opcional)</label><input name="crm" maxlength="20" value="${esc(d?.crm || '')}" placeholder="Não aparece na escala"></div>
      <div class="field"><label>Especialidade</label><input name="specialty" maxlength="80" value="${esc(d?.specialty || '')}"></div>
      <div class="field span2"><label>Vínculo</label><input name="vinculo" maxlength="80" value="${esc(d?.vinculo || ESC_VINCULO_CEDIDO)}"></div>
      <div class="field span2"><label>Setores / habilitações</label><div class="checks">${setores.map(s => `<label><input type="checkbox" name="sector" value="${s.id}" ${secs.has(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}</div></div>
      <div class="field span2"><label>Observação</label><textarea name="observacao" rows="2" maxlength="500">${esc(d?.observacao || '')}</textarea></div>
    </div>
    <div class="form-actions"><button type="button" class="btn" data-act="closeModal">Cancelar</button><button class="btn primary">Salvar</button></div>
  </form>`, { wide: true });
}

async function escHabSaveMed(f) {
  const name = String(f.name || '').trim();
  if (name.length < 3) throw new Error('Informe o nome completo.');
  if (/cpf|telefone|celular|e-?mail/i.test(JSON.stringify(f))) throw new Error('Não cadastre CPF, telefone ou e-mail pessoal.');
  const v = {
    name,
    crm: String(f.crm || '').trim() || null,
    specialty: String(f.specialty || '').trim() || null,
    vinculo: String(f.vinculo || '').trim() || ESC_VINCULO_CEDIDO,
    observacao: String(f.observacao || '').trim() || null,
    active: true
  };
  const sectors = f.sectors || [];
  const parecidos = escNomeParecidos(v.name, f.id || null);
  if (parecidos.length) {
    const lista = parecidos.slice(0, 6).map(d => d.name + (escDocCedido(d) ? ' (cedido)' : '')).join('\n');
    if (!confirm(`Já existe médico com nome parecido:\n\n${lista}${parecidos.length > 6 ? '\n…' : ''}\n\nNomes com Junior, Jr, Filho, Neto ou Sobrinho são outra pessoa e não foram listados.\n\nCadastrar mesmo assim?`)) return;
  }
  if (REAL) {
    let id = f.id || null;
    const payload = { ...v, origem: 'cadastro' };
    if (id) {
      if (!escPodeEditarCedido(doc(id))) throw new Error('Este cadastro não pode ser editado por aqui.');
      const { error } = await S.sb.from('doctors').update(payload).eq('id', id);
      if (error) throw new Error(error.message);
    } else {
      const r = await S.sb.from('doctors').insert(payload).select('id').single();
      if (r.error) throw new Error(r.error.message);
      id = r.data.id;
    }
    const cur = doc(id)?.sector_ids || [];
    const add = sectors.filter(s => !cur.includes(s)), del = cur.filter(s => !sectors.includes(s));
    if (add.length) { const { error } = await S.sb.from('doctor_sectors').insert(add.map(s => ({ doctor_id: id, sector_id: s }))); if (error) throw new Error(error.message); }
    if (del.length) { const { error } = await S.sb.from('doctor_sectors').delete().eq('doctor_id', id).in('sector_id', del); if (error) throw new Error(error.message); }
    await done('Médico salvo.');
    return;
  }
  let d = f.id && doc(f.id);
  if (d && !escPodeEditarCedido(d)) throw new Error('Este cadastro não pode ser editado por aqui.');
  if (!d) {
    d = { id: rid('med'), origem: 'cadastro', cadastro_fms: false, matricula: null, empresa: null, sector_ids: [], active: true };
    S.data.doctors.push(d);
  }
  Object.assign(d, v, { sector_ids: sectors, origem: d.origem || 'cadastro' });
  audit('DOCTOR_SAVED', `Médico cedido salvo: ${d.name} · vínculo: ${d.vinculo}`);
  await done('Médico salvo.');
}

async function escHabDelMed(id) {
  const d = doc(id);
  if (!escPodeEditarCedido(d)) { toast('Só é possível excluir médicos adicionados manualmente (cedidos).', true); return; }
  const used = (S.data.shifts || []).some(s => s.doctor_id === id && s.status !== 'cancelled');
  if (used) {
    if (!confirm(`${d.name} já tem plantão na escala. Inativar o cadastro? Os plantões já lançados permanecem, e o nome continua no cruzamento.`)) return;
    d.active = false;
    if (REAL) {
      const { error } = await S.sb.from('doctors').update({ active: false }).eq('id', id);
      if (error) throw new Error(error.message);
    }
    audit('DOCTOR_SAVED', `Médico cedido inativado: ${d.name}`);
    await done('Cadastro inativado.');
    return;
  }
  if (!confirm(`Excluir ${d.name} do cadastro?`)) return;
  if (REAL) {
    if (S.sb) {
      await S.sb.from('doctor_sectors').delete().eq('doctor_id', id);
      const { error } = await S.sb.from('doctors').delete().eq('id', id);
      if (error) throw new Error(error.message);
    }
    await done('Médico excluído.');
    return;
  }
  S.data.doctors = S.data.doctors.filter(x => x.id !== id);
  audit('DOCTOR_SAVED', `Médico cedido excluído: ${d.name}`);
  await done('Médico excluído.');
}

// ── horários editáveis ──
function escValidHm(s) { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(s || '').trim()); }
function escNormHm(s) {
  const t = String(s || '').trim();
  const m = t.match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/) || t.match(/^(\d{1,2})$/);
  if (!m) return '';
  const h = Math.min(23, +m[1]), min = Math.min(59, +(m[2] || 0));
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}
function escKeyParts(key) {
  const m = String(key || '').match(/^(\d{2}:\d{2})-(\d{2}:\d{2})(.*)$/);
  return m ? { start: m[1], end: m[2], local: m[3] || '' } : null;
}
function escHorarioEmpty() { return { cols: {}, days: {} }; }
function escHorarioMap(ym, sid, eid) {
  const k = escTurnoStoreKey(ym, sid, eid);
  const saved = (S.data.horarioEdits || {})[k] || escHorarioEmpty();
  const draft = (S.esc && S.esc.horarioDraft && S.esc.horarioDraft[k]) || escHorarioEmpty();
  return { cols: Object.assign({}, saved.cols, draft.cols), days: Object.assign({}, saved.days, draft.days) };
}
function escHorarioPending(ym, sid, eid) {
  if (!S.esc || !S.esc.horarioDraft) return false;
  if (ym && sid) {
    const d = S.esc.horarioDraft[escTurnoStoreKey(ym, sid, eid)];
    return !!(d && (Object.keys(d.cols || {}).length || Object.keys(d.days || {}).length));
  }
  return Object.keys(S.esc.horarioDraft).some(k => {
    const d = S.esc.horarioDraft[k];
    return d && (Object.keys(d.cols || {}).length || Object.keys(d.days || {}).length);
  });
}
function escTurnoEf(t, day, ym, sid, eid) {
  const m = escHorarioMap(ym, sid, eid);
  const d = m.days[t.key + '|' + day];
  const c = m.cols[t.key];
  const start = (d || c || t).start;
  const end = (d || c || t).end;
  return { start, end, dayOver: !!d, colOver: !!(c && (c.start !== (escKeyParts(t.key)?.start || t.start) || c.end !== (escKeyParts(t.key)?.end || t.end))) };
}
function escShiftTurnoKey(s, hmap) {
  const start = fmtH(s.starts_at), end = fmtH(s.ends_at);
  const day = +dayKey(s.starts_at).slice(8);
  const local = s.local || '';
  const natural = start + '-' + end + local;
  const h = hmap || escHorarioMap(s._month || monthOf(s.starts_at), s.sector_id, s.escala_id);
  for (const [k, v] of Object.entries(h.days || {})) {
    const i = k.lastIndexOf('|');
    if (i < 0) continue;
    const tk = k.slice(0, i), d = +k.slice(i + 1);
    if (d === day && v.start === start && v.end === end && (!local || tk.endsWith(local))) return tk;
  }
  for (const [tk, v] of Object.entries(h.cols || {})) {
    if (v.start === start && v.end === end && (!local || tk.endsWith(local))) return tk;
  }
  return natural;
}
function escShiftEffectiveTimes(s) {
  if (!s || !s.starts_at) return s;
  const ym = s._month || monthOf(s.starts_at);
  const day = +dayKey(s.starts_at).slice(8);
  const hmap = escHorarioMap(ym, s.sector_id, s.escala_id);
  const start0 = fmtH(s.starts_at), end0 = fmtH(s.ends_at);
  const key = escShiftTurnoKey(s, hmap);
  const dayEd = hmap.days[key + '|' + day];
  const colEd = hmap.cols[key];
  const start = (dayEd || colEd || { start: start0 }).start;
  const end = (dayEd || colEd || { end: end0 }).end;
  if (start === start0 && end === end0) return s;
  const rng = escRange(ym, day, start, end);
  return Object.assign({}, s, { starts_at: rng.starts_at, ends_at: rng.ends_at });
}

function escHabListMeta(d) {
  const bits = [];
  if (d.matricula) bits.push('matrícula ' + d.matricula);
  else bits.push('sem matrícula');
  if (d.specialty) bits.push(d.specialty);
  if (escDocCedido(d)) bits.push(d.vinculo || ESC_VINCULO_CEDIDO);
  return bits.join(' · ');
}

function escEditHorarioOpen(tk, dayHint) {
  if (!isEscalista()) { toast('Só quem monta a escala edita o horário.', true); return; }
  const ym = escYm(), sid = S.esc.sectorId, eid = escEnsureEscala(sid);
  const g = escGrid(ym, sid, eid);
  const t = g.turnos.find(x => x.key === tk);
  if (!t) return;
  const ef = escTurnoEf(t, dayHint || 1, ym, sid, eid);
  const n = g.n;
  const day0 = dayHint && dayHint >= 1 && dayHint <= n ? dayHint : 1;
  modal('Editar horário', `<form id="escHorarioForm">
    <input type="hidden" name="tk" value="${esc(tk)}">
    <p class="hint">${esc(secName(sid))}${eid && escEscalaName(eid) ? ' · ' + esc(escEscalaName(eid)) : ''} · ${esc(fmtMonth(ym))}. Aceita plantão que atravessa a meia-noite (ex.: 19:00–07:00). A alteração só é gravada ao tocar em Salvar.</p>
    <div class="form-grid">
      <div class="field"><label>Início</label><input name="inicio" type="time" required value="${esc(ef.start)}"></div>
      <div class="field"><label>Fim</label><input name="fim" type="time" required value="${esc(ef.end)}"></div>
      <div class="field span2 esc-hora-scope">
        <div class="esc-rep-lab">Aplicar em:</div>
        <label><input type="radio" name="escHoraScope" value="mes" checked> Todo o mês deste setor</label>
        <label><input type="radio" name="escHoraScope" value="dia"> Só um dia
          <input type="number" name="dia" id="escHoraDia" min="1" max="${n}" value="${day0}" aria-label="Dia do mês">
        </label>
      </div>
    </div>
    <div class="form-actions"><button type="button" class="btn" data-act="closeModal">Cancelar</button><button class="btn primary">Aplicar</button></div>
  </form>`);
}

function escApplyHorario(f) {
  const start = escNormHm(f.inicio), end = escNormHm(f.fim);
  if (!escValidHm(start) || !escValidHm(end)) throw new Error('Informe o início e o fim no formato HH:MM.');
  const ym = escYm(), sid = S.esc.sectorId, eid = escEnsureEscala(sid);
  const g = escGrid(ym, sid, eid);
  const t = g.turnos.find(x => x.key === f.tk);
  if (!t) throw new Error('Horário não encontrado nesta escala.');
  const scope = f.escHoraScope || 'mes';
  const day = Math.max(1, Math.min(g.n, +f.dia || 1));
  const k = escTurnoStoreKey(ym, sid, eid);
  S.esc.horarioDraft = S.esc.horarioDraft || {};
  const prev = JSON.parse(JSON.stringify(S.esc.horarioDraft[k] || escHorarioEmpty()));
  const savedPrev = JSON.parse(JSON.stringify((S.data.horarioEdits || {})[k] || escHorarioEmpty()));
  const cur = S.esc.horarioDraft[k] || (S.esc.horarioDraft[k] = escHorarioEmpty());
  if (scope === 'dia') {
    cur.days = cur.days || {};
    cur.days[t.key + '|' + day] = { start, end };
  } else {
    cur.cols = cur.cols || {};
    cur.cols[t.key] = { start, end };
  }
  S.esc.undoRepeat = { kind: 'horario', ym, sectorId: sid, escalaId: eid, prevDraft: prev, prevSaved: savedPrev };
  closeModal();
  S.ponto.cache = null;
  if (S.data) S.data._ver = (S.data._ver || 0) + 1;
  toast(scope === 'dia'
    ? `Horário do dia ${day} alterado para ${start}–${end}. Toque em Salvar para gravar, ou em Desfazer para voltar.`
    : `Horário da coluna alterado para ${start}–${end} em todo o mês. Toque em Salvar para gravar, ou em Desfazer para voltar.`);
  render();
}

function escUndoHorario(u) {
  const k = escTurnoStoreKey(u.ym, u.sectorId, u.escalaId);
  S.esc.horarioDraft = S.esc.horarioDraft || {};
  S.esc.horarioDraft[k] = u.prevDraft || escHorarioEmpty();
  if (u.prevSaved) {
    S.data.horarioEdits = S.data.horarioEdits || {};
    S.data.horarioEdits[k] = u.prevSaved;
  }
  S.esc.undoRepeat = null;
  toast('Alteração de horário desfeita.');
  render();
}

async function escCommitHorarios(ym) {
  const pendingKeys = Object.keys((S.esc && S.esc.horarioDraft) || {});
  if (!pendingKeys.length && !((S.data.horarioEdits) && Object.keys(S.data.horarioEdits).length)) return false;
  const had = escHorarioPending();
  const setores = [...new Set((S.data.schedules || []).filter(s => s.month_ref === ym).map(s => s.sector_id))];
  for (const sid of setores) {
    const escalas = escEscalasOf(sid);
    const ids = escalas.length ? escalas.map(e => e.id) : [escEnsureEscala(sid)];
    for (const eid of ids) {
      const k = escTurnoStoreKey(ym, sid, eid);
      if (!escHorarioPending(ym, sid, eid) && !((S.data.horarioEdits || {})[k])) continue;
      const g = escGrid(ym, sid, eid);
      // reescreve as células com os horários efetivos (escWriteGrid usa escTurnoEf via patch em escRange calls)
      await escWriteGrid(ym, sid, g, eid);
      await escPersistHorarios(ym, sid, eid);
    }
  }
  S.esc.horarioDraft = {};
  return had;
}

async function escPersistHorarios(ym, sid, eid) {
  const k = escTurnoStoreKey(ym, sid, eid);
  const draft = (S.esc.horarioDraft && S.esc.horarioDraft[k]) || escHorarioEmpty();
  S.data.horarioEdits = S.data.horarioEdits || {};
  const cur = S.data.horarioEdits[k] || escHorarioEmpty();
  S.data.horarioEdits[k] = { cols: Object.assign({}, cur.cols, draft.cols), days: Object.assign({}, cur.days, draft.days) };
  if (!REAL) { demoSave(); return; }
  if (!S.sb) return;
  const rows = [];
  Object.entries(S.data.horarioEdits[k].cols || {}).forEach(([tk, v]) => {
    rows.push({ month_ref: ym, sector_id: sid, escala_id: eid || null, turno_key: tk, day: null, start_hm: v.start, end_hm: v.end });
  });
  Object.entries(S.data.horarioEdits[k].days || {}).forEach(([dk, v]) => {
    const i = dk.lastIndexOf('|');
    rows.push({ month_ref: ym, sector_id: sid, escala_id: eid || null, turno_key: dk.slice(0, i), day: +dk.slice(i + 1), start_hm: v.start, end_hm: v.end });
  });
  let q = S.sb.from('escala_horarios').delete().eq('month_ref', ym).eq('sector_id', sid);
  q = eid ? q.eq('escala_id', eid) : q.is('escala_id', null);
  const { error: e1 } = await q;
  if (e1) throw new Error(e1.message);
  if (rows.length) {
    const { error } = await S.sb.from('escala_horarios').insert(rows);
    if (error) throw new Error(error.message);
  }
}

async function escLoadHorariosReal() {
  if (!REAL || !S.sb || !isEscalista()) return;
  try {
    const rows = await fetchAll('escala_horarios');
    const map = {};
    (rows || []).forEach(r => {
      const k = escTurnoStoreKey(r.month_ref, r.sector_id, r.escala_id);
      map[k] = map[k] || escHorarioEmpty();
      if (r.day == null) map[k].cols[r.turno_key] = { start: r.start_hm, end: r.end_hm };
      else map[k].days[r.turno_key + '|' + r.day] = { start: r.start_hm, end: r.end_hm };
    });
    S.data.horarioEdits = map;
  } catch (e) { console.warn('escala_horarios indisponível:', e.message); }
}

if (typeof EscAct !== 'undefined') {
  Object.assign(EscAct, {
    escHabNovoMed: () => escHabOpenMed(null),
    escHabEditMed: el => escHabOpenMed(el.dataset.id),
    escHabDelMed: el => escHabDelMed(el.dataset.id),
    escEditHorario: el => escEditHorarioOpen(el.dataset.tk, el.dataset.day ? +el.dataset.day : undefined)
  });
}
// ───────── eventos ─────────
async function loginRun(fn) { S.login.error = null; try { await fn(); } catch (e) { console.warn(e); S.login.error = e.message || 'Falha na operação'; renderLogin(); } }
async function run(fn) { try { await fn(); } catch (e) { console.warn(e); toast(e.message || 'Falha na operação', true); } }
const formObj = f => { const o = Object.fromEntries(new FormData(f).entries()); o.sectors = [...f.querySelectorAll('input[name=sector]:checked')].map(x => x.value); return o; };
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) { if (e.target.classList?.contains('overlay')) closeModal(); return; }
  if (el.tagName === 'INPUT' && el.type === 'checkbox' && el.dataset.act === 'setting') return; // tratado em change
  // <select>/campo de texto: o clique só abre o controle. Re-render aqui fecha o menu (só trata em change/input).
  if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(button|submit|reset|checkbox|radio)$/i.test(el.type || ''))) return;
  const act = el.dataset.act, id = el.dataset.id;
  const H = {
    closeModal, nav: () => { S.page = el.dataset.page; S.loginWarn = null; render(); window.scrollTo(0, 0); },
    page: () => { S.pg[el.dataset.key] = +el.dataset.p; render(); }, tab: () => { S.tabs[el.dataset.key] = el.dataset.v; render(); },
    setF: () => { S.f[el.dataset.k] = el.dataset.v; S.pg = {}; render(); },
    shift: () => shiftDetails(id), editShift: () => editShift(id), openSwap: () => run(() => openSwap(id)),
    respondSwap: () => run(() => A.respondSwap(id, el.dataset.ok === '1')), approveSwap: () => run(() => A.approveSwap(id, el.dataset.ok === '1')), cancelSwap: () => run(() => A.cancelSwap(id)),
    waApply: () => run(() => A.waApply(id)), waFix: () => waFix(id), waDiscard: () => run(() => A.waDiscard(id)), evFix: () => evFix(id),
    approveReq: () => { const f = el.closest('form'), o = formObj(f); run(() => A.approveReq(id, o.doctor_id || null, o.sectors, o.note)); },
    rejectReq: () => { const f = el.closest('form'), o = formObj(f); if (!o.note) { toast('Escreva o motivo da recusa na observação.', true); f.note.focus(); return; } run(() => A.rejectReq(id, o.note)); },
    unbind: () => { const m = prompt(`Desfazer o vínculo da conta (e-mail e senha) de ${docName(id)}? Informe o motivo:`); if (m && m.trim()) run(() => A.unbind(id, m.trim())); },
    copyInvite: () => { const u = inviteUrl(el.dataset.token); (navigator.clipboard?.writeText(u) || Promise.reject()).then(() => toast('Link copiado.'), () => { const i = $('#invLink') || el.previousElementSibling; i?.select?.(); toast('Selecione e copie o link.'); }); },
    revokeInvite: () => run(() => A.revokeInvite(id)), editDoctor: () => editDoctor(id),
    exportPonto: () => run(exportPonto),
    printPonto: () => run(printPontoReport), printTrocas: () => run(printTrocasReport), exportVersao: () => run(() => exportVersao(el.dataset.v)), exportEscala: () => run(() => exportVersao(S.f.version)),
    wSubmit: () => run(wizSubmit),
    toggleExtras: () => { S.ponto.showExtras = !S.ponto.showExtras; render(); }, markRead: () => run(A.markRead),
    logout: () => run(async () => { if (REAL) { S.w = null; await S.sb.auth.signOut(); } else { S.me = null; S.page = null; S.w = null; S.f.month = null; demoSave(); S.login = { step: 1, matricula: '', found: null, mode: 'medico' }; route(); } }),
    demoLogin: () => demoSignIn(el.dataset.user), demoReset: () => { if (confirm('Apagar tudo o que foi feito nesta demonstração?')) demoReset(); },
    refreshAccess: () => run(async () => { if (REAL) await resolveAccess(); else { const a = S.data.accounts.find(x => x.user_id === S.me.user_id); if (a) demoSignIn(a.user_id); else { const r = S.data.requests.find(x => x.user_id === S.me.user_id && x.status === 'rejected' && !S.data.requests.some(y => y.user_id === S.me.user_id && y.status === 'pending')); if (r) { S.me = { kind: 'rejected', user_id: S.me.user_id, email: S.me.email, request: r }; } route(); toast(a ? '' : 'Ainda aguardando a coordenação.'); } } }),
    loginBack: () => { S.login.step = +el.dataset.step; if (S.login.step === 1) S.login.found = null; renderLogin(); },
    loginRestart: () => { S.login = { step: 1, matricula: '', found: null, mode: 'medico' }; if (S.me && S.me.kind === 'rejected') S.me = { kind: 'none', user_id: S.me.user_id, email: S.me.email }; renderLogin(); },
    confirmName: () => { S.login.step = 3; renderLogin(); },
    forgot: () => loginRun(async () => { const r = await forgotMatricula(S.login.found.matricula); S.login = { step: 'enviado', sentMsg: `Enviamos um link para criar uma nova senha ao e-mail cadastrado <b>${esc(r.masked)}</b>. O link vale por 1 hora.`, demoMail: r.demoMail }; renderLogin(); }),
    openInvite: () => { S.login = { step: 1, mode: 'convite' }; renderLogin(); },
    masterLogin: () => { S.login = { step: 'master' }; renderLogin(); },
    masterForgot: () => { S.login = { step: 'master_forgot' }; renderLogin(); },
    newRegistration: () => { S.login = { step: 1, mode: 'cadastro' }; renderLogin(); }
  };
  if (H[act]) { e.preventDefault(); H[act](); return; }
  if (typeof EscAct !== 'undefined' && EscAct[act]) { e.preventDefault(); run(() => EscAct[act](el, e)); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.act && typeof EscAct !== 'undefined' && EscAct[t.dataset.act] && t.dataset.act !== 'setting') return run(() => EscAct[t.dataset.act](t, e));
  if (t.dataset.act === 'setting') return run(() => A.setting(t.dataset.k, t.checked));
  if (t.id === 'wSector') { wizSet('sector', t.value); wizSet('escala', ''); return render(); }
  if (t.id === 'wEscala') { wizSet('escala', t.value); return render(); }
  if (t.id === 'wDoctor') { wizSet('doctor', t.value); return render(); }
  if (t.id === 'wMonth') { wizSet('month', t.value); return render(); }
  if (t.id === 'wDay') { wizSet('day', t.value); return render(); }
  if (t.id === 'wShift') { wizSet('shift', t.value); return render(); }
  if (t.id === 'wTarget') { wizSet('target', t.value); return render(); }
  if (t.name === 'nomeConf') { $('#btnConfirmName').disabled = !t.checked; return; }
  if (t.closest('#swapForm') && (t.name === 'kind' || t.name === 'target')) return fillRecip();
  if (t.dataset.rf === 'soEventos') { S.ponto.f.soEventos = t.checked; if (!t.checked) S.ponto.f.todosMeses = false; return render(); }
  if (t.dataset.rf === 'mesRel') {
    if (t.value === '__todos__') { S.ponto.f.todosMeses = true; S.ponto.f.soEventos = true; return render(); }
    S.ponto.f.todosMeses = false; S.f.month = t.value; S.pg = {}; S.ponto.cache = null;
    return run(async () => { await ensureMonth(t.value); render(); });
  }
  if (t.dataset.f && t.type !== 'search') { const k = t.dataset.f; S.f[k] = t.type === 'checkbox' ? t.checked : t.value; S.pg = {}; if (k === 'month') { S.ponto.cache = null; return run(async () => { await ensureMonth(t.value); render(); }); } render(); }
  if (t.dataset.pf && t.type !== 'search') { S.ponto.f[t.dataset.pf] = t.value; S.pg.ponto = 1; render(); }
  if (t.dataset.mf && t.type !== 'search') { S.tabs.medF[t.dataset.mf] = t.value; S.pg.medicos = 1; render(); }
  if (t.dataset.cf && t.type !== 'search') { S.tabs.ctrF[t.dataset.cf] = t.value; S.pg.contratos = 1; render(); }
});
let typeT;
document.addEventListener('input', e => {
  if (e.target.tagName === 'SELECT') return; // valor do select só em 'change', para não reconstruir o menu aberto
  if (e.target.dataset.act && typeof EscAct !== 'undefined' && EscAct[e.target.dataset.act]) { EscAct[e.target.dataset.act](e.target, e); return; }
  if (e.target.id === 'wNote') wiz().note = e.target.value;
  const t = e.target; if (t.closest && t.closest('#login')) { const er = $('#login form .err'); if (er) er.remove(); }
  if (t.type !== 'search') return;
  clearTimeout(typeT);
  typeT = setTimeout(() => {
    const sel = t.dataset.f ? `[data-f="${t.dataset.f}"]` : t.dataset.pf ? `[data-pf="${t.dataset.pf}"]` : t.dataset.cf ? `[data-cf="${t.dataset.cf}"]` : `[data-mf="${t.dataset.mf}"]`;
    if (t.dataset.f) S.f[t.dataset.f] = t.value; else if (t.dataset.pf) S.ponto.f[t.dataset.pf] = t.value; else if (t.dataset.mf) S.tabs.medF[t.dataset.mf] = t.value; else if (t.dataset.cf) S.tabs.ctrF[t.dataset.cf] = t.value;
    S.pg = {}; render(); const n = $(sel); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
  }, 250);
});
document.addEventListener('submit', e => {
  const f = e.target; e.preventDefault();
  const o = formObj(f), fid = f.getAttribute('id');
  if (fid === 'matForm') return run(async () => {
    S.login.matricula = o.matricula; S.login.error = null;
    const r = await lookupMatricula(o.matricula);
    if (!r.found) { S.login.error = /^\s*CR[MO]/i.test(o.matricula) ? 'O login é só por matrícula. Digite o número do crachá.' : 'Matrícula não encontrada. Confira o número do crachá ou use “Solicitar cadastro”.'; return renderLogin(); }
    S.login.found = r; S.login.step = 2; renderLogin();
  });
  if (fid === 'staffForm') return loginRun(() => loginStaff(o.usuario, o.senha));
  if (fid === 'firstForm') return loginRun(() => firstAccess(o));
  if (fid === 'pwForm') return loginRun(() => loginMatricula(S.login.found.matricula, o.senha));
  if (fid === 'newPwForm') return loginRun(() => setNewPassword(o));
  if (fid === 'masterForm') return loginRun(() => masterLogin(o));
  if (fid === 'masterForgotForm') return loginRun(() => masterForgot(o));
  if (fid === 'inviteAcceptForm') return loginRun(() => acceptInvite(o));
  if (fid === 'regForm') return run(() => A.submitRegistration(o)); // erro em aviso (toast) para não apagar o formulário
  if (fid === 'swapForm') { if (!o.target) return toast('Escolha o colega.', true); if (o.kind === 'reciprocal' && !o.to) return toast('Escolha o plantão do colega.', true); return run(() => A.requestSwap(o.from, o.target, o.kind === 'reciprocal' ? o.to : null, o.note)); }
  if (fid === 'editShiftForm') return run(() => A.editShift(o.id, o.doctor_id, o.motivo));
  if (fid === 'waForm') return run(() => A.waSave(o.id, o.sai, o.entra));
  if (fid === 'evForm') return run(() => evSave(o.id, o.staff_id, o.iguais === 'on'));
  if (fid === 'inviteForm') return run(() => A.createInvite(o.doctor_id, o.email));
  if (fid === 'doctorForm') return run(() => A.saveDoctor(o));
  if (fid === 'cedidoForm') return run(() => escHabSaveMed(o));
  if (fid === 'escHorarioForm') return run(() => escApplyHorario(o));
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); if (e.key === 'Enter' && e.target.classList?.contains('kpi')) e.target.click(); });
$('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
window.addEventListener('hashchange', () => {
  const rt = !REAL && location.hash.match(/redefinir=([a-z0-9]+)/i);
  if (rt) { S.me = null; S.login = { step: 'nova_senha', token: rt[1] }; demoSave(); return route(); }
  if (!S.me && inviteToken()) renderLogin();
});
window.EscalaMed = { S, A, version: '4.17', trocasReportHtml, printTrocasReport, Assistente: typeof Assistente !== 'undefined' ? Assistente : null };
boot();
})();
