const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
test('HTTP account flow enforces cookies and room membership', async () => {
  const port = 19489;
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'memory-db.cjs'), path.join(__dirname, '../server.js')], { env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('exit', code => reject(new Error(`Server exited ${code}`))); child.once('error', reject); });
    async function request(route, body, cookie, method = body ? 'POST' : 'GET') {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], data: await response.json() };
    }
    assert.equal((await request('/api/rooms', {})).status, 401);
    const signup = await request('/api/signup', { email: 'alice@example.test', name: 'Alice', password: 'long test password' });
    assert.equal(signup.status, 200); assert.ok(signup.cookie);
    const cookie = signup.cookie;
    assert.equal((await request('/api/admin/rooms', null, cookie)).status, 403);
    assert.equal((await request('/api/admin/rooms')).status, 401);
    assert.equal((await request('/api/me', null, cookie)).data.user.name, 'Alice');
    const created = await request('/api/rooms', {}, cookie); assert.equal(created.status, 201);
    const code = created.data.room.code; assert.equal(code.length, 4);
    assert.equal((await request(`/api/room?code=${code}`, null, cookie)).data.room.code, code);
    assert.equal((await request(`/api/admin/rooms/${code}`, { confirmCode: code }, cookie, 'DELETE')).status, 403);
    assert.equal((await request(`/api/admin/rooms/${code}`, { confirmCode: code }, null, 'DELETE')).status, 401);
    const bob = await request('/api/signup', { email: 'bob@example.test', name: 'Bob', password: 'long test password' });
    assert.equal((await request('/api/messages', { code, userId: signup.data.user.id, text: 'Spoof' }, bob.cookie)).status, 404);
    assert.equal((await request('/api/join', { code: code.toLowerCase() }, bob.cookie)).status, 200);
    const stream = await fetch(`http://127.0.0.1:${port}/api/events?code=${code}`, { headers: { Cookie: cookie } });
    const reader = stream.body.getReader();
    await reader.read();
    const sent = await request('/api/messages', { code, userId: signup.data.user.id, text: 'Hi Alice' }, bob.cookie);
    assert.equal(sent.status, 201); assert.equal(sent.data.message.text, 'Hi Alice');
    let timer;
    try {
      const packet = await Promise.race([reader.read(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Live message was not delivered')), 3000); })]);
      assert.match(new TextDecoder().decode(packet.value), /Hi Alice/);
    } finally { clearTimeout(timer); await reader.cancel(); }
    assert.equal((await request(`/api/room?code=${code}`, null, cookie)).data.room.messages.at(-1).text, 'Hi Alice');
    const rejoined = await request('/api/join', { code }, cookie);
    assert.equal(rejoined.data.room.messages.find(message => message.text === 'Hi Alice').userId, bob.data.user.id);
    assert.equal((await request('/api/profile', { name: 'Alice Updated' }, cookie)).data.user.name, 'Alice Updated');
    assert.equal((await request('/api/my-rooms', null, cookie)).data.rooms.length, 1);
    await request('/api/logout', {}, cookie);
    assert.equal((await request('/api/rooms', {}, cookie)).status, 401);
    assert.equal((await request('/api/login', { email: 'alice@example.test', password: 'long test password' })).status, 200);
  } finally {
    child.kill('SIGKILL');
    await new Promise(resolve => child.exitCode !== null || child.signalCode !== null ? resolve() : child.once('exit', resolve));
  }
});
