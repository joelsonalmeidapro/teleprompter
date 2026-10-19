/* Teleprompter Joelson: roteiros criptografados (AES-GCM, chave por PBKDF2), rolagem com controle, voz e Bluetooth. */
(() => {
const $ = id => document.getElementById(id);
const LS = {
  get(k, d) { try { const v = localStorage.getItem('tp_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('tp_' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('tp_' + k); } catch (e) {} }
};
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const tob64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const esc = s => s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

let DADOS = null, pastaAtual = LS.get('pasta', null), roteiroAtual = null;

/* ---------- cripto ---------- */
async function baixarPacote() {
  const r = await fetch('roteiros.enc?t=' + Date.now(), {cache: 'no-store'});
  if (!r.ok) throw new Error('sem pacote');
  return r.json();
}
async function chaveDaSenha(senha, pac) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'PBKDF2', salt: b64(pac.salt), iterations: pac.it, hash: 'SHA-256'},
    base, {name: 'AES-GCM', length: 256}, true, ['decrypt']);
}
async function abrir(pac, chave) {
  const pt = await crypto.subtle.decrypt({name: 'AES-GCM', iv: b64(pac.iv)}, chave, b64(pac.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function chaveSalva(pac) {
  const k = LS.get('k', null);
  if (!k || k.salt !== pac.salt) return null;
  return crypto.subtle.importKey('raw', b64(k.raw), {name: 'AES-GCM'}, false, ['decrypt']);
}
async function carregar(senha) {
  let pac;
  try { pac = await baixarPacote(); LS.set('pac', pac); }
  catch (e) { pac = LS.get('pac', null); if (!pac) throw e; }
  let chave = senha ? await chaveDaSenha(senha, pac) : await chaveSalva(pac);
  if (!chave) return false;
  DADOS = await abrir(pac, chave);
  if (senha) LS.set('k', {salt: pac.salt, raw: tob64(await crypto.subtle.exportKey('raw', chave))});
  return true;
}

/* ---------- telas ---------- */
function mostrar(id) { for (const t of document.querySelectorAll('.tela')) t.hidden = t.id !== id; }

$('formSenha').addEventListener('submit', async e => {
  e.preventDefault();
  $('erroSenha').hidden = true;
  try { if (await carregar($('senha').value.trim())) { $('senha').value = ''; abrirLista(); return; } } catch (err) {}
  $('erroSenha').hidden = false;
});

$('atualizar').onclick = async () => {
  $('info').textContent = 'Atualizando...';
  try { if (await carregar(null)) { abrirLista(); return; } } catch (e) {}
  $('info').textContent = 'Sem conexão: mostrando a última versão salva.';
};

function abrirLista() {
  mostrar('telaLista');
  const pastas = DADOS.pastas;
  if (!pastas.some(p => p.id === pastaAtual)) pastaAtual = pastas[0].id;
  $('pastas').innerHTML = pastas.map(p => `<button type="button" data-p="${p.id}" aria-pressed="${p.id === pastaAtual}">${esc(p.nome)}</button>`).join('');
  $('pastas').onclick = e => { const b = e.target.closest('button'); if (!b) return; pastaAtual = b.dataset.p; LS.set('pasta', pastaAtual); abrirLista(); };
  const feitos = LS.get('feitos', {});
  const lista = DADOS.roteiros.filter(r => r.pasta === pastaAtual);
  let html = '', grupo = null;
  for (const r of lista) {
    if (r.grupo && r.grupo !== grupo) { grupo = r.grupo; html += `<li class="sub">${esc(grupo)}</li>`; }
    const pos = LS.get('pos_' + r.id, 0);
    html += `<li class="${feitos[r.id] ? 'feito' : ''}"><button type="button" data-id="${r.id}"><b>${feitos[r.id] ? '✓ ' : ''}${esc(r.titulo)}</b><small>${r.palavras} palavras · ~${Math.max(1, Math.round(r.palavras / 150))} min${pos > 0 ? ' · continuar de onde parou' : ''}</small></button></li>`;
  }
  $('lista').innerHTML = html || '<li class="info">Nenhum roteiro nesta pasta ainda.</li>';
  $('lista').onclick = e => { const b = e.target.closest('button[data-id]'); if (b) abrirPrompter(b.dataset.id); };
  const d = new Date(DADOS.gerado);
  $('info').textContent = `${DADOS.roteiros.length} roteiros · atualizado em ${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}`;
}

/* ---------- ajustes ---------- */
const AJ = Object.assign({vel: 140, fonte: 46, fonteH: 64, ppl: 4, margem: 8, espaco: 13, guiaPos: 30, espelho: false, centro: true, numeros: true, contar: true, voz: false, sens: 24}, LS.get('aj', {}));
if (AJ.vel < 40) AJ.vel = 140;
AJ.voz = false; // seguir voz desligado por enquanto
const salvarAj = () => LS.set('aj', AJ);
const deitado = () => innerWidth > innerHeight;
const fk = () => deitado() ? 'fonteH' : 'fonte';
function aplicarVisual() {
  const r = document.documentElement.style;
  r.setProperty('--fonte', AJ[fk()] + 'px'); r.setProperty('--margem', AJ.margem + 'vw');
  r.setProperty('--espaco', (AJ.espaco / 10).toFixed(2)); r.setProperty('--guia', AJ.guiaPos + '%');
  $('rolo').classList.toggle('centro', AJ.centro);
  for (const [id, k] of [['espelho', 'espelho'], ['alinhar', 'centro'], ['numeros', 'numeros'], ['contar', 'contar'], ['vozBt', 'voz']]) $(id).setAttribute('aria-pressed', AJ[k]);
  $('vozPainel').hidden = !AJ.voz;
}
function liga(id, k, fmt = v => v, remonta = false) {
  const el = $(id); el.value = AJ[k]; $(id + 'v').textContent = fmt(AJ[k]);
  el.oninput = () => { AJ[k] = +el.value; $(id + 'v').textContent = fmt(AJ[k]); salvarAj(); aplicarVisual(); if (remonta) remontar(); else posicionar(); };
}
liga('vel', 'vel', v => v + ' ppm');
function ligaFonte() { const el = $('fonte'); el.value = AJ[fk()]; $('fontev').textContent = AJ[fk()]; el.oninput = () => { AJ[fk()] = +el.value; $('fontev').textContent = el.value; salvarAj(); remontar(); }; }
ligaFonte(); liga('ppl', 'ppl', v => v, true); liga('margem', 'margem', v => v, true);
liga('espaco', 'espaco', v => (v / 10).toFixed(1), true); liga('guiaPos', 'guiaPos', v => v + '%'); liga('sens', 'sens');
function tog(id, k, depois) { $(id).onclick = () => { AJ[k] = !AJ[k]; salvarAj(); aplicarVisual(); if (depois) depois(); }; }
tog('espelho', 'espelho', posicionar); tog('alinhar', 'centro'); tog('numeros', 'numeros', remontar); tog('contar', 'contar');
tog('vozBt', 'voz', () => { if (AJ.voz) ligarMic(); else desligarMic(); });

/* ---------- montagem do texto ---------- */
// quebra por número de palavras E pela largura da tela: a letra fica sempre do mesmo tamanho
const regua = document.createElement('canvas').getContext('2d');
let larguraMax = 0;
function mede(palavras) {
  return regua.measureText(palavras.join(' ').replace(/\*\*/g, '')).width;
}
function quebrar(frase, n) {
  const ws = frase.split(/\s+/).filter(Boolean), out = [];
  let cur = [];
  for (const w of ws) {
    if (cur.length && larguraMax && mede([...cur, w]) > larguraMax) { out.push(cur); cur = []; }
    cur.push(w);
    const pont = /[,;:!?.…)]["”*]*$/.test(w);
    if (cur.length >= n || (pont && cur.length >= Math.max(2, Math.ceil(n / 2)))) { out.push(cur); cur = []; }
  }
  if (cur.length) {
    const ult = out[out.length - 1];
    if (cur.length === 1 && ult && ult.length < n + 2 && (!larguraMax || mede([...ult, ...cur]) <= larguraMax)) ult.push(...cur); else out.push(cur);
  }
  return out;
}
// amarelo = números e nomes próprios; verde = ênfase marcada no roteiro com **assim**
const NOME = /^["“'(]?[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõçà]+/;
function realce(palavras, est) {
  return palavras.map(w => {
    let abre = false, fecha = false;
    if (w.startsWith('**')) { w = w.slice(2); abre = true; }
    if (/\*\*[.,;:!?…"”)]*$/.test(w)) { w = w.replace(/\*\*(?=[.,;:!?…"”)]*$)/, ''); fecha = true; }
    if (abre) est.enfase = true;
    const inicio = est.inicio; est.inicio = /[.!?:…]["”)]?$/.test(w);
    let html;
    if (est.enfase) html = `<em>${esc(w)}</em>`;
    else if (AJ.numeros && (/\d/.test(w) || (!inicio && NOME.test(w)) || /^[A-Z]{2,}\d*[,.;:!?]?$/.test(w))) html = `<b>${esc(w)}</b>`;
    else html = esc(w);
    if (fecha) est.enfase = false;
    return html;
  }).join(' ');
}
function remontar() {
  if (!roteiroAtual) return;
  const fpx = AJ[fk()];
  document.documentElement.style.setProperty('--fonte', fpx + 'px');
  regua.font = `800 ${fpx}px -apple-system, "SF Pro Display", system-ui, "Segoe UI", Roboto, sans-serif`;
  larguraMax = ($('rolo').clientWidth || innerWidth) - 2 * (AJ.margem / 100) * innerWidth - 4;
  const prop = maxY() ? y / maxY() : 0;
  let html = '<div style="height:' + AJ.guiaPos + 'vh"></div>';
  for (const p of roteiroAtual.partes) {
    if (p.t === 'rot') html += `<div class="rot">${esc(p.x)}</div>`;
    else if (p.t === 'bloco') html += '<div class="blocofim"></div>';
    else { const ls = quebrar(p.x, AJ.ppl), est = {inicio: true, enfase: false}; ls.forEach((l, i) => { html += `<p class="ln${i === ls.length - 1 ? ' fimfrase' : ''}">${realce(l, est)}</p>`; }); }
  }
  html += '<div style="height:85vh"></div>';
  $('rolo').innerHTML = html;
  ajustarFonte();
  y = prop * maxY(); posicionar();
}

/* letra se ajusta para nenhuma linha quebrar em duas */
function ajustarFonte() {}

/* ---------- rolagem ---------- */
let segurando = 0, avisoBotao = '', avisoT = 0, y = 0, rodando = false, tAnt = 0, velAtual = 0, falando = false, ultimaFala = 0, wake = null;
const pxPorSeg = () => roteiroAtual && roteiroAtual.palavras ? (maxY() / roteiroAtual.palavras) * AJ.vel / 60 : 0;
const maxY = () => Math.max(0, $('rolo').scrollHeight - innerHeight * (AJ.guiaPos / 100) - 40);
function posicionar() {
  $('rolo').style.transform = (AJ.espelho ? 'scaleX(-1) ' : '') + `translateY(${-y}px)`;
  const m = maxY(), pct = m ? y / m : 0;
  $('barraFill').style.width = (pct * 100).toFixed(1) + '%';
  const pxs = pxPorSeg(), rest = pxs ? (m - y) / pxs : 0;
  $('hudTxt').textContent = `${avisoBotao ? 'botão: ' + avisoBotao + ' · ' : ''}${rodando ? (AJ.voz && micOk ? (falando ? 'ouvindo · ' : 'esperando você falar · ') + 'mic ' + Math.round(nivelAtual * 100) + '/' + Math.round(limiarAtual * 100) + ' · ' : '') : 'pausado · '}${AJ.vel} ppm · falta ${Math.floor(rest / 60)}:${String(Math.floor(rest % 60)).padStart(2, '0')}`;
}
function quadro(t) {
  const dt = tAnt ? Math.min(0.1, (t - tAnt) / 1000) : 0; tAnt = t;
  if (AJ.voz && micOk) lerMic(t);
  let alvo = rodando ? pxPorSeg() : 0;
  if (rodando && AJ.voz && micOk && !falando) alvo = 0;
  if (segurando) { const lh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fonte')) * (AJ.espaco / 10); y = Math.max(0, Math.min(maxY(), y + segurando * lh * 2.5 * dt)); posicionar(); }
  velAtual += (alvo - velAtual) * Math.min(1, dt * 6);
  if (Math.abs(velAtual) > 0.05) {
    y = Math.min(maxY(), y + velAtual * dt); posicionar();
    if (y >= maxY() && rodando) { parar(true); marcarFeito(); }
  }
  requestAnimationFrame(quadro);
}
async function pedirWake() { try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch (e) {} }
let contando = false;
function tocar() {
  if (contando) return;
  if (ctx && ctx.state !== 'running') ctx.resume();
  const vai = () => { rodando = true; document.body.classList.add('rodando', 'limpo'); $('pausaFlut').textContent = '❚❚'; $('play').textContent = '❚❚ Pausar'; pedirWake(); posicionar(); };
  if (!AJ.contar || y > 5) return vai();
  contando = true; let n = 3; const c = $('contagem'); c.hidden = false; c.textContent = n;
  document.body.classList.add('rodando', 'limpo');
  const iv = setInterval(() => { n--; if (n <= 0) { clearInterval(iv); c.hidden = true; contando = false; vai(); } else c.textContent = n; }, 800);
}
// parar(true) abre o menu; parar() só congela o texto (controle e botão flutuante)
function parar(menu) { rodando = false; document.body.classList.remove('rodando'); if (menu) document.body.classList.remove('limpo'); $('pausaFlut').textContent = '▶'; $('play').textContent = y > 5 ? '▶ Continuar' : '▶ Começar'; if (roteiroAtual) LS.set('pos_' + roteiroAtual.id, y); posicionar(); }
const alternar = () => rodando ? parar() : tocar();
const abrirMenu = () => { parar(true); };
function setVel(v) { AJ.vel = Math.max(60, Math.min(260, v)); $('vel').value = AJ.vel; $('velv').textContent = AJ.vel + ' ppm'; salvarAj(); posicionar(); }
function pularFrase(dir) {
  const guia = innerHeight * AJ.guiaPos / 100;
  const tops = [...$('rolo').querySelectorAll('.ln')].map(el => el.offsetTop - guia);
  if (dir > 0) { const t = tops.find(t => t > y + 4); if (t !== undefined) y = Math.min(maxY(), t); }
  else { const ant = tops.filter(t => t < y - 4); y = ant.length ? Math.max(0, ant[ant.length - 1]) : 0; }
  posicionar();
}
function marcarFeito() { const f = LS.get('feitos', {}); f[roteiroAtual.id] = Date.now(); LS.set('feitos', f); LS.set('pos_' + roteiroAtual.id, 0); }

function abrirPrompter(id) {
  roteiroAtual = DADOS.roteiros.find(r => r.id === id); if (!roteiroAtual) return;
  mostrar('telaPrompter'); $('tituloAtual').textContent = roteiroAtual.titulo;
  y = 0; aplicarVisual(); remontar(); y = Math.min(LS.get('pos_' + id, 0), maxY()); posicionar(); parar(true);
  if (AJ.voz) ligarMic();
}
$('voltarLista').onclick = () => { parar(true); desligarMic(); abrirLista(); };
$('play').onclick = alternar;
$('inicio').onclick = () => { parar(true); y = 0; LS.set('pos_' + roteiroAtual.id, 0); posicionar(); $('play').textContent = '▶ Começar'; };
// tocar na tela: com o texto limpo abre o menu; com o menu aberto, começa
/* toque, arrastar e roda: o controle Bluetooth costuma agir como mouse/dedo
   - toque de dedo: abre o menu (ou começa, se o menu já está aberto)
   - "clique" do controle (mouse): só pausa/continua, sem menu
   - arrastar (dedo ou alavanca) e roda do mouse: rolam o texto pra cima/baixo */
let pIni = null;
const palco = $('palco');
palco.addEventListener('pointerdown', e => { pIni = {y: e.clientY, ult: e.clientY, tipo: e.pointerType, arrastou: false}; });
palco.addEventListener('pointermove', e => {
  if (!pIni) return;
  const dy = e.clientY - pIni.ult;
  if (Math.abs(e.clientY - pIni.y) > 8) pIni.arrastou = true;
  if (pIni.arrastou) { y = Math.max(0, Math.min(maxY(), y - dy)); pIni.ult = e.clientY; posicionar(); }
});
palco.addEventListener('pointerup', e => {
  const p = pIni; pIni = null;
  if (!p || p.arrastou) { if (roteiroAtual) LS.set('pos_' + roteiroAtual.id, y); return; }
  if (p.tipo === 'mouse' || p.tipo === 'pen') return alternar();
  document.body.classList.contains('limpo') ? abrirMenu() : tocar();
});
palco.addEventListener('pointercancel', () => { pIni = null; });
palco.addEventListener('wheel', e => { e.preventDefault(); y = Math.max(0, Math.min(maxY(), y + e.deltaY)); posicionar(); }, {passive: false});
$('pausaFlut').onclick = e => { e.stopPropagation(); alternar(); };

/* ---------- controle Bluetooth / teclado ---------- */
document.addEventListener('keydown', e => {
  if ($('telaPrompter').hidden) return;
  const k = e.key;
  $('tecla').textContent = 'Último botão recebido: ' + (k === ' ' ? 'Espaço' : k) + (e.code && e.code !== k ? ` (${e.code})` : '');
  avisoBotao = (k === ' ' ? 'Espaço' : k); clearTimeout(avisoT); avisoT = setTimeout(() => { avisoBotao = ''; posicionar(); }, 2500); posicionar();
  const mapa = LS.get('mapa', {});
  let acao = mapa[k] || ({' ': 'play', 'Enter': 'play', 'MediaPlayPause': 'play', 'k': 'play',
    'ArrowRight': 'mais', '+': 'mais', 'ArrowLeft': 'menos', '-': 'menos',
    'ArrowUp': 'volta', 'PageUp': 'volta', 'MediaTrackPrevious': 'volta', 'AudioVolumeUp': 'volta',
    'ArrowDown': 'avanca', 'PageDown': 'avanca', 'MediaTrackNext': 'avanca', 'AudioVolumeDown': 'avanca', 'Home': 'inicio'})[k];
  // qualquer outro botão do controle (ex.: OK no modo game) = pausar/continuar
  const ignorar = ['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Escape', 'CapsLock', 'Unidentified', 'Dead', 'Process'];
  if (!acao && !ignorar.includes(k) && !e.ctrlKey && !e.metaKey && !e.altKey) acao = 'play';
  if (!acao) return;
  e.preventDefault();
  // botão segurado: o controle repete o comando; play não repete e a alavanca vira rolagem suave
  if (e.repeat) { if (acao === 'volta' || acao === 'avanca') segurando = acao === 'avanca' ? 1 : -1; return; }
  if (acao === 'play') alternar(); else if (acao === 'mais') setVel(AJ.vel + 10); else if (acao === 'menos') setVel(AJ.vel - 10);
  else if (acao === 'volta') pularFrase(-1); else if (acao === 'avanca') pularFrase(1); else if (acao === 'inicio') $('inicio').click();
});

/* ---------- seguir a voz ---------- */
let nivelAtual = 0, limiarAtual = 0, pisoRuido = null, micOk = false, ctx = null, analisador = null, fluxo = null, buf = null;
async function ligarMic() {
  if (micOk) return;
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume && ctx.resume();
    fluxo = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: false, noiseSuppression: false, autoGainControl: true}});
    if (ctx.state !== 'running') await ctx.resume();
    const src = ctx.createMediaStreamSource(fluxo);
    analisador = ctx.createAnalyser(); analisador.fftSize = 1024; buf = new Float32Array(analisador.fftSize);
    src.connect(analisador); const mudo = ctx.createGain(); mudo.gain.value = 0; analisador.connect(mudo); mudo.connect(ctx.destination); micOk = true; $('micPonto').hidden = false;
  } catch (e) { AJ.voz = false; salvarAj(); aplicarVisual(); $('tecla').textContent = 'O microfone não foi liberado. Em Ajustes do iPhone, permita o microfone para o Safari.'; }
}
function desligarMic() { micOk = false; pisoRuido = null; $('micPonto').hidden = true; try { fluxo && fluxo.getTracks().forEach(t => t.stop()); ctx && ctx.close(); } catch (e) {} fluxo = ctx = null; }
function lerMic(t) {
  analisador.getFloatTimeDomainData(buf);
  let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  const rms = Math.sqrt(s / buf.length), nivel = Math.min(1, Math.sqrt(rms) * 2.2);
  // piso de ruído se calibra sozinho: desce rápido no silêncio, sobe devagar
  if (pisoRuido === null) pisoRuido = nivel;
  pisoRuido = nivel < pisoRuido ? pisoRuido * 0.7 + nivel * 0.3 : pisoRuido + (nivel - pisoRuido) * 0.003;
  const limiar = Math.min(0.95, pisoRuido + (41 - AJ.sens) / 40 * 0.22);
  limiarAtual = limiar;
  const antes = falando;
  if (nivel > limiar) { falando = true; ultimaFala = t; } else if (t - ultimaFala > 700) falando = false;
  if (antes !== falando) posicionar();
  nivelAtual = nivel; $('nivel').style.width = (nivel * 100) + '%'; if (rodando && Math.random() < 0.1) posicionar(); $('limiar').style.left = (limiar * 100) + '%';
  $('micPonto').classList.toggle('on', falando);
}

/* ---------- partida ---------- */
addEventListener('resize', () => { ligaFonte(); if (!$('telaPrompter').hidden) remontar(); });
document.addEventListener('keyup', () => { if (segurando) { segurando = 0; if (roteiroAtual) LS.set('pos_' + roteiroAtual.id, y); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && rodando) pedirWake(); if (document.visibilityState === 'hidden' && rodando) parar(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
aplicarVisual(); requestAnimationFrame(quadro);
(async () => {
  try { if (await carregar(null)) return abrirLista(); } catch (e) {}
  mostrar('telaSenha');
})();
})();
