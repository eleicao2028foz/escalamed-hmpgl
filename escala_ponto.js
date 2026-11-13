/* EscalaMed — motor do cruzamento Escala x Ponto (mesma regra da função SQL public.cross_check).
   - Plantões contíguos do mesmo médico são avaliados como um bloco (ex.: 07–13 + 13–19).
   - Entrada = 1ª marcação entre (início − 2h) e o meio do plantão; Saída = última entre o meio e (fim + 2h).
   - Tolerância de 15 min para atraso e saída antecipada.
   - Sobreaviso não é cobrado; marcações nesse período são apenas informativas. */
(function (g) {
  const MIN = 60000, WIN = 120 * MIN;
  const ms = t => new Date(t).getTime();
  const pad = n => String(n).padStart(2, '0');
  const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const dm = t => { const d = new Date(t); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1); };
  const STATUS = {
    cumprido: ['Cumprido', 'ok'], falta: ['Falta', 'bad'], atraso: ['Atraso', 'warn'],
    saida_antecipada: ['Saída antecipada', 'warn2'], incompleto: ['Incompleto', 'inc'], sobreaviso: ['Sobreaviso (não cobrado)', 'muted'],
    visita_ok: ['Visita com marcação', 'ok'], visita_sem: ['Visita sem marcação', 'bad']
  };
  function shiftBounds(s) {
    if (s.startTs) return [ms(s.startTs), ms(s.endTs)];
    if (s.start && s.start.length > 5) { let a = ms(s.start), b = ms(s.end); if (b <= a) b += 86400000; return [a, b]; }
    let a = ms(s.date + 'T' + s.start), b = ms(s.date + 'T' + s.end);
    if (b <= a) b += 86400000;
    return [a, b];
  }
  // shifts: {id,date,start,end|startTs,endTs, doctorId, sector, local, type, swapNote}
  // punches: {doctorId, ts}; doctors: {id,name,matricula,company}
  function crossCheck({ shifts, punches, doctors, dadosAte, tol = 15 }) {
    const docs = Object.fromEntries(doctors.map(d => [d.id, d]));
    const marks = {};
    punches.forEach(p => (marks[p.doctorId] = marks[p.doctorId] || []).push({ t: ms(p.ts), used: false }));
    Object.values(marks).forEach(a => a.sort((x, y) => x.t - y.t));
    const cut = dadosAte ? ms(dadosAte) : Infinity;
    const rows = [];
    const byDoc = {};
    shifts.forEach(s => (byDoc[s.doctorId] = byDoc[s.doctorId] || []).push(s));
    for (const [docId, list] of Object.entries(byDoc)) {
      const d = docs[docId] || { name: '—' }, mk = marks[docId] || [];
      const base = r => ({ doctorId: docId, doctorName: d.name, matricula: d.matricula || '', empresa: d.company || d.empresa || 'Empresa não informada', ...r });
      // presenciais → blocos contíguos
      const pres = list.filter(s => s.type !== 'Sobreaviso' && s.type !== 'Visita').map(s => ({ s, b: shiftBounds(s) })).sort((x, y) => x.b[0] - y.b[0]);
      const blocks = [];
      for (const x of pres) {
        const last = blocks[blocks.length - 1];
        if (last && x.b[0] <= last.end) { last.end = Math.max(last.end, x.b[1]); last.items.push(x.s); }
        else blocks.push({ start: x.b[0], end: x.b[1], items: [x.s] });
      }
      for (const bl of blocks) {
        const mid = bl.start + (bl.end - bl.start) / 2;
        const en = mk.filter(m => m.t >= bl.start - WIN && m.t < mid), sa = mk.filter(m => m.t >= mid && m.t <= bl.end + WIN);
        en.concat(sa).forEach(m => (m.used = true));
        const entrada = en.length ? en[0].t : null, saida = sa.length ? sa[sa.length - 1].t : null;
        const oc = [];
        const foraDoMes = bl.end > cut;
        if (!entrada && !saida) oc.push('falta');
        else {
          if (!entrada || (!saida && !foraDoMes)) oc.push('incompleto');
          if (entrada && entrada > bl.start + tol * MIN) oc.push('atraso');
          if (saida && saida < bl.end - tol * MIN) oc.push('saida_antecipada');
        }
        const status = oc.includes('falta') ? 'falta' : oc.includes('incompleto') ? 'incompleto' : oc.includes('atraso') ? 'atraso' : oc.includes('saida_antecipada') ? 'saida_antecipada' : 'cumprido';
        const notes = bl.items.map(s => s.swapNote).filter(Boolean);
        if (bl.items.length > 1) notes.push('Bloco contínuo: ' + bl.items.map(s => { const [a, b] = shiftBounds(s); return hm(a) + '–' + hm(b); }).join(' + '));
        const inc = bl.items.filter(s => s.conf && !['alta', 'manual'].includes(s.conf));
        if (inc.length) notes.push('⚠ Nome na escala com correspondência incerta: "' + inc.map(s => s.texto).join('", "') + '".');
        if (foraDoMes && !saida && entrada) notes.push('Saída cai no mês seguinte (fora do período importado).');
        rows.push(base({
          key: bl.items.map(s => s.id).join('+'), shiftIds: bl.items.map(s => s.id), type: 'Plantão',
          startTs: bl.start, endTs: bl.end, data: new Date(bl.start).toISOString(),
          sector: [...new Set(bl.items.map(s => s.sector))].join(' / '), local: [...new Set(bl.items.map(s => s.local || ''))].filter(Boolean).join(' + '),
          entrada, saida, status, ocorrencias: oc,
          difEntrada: entrada ? Math.round((entrada - bl.start) / MIN) : null,
          difSaida: saida ? Math.round((saida - bl.end) / MIN) : null,
          swapped: bl.items.some(s => s.swapNote), incerto: bl.items.some(s => s.conf && !['alta', 'manual'].includes(s.conf)), nota: notes.join(' ')
        }));
      }
      // visita: sem horário fixo — basta uma marcação no dia
      for (const s of list.filter(s => s.type === 'Visita')) {
        const [a, b] = shiftBounds(s), d0 = new Date(a); d0.setHours(0, 0, 0, 0); const d1 = d0.getTime() + 86400000;
        const inn = mk.filter(m => m.t >= d0.getTime() && m.t < d1);
        inn.forEach(m => (m.used = true));
        rows.push(base({
          key: s.id, shiftIds: [s.id], type: 'Visita', startTs: a, endTs: b, data: new Date(a).toISOString(), sector: s.sector, local: s.local || '',
          entrada: inn.length ? inn[0].t : null, saida: inn.length > 1 ? inn[inn.length - 1].t : null, status: inn.length ? 'visita_ok' : 'visita_sem',
          ocorrencias: [], difEntrada: null, difSaida: null, swapped: !!s.swapNote, incerto: !!(s.conf && !['alta', 'manual'].includes(s.conf)),
          nota: [s.swapNote, 'Visita sem horário fixo: basta uma marcação no dia.'].filter(Boolean).join(' ')
        }));
      }
      // sobreaviso: informativo
      for (const s of list.filter(s => s.type === 'Sobreaviso')) {
        const [a, b] = shiftBounds(s);
        const inn = mk.filter(m => !m.used && m.t >= a && m.t < b);
        inn.forEach(m => (m.used = true));
        rows.push(base({
          key: s.id, shiftIds: [s.id], type: 'Sobreaviso', startTs: a, endTs: b, data: new Date(a).toISOString(), sector: s.sector, local: s.local || '',
          entrada: null, saida: null, status: 'sobreaviso', ocorrencias: [], difEntrada: null, difSaida: null, swapped: !!s.swapNote,
          nota: [s.swapNote, inn.length ? `${inn.length} marcação(ões) no período: ${inn.map(m => hm(m.t)).join(', ')} (informativo)` : ''].filter(Boolean).join(' ')
        }));
      }
    }
    const extras = [];
    for (const [docId, mk] of Object.entries(marks)) mk.filter(m => !m.used).forEach(m => {
      const d = docs[docId] || {};
      extras.push({ doctorId: docId, doctorName: d.name || docId, matricula: d.matricula || '', empresa: d.company || d.empresa || '', ts: m.t });
    });
    rows.sort((x, y) => x.startTs - y.startTs || x.doctorName.localeCompare(y.doctorName));
    extras.sort((x, y) => x.ts - y.ts);
    return { rows, extras };
  }
  function kpis(rows) {
    const p = rows.filter(r => r.type === 'Plantão'), has = k => p.filter(r => r.ocorrencias.includes(k)).length;
    return { plantoes: p.length, cumpridos: p.filter(r => !r.ocorrencias.length).length, faltas: has('falta'), atrasos: has('atraso'), saidas: has('saida_antecipada'), incompletos: has('incompleto'), sobreaviso: rows.filter(r => r.type === 'Sobreaviso').length, visitas: rows.filter(r => r.type === 'Visita').length, visitasOk: rows.filter(r => r.status === 'visita_ok').length };
  }
  const fmtDia = t => { const d = new Date(t); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); };
  const ocText = r => (r.incerto ? '⚠ ' : '') + (r.ocorrencias.length ? r.ocorrencias.map(o => STATUS[o][0]).join(', ') : STATUS[r.status][0]);
  function sheetRows(rows) {
    return rows.map(r => ({
      'Data': fmtDia(r.startTs), 'Horário escalado': hm(r.startTs) + '–' + hm(r.endTs), 'Médico': r.doctorName, 'Matrícula': r.matricula,
      'Setor': r.sector, 'Local (escala)': r.local, 'Tipo': r.type, 'Entrada': r.entrada ? dm(r.entrada) + ' ' + hm(r.entrada) : '',
      'Saída': r.saida ? dm(r.saida) + ' ' + hm(r.saida) : '', 'Status': ocText(r),
      'Dif. entrada (min)': r.difEntrada ?? '', 'Dif. saída (min)': r.difSaida ?? '', 'Observação': r.nota || ''
    }));
  }
  function resumo(rows) {
    const by = {};
    rows.forEach(r => { const k = r.empresa + '|' + r.doctorName; (by[k] = by[k] || { e: r.empresa, m: r.doctorName, mat: r.matricula, rs: [] }).rs.push(r); });
    const out = [], emp = {};
    Object.values(by).sort((a, b) => a.e.localeCompare(b.e) || a.m.localeCompare(b.m)).forEach(x => {
      const k = kpis(x.rs);
      out.push({ 'Empresa': x.e, 'Médico': x.m, 'Matrícula': x.mat, 'Plantões': k.plantoes, 'Cumpridos': k.cumpridos, 'Faltas': k.faltas, 'Atrasos': k.atrasos, 'Saídas antecipadas': k.saidas, 'Incompletos': k.incompletos, 'Visitas': k.visitas, 'Visitas c/ marcação': k.visitasOk, 'Sobreavisos': k.sobreaviso });
      emp[x.e] = emp[x.e] || []; emp[x.e].push(...x.rs);
    });
    const tot = kpis(rows);
    out.push({ 'Empresa': 'TOTAL GERAL', 'Médico': '', 'Matrícula': '', 'Plantões': tot.plantoes, 'Cumpridos': tot.cumpridos, 'Faltas': tot.faltas, 'Atrasos': tot.atrasos, 'Saídas antecipadas': tot.saidas, 'Incompletos': tot.incompletos, 'Visitas': tot.visitas, 'Visitas c/ marcação': tot.visitasOk, 'Sobreavisos': tot.sobreaviso });
    return { out, emp };
  }
  function sheetName(n, used) {
    let s = String(n).replace(/[\[\]:*?\/\\]/g, '').slice(0, 31).trim() || 'Empresa', k = 2;
    while (used.has(s)) { s = s.slice(0, 28) + '_' + k++; }
    used.add(s); return s;
  }
  function loadXlsx() {
    if (g.XLSX) return Promise.resolve(g.XLSX);
    return new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
      sc.onload = () => g.XLSX ? res(g.XLSX) : rej(new Error('SheetJS indisponível'));
      sc.onerror = () => rej(new Error('Sem acesso ao SheetJS'));
      document.head.appendChild(sc);
      setTimeout(() => rej(new Error('Tempo esgotado ao carregar SheetJS')), 8000);
    });
  }
  function csvBlob(rows) {
    if (!rows.length) return null;
    const keys = Object.keys(rows[0]);
    const csv = [keys.join(';'), ...rows.map(r => keys.map(k => '"' + String(r[k] ?? '').replace(/"/g, '""') + '"').join(';'))].join('\r\n');
    return new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  }
  function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); }
  // Retorna 'xlsx' ou 'csv' conforme o formato gerado.
  async function exportByEmpresa(rows, extras, mes) {
    const { out, emp } = resumo(rows);
    try {
      const X = await loadXlsx(), wb = X.utils.book_new(), used = new Set();
      const ws = X.utils.json_to_sheet(out); ws['!cols'] = [{ wch: 44 }, { wch: 38 }, { wch: 10 }, ...Array(7).fill({ wch: 12 })];
      X.utils.book_append_sheet(wb, ws, sheetName('Resumo', used));
      Object.keys(emp).sort().forEach(e => {
        const w = X.utils.json_to_sheet(sheetRows(emp[e])); w['!cols'] = [{ wch: 11 }, { wch: 13 }, { wch: 36 }, { wch: 9 }, { wch: 18 }, { wch: 30 }, { wch: 11 }, { wch: 12 }, { wch: 12 }, { wch: 26 }, { wch: 9 }, { wch: 9 }, { wch: 60 }];
        X.utils.book_append_sheet(wb, w, sheetName(e, used));
      });
      if (extras && extras.length) X.utils.book_append_sheet(wb, X.utils.json_to_sheet(extras.map(x => ({ 'Empresa': x.empresa, 'Médico': x.doctorName, 'Matrícula': x.matricula, 'Marcação': fmtDia(x.ts) + ' ' + hm(x.ts) }))), sheetName('Marcações fora da escala', used));
      X.writeFile(wb, `escala_x_ponto_${mes}.xlsx`);
      return 'xlsx';
    } catch (e) {
      console.warn('Exportação XLSX indisponível, gerando CSV:', e.message);
      const all = sheetRows(rows).map((r, i) => ({ 'Empresa': rows[i].empresa, ...r }));
      download(csvBlob(all), `escala_x_ponto_${mes}.csv`);
      download(csvBlob(out), `escala_x_ponto_${mes}_resumo.csv`);
      return 'csv';
    }
  }
  g.EscalaPonto = { crossCheck, kpis, STATUS, exportByEmpresa, hm, dm, fmtDia, ocText };
})(typeof window !== 'undefined' ? window : globalThis);
