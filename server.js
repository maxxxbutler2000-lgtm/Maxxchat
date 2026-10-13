const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const database = require('./database');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const rooms = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function cleanName(value) {
  const fallback = `Guest ${Math.floor(100 + Math.random() * 900)}`;
  return String(value || fallback).trim().replace(/\s+/g, " ").slice(0, 28) || fallback;
}

function cleanRoomCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function cleanMessage(value) {
  return String(value || "").replace(/\s+$/g, "").slice(0, 800);
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 4; i += 1) {
      code += alphabet[crypto.randomInt(alphabet.length)];
    }
  } while (rooms.has(code) || database.isDeleted(code));
  return code;
}

function makeUser(name) {
  return {
    id: crypto.randomUUID(),
    name: cleanName(name),
    color: `hsl(${Math.floor(Math.random() * 360)} 72% 48%)`,
    joinedAt: Date.now()
  };
}

function getRoom(code) {
  const room = rooms.get(cleanRoomCode(code));
  return room?.deleting ? undefined : room;
}

async function createRoom(account) {
  const code = makeRoomCode();
  const user = account;
  const room = {
    code,
    users: new Map([[user.id, user]]),
    messages: [],
    clients: new Map(),
    typing: new Map(),
    createdAt: Date.now(),
    lastActivity: Date.now()
  };
  rooms.set(code, room);
  try { await pushSystem(room, `${user.name} created the room.`); }
  catch (error) { rooms.delete(code); throw error; }
  return { room, user };
}

async function joinRoom(code, account) {
  const room = getRoom(code);
  if (!room) return null;
  const user = account;
  const existing = room.users.has(user.id);
  room.users.set(user.id, user);
  room.lastActivity = Date.now();
  if (!existing) await pushSystem(room, `${user.name} joined.`);
  else await database.saveRoom(room);
  return { room, user };
}

function roomPayload(room) {
  return {
    code: room.code,
    users: Array.from(room.users.values()).map((user) => ({
      id: user.id,
      name: user.name,
      color: user.color,
      avatar: user.avatar
    })),
    messages: room.messages.slice(-80),
    typing: Array.from(room.typing.values())
  };
}

async function pushSystem(room, text) {
  const message = {
    id: crypto.randomUUID(),
    type: "system",
    text,
    createdAt: Date.now()
  };
  room.messages.push(message);
  room.messages = room.messages.slice(-160);
  await database.saveRoom(room);
  broadcast(room, "message", message);
  broadcast(room, "state", roomPayload(room));
}

async function pushChat(room, user, text) {
  const message = {
    id: crypto.randomUUID(),
    type: "chat",
    text,
    userId: user.id,
    userName: user.name,
    color: user.color,
    avatar: user.avatar,
    createdAt: Date.now()
  };
  room.messages.push(message);
  room.messages = room.messages.slice(-160);
  room.lastActivity = Date.now();
  await database.saveRoom(room);
  broadcast(room, "message", message);
}

function broadcast(room, event, data) {
  const packet = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const response of room.clients.values()) {
    response.write(packet);
  }
}

function closeUserStreams(userId) {
  for (const room of rooms.values()) {
    for (const [id, response] of room.clients) {
      if (response.accountId === userId) { room.clients.delete(id); response.end(); }
    }
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 150_000) {
        request.destroy();
        reject(new Error("Body too large"));
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function handleApi(request, response, url) {
  if (request.method === 'POST' && request.headers.origin && request.headers.origin !== `${request.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${request.headers.host}`) {
    sendJson(response, 403, { error: 'Request origin is not allowed.' });
    return;
  }
  const secure = request.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  const setCookie = token => response.setHeader('Set-Cookie', `maxxchat_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${token ? 2592000 : 0}${secure ? '; Secure' : ''}`);
  if (request.method === 'POST' && ['/api/signup', '/api/login'].includes(url.pathname)) {
    const ip = request.socket.remoteAddress;
    const key = `${ip}:${url.pathname}`;
    const attempts = authAttempts.get(key) || { count: 0, until: Date.now() + 60000 };
    if (attempts.until < Date.now()) { attempts.count = 0; attempts.until = Date.now() + 60000; }
    attempts.count++;
    authAttempts.set(key, attempts);
    if (attempts.count > 30) { sendJson(response, 429, { error: 'Too many attempts. Wait one minute.' }); return; }
    const body = await readBody(request);
    const user = await (url.pathname === '/api/signup' ? database.signup(body) : database.login(body));
    setCookie(await database.session(user.id));
    sendJson(response, 200, { user });
    return;
  }
  const account = await database.account(request);
  if (url.pathname === '/api/me' && request.method === 'GET') { sendJson(response, 200, { user: account }); return; }
  if (!account) { sendJson(response, 401, { error: 'Please sign in first.' }); return; }
  if (url.pathname.startsWith('/api/admin/')) {
    if (!process.env.OWNER_ACCOUNT_ID || account.id !== process.env.OWNER_ACCOUNT_ID) {
      sendJson(response, 403, { error: 'This panel is only available to the owner.' }); return;
    }
    if (request.method === 'GET' && url.pathname === '/api/admin/rooms') {
      const offset = Number(url.searchParams.get('offset') || 0);
      if (!Number.isSafeInteger(offset) || offset < 0) { sendJson(response, 400, { error: 'Invalid page.' }); return; }
      const search = url.searchParams.get('search') || '';
      if (search.length > 120) { sendJson(response, 400, { error: 'Search is too long.' }); return; }
      sendJson(response, 200, await database.moderationRooms(offset, search)); return;
    }
    if (request.method === 'DELETE' && /^\/api\/admin\/rooms\/[A-Z0-9]{4}$/.test(url.pathname)) {
      const code = url.pathname.split('/').at(-1);
      const body = await readBody(request);
      if (body.confirmCode !== code) { sendJson(response, 400, { error: 'Confirm the room code before deleting.' }); return; }
      const room = getRoom(code);
      if (!room && !await database.moderationRoom(code)) { sendJson(response, 404, { error: 'Room not found.' }); return; }
      if (room) room.deleting = true;
      try { await database.deleteRoom(code); }
      catch (error) { if (room) room.deleting = false; throw error; }
      if (room) {
        broadcast(room, 'deleted', { code });
        for (const client of room.clients.values()) client.end();
        room.clients.clear();
      }
      rooms.delete(code);
      sendJson(response, 200, { deleted: true }); return;
    }
    if (request.method === 'GET' && /^\/api\/admin\/rooms\/[A-Z0-9]{4}$/.test(url.pathname)) {
      const time = Number(url.searchParams.get('time') || 0);
      const id = url.searchParams.get('id') || '00000000-0000-0000-0000-000000000000';
      if (!Number.isSafeInteger(time) || time < 0 || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) { sendJson(response, 400, { error: 'Invalid message page.' }); return; }
      const room = await database.moderationRoom(url.pathname.split('/').at(-1), time, id);
      sendJson(response, room ? 200 : 404, room || { error: 'Room is outside the 48-hour review window.' }); return;
    }
    sendJson(response, 404, { error: 'Not found.' }); return;
  }
  if (url.pathname.startsWith('/api/avatar/') && request.method === 'GET') {
    const image = await database.avatar(url.pathname.slice('/api/avatar/'.length));
    if (!image) { response.writeHead(404); response.end(); return; }
    const [header, bytes] = image.split(',');
    response.writeHead(200, { 'Content-Type': header.slice(5, header.indexOf(';')), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(Buffer.from(bytes, 'base64'));
    return;
  }
  if (url.pathname === '/api/logout' && request.method === 'POST') {
    await database.logout(request); closeUserStreams(account.id); setCookie(''); sendJson(response, 200, { ok: true }); return;
  }
  if (url.pathname === '/api/profile' && request.method === 'POST') {
    const user = await database.profile(account.id, await readBody(request));
    for (const room of rooms.values()) {
      if (room.users.has(user.id)) {
        room.users.set(user.id, user);
        await database.saveRoom(room);
        broadcast(room, 'state', roomPayload(room));
      }
    }
    sendJson(response, 200, { user }); return;
  }
  if (url.pathname === '/api/my-rooms' && request.method === 'GET') {
    sendJson(response, 200, { rooms: [...rooms.values()].filter(room => room.users.has(account.id)).map(room => ({ code: room.code, lastActivity: room.lastActivity })) }); return;
  }
  if (request.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readBody(request);
    const { room, user } = await createRoom(account);
    sendJson(response, 201, { room: roomPayload(room), user });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/join") {
    const body = await readBody(request);
    const joined = await joinRoom(body.code, account);
    if (!joined) {
      sendJson(response, 404, { error: "No room found for that code." });
      return;
    }
    sendJson(response, 200, { room: roomPayload(joined.room), user: joined.user });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/events") {
    const code = cleanRoomCode(url.searchParams.get("code"));
    const userId = account.id;
    const room = getRoom(code);
    if (!room || !room.users.has(userId)) {
      sendJson(response, 404, { error: "Room or user not found." });
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    response.write(`event: state\ndata: ${JSON.stringify(roomPayload(room))}\n\n`);
    const connectionId = crypto.randomUUID();
    response.accountId = userId;
    room.clients.set(connectionId, response);
    let checkingSession = false;
    const heartbeat = setInterval(async () => {
      if (checkingSession) return;
      checkingSession = true;
      try {
        if (!await database.account(request) || !room.users.has(userId)) response.end();
        else response.write(': heartbeat\n\n');
      } catch { response.end(); }
      finally { checkingSession = false; }
    }, 20000);

    request.on("close", () => {
      clearInterval(heartbeat);
      room.clients.delete(connectionId);
      room.typing.delete(userId);
      broadcast(room, "state", roomPayload(room));
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/messages") {
    const body = await readBody(request);
    const room = getRoom(body.code);
    const user = room && room.users.get(account.id);
    const text = cleanMessage(body.text);
    if (!room || !user) {
      sendJson(response, 404, { error: "Room or user not found." });
      return;
    }
    if (!text) {
      sendJson(response, 400, { error: "Message cannot be empty." });
      return;
    }
    room.typing.delete(user.id);
    await pushChat(room, user, text);
    broadcast(room, "state", roomPayload(room));
    sendJson(response, 201, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/typing") {
    const body = await readBody(request);
    const room = getRoom(body.code);
    const user = room && room.users.get(account.id);
    if (!room || !user) {
      sendJson(response, 404, { error: "Room or user not found." });
      return;
    }
    if (body.isTyping) {
      room.typing.set(user.id, user.name);
      setTimeout(() => {
        room.typing.delete(user.id);
        broadcast(room, "state", roomPayload(room));
      }, 4500);
    } else {
      room.typing.delete(user.id);
    }
    broadcast(room, "state", roomPayload(room));
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/leave") {
    const body = await readBody(request);
    const room = getRoom(body.code);
    const user = room && room.users.get(account.id);
    if (room && user) {
      room.users.delete(user.id);
      room.typing.delete(user.id);
      await pushSystem(room, `${user.name} left.`);
      closeUserStreams(user.id);
    }
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 404, { error: "Not found." });
}

function serveStatic(request, response, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(content);
  });
}

const authAttempts = new Map();
let mutations = Promise.resolve();
const server = http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      // Serialize room mutations so persisted snapshots cannot arrive out of order.
      if (['POST', 'DELETE'].includes(request.method) && !['/api/login', '/api/signup'].includes(url.pathname)) {
        const operation = mutations.then(() => handleApi(request, response, url));
        mutations = operation.catch(() => {});
        await operation;
      } else await handleApi(request, response, url);
    } else {
      serveStatic(request, response, url);
    }
  } catch (error) {
    console.error('Request failed:', error.code || error.name);
    if (!response.headersSent) sendJson(response, error.status || (error instanceof SyntaxError ? 400 : 500), { error: error.status ? error.message : 'Something went wrong. Please try again.' });
  }
});

setInterval(() => {
  for (const [key, entry] of authAttempts) if (entry.until < Date.now()) authAttempts.delete(key);
}, 1000 * 60 * 30).unref();
setInterval(() => database.pruneModeration().catch(() => console.error('Moderation cleanup failed')), 5 * 60 * 1000).unref();

database.initialize().then(saved => {
  for (const room of saved) rooms.set(room.code, { ...room, users: new Map(room.users.map(user => [user.id, user])), clients: new Map(), typing: new Map() });
  server.listen(PORT, () => console.log(`Maxxchat running at http://localhost:${PORT}`));
}).catch(error => { console.error('Database startup failed:', error.message); process.exit(1); });
