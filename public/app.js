const state = {
  room: null,
  user: null,
  events: null,
  typingTimer: null,
  sentTyping: false
};

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
        <span class="avatar" style="background:${user.color}">${escapeHtml(initials(user.name))}</span>
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
      <span class="avatar" style="background:${message.color}">${escapeHtml(initials(message.userName))}</span>
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
});

window.addEventListener("beforeunload", () => {
  if (!state.room || !state.user) return;
  navigator.sendBeacon(
    "/api/leave",
    new Blob([JSON.stringify({ code: state.room.code, userId: state.user.id })], { type: "application/json" })
  );
});
