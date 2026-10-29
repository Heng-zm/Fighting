import { describe, it, expect } from 'vitest';

function allowRate(socket, key, limit = 5, windowMs = 10000, now = Date.now()) {
  if (!socket.data.rateBuckets) socket.data.rateBuckets = {};
  const recent = (socket.data.rateBuckets[key] || []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) {
    socket.data.rateBuckets[key] = recent;
    return false;
  }
  recent.push(now);
  socket.data.rateBuckets[key] = recent;
  return true;
}

describe('Rate Limiter Logic', () => {
  it('allows actions within the limit and rejects once limit is exceeded', () => {
    const socket = { data: {} };
    const limit = 3;
    const windowMs = 5000;
    const now = 1000000;

    expect(allowRate(socket, 'testAction', limit, windowMs, now)).toBe(true);
    expect(allowRate(socket, 'testAction', limit, windowMs, now + 10)).toBe(true);
    expect(allowRate(socket, 'testAction', limit, windowMs, now + 20)).toBe(true);

    // 4th action exceeds limit of 3
    expect(allowRate(socket, 'testAction', limit, windowMs, now + 30)).toBe(false);
  });

  it('resets capacity after the window expires', () => {
    const socket = { data: {} };
    const limit = 2;
    const windowMs = 5000;
    const now = 1000000;

    expect(allowRate(socket, 'testAction', limit, windowMs, now)).toBe(true);
    expect(allowRate(socket, 'testAction', limit, windowMs, now + 100)).toBe(true);
    expect(allowRate(socket, 'testAction', limit, windowMs, now + 200)).toBe(false);

    // Time advances past windowMs
    expect(allowRate(socket, 'testAction', limit, windowMs, now + 5001)).toBe(true);
  });

  it('keeps separate buckets for different keys', () => {
    const socket = { data: {} };
    expect(allowRate(socket, 'keyA', 1, 5000)).toBe(true);
    expect(allowRate(socket, 'keyA', 1, 5000)).toBe(false);

    // keyB should still be allowed
    expect(allowRate(socket, 'keyB', 1, 5000)).toBe(true);
  });
});

