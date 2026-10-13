const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database');
after(() => db.pool.end());
test('password hashes use unique salts and verify only the correct password', async () => {
  const a = await db.passwordHash('a long test password');
  const b = await db.passwordHash('a long test password');
  assert.notEqual(a, b);
  assert.equal(await db.passwordMatches('a long test password', a), true);
  assert.equal(await db.passwordMatches('a wrong test password', a), false);
  assert.ok(!a.includes('a long test password'));
});
test('credentials normalize email and reject invalid or unbounded input', () => {
  assert.equal(db.credentials({ email: ' Maxx@Example.com ', password: '1234567890' }).email, 'maxx@example.com');
  assert.throws(() => db.credentials({ email: 'wrong', password: '1234567890' }));
  assert.throws(() => db.credentials({ email: 'a@b.com', password: 'short' }));
  assert.throws(() => db.credentials({ email: 'a@b.com', password: 'x'.repeat(129) }));
});
