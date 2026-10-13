const { Pool } = require('pg');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const committedRooms = new Map();

function publicAccount(row) {
  return { id: row.id, name: row.name, avatar: row.avatar ? `/api/avatar/${row.id}` : null, color: row.color, isAdmin: !!process.env.OWNER_ACCOUNT_ID && row.id === process.env.OWNER_ACCOUNT_ID };
}
function credentials(body) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw Object.assign(new Error('Enter a valid email address.'), { status: 400 });
  if (password.length < 10 || password.length > 128) throw Object.assign(new Error('Use a password between 10 and 128 characters.'), { status: 400 });
  return { email, password };
}
async function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}
async function passwordMatches(password, encoded) {
  const [salt, hash] = encoded.split(':');
  const actual = await passwordHash(password, salt);
  return crypto.timingSafeEqual(Buffer.from(actual.split(':')[1], 'hex'), Buffer.from(hash, 'hex'));
}
async function initialize() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Connect Railway PostgreSQL before starting Maxxchat.');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id UUID PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      name TEXT NOT NULL, avatar TEXT, color TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_rooms (code TEXT PRIMARY KEY, payload JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS moderation_rooms (code TEXT PRIMARY KEY, created_at BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS moderation_people (
      room_code TEXT REFERENCES moderation_rooms(code) ON DELETE CASCADE,
      account_id UUID, name TEXT NOT NULL, PRIMARY KEY(room_code,account_id)
    );
    CREATE TABLE IF NOT EXISTS moderation_messages (
      id UUID PRIMARY KEY, room_code TEXT NOT NULL REFERENCES moderation_rooms(code) ON DELETE CASCADE,
      created_at BIGINT NOT NULL, payload JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS moderation_time ON moderation_messages(room_code,created_at,id);
    DELETE FROM sessions WHERE expires_at < NOW();
  `);
  const rooms = (await pool.query('SELECT payload FROM chat_rooms')).rows.map(row => row.payload);
  for (const room of rooms) await saveRoom({ ...room, users: new Map(room.users.map(user => [user.id, user])) });
  await pruneModeration();
  return rooms;
}
async function signup(body) {
  const { email, password } = credentials(body);
  const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 28);
  if (!name) throw Object.assign(new Error('Enter a display name.'), { status: 400 });
  const hash = await passwordHash(password);
  try {
    const result = await pool.query('INSERT INTO accounts(id,email,password_hash,name,color) VALUES($1,$2,$3,$4,$5) RETURNING *', [crypto.randomUUID(), email, hash, name, `hsl(${crypto.randomInt(360)} 72% 48%)`]);
    return publicAccount(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') throw Object.assign(new Error('This email is already registered. Sign in instead.'), { status: 409 });
    throw error;
  }
}
async function login(body) {
  const { email, password } = credentials(body);
  const row = (await pool.query('SELECT * FROM accounts WHERE email=$1', [email])).rows[0];
  // Run scrypt even for unknown emails to avoid a cheap account-enumeration timing signal.
  const valid = await passwordMatches(password, row?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`);
  if (!row || !valid) throw Object.assign(new Error('Email or password is incorrect.'), { status: 401 });
  return publicAccount(row);
}
function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
async function session(accountId) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query("INSERT INTO sessions VALUES($1,$2,NOW() + INTERVAL '30 days')", [tokenHash(token), accountId]);
  return token;
}
function cookieToken(request) {
  return /(?:^|;\s*)maxxchat_session=([a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie || '')?.[1];
}
async function account(request) {
  const token = cookieToken(request);
  if (!token) return null;
  const result = await pool.query('SELECT a.* FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>NOW()', [tokenHash(token)]);
  return result.rows[0] ? publicAccount(result.rows[0]) : null;
}
async function logout(request) {
  const token = cookieToken(request);
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(token)]);
}
async function profile(id, body) {
  const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 28);
  if (!name) throw Object.assign(new Error('Enter a display name.'), { status: 400 });
  const avatar = body.avatar === undefined ? undefined : body.avatar || null;
  if (avatar !== undefined && avatar !== null && (typeof avatar !== 'string' || avatar.length > 120000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(avatar))) {
    throw Object.assign(new Error('Choose a smaller PNG, JPEG, or WebP picture.'), { status: 400 });
  }
  return publicAccount((await pool.query('UPDATE accounts SET name=$2,avatar=CASE WHEN $4 THEN avatar ELSE $3 END WHERE id=$1 RETURNING *', [id, name, avatar ?? null, avatar === undefined])).rows[0]);
}
async function saveRoom(room) {
  const payload = { code: room.code, users: [...room.users.values()], messages: room.messages.slice(-160), createdAt: room.createdAt, lastActivity: room.lastActivity };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO chat_rooms VALUES($1,$2) ON CONFLICT(code) DO UPDATE SET payload=EXCLUDED.payload', [room.code, JSON.stringify(payload)]);
    if (room.createdAt >= Date.now() - 48 * 60 * 60 * 1000) {
      await client.query('INSERT INTO moderation_rooms VALUES($1,$2) ON CONFLICT(code) DO NOTHING', [room.code, room.createdAt]);
      const previous = committedRooms.get(room.code);
      const knownMessages = new Set((previous?.messages || []).map(message => message.id));
      for (const message of room.messages) {
        if (knownMessages.has(message.id)) continue;
        await client.query('INSERT INTO moderation_messages VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING', [message.id, room.code, message.createdAt, JSON.stringify(message)]);
      }
      for (const user of room.users.values()) {
        const oldUser = previous?.users.find(old => old.id === user.id);
        if (oldUser?.name === user.name) continue;
        await client.query('INSERT INTO moderation_people VALUES($1,$2,$3) ON CONFLICT(room_code,account_id) DO UPDATE SET name=EXCLUDED.name', [room.code, user.id, user.name]);
      }
    }
    await client.query('COMMIT');
    committedRooms.set(room.code, structuredClone(payload));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    const previous = committedRooms.get(room.code);
    if (previous) {
      room.users = new Map(previous.users.map(user => [user.id, user]));
      room.messages = structuredClone(previous.messages);
      room.lastActivity = previous.lastActivity;
    }
    throw error;
  } finally { client.release(); }
}
async function pruneModeration() {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  await pool.query('DELETE FROM moderation_rooms WHERE created_at < $1', [cutoff]);
}
async function moderationRooms(offset = 0) {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const rows = (await pool.query('SELECT code,created_at FROM moderation_rooms WHERE created_at >= $1 ORDER BY created_at DESC,code LIMIT 51 OFFSET $2', [cutoff, offset])).rows;
  return { rooms: rows.slice(0, 50).map(row => ({ code: row.code, createdAt: Number(row.created_at) })), nextOffset: rows.length > 50 ? offset + 50 : null };
}
async function moderationRoom(code, afterTime = 0, afterId = '00000000-0000-0000-0000-000000000000') {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const room = (await pool.query('SELECT code,created_at FROM moderation_rooms WHERE code=$1 AND created_at >= $2', [code, cutoff])).rows[0];
  if (!room) return null;
  const people = (await pool.query('SELECT account_id,name FROM moderation_people WHERE room_code=$1 ORDER BY name,account_id', [code])).rows;
  const rows = (await pool.query('SELECT payload FROM moderation_messages WHERE room_code=$1 AND (created_at>$2 OR (created_at=$2 AND id>$3)) ORDER BY created_at,id LIMIT 201', [code, afterTime, afterId])).rows;
  const messages = rows.slice(0, 200).map(row => row.payload);
  const last = messages.at(-1);
  return { code, createdAt: Number(room.created_at), people: people.map(row => ({ id: row.account_id, name: row.name })), messages, next: rows.length > 200 ? { time: last.createdAt, id: last.id } : null };
}
async function avatar(id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) return null;
  return (await pool.query('SELECT avatar FROM accounts WHERE id=$1', [id])).rows[0]?.avatar;
}
module.exports = { initialize, signup, login, session, account, logout, profile, saveRoom, avatar, passwordHash, passwordMatches, credentials, pool, moderationRooms, moderationRoom, pruneModeration };
