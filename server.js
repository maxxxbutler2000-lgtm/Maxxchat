const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

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
    for (let i = 0; i < 6; i += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  } while (rooms.has(code));
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
  return rooms.get(cleanRoomCode(code));
}

function createRoom(ownerName) {
  const code = makeRoomCode();
  const user = makeUser(ownerName);
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
  pushSystem(room, `${user.name} created the room.`);
  return { room, user };
}

function joinRoom(code, name) {
  const room = getRoom(code);
  if (!room) return null;
  const user = makeUser(name);
  room.users.set(user.id, user);
  room.lastActivity = Date.now();
  pushSystem(room, `${user.name} joined.`);
  return { room, user };
}

function roomPayload(room) {
  return {
    code: room.code,
    users: Array.from(room.users.values()).map((user) => ({
      id: user.id,
      name: user.name,
      color: user.color
    })),
    messages: room.messages.slice(-80),
    typing: Array.from(room.typing.values())
  };
}

function pushSystem(room, text) {
  const message = {
    id: crypto.randomUUID(),
    type: "system",
    text,
    createdAt: Date.now()
  };
  room.messages.push(message);
  broadcast(room, "message", message);
  broadcast(room, "state", roomPayload(room));
}

function pushChat(room, user, text) {
  const message = {
    id: crypto.randomUUID(),
    type: "chat",
    text,
    userId: user.id,
    userName: user.name,
    color: user.color,
    createdAt: Date.now()
  };
  room.messages.push(message);
  room.messages = room.messages.slice(-160);
  room.lastActivity = Date.now();
  broadcast(room, "message", message);
}

function broadcast(room, event, data) {
  const packet = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const response of room.clients.values()) {
    response.write(packet);
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
      if (body.length > 10_000) {
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
  if (request.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readBody(request);
    const { room, user } = createRoom(body.name);
    sendJson(response, 201, { room: roomPayload(room), user });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/join") {
    const body = await readBody(request);
    const joined = joinRoom(body.code, body.name);
    if (!joined) {
      sendJson(response, 404, { error: "No room found for that code." });
      return;
    }
    sendJson(response, 200, { room: roomPayload(joined.room), user: joined.user });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/events") {
    const code = cleanRoomCode(url.searchParams.get("code"));
    const userId = url.searchParams.get("userId");
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
    room.clients.set(userId, response);

    request.on("close", () => {
      room.clients.delete(userId);
      room.typing.delete(userId);
      broadcast(room, "state", roomPayload(room));
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/messages") {
    const body = await readBody(request);
    const room = getRoom(body.code);
    const user = room && room.users.get(body.userId);
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
    pushChat(room, user, text);
    broadcast(room, "state", roomPayload(room));
    sendJson(response, 201, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/typing") {
    const body = await readBody(request);
    const room = getRoom(body.code);
    const user = room && room.users.get(body.userId);
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
    const user = room && room.users.get(body.userId);
    if (room && user) {
      room.users.delete(user.id);
      room.typing.delete(user.id);
      room.clients.delete(user.id);
      pushSystem(room, `${user.name} left.`);
      if (room.users.size === 0) rooms.delete(room.code);
    }
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 404, { error: "Not found." });
}

function serveStatic(request, response, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
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

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
    } else {
      serveStatic(request, response, url);
    }
  } catch (error) {
    sendJson(response, 500, { error: "Something went wrong." });
  }
});

setInterval(() => {
  const staleBefore = Date.now() - 1000 * 60 * 60 * 6;
  for (const [code, room] of rooms.entries()) {
    if (room.lastActivity < staleBefore && room.users.size === 0) rooms.delete(code);
  }
}, 1000 * 60 * 30).unref();

server.listen(PORT, () => {
  console.log(`Chatroom running at http://localhost:${PORT}`);
});
