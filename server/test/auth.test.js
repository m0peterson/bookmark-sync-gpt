import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, signToken, verifyPassword, verifyToken } from '../src/auth.js';
import { cleanWindows, validEmail, validPassword } from '../src/validation.js';

test('password hashes verify without retaining plaintext', () => {
  const stored = hashPassword('correct horse battery staple');
  assert.equal(verifyPassword('correct horse battery staple', stored), true);
  assert.equal(verifyPassword('wrong password', stored), false);
  assert.equal(stored.includes('correct horse'), false);
});

test('signed token rejects tampering and expiration', () => {
  const secret = 'a'.repeat(32);
  const token = signToken({ sub: 'user-1' }, secret, 60);
  assert.equal(verifyToken(token, secret).sub, 'user-1');
  assert.equal(verifyToken(`${token}x`, secret), null);
  assert.equal(verifyToken(signToken({ sub: 'x' }, secret, -1), secret), null);
});

test('input validation bounds session data', () => {
  assert.equal(validEmail('me@example.com'), true);
  assert.equal(validPassword('0123456789'), true);
  assert.deepEqual(cleanWindows([{ id: 'one', name: 'Main', tabs: [{ url: 'https://example.com', pinned: 1 }] }])[0].tabs[0], {
    url: 'https://example.com', title: 'https://example.com', pinned: true
  });
  assert.throws(() => cleanWindows([{ tabs: [{ url: 'chrome://settings' }] }]));
});
