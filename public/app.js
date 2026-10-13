const state = {
  room: null,
  user: null,
  events: null,
  typingTimer: null,
  sentTyping: false
};
let account = null;
let signupMode = false;
let newAvatar;
const byId = id => document.getElementById(id);

const entryView = document.querySelector("#entryView");
const chatView = document.querySelector("#chatView");
const joinForm = document.querySelector("#joinForm");
const nameInput = document.querySelector("#nameInput");
const codeInput = document.querySelector("#codeInput");
const createRoomButton = document.querySelector("#createRoomButton");
const formError = document.querySelector("#formError");
const roomCode = document.querySelector("#roomCode");
const shareHint = document.querySelector("#shareHint");
const copyCodeButton = document.querySelector("#copyCodeButton");
const memberList = document.querySelector("#memberList");
const chatTitle = document.querySelector("#chatTitle");
const statusPill = document.querySelector("#statusPill");
const messages = document.querySelector("#messages");
const typingLine = document.querySelector("#typingLine");
const messageForm = document.querySelector("#messageForm");
const messageInput = document.querySelector("#messageInput");
const leaveButton = document.querySelector("#leaveButton");

function setError(text = "") {
  formError.textContent = text;
}

codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
});

function initials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function avatarContent(user) {
  return user.avatar ? `<img src="${escapeHtml(user.avatar)}" alt="" loading="lazy">` : escapeHtml(initials(user.name));
}

function timeLabel(timestamp) {
  return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "That did not work.");
  return data;
}

function enterRoom(room, user) {
  state.room = room;
  state.user = user;
  entryView.classList.add("hidden");
  chatView.classList.remove("hidden");
  roomCode.textContent = room.code;
  chatTitle.textContent = `# ${room.code}`;
  renderState(room);
  connectEvents();
  messageInput.focus();
}

function connectEvents() {
  if (state.events) state.events.close();
  const params = new URLSearchParams({ code: state.room.code, userId: state.user.id });
  const events = new EventSource(`/api/events?${params}`);
  state.events = events;
  statusPill.textContent = "Connected";

  events.addEventListener("state", (event) => {
    renderState(JSON.parse(event.data));
  });

  events.addEventListener("message", (event) => {
    appendMessage(JSON.parse(event.data));
  });

  events.onerror = () => {
    statusPill.textContent = "Reconnecting";
  };
}

function renderState(room) {
  state.room = { ...state.room, ...room };
  memberList.innerHTML = room.users
    .map((user) => `
      <li class="member">
        <span class="avatar" style="background:${user.color}">${avatarContent(user)}</span>
        <span>${escapeHtml(user.name)}${user.id === state.user.id ? " (you)" : ""}</span>
      </li>
    `)
    .join("");

  messages.innerHTML = "";
  room.messages.forEach(appendMessage);
  renderTyping(room.typing || []);
}

function appendMessage(message) {
  if (document.querySelector(`[data-message-id="${message.id}"]`)) return;

  const shouldStick = messages.scrollTop + messages.clientHeight >= messages.scrollHeight - 80;
  const element = document.createElement("div");
  element.dataset.messageId = message.id;

  if (message.type === "system") {
    element.className = "system-message";
    element.textContent = message.text;
  } else {
    const own = message.userId === state.user.id;
    element.className = `message${own ? " own" : ""}`;
    element.innerHTML = `
      <span class="avatar" style="background:${message.color}">${avatarContent(roomUser(message))}</span>
      <div class="bubble">
        <div class="message-meta">
          <span class="message-name">${escapeHtml(message.userName)}</span>
          <span class="message-time">${timeLabel(message.createdAt)}</span>
        </div>
        <p class="message-text">${escapeHtml(message.text)}</p>
      </div>
    `;
  }

  messages.appendChild(element);
  if (shouldStick) messages.scrollTop = messages.scrollHeight;
}

function roomUser(message) {
  return state.room.users.find(user => user.id === message.userId) || { name: message.userName, avatar: message.avatar };
}

function renderTyping(typing) {
  const others = typing.filter((name) => name !== state.user.name);
  if (others.length === 0) {
    typingLine.textContent = "";
  } else if (others.length === 1) {
    typingLine.textContent = `${others[0]} is typing...`;
  } else {
    typingLine.textContent = `${others.slice(0, 2).join(", ")} are typing...`;
  }
}

async function sendTyping(isTyping) {
  if (!state.room || !state.user) return;
  await api("/api/typing", {
    code: state.room.code,
    userId: state.user.id,
    isTyping
  }).catch(() => {});
}

createRoomButton.addEventListener("click", async () => {
  setError();
  createRoomButton.disabled = true;
  try {
    const data = await api("/api/rooms", { name: nameInput.value });
    enterRoom(data.room, data.user);
  } catch (error) {
    setError(error.message);
  } finally {
    createRoomButton.disabled = false;
  }
});

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError();
  const code = codeInput.value.trim().toUpperCase();
  if (!code) {
    setError("Enter a room code first.");
    return;
  }
  try {
    const data = await api("/api/join", { code, name: nameInput.value });
    enterRoom(data.room, data.user);
  } catch (error) {
    setError(error.message);
  }
});

copyCodeButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.room.code);
  shareHint.textContent = "Copied. Send it to whoever you want in here.";
  setTimeout(() => {
    shareHint.textContent = "Share this code with someone else.";
  }, 2200);
});

messageInput.addEventListener("input", () => {
  if (!state.sentTyping) {
    state.sentTyping = true;
    sendTyping(true);
  }
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => {
    state.sentTyping = false;
    sendTyping(false);
  }, 1200);
});

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  messageInput.value = "";
  state.sentTyping = false;
  clearTimeout(state.typingTimer);
  await api("/api/messages", {
    code: state.room.code,
    userId: state.user.id,
    text
  }).catch((error) => {
    messageInput.value = text;
    alert(error.message);
  });
});

leaveButton.addEventListener("click", async () => {
  await api("/api/leave", { code: state.room.code, userId: state.user.id }).catch(() => {});
  if (state.events) state.events.close();
  state.room = null;
  state.user = null;
  chatView.classList.add("hidden");
  entryView.classList.remove("hidden");
  messages.innerHTML = "";
  codeInput.value = "";
  statusPill.textContent = "Connecting";
  refreshRooms().catch(() => {});
});

async function refreshRooms() {
  const response = await fetch('/api/my-rooms');
  if (!response.ok) return;
  const data = await response.json();
  byId('savedRooms').replaceChildren();
  if (data.rooms.length) {
    const title = document.createElement('h3'); title.textContent = 'Your rooms'; byId('savedRooms').append(title);
  }
  for (const room of data.rooms.sort((a, b) => b.lastActivity - a.lastActivity)) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'secondary-button'; button.textContent = `# ${room.code}`;
    button.addEventListener('click', async () => {
      try { const data = await api('/api/join', { code: room.code }); enterRoom(data.room, data.user); }
      catch (error) { setError(error.message); }
    });
    byId('savedRooms').append(button);
  }
}
function showAccount(user) {
  account = user;
  byId('accountView').classList.toggle('hidden', !!user);
  byId('accountToolbar').classList.toggle('hidden', !user);
  entryView.classList.toggle('hidden', !user);
  if (user) { nameInput.value = user.name; refreshRooms().catch(() => setError('Could not load saved rooms.')); }
}
function authMode(signup) {
  signupMode = signup;
  byId('signupNameLabel').classList.toggle('hidden', !signup);
  byId('signupName').required = signup;
  byId('passwordInput').autocomplete = signup ? 'new-password' : 'current-password';
  byId('authSubmit').textContent = signup ? 'Create account' : 'Sign in';
  byId('loginTab').setAttribute('aria-selected', String(!signup));
  byId('signupTab').setAttribute('aria-selected', String(signup));
  byId('authError').textContent = '';
}
byId('loginTab').addEventListener('click', () => authMode(false));
byId('signupTab').addEventListener('click', () => authMode(true));
byId('authForm').addEventListener('submit', async event => {
  event.preventDefault(); byId('authSubmit').disabled = true; byId('authError').textContent = '';
  try {
    const data = await api(signupMode ? '/api/signup' : '/api/login', { email: byId('emailInput').value, password: byId('passwordInput').value, name: byId('signupName').value });
    byId('passwordInput').value = ''; showAccount(data.user);
  } catch (error) { byId('authError').textContent = error.message; }
  finally { byId('authSubmit').disabled = false; }
});
byId('logoutButton').addEventListener('click', async () => {
  try {
    await api('/api/logout', {});
    state.events?.close(); state.room = null; state.user = null;
    chatView.classList.add('hidden'); showAccount(null);
  } catch (error) { alert(error.message); }
});
function profilePreview(src) {
  const preview = byId('profilePreview'); preview.replaceChildren(); preview.style.background = account.color;
  if (src) { const img = document.createElement('img'); img.src = src; img.alt = ''; preview.append(img); }
  else preview.textContent = initials(byId('profileName').value || account.name);
}
byId('profileButton').addEventListener('click', () => {
  byId('profileAccountId').textContent = `Account ID: ${account.id}`;
  newAvatar = undefined; byId('avatarInput').value = ''; byId('profileName').value = account.name;
  byId('profileError').textContent = ''; profilePreview(account.avatar ? `${account.avatar}?v=${Date.now()}` : null); byId('profileDialog').showModal();
});
byId('closeProfile').addEventListener('click', () => byId('profileDialog').close());
byId('removeAvatar').addEventListener('click', () => { newAvatar = null; byId('avatarInput').value = ''; profilePreview(null); });
byId('avatarInput').addEventListener('change', async () => {
  const file = byId('avatarInput').files[0]; if (!file) return;
  byId('saveProfile').disabled = true; byId('profileError').textContent = '';
  try {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5000000) throw new Error('Choose a PNG, JPEG, or WebP under 5 MB.');
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 192;
    const size = Math.min(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 192, 192);
    bitmap.close(); newAvatar = canvas.toDataURL('image/jpeg', .8); profilePreview(newAvatar);
  } catch (error) { byId('profileError').textContent = error.message; }
  finally { byId('saveProfile').disabled = false; }
});
byId('profileForm').addEventListener('submit', async event => {
  event.preventDefault(); byId('saveProfile').disabled = true;
  try {
    const body = { name: byId('profileName').value };
    if (newAvatar !== undefined) body.avatar = newAvatar;
    const data = await api('/api/profile', body); account = data.user; nameInput.value = account.name;
    if (state.user) state.user = account;
    byId('profileDialog').close();
  } catch (error) { byId('profileError').textContent = error.message; }
  finally { byId('saveProfile').disabled = false; }
});
fetch('/api/me').then(response => { if (!response.ok) throw new Error(); return response.json(); }).then(data => showAccount(data.user)).catch(() => { byId('authError').textContent = 'Cannot connect to Maxxchat. Please reload.'; });

let secretBuffer = '';
let secretTime = 0;
let adminOffset = null;
let adminCursor = null;
let adminCode = null;
let adminVersion = 0;
async function adminGet(path) {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load moderation history.');
  return data;
}
async function loadAdminRooms(append = false) {
  byId('refreshAdmin').disabled = true; byId('moreAdminRooms').disabled = true;
  byId('adminError').textContent = '';
  try {
    const data = await adminGet(`/api/admin/rooms?offset=${append ? adminOffset : 0}`);
    if (!append) byId('adminRooms').replaceChildren();
    for (const room of data.rooms) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button';
      button.textContent = `# ${room.code}`; button.title = new Date(room.createdAt).toLocaleString();
      button.dataset.code = room.code; button.addEventListener('click', () => loadAdminRoom(room.code));
      byId('adminRooms').append(button);
    }
    if (!data.rooms.length && !append) byId('adminRooms').textContent = 'No rooms in this window.';
    adminOffset = data.nextOffset; byId('moreAdminRooms').classList.toggle('hidden', adminOffset === null);
  } catch (error) { byId('adminError').textContent = error.message; }
  finally { byId('refreshAdmin').disabled = false; byId('moreAdminRooms').disabled = false; }
}
async function loadAdminRoom(code, append = false) {
  const version = ++adminVersion;
  byId('adminError').textContent = ''; byId('moreAdminMessages').disabled = true;
  try {
    const query = append && adminCursor ? `?time=${adminCursor.time}&id=${adminCursor.id}` : '';
    const data = await adminGet(`/api/admin/rooms/${code}${query}`);
    if (version !== adminVersion || !byId('adminDialog').open) return;
    adminCode = code; adminCursor = data.next;
    byId('adminRoomTitle').textContent = `# ${code} - ${new Date(data.createdAt).toLocaleString()}`;
    byId('adminPeople').replaceChildren();
    for (const person of data.people) {
      const row = document.createElement('div'); row.className = 'moderation-person';
      const name = document.createElement('strong'); name.textContent = person.name;
      const id = document.createElement('small'); id.textContent = `Account: ${person.id}`;
      row.append(name, id); byId('adminPeople').append(row);
    }
    if (!append) byId('adminMessages').replaceChildren();
    for (const message of data.messages) {
      const row = document.createElement('div'); row.className = 'audit-message';
      const name = document.createElement('strong'); name.textContent = message.type === 'system' ? 'Room event' : message.userName;
      const stamp = document.createElement('small'); stamp.textContent = `${new Date(message.createdAt).toLocaleString()}${message.userId ? ` | Account: ${message.userId}` : ''}`;
      const text = document.createElement('p'); text.textContent = message.text;
      row.append(name, stamp, text); byId('adminMessages').append(row);
    }
    byId('moreAdminMessages').classList.toggle('hidden', !adminCursor);
    for (const button of byId('adminRooms').querySelectorAll('button')) button.setAttribute('aria-current', String(button.dataset.code === code));
  } catch (error) { if (version === adminVersion) byId('adminError').textContent = error.message; }
  finally { if (version === adminVersion) byId('moreAdminMessages').disabled = false; }
}
document.addEventListener('keydown', event => {
  if (event.target?.type === 'password' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  if (Date.now() - secretTime > 3000) secretBuffer = '';
  secretTime = Date.now();
  if (event.key.length !== 1) { secretBuffer = ''; return; }
  secretBuffer = (secretBuffer + event.key.toLowerCase()).slice(-11);
  if (secretBuffer !== 'secretpanel') return;
  secretBuffer = '';
  if (!account?.isAdmin) return;
  if (byId('profileDialog').open) byId('profileDialog').close();
  if (!byId('adminDialog').open) byId('adminDialog').showModal();
  loadAdminRooms();
});
byId('closeAdmin').addEventListener('click', () => byId('adminDialog').close());
byId('adminDialog').addEventListener('close', () => { adminVersion++; byId('adminMessages').replaceChildren(); byId('adminPeople').replaceChildren(); adminCursor = null; adminCode = null; });
byId('refreshAdmin').addEventListener('click', () => { loadAdminRooms(); if (adminCode) loadAdminRoom(adminCode); });
byId('moreAdminRooms').addEventListener('click', () => loadAdminRooms(true));
byId('moreAdminMessages').addEventListener('click', () => { if (adminCode) loadAdminRoom(adminCode, true); });
