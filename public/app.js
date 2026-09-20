const CENTER = {lat:23.3441, lng:85.3096};

const state = {
  user: null,
  token: localStorage.getItem('nearhelp_token') || '',
  online: true,
  offlineQueue: [],
  incident: null,
  resources: [],
  guardians: [],
  welfare: [],
  history: [],
  moderation: [],
};

const ROLE_LABEL = { user: 'Person seeking help', responder: 'Community responder', admin: 'Platform administrator' };
const DEMO_USERS = {
  user: { name: 'Asha Verma', role: 'user', email: 'asha@nearhelp.app', password: 'demo1234' },
  responder: { name: 'Rakesh Kumar', role: 'responder', email: 'rakesh@nearhelp.app', password: 'demo1234' },
  admin: { name: 'S. Iyer', role: 'admin', email: 'admin@nearhelp.app', password: 'demo1234' },
};

function toast(msg, kind = '') {
  const host = document.getElementById('toastHost');
  const el = document.createElement('div');
  el.className = `toast ${kind === 'danger' ? 'danger' : kind === 'ok' ? 'ok' : ''}`.trim();
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 3400);
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

function setAuthTab(tab) {
  document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
  document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
  document.getElementById('loginFields').classList.toggle('hide', tab !== 'login');
  document.getElementById('registerFields').classList.toggle('hide', tab !== 'register');
}

function renderLoginUser(user) {
  document.getElementById('whoName').textContent = user.name;
  document.getElementById('whoRole').textContent = ROLE_LABEL[user.role] || user.role;
  document.getElementById('avatarInit').textContent = user.name.split(' ').map((s) => s[0]).slice(0, 2).join('');
  const isAdmin = user.role === 'admin';
  document.getElementById('adminNav').style.display = isAdmin ? 'flex' : 'none';
  document.getElementById('adminLabel').style.display = isAdmin ? 'block' : 'none';
}

async function doAuth() {
  const registerMode = !document.getElementById('registerFields').classList.contains('hide');

  try {
    if (registerMode) {
      const name = document.getElementById('r_name').value.trim();
      const email = document.getElementById('r_email').value.trim();
      const password = document.getElementById('r_pass').value;
      const role = document.getElementById('r_role').value;
      if (!name || !email || !password) return toast('Please fill in all fields', 'danger');
      const data = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password, role }) });
      setLoggedIn(data.user, data.token);
      toast('Account created — signed in', 'ok');
      return;
    }

    const email = document.getElementById('li_email').value.trim();
    const password = document.getElementById('li_pass').value;
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    setLoggedIn(data.user, data.token);
    toast('Signed in successfully', 'ok');
  } catch (error) {
    toast(error.message, 'danger');
  }
}

async function demoLogin(role) {
  const demo = DEMO_USERS[role];
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: demo.email, password: demo.password }),
    });
    setLoggedIn(data.user, data.token);
    toast(`${demo.name} logged in`, 'ok');
  } catch (error) {
    toast(error.message, 'danger');
  }
}

function setLoggedIn(user, token) {
  state.user = user;
  state.token = token;
  localStorage.setItem('nearhelp_token', token);
  document.getElementById('login').classList.add('hide');
  document.getElementById('app').classList.add('on');
  renderLoginUser(user);
  loadInitialData();
}

function logout() {
  state.user = null;
  state.token = '';
  localStorage.removeItem('nearhelp_token');
  document.getElementById('app').classList.remove('on');
  document.getElementById('login').classList.remove('hide');
  document.getElementById('sosModalBg').classList.add('hide');
  state.incident = null;
}

function go(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hide'));
  document.getElementById('view-' + view).classList.remove('hide');
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === view));

  const titleMap = { dashboard: 'Dashboard', sos: 'Active incident', resources: 'Nearby resources', guardians: 'Guardians', history: 'History', admin: 'Analytics & moderation' };
  document.getElementById('pageTitle').textContent = titleMap[view] || 'NearHelp';

  if (view === 'sos') setTimeout(initLiveMap, 30);
  if (view === 'resources') setTimeout(initResMap, 30);
  if (view === 'admin') setTimeout(initCharts, 30);
}

function toggleOffline() {
  state.online = !state.online;
  const btn = document.getElementById('offlineToggle');
  btn.classList.toggle('on', state.online);
  document.getElementById('connDot').classList.toggle('off', !state.online);
  document.getElementById('connTxt').textContent = state.online ? 'Online' : 'Offline (simulated)';

  if (state.online && state.offlineQueue.length) {
    toast(`Reconnected — sending ${state.offlineQueue.length} queued SOS`, 'ok');
    state.offlineQueue = [];
    renderQueue();
  }
}

function renderQueue() {
  const n = state.offlineQueue.length;
  document.getElementById('queueChip').textContent = n + ' queued';
  document.getElementById('queueSub').textContent = n ? `${n} alert(s) waiting for connectivity` : 'Empty — alerts send instantly';
}

function openSosModal() {
  document.getElementById('sosModalBg').classList.remove('hide');
}

function closeSosModal() {
  document.getElementById('sosModalBg').classList.add('hide');
}

async function confirmSos() {
  const type = document.getElementById('sosType').value;
  const priority = document.getElementById('sosPriority').value;
  closeSosModal();

  if (!state.online) {
    state.offlineQueue.push({ type, priority, lat: CENTER.lat, lng: CENTER.lng, ts: Date.now() });
    renderQueue();
    toast('No connection — SOS queued and will send automatically', 'danger');
    return;
  }

  try {
    const data = await api('/api/incidents', {
      method: 'POST',
      body: JSON.stringify({ type, priority, lat: CENTER.lat, lng: CENTER.lng }),
    });
    state.incident = data.incident;
    document.getElementById('navSosBadge').classList.remove('hide');
    toast('SOS sent — responder assigned', 'danger');
    go('sos');
    renderIncident();
    renderHistory();
  } catch (error) {
    toast(error.message, 'danger');
  }
}

async function resolveIncident() {
  if (!state.incident) return;
  try {
    await api(`/api/incidents/${state.incident.id}/resolve`, { method: 'POST' });
    state.incident = null;
    document.getElementById('navSosBadge').classList.add('hide');
    toast('Incident marked resolved — added to history', 'ok');
    renderIncident();
    await loadHistory();
    go('dashboard');
  } catch (error) {
    toast(error.message, 'danger');
  }
}

function renderIncident() {
  const inc = state.incident;
  const empty = document.getElementById('sosEmptyState');
  const active = document.getElementById('sosActiveState');

  if (!inc) {
    empty.classList.remove('hide');
    active.classList.add('hide');
    return;
  }

  empty.classList.add('hide');
  active.classList.remove('hide');

  document.getElementById('incId').textContent = '#' + inc.id;
  const pClass = inc.priority === 'high' ? 'chip-sos' : inc.priority === 'medium' ? 'chip-amber' : 'chip-muted';
  const pLabel = inc.priority ? inc.priority[0].toUpperCase() + inc.priority.slice(1) + ' priority' : 'High priority';
  document.getElementById('incPriorityChip').className = 'chip ' + pClass;
  document.getElementById('incPriorityChip').textContent = pLabel;

  document.getElementById('incMeta').textContent = `${inc.type} · raised ${Math.max(0, Math.round((Date.now() - new Date(inc.createdAt).getTime()) / 60000))} min ago · ${CENTER.lat.toFixed(2)}, ${CENTER.lng.toFixed(2)}`;
  document.getElementById('etaTxt').textContent = `${inc.eta || 6} min`;

  const order = ['created', 'broadcast', 'assigned', 'enroute', 'resolved'];
  const currentStage = inc.status || 'assigned';
  order.forEach((stage, index) => {
    const e = document.getElementById('st-' + stage);
    e.classList.remove('done', 'now');
    const currentIndex = order.indexOf(currentStage);
    if (index < currentIndex) e.classList.add('done');
    else if (index === currentIndex) e.classList.add('now');
  });

  const chatEl = document.getElementById('chatMsgs');
  chatEl.innerHTML = (inc.chat || []).map((m) => `
    <div class="msg ${m.who === 'me' ? 'me' : 'them'}">
      ${m.who !== 'me' ? '<div class="who">Rakesh</div>' : ''}
      ${m.text}
    </div>
  `).join('');
  chatEl.scrollTop = chatEl.scrollHeight;

  const aiEl = document.getElementById('aiMsgs');
  aiEl.innerHTML = (inc.ai || []).map((m) => `
    <div class="msg ${m.who === 'me' ? 'me' : 'ai'}">
      ${m.who !== 'me' ? '<div class="who">AI assistant</div>' : ''}
      ${m.text}
    </div>
  `).join('');
  aiEl.scrollTop = aiEl.scrollHeight;

  document.getElementById('incTimeline').innerHTML = (inc.timeline || []).map((t) => `
    <div class="tl-item"><b>${t.label}</b><span>${t.t}</span></div>
  `).join('');
}

async function sendChat() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text || !state.incident) return;
  input.value = '';

  try {
    const data = await api(`/api/incidents/${state.incident.id}/chat`, { method: 'POST', body: JSON.stringify({ text }) });
    state.incident.chat = data.chat;
    renderIncident();
  } catch (error) {
    toast(error.message, 'danger');
  }
}

async function sendAi() {
  const input = document.getElementById('aiInput');
  const text = input.value.trim();
  if (!text || !state.incident) return;
  input.value = '';

  try {
    const data = await api(`/api/incidents/${state.incident.id}/ai`, { method: 'POST', body: JSON.stringify({ text }) });
    state.incident.ai = data.ai;
    renderIncident();
  } catch (error) {
    toast(error.message, 'danger');
  }
}

function renderGuardians() {
  const guardianList = document.getElementById('guardianList');
  guardianList.innerHTML = state.guardians.map((g) => `
    <div class="list-row"><div class="avatar" style="background:var(--teal)">${g.name.split(' ').map((s) => s[0]).slice(0, 2).join('')}</div>
    <div class="txt"><b>${g.name}</b><span>${g.relation}</span></div>
    <span class="chip ${g.status === 'online' ? 'chip-safe' : 'chip-muted'}">${g.status === 'online' ? 'Online' : 'Offline'}</span></div>
  `).join('');

  document.getElementById('wardList').innerHTML = `
    <div class="list-row"><div class="avatar" style="background:var(--amber)">KV</div>
    <div class="txt"><b>Kabir Verma</b><span>Last check-in 2 days ago</span></div>
    <span class="chip chip-safe">Safe</span></div>
  `;

  document.getElementById('welfareList').innerHTML = state.welfare.map((w) => `
    <div class="list-row"><div class="ico" style="background:var(--amber-tint)">💬</div>
    <div class="txt"><b>Check from ${w.from_name}</b><span>${w.time_label}</span></div>
    <button class="btn btn-primary btn-sm" onclick="answerWelfare(${w.id})">I'm safe</button></div>
  `).join('') || '<div class="empty" style="padding:16px;">No pending checks</div>';
}

async function answerWelfare(id) {
  try {
    await api(`/api/welfare/${id}/answer`, { method: 'POST' });
    toast('Marked as safe — guardian notified', 'ok');
    await loadInitialData();
  } catch (error) {
    toast(error.message, 'danger');
  }
}

async function addGuardian() {
  const input = document.getElementById('newGuardianName');
  const name = input.value.trim();
  if (!name) return;
  try {
    await api('/api/guardians', { method: 'POST', body: JSON.stringify({ name, relation: 'Guardian', status: 'offline' }) });
    input.value = '';
    toast('Guardian added', 'ok');
    await loadGuardians();
  } catch (error) {
    toast(error.message, 'danger');
  }
}

function renderResourceList() {
  const resList = document.getElementById('resList');
  resList.innerHTML = state.resources.map((r) => `
    <div class="list-row"><div class="ico" style="background:var(--teal-tint)">${r.type === 'hospital' ? '🏥' : r.type === 'police' ? '🚓' : '🚒'}</div>
    <div class="txt"><b>${r.name}</b><span>${r.type[0].toUpperCase() + r.type.slice(1)}</span></div>
    <div class="end"><span class="chip chip-neutral">${r.dist}</span></div></div>
  `).join('');
}

async function loadHistory() {
  try {
    const data = await api('/api/history');
    state.history = data.history;
    document.getElementById('statHistory').textContent = state.history.length;
    document.getElementById('historyBody').innerHTML = state.history.map((h) => `
      <tr><td class="mono">${h.id}</td><td>${h.type}</td>
      <td><span class="chip ${h.priority === 'High' ? 'chip-sos' : h.priority === 'Medium' ? 'chip-amber' : 'chip-muted'}">${h.priority}</span></td>
      <td>${h.responder}</td>
      <td><span class="chip ${h.status === 'Resolved' ? 'chip-safe' : 'chip-muted'}">${h.status}</span></td>
      <td>${h.date}</td><td><button class="btn btn-ghost btn-sm" onclick="toast('Report view is a planned feature','ok')">View</button></td></tr>
    `).join('');
  } catch (error) {
    toast(error.message, 'danger');
  }
}

async function loadModeration() {
  try {
    const data = await api('/api/moderation');
    state.moderation = data.moderation;
    document.getElementById('flaggedCount').textContent = state.moderation.filter((m) => m.status === 'Under review').length;
    document.getElementById('moderationBody').innerHTML = state.moderation.map((m, i) => `
      <tr><td class="mono">${m.incident_id || m.id}</td><td>${m.flagged_by || m.flaggedBy}</td><td>${m.reason}</td>
      <td><span class="chip ${m.status === 'Under review' ? 'chip-amber' : 'chip-muted'}">${m.status}</span></td>
      <td>${m.status === 'Under review' ? `<button class="btn btn-outline btn-sm" onclick="moderate(${i}, 'Dismissed')">Dismiss</button> <button class="btn btn-danger btn-sm" onclick="moderate(${i}, 'Confirmed false alert')">Confirm</button>` : ''}</td></tr>
    `).join('');
  } catch (error) {
    toast(error.message, 'danger');
  }
}

async function moderate(index, status) {
  const item = state.moderation[index];
  if (!item) return;
  try {
    await api(`/api/moderation/${item.id || index + 1}`, { method: 'POST', body: JSON.stringify({ status }) });
    state.moderation[index].status = status;
    await loadModeration();
    toast('Moderation decision recorded', 'ok');
  } catch (error) {
    toast(error.message, 'danger');
  }
}

function initDashMap() {
  if (window.__dashMap) return;
  const map = L.map('map', { zoomControl: false, attributionControl: false }).setView([CENTER.lat, CENTER.lng], 14);
  window.__dashMap = map;
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
  L.circleMarker([CENTER.lat, CENTER.lng], { radius: 7, color: '#d5273b', fillColor: '#d5273b', fillOpacity: 1 }).addTo(map);
  state.resources.forEach((r) => L.marker([r.lat, r.lng]).addTo(map).bindPopup(r.name));
}

function initLiveMap() {
  if (!document.getElementById('liveMap')) return;
  if (window.__liveMap) {
    window.__liveMap.invalidateSize();
    return;
  }
  const map = L.map('liveMap', { zoomControl: false, attributionControl: false }).setView([CENTER.lat, CENTER.lng], 14);
  window.__liveMap = map;
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
  L.circleMarker([CENTER.lat, CENTER.lng], { radius: 8, color: '#d5273b', fillColor: '#d5273b', fillOpacity: 1 }).addTo(map).bindPopup('You');
  L.circleMarker([CENTER.lat + 0.015, CENTER.lng - 0.01], { radius: 8, color: '#0e6e76', fillColor: '#0e6e76', fillOpacity: 1 }).addTo(map).bindPopup('Rakesh Kumar — responder');
  state.resources.slice(0, 3).forEach((r) => L.marker([r.lat, r.lng]).addTo(map).bindPopup(r.name));
}

function initResMap() {
  if (!document.getElementById('resMap')) return;
  if (window.__resMap) {
    window.__resMap.invalidateSize();
    return;
  }
  const map = L.map('resMap', { zoomControl: true, attributionControl: false }).setView([CENTER.lat, CENTER.lng], 13.5);
  window.__resMap = map;
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
  L.circleMarker([CENTER.lat, CENTER.lng], { radius: 7, color: '#d5273b', fillColor: '#d5273b', fillOpacity: 1 }).addTo(map).bindPopup('You');
  state.resources.forEach((r) => L.marker([r.lat, r.lng]).addTo(map).bindPopup(`<b>${r.name}</b><br>${r.type} · ${r.dist}`));
}

let chartsInited = false;
function initCharts() {
  if (chartsInited) return;
  chartsInited = true;
  new Chart(document.getElementById('chartType'), {
    type: 'doughnut',
    data: { labels: ['Medical', 'Safety threat', 'Accident', 'Fire', 'Other'], datasets: [{ data: [128, 74, 56, 22, 32], backgroundColor: ['#0e6e76', '#d5273b', '#b9760a', '#8b96a8', '#c7cedb'] }] },
    options: {
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
    },
  });

  new Chart(document.getElementById('chartTrend'), {
    type: 'bar',
    data: { labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], datasets: [{ label: 'Alerts', data: [38, 44, 29, 52, 61, 47, 41], backgroundColor: '#0e6e76', borderRadius: 4 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#eef0f4' } }, x: { grid: { display: false } } } },
  });
}

async function loadGuardians() {
  try {
    const data = await api('/api/guardians');
    state.guardians = data.guardians;
    renderGuardians();
  } catch (error) {
    toast(error.message, 'danger');
  }
}

async function loadWelfare() {
  try {
    const data = await api('/api/welfare');
    state.welfare = data.welfare;
    renderGuardians();
  } catch (error) {
    toast(error.message, 'danger');
  }
}

async function loadResources() {
  try {
    const data = await api('/api/resources');
    state.resources = data.resources;
    renderResourceList();
    setTimeout(initDashMap, 50);
    setTimeout(initResMap, 50);
  } catch (error) {
    toast(error.message, 'danger');
  }
}

async function loadIncident() {
  try {
    const data = await api('/api/incidents/active');
    state.incident = data.incident;
    document.getElementById('navSosBadge').classList.toggle('hide', !state.incident);
    renderIncident();
  } catch (error) {
    toast(error.message, 'danger');
  }
}

async function loadInitialData() {
  if (!state.token || !state.user) return;
  try {
    await Promise.all([loadResources(), loadGuardians(), loadWelfare(), loadHistory(), loadModeration(), loadIncident()]);
    renderAll();
  } catch (error) {
    toast(error.message, 'danger');
  }
}

function renderAll() {
  renderQueue();
  renderGuardians();
  renderResourceList();
  renderIncident();
  setTimeout(initDashMap, 50);
}

window.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('login').classList.remove('hide');
  document.getElementById('app').classList.remove('on');
  document.getElementById('offlineToggle').classList.add('on');
  setAuthTab('login');

  if (state.token) {
    try {
      const me = await api('/api/me');
      setLoggedIn(me.user, state.token);
    } catch (error) {
      localStorage.removeItem('nearhelp_token');
      state.token = '';
      toast('Session expired — please sign in again', 'danger');
    }
  }

  const socket = io();
  socket.on('incident:updated', (payload) => {
    if (!state.incident || payload.id === state.incident.id) {
      state.incident = { ...state.incident, ...payload };
      renderIncident();
    }
  });
});

window.setAuthTab = setAuthTab;
window.doAuth = doAuth;
window.demoLogin = demoLogin;
window.logout = logout;
window.go = go;
window.toggleOffline = toggleOffline;
window.openSosModal = openSosModal;
window.closeSosModal = closeSosModal;
window.confirmSos = confirmSos;
window.resolveIncident = resolveIncident;
window.sendChat = sendChat;
window.sendAi = sendAi;
window.answerWelfare = answerWelfare;
window.addGuardian = addGuardian;
window.moderate = moderate;
window.toast = toast;

window.onbeforeunload = () => {
  if (state.token) localStorage.setItem('nearhelp_token', state.token);
};






























































































































































































































































































































































