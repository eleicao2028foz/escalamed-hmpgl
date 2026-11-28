/* Hermes — caixinha da barra lateral.
   Só o visor, o texto e o microfone. A chave de IA fica na Edge Function;
   daqui sai apenas o access_token da sessão e a chave anon já usada pelo app. */
(function () {
  'use strict';

  const visor = document.getElementById('hermesVisor');
  const form = document.getElementById('hermesForm');
  const input = document.getElementById('hermesInput');
  const mic = document.getElementById('hermesMic');
  const statusEl = document.getElementById('hermesStatus');
  const region = document.getElementById('hermes');
  const speakerBtn = document.getElementById('hermesSpeaker');
  if (!visor || !form || !input || !mic || !statusEl || !region || !speakerBtn) return;

  const FN = '/functions/v1/hermes-assistant';
  const MAX_MSGS = 8;
  const msgs = [];

  let state = 'idle';
  let busy = false;
  let turn = 0;
  let speakGen = 0;
  let listening = false;
  let rec = null;
  let audioCtx = null;
  let source = null;
  let speakRaf = 0;
  let playResolve = null;
  let abortCtrl = null;

  let px = 0;
  let py = 0;
  let blink = 0;
  let blinking = false;
  let nextBlink = 0;
  let faceQueued = false;

  function fail(code, message) {
    const err = new Error(message || code);
    err.code = code;
    return err;
  }

  function client() {
    const S = window.EscalaMed && window.EscalaMed.S;
    return S && S.sb ? S.sb : null;
  }

  function reduceMotion() {
    return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function setLevel(rms) {
    const mouth = Math.max(0, Math.min(1, ((Number(rms) || 0) - 0.02) * 6.2));
    visor.style.setProperty('--mouth', mouth.toFixed(3));
    visor.style.setProperty('--eye', (1 + mouth * 0.07).toFixed(3));
  }

  function setState(next) {
    state = next;
    visor.dataset.state = next;
    const isListen = next === 'listen';
    const isSpeak = next === 'speak';
    mic.classList.toggle('is-listen', isListen);
    mic.classList.toggle('is-speak', isSpeak);
    mic.setAttribute('aria-pressed', isListen ? 'true' : 'false');
    const label = isSpeak ? 'Interromper a fala' : isListen ? 'Parar de ouvir' : 'Falar com o Hermes';
    mic.setAttribute('aria-label', label);
    mic.title = label;
    region.setAttribute('aria-busy', next === 'think' ? 'true' : 'false');
  }

  function showStatus(text, kind) {
    if (!text) {
      statusEl.hidden = true;
      statusEl.textContent = '';
      statusEl.removeAttribute('title');
      statusEl.removeAttribute('data-kind');
      statusEl.removeAttribute('aria-live');
      return;
    }
    statusEl.hidden = false;
    statusEl.dataset.kind = kind || 'reply';
    statusEl.textContent = text;
    statusEl.title = text;
    if (kind === 'reply') statusEl.removeAttribute('aria-live');
    else statusEl.setAttribute('aria-live', 'polite');
  }

  function remember(role, content) {
    msgs.push({ role: role, content: content });
    while (msgs.length > MAX_MSGS) msgs.shift();
  }

  function forgetLastUser(text) {
    const last = msgs[msgs.length - 1];
    if (last && last.role === 'user' && last.content === text) msgs.pop();
  }

  // ── Áudio no iPhone/Safari ───────────────────────────────────────────────
  // O Safari iOS só deixa tocar som se o play() nascer de um toque, e a resposta do Hermes
  // chega segundos depois (fora do gesto). Por isso, a cada toque (enviar, microfone, alto-falante)
  // "destravamos" tudo de uma vez: sessão de áudio em "playback" (toca mesmo no modo silencioso),
  // AudioContext, um <audio> reutilizável e o speechSynthesis. Depois a fala usa o que já foi liberado.
  const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  let audioEl = null;
  let audioElUnlocked = false;
  let synthPrimed = false;
  let ptVoice = null;
  let lastReply = null;      // { text, buf } da última resposta (para o botão repetir sem gastar outra chamada)
  let elUrl = '';

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      const id = setTimeout(function () { reject(fail('timeout')); }, ms);
      promise.then(function (v) { clearTimeout(id); resolve(v); }, function (e) { clearTimeout(id); reject(e); });
    });
  }

  function pickVoice() {
    try {
      const voices = (window.speechSynthesis && window.speechSynthesis.getVoices()) || [];
      if (!voices.length) return null;
      const br = voices.filter(function (v) { return /^pt[-_]BR$/i.test(v.lang); });
      const any = voices.filter(function (v) { return /^pt/i.test(v.lang); });
      const pool = br.length ? br : any;
      ptVoice = pool.filter(function (v) { return /luciana|francisca|maria|google/i.test(v.name); })[0] || pool[0] || null;
    } catch (e) { /* sem vozes ainda */ }
    return ptVoice;
  }
  if (window.speechSynthesis) {
    pickVoice();
    try { window.speechSynthesis.addEventListener('voiceschanged', pickVoice); } catch (e) { /* ignore */ }
  }

  function ensureAudioEl() {
    if (audioEl) return audioEl;
    const el = document.createElement('audio');
    el.setAttribute('playsinline', '');
    el.setAttribute('webkit-playsinline', '');
    el.preload = 'auto';
    el.volume = 1;
    el.style.display = 'none';
    (region || document.body).appendChild(el);
    audioEl = el;
    return el;
  }

  function primeAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new AC();
      try { audioCtx.onstatechange = function () { /* retomado no próximo toque */ }; } catch (e) { /* ignore */ }
    }
    // no iOS o estado pode ser "interrupted" (depois do ditado ou de voltar de outro app), não só "suspended"
    if (audioCtx.state !== 'running') {
      try { const r = audioCtx.resume(); if (r && r.catch) r.catch(function () {}); } catch (e) { /* ignore */ }
    }
    return audioCtx;
  }

  // Chamar de DENTRO de um toque (síncrono). Barato e seguro de repetir.
  function unlockAudio() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* sem API */ }
    const ctx = primeAudio();
    if (ctx) {
      try {
        const b = ctx.createBuffer(1, 1, 22050);
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(ctx.destination);
        s.start(0);
      } catch (e) { /* ignore */ }
    }
    try {
      const el = ensureAudioEl();
      if (!audioElUnlocked) {
        el.src = SILENT_WAV;
        const pr = el.play();
        if (pr && pr.then) {
          pr.then(function () { audioElUnlocked = true; try { el.pause(); } catch (e) { /* ignore */ } },
            function () { /* o próximo toque tenta de novo */ });
        } else audioElUnlocked = true;
      }
    } catch (e) { /* ignore */ }
    try {
      const synth = window.speechSynthesis;
      if (synth && typeof SpeechSynthesisUtterance !== 'undefined') {
        pickVoice();
        if (!synthPrimed) {
          const u = new SpeechSynthesisUtterance(' ');
          u.volume = 0;
          u.lang = 'pt-BR';
          synth.speak(u);
          synthPrimed = true;
        } else if (synth.paused) {
          synth.resume();
        }
      }
    } catch (e) { /* ignore */ }
  }

  function stopSpeaking() {
    speakGen++;
    if (speakRaf) cancelAnimationFrame(speakRaf);
    speakRaf = 0;
    const src = source;
    source = null;
    if (src) {
      try { src.onended = null; src.stop(); } catch (e) { /* já parou */ }
    }
    if (audioEl && !audioEl.paused) {
      try { audioEl.pause(); } catch (e) { /* ignore */ }
    }
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* sem voz */ }
    setLevel(0);
    const done = playResolve;
    playResolve = null;
    if (done) done();
    if (state === 'speak') setState('idle');
  }

  async function sessionToken() {
    const sb = client();
    if (!sb || !sb.auth || !sb.auth.getSession) return '';
    const { data } = await sb.auth.getSession();
    return (data && data.session && data.session.access_token) || '';
  }

  async function hermesFetch(payload, signal, retried) {
    const cfg = window.ESCALAMED_CONFIG || {};
    const base = String(cfg.SUPABASE_URL || '').replace(/\/$/, '');
    const key = cfg.SUPABASE_ANON_KEY || '';
    if (!base || !key) throw fail('no-session', 'Entre na conta para falar com o Hermes.');
    const token = await sessionToken();
    if (!token) throw fail('no-session', 'Entre na conta para falar com o Hermes.');
    let res;
    try {
      res = await fetch(base + FN, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          apikey: key,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: signal
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      throw fail('network', 'Sem conexão com o Hermes.');
    }
    if (res.status === 401 && !retried) {
      try { await sessionToken(); } catch (e) { /* tenta de novo com a sessão atual */ }
      return hermesFetch(payload, signal, true);
    }
    return res;
  }

  async function chat(text, signal) {
    remember('user', text);
    try {
      const res = await hermesFetch({
        action: 'chat',
        messages: msgs.map(function (m) { return { role: m.role, content: m.content }; })
      }, signal);
      if (res.status === 429) {
        let message = 'Muitas mensagens agora. Espere um instante.';
        try {
          const j = await res.json();
          if (j && j.message) message = String(j.message);
        } catch (e) { /* usa o texto padrão */ }
        throw fail('rate', message);
      }
      if (res.status === 401) throw fail('auth', 'Sessão expirada. Entre de novo.');
      if (!res.ok) throw fail('http', 'Não consegui consultar agora.');
      let body;
      try { body = await res.json(); }
      catch (e) { throw fail('http', 'Não consegui consultar agora.'); }
      const reply = String(body && body.reply || '').trim();
      if (!reply) throw fail('empty', 'Sem resposta.');
      remember('assistant', reply);
      return reply;
    } catch (e) {
      forgetLastUser(text);
      throw e;
    }
  }

  async function fetchTts(text) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { try { ctrl.abort(); } catch (e) { /* ignore */ } }, 12000);
    try {
      const res = await hermesFetch({ action: 'tts', text: String(text || '') }, ctrl.signal);
      if (!res.ok) throw fail('tts');
      const type = String(res.headers.get('content-type') || '').toLowerCase();
      if (type.indexOf('json') !== -1 || type.indexOf('text/') === 0) throw fail('tts');
      const buf = await res.arrayBuffer();
      if (!buf || buf.byteLength < 44) throw fail('tts');
      return buf;
    } catch (e) {
      throw (e && e.code) ? e : fail('tts');
    } finally {
      clearTimeout(timer);
    }
  }

  // Envelope sintético da boca (quando não há analisador de áudio).
  function fakeLipsync(isAlive) {
    const t0 = performance.now();
    const step = function (now) {
      if (!isAlive()) return;
      const t = (now - t0) / 1000;
      const env = Math.abs(Math.sin(t * 9)) * (0.45 + 0.55 * Math.abs(Math.sin(t * 2.3)));
      setLevel(0.035 + env * 0.15);
      speakRaf = requestAnimationFrame(step);
    };
    speakRaf = requestAnimationFrame(step);
  }

  // Toca o WAV no <audio> já destravado: é o caminho mais confiável no iOS (e ignora o botão de silencioso).
  function playElement(buf, my, gen) {
    return new Promise(function (resolve, reject) {
      if (my !== turn || gen !== speakGen) return resolve(true);
      const el = ensureAudioEl();
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
      if (elUrl) { try { URL.revokeObjectURL(elUrl); } catch (e) { /* ignore */ } }
      elUrl = URL.createObjectURL(new Blob([buf.slice(0)], { type: 'audio/wav' }));
      let settled = false;
      let started = false;
      const alive = function () { return !settled && gen === speakGen && my === turn; };
      const finish = function (ok, err) {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        el.onended = el.onerror = el.onplaying = null;
        if (playResolve === finishPlay) playResolve = null;
        if (speakRaf) cancelAnimationFrame(speakRaf);
        speakRaf = 0;
        if (gen === speakGen && my === turn) setLevel(0);
        if (ok) resolve(true); else reject(err || fail('tts'));
      };
      const finishPlay = function () { finish(true); };
      playResolve = finishPlay;
      el.onplaying = function () { started = true; };
      el.onended = function () { finish(true); };
      el.onerror = function () { finish(false, fail('tts')); };
      const guard = setTimeout(function () { if (!started) finish(false, fail('timeout')); }, 4000);
      el.src = elUrl;
      el.currentTime = 0;
      setState('speak');
      let pr;
      try { pr = el.play(); } catch (e) { return finish(false, fail('blocked')); }
      if (pr && pr.then) {
        pr.then(function () { audioElUnlocked = true; started = true; fakeLipsync(alive); },
          function () { finish(false, fail('blocked')); });
      } else { started = true; fakeLipsync(alive); }
    });
  }

  function playBuffer(buf, my, gen) {
    const ctx = primeAudio();
    if (!ctx) return Promise.reject(fail('tts'));
    const ready = ctx.state === 'running' ? Promise.resolve() : withTimeout(ctx.resume(), 1500);
    return ready.then(function () {
      if (ctx.state !== 'running') throw fail('suspended');
      return ctx.decodeAudioData(buf.slice(0));
    }).then(function (audioBuf) {
      if (my !== turn || gen !== speakGen) return;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.62;
      const src = ctx.createBufferSource();
      src.buffer = audioBuf;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      source = src;
      const data = new Uint8Array(analyser.fftSize);
      const loop = function () {
        if (gen !== speakGen || my !== turn || source !== src) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        setLevel(Math.sqrt(sum / data.length));
        speakRaf = requestAnimationFrame(loop);
      };
      return new Promise(function (resolve) {
        playResolve = resolve;
        src.onended = function () {
          if (source === src) source = null;
          if (speakRaf) cancelAnimationFrame(speakRaf);
          speakRaf = 0;
          if (gen === speakGen && my === turn) setLevel(0);
          if (playResolve === resolve) playResolve = null;
          resolve();
        };
        setState('speak');
        try { src.start(); }
        catch (e) { resolve(); return; }
        loop();
      });
    });
  }

  // Última opção: voz do próprio aparelho. Resolve true se chegou a falar.
  function playFallback(text, my, gen) {
    return new Promise(function (resolve) {
      if (my !== turn || gen !== speakGen) return resolve(true);
      const synth = window.speechSynthesis;
      if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return resolve(false);
      let settled = false;
      let started = false;
      let cap = 0;
      let startGuard = 0;
      const finish = function () {
        if (settled) return;
        settled = true;
        clearTimeout(cap);
        clearTimeout(startGuard);
        if (playResolve === finish) playResolve = null;
        if (speakRaf) cancelAnimationFrame(speakRaf);
        speakRaf = 0;
        if (gen === speakGen && my === turn) setLevel(0);
        resolve(started);
      };
      playResolve = finish;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pt-BR';
      u.rate = 1;
      u.volume = 1;
      const v = ptVoice || pickVoice();
      if (v) u.voice = v;
      cap = setTimeout(finish, Math.min(30000, 2500 + String(text || '').length * 70));
      u.onstart = function () { started = true; clearTimeout(startGuard); };
      u.onend = u.onerror = function () { finish(); };
      // se em 2,5 s não começou a falar, o iOS bloqueou: avisa em vez de ficar mudo e parado
      startGuard = setTimeout(function () { if (!started) { try { synth.cancel(); } catch (e) { /* ignore */ } finish(); } }, 2500);
      setState('speak');
      try {
        synth.cancel();
        if (synth.paused) synth.resume();
        synth.speak(u);
      } catch (e) {
        finish();
        return;
      }
      fakeLipsync(function () { return !settled && gen === speakGen && my === turn; });
    });
  }

  function markPending(on) {
    speakerBtn.classList.toggle('is-pending', !!on);
    if (on) {
      speakerBtn.title = 'Toque para ouvir a resposta';
      speakerBtn.setAttribute('aria-label', 'Toque para ouvir a resposta');
    } else {
      speakerBtn.title = 'Repetir a fala';
      speakerBtn.setAttribute('aria-label', 'Repetir a fala');
    }
  }

  // Tenta, em ordem: <audio> destravado (iOS) / WebAudio (resto) → o outro → voz do aparelho.
  async function speakReply(text, my, cachedBuf) {
    const gen = speakGen;
    setState('speak');
    let buf = cachedBuf || null;
    let spoke = false;
    if (!buf) {
      try { buf = await fetchTts(text); } catch (e) { buf = null; }
    }
    if (my !== turn || gen !== speakGen) return;
    if (buf) {
      lastReply = { text: text, buf: buf };
      const order = IS_IOS ? [playElement, playBuffer] : [playBuffer, playElement];
      for (let i = 0; i < order.length && !spoke; i++) {
        try {
          await order[i](buf, my, gen);
          spoke = true;
        } catch (e) {
          if (my !== turn || gen !== speakGen) return;
        }
      }
    }
    if (!spoke) {
      if (!lastReply || lastReply.text !== text) lastReply = { text: text, buf: null };
      spoke = await playFallback(text, my, gen);
      if (my !== turn || gen !== speakGen) return;
    }
    speakerBtn.hidden = false;
    markPending(!spoke);
    if (!spoke && IS_IOS) showStatus('Toque no 🔊 para ouvir a resposta.', 'status');
    if (my === turn && gen === speakGen && state === 'speak') {
      setLevel(0);
      setState('idle');
    }
  }

  function repeatSpeech() {
    unlockAudio();                       // dentro do toque
    if (!lastReply) return;
    if (state === 'speak') { stopSpeaking(); return; }
    stopSpeaking();
    const my = turn;
    markPending(false);
    speakReply(lastReply.text, my, lastReply.buf);
  }

  function friendly(e) {
    if (!e) return 'Não consegui consultar agora.';
    if (e.code === 'rate') return e.message || 'Muitas mensagens agora. Espere um instante.';
    if (e.code === 'auth') return 'Sessão expirada. Entre de novo.';
    if (e.code === 'no-session') return 'Entre na conta para falar com o Hermes.';
    if (e.code === 'network') return 'Sem conexão com o Hermes.';
    if (e.code === 'empty') return 'Sem resposta.';
    return 'Não consegui consultar agora.';
  }

  async function send(text) {
    text = String(text || '').replace(/\s+/g, ' ').trim();
    if (!text || busy) return;
    stopSpeaking();
    if (listening) stopListen(false);
    busy = true;
    const my = ++turn;
    markPending(false);
    input.value = '';
    setState('think');
    showStatus('Consultando…', 'status');
    mic.disabled = true;
    const ctrl = new AbortController();
    abortCtrl = ctrl;
    try {
      const reply = await chat(text, ctrl.signal);
      if (my !== turn) return;
      showStatus(reply, 'reply');
      busy = false;
      mic.disabled = false;
      await speakReply(reply, my);
    } catch (e) {
      if (my !== turn || (e && e.name === 'AbortError')) return;
      setState('error');
      showStatus(friendly(e), 'error');
    } finally {
      if (my === turn) {
        busy = false;
        mic.disabled = false;
        abortCtrl = null;
        if (state === 'error') {
          setTimeout(function () { if (state === 'error') setState('idle'); }, 1500);
        }
      }
    }
  }

  function stopListen(andSend) {
    const was = listening;
    listening = false;
    const r = rec;
    rec = null;
    if (r) {
      try { r.abort(); }
      catch (e) { try { r.stop(); } catch (e2) { /* já encerrou */ } }
    }
    if (state === 'listen') setState('idle');
    if (!was) return;
    if (!andSend) return;
    const q = input.value.trim();
    if (q) send(q);
    else showStatus('Não ouvi nada.', 'error');
  }

  function startListen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      showStatus('O ditado precisa do Chrome ou do Edge.', 'error');
      return;
    }
    stopSpeaking();
    const prefix = input.value.trim();
    let inst;
    try { inst = new SR(); }
    catch (e) {
      showStatus('Não consegui ligar o microfone.', 'error');
      return;
    }
    inst.lang = 'pt-BR';
    inst.interimResults = true;
    inst.continuous = false;
    inst.onresult = function (ev) {
      let said = '';
      const list = ev.results || [];
      for (let i = 0; i < list.length; i++) said += (list[i][0] && list[i][0].transcript) || '';
      said = said.replace(/\s+/g, ' ').trim();
      input.value = [prefix, said].filter(Boolean).join(' ');
    };
    inst.onerror = function (ev) {
      const err = ev && ev.error;
      if (err === 'aborted') { listening = false; return; }
      listening = false;
      if (state === 'listen') setState('idle');
      if (err === 'no-speech') showStatus('Não ouvi nada.', 'error');
      else if (err === 'not-allowed' || err === 'service-not-allowed') showStatus('Libere o microfone para este site.', 'error');
      else showStatus('Não consegui ouvir. Escreva a pergunta.', 'error');
    };
    inst.onend = function () {
      if (!listening) return;
      listening = false;
      rec = null;
      if (state === 'listen') setState('idle');
      const q = input.value.trim();
      if (q) send(q);
      else showStatus('Não ouvi nada.', 'error');
    };
    rec = inst;
    listening = true;
    setState('listen');
    showStatus('Ouvindo…', 'status');
    try { inst.start(); }
    catch (e) {
      listening = false;
      rec = null;
      setState('idle');
      showStatus('Não consegui ligar o microfone.', 'error');
    }
  }

  function resetSession() {
    turn++;
    if (abortCtrl) {
      try { abortCtrl.abort(); } catch (e) { /* ignore */ }
      abortCtrl = null;
    }
    stopSpeaking();
    if (listening) stopListen(false);
    msgs.length = 0;
    lastReply = null;
    speakerBtn.hidden = true;
    markPending(false);
    input.value = '';
    busy = false;
    mic.disabled = false;
    showStatus('');
    setState('idle');
  }

  function shellHidden() {
    const shell = document.getElementById('shell');
    return !!(shell && shell.classList.contains('hidden'));
  }

  function faceFrame(now) {
    faceQueued = false;
    if (shellHidden()) return;
    const reduce = reduceMotion();
    const t = now / 1000;
    let tx = 0;
    let ty = 0;
    if (state === 'listen') {
      tx = Math.sin(t * 1.7) * 0.16;
      ty = 0.08;
    } else if (state === 'think') {
      tx = -0.42 + Math.sin(t * 0.8) * 0.08;
      ty = -0.72;
    } else if (state === 'speak') {
      tx = Math.sin(t * 2.6) * 0.1;
      ty = 0.05;
    } else if (state === 'error') {
      ty = 0.28;
    } else if (!reduce) {
      tx = Math.sin(t * 0.33) * 0.66;
      ty = Math.cos(t * 0.21) * 0.3;
    }
    px += (tx - px) * 0.08;
    py += (ty - py) * 0.08;
    if (!reduce && !blinking && now > nextBlink && state !== 'speak') {
      blinking = true;
      blink = 1;
      setTimeout(function () { blink = 0; blinking = false; }, 120);
      const gap = state === 'listen' ? 2200 : state === 'think' ? 1600 : 2600 + Math.random() * 2800;
      nextBlink = now + gap;
    }
    visor.style.setProperty('--px', px.toFixed(3));
    visor.style.setProperty('--py', py.toFixed(3));
    visor.style.setProperty('--blink', String(blink));
    ensureFace();
  }

  function ensureFace() {
    if (faceQueued || shellHidden()) return;
    faceQueued = true;
    if (!nextBlink) nextBlink = performance.now() + 700;
    requestAnimationFrame(faceFrame);
  }

  // Destrava o áudio já no primeiro toque no campo/botões (antes de qualquer espera de rede).
  let lastUnlock = 0;
  ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown'].forEach(function (ev) {
    region.addEventListener(ev, function (e) {
      if (ev === 'keydown' && e.key !== 'Enter') return;
      const now = Date.now();
      if (now - lastUnlock < 350) return;
      lastUnlock = now;
      unlockAudio();
    }, { capture: true, passive: true });
  });
  speakerBtn.addEventListener('click', function (e) { e.preventDefault(); repeatSpeech(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && audioCtx && audioCtx.state !== 'running') {
      try { audioCtx.resume().catch(function () {}); } catch (e) { /* ignore */ }
    }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    e.stopPropagation();
    unlockAudio();
    if (listening) stopListen(false);
    send(input.value);
  });

  mic.addEventListener('click', function () {
    unlockAudio();
    if (state === 'speak') { stopSpeaking(); return; }
    if (listening) { stopListen(true); return; }
    if (busy) return;
    startListen();
  });

  const shell = document.getElementById('shell');
  if (shell && window.MutationObserver) {
    new MutationObserver(function () {
      if (shell.classList.contains('hidden')) resetSession();
      else ensureFace();
    }).observe(shell, { attributes: true, attributeFilter: ['class'] });
  }

  setState('idle');
  ensureFace();
})();
