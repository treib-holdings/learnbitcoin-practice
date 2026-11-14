import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ipv6Prefix64, readerKey } from '../src/reader-key.ts';
import type { LimiterName } from '../src/reader-key.ts';

const LIMITERS: LimiterName[] = ['chain', 'broadcast', 'faucet', 'pot', 'events'];

test('a key is a short hash and never holds the address', async () => {
  for (const ip of ['203.0.113.7', '2001:db8:aa:bb:1:2:3:4', '']) {
    const key = await readerKey('faucet', ip);
    assert.match(key, /^[0-9a-f]{24}$/);
    if (ip !== '') {
      assert.ok(!key.includes(ip));
      assert.ok(!key.includes(ip.replaceAll('.', '').replaceAll(':', '')));
    }
  }
  // The exact value: SHA-256 of "lbp-faucet:203.0.113.7", first 12 bytes.
  const { createHash } = await import('node:crypto');
  const expected = createHash('sha256').update('lbp-faucet:203.0.113.7').digest('hex').slice(0, 24);
  assert.equal(await readerKey('faucet', '203.0.113.7'), expected);
});

test('the same reader has a different key at each limiter', async () => {
  const keys = await Promise.all(LIMITERS.map((name) => readerKey(name, '203.0.113.7')));
  assert.equal(new Set(keys).size, LIMITERS.length);
});

test('different IPv4 readers have different keys, and the same reader the same key', async () => {
  assert.notEqual(await readerKey('chain', '203.0.113.7'), await readerKey('chain', '203.0.113.8'));
  assert.equal(await readerKey('chain', '203.0.113.7'), await readerKey('chain', '203.0.113.7'));
});

test('an IPv6 reader is counted by their /64', async () => {
  assert.equal(ipv6Prefix64('2001:db8::1'), '2001:db8:0:0');
  assert.equal(ipv6Prefix64('2001:0db8:00aa:0bb0:1:2:3:4'), '2001:db8:aa:bb0');
  assert.equal(ipv6Prefix64('2001:DB8:AA:BB::1'), '2001:db8:aa:bb');
  assert.equal(ipv6Prefix64('::1'), '0:0:0:0');
  assert.equal(ipv6Prefix64('fe80::'), 'fe80:0:0:0');

  const one = await readerKey('chain', '2001:db8:aa:bb:1:2:3:4');
  assert.equal(await readerKey('chain', '2001:db8:aa:bb:ffff:ffff:ffff:ffff'), one, 'same /64, same key');
  assert.equal(await readerKey('chain', '2001:db8:aa:bb::9'), one);
  assert.equal(await readerKey('chain', '2001:0DB8:00AA:00BB::9'), one, 'however the address is written');
  assert.notEqual(await readerKey('chain', '2001:db8:aa:bc:1:2:3:4'), one, 'the next /64 is someone else');
});

test('with no address every request shares one key per limiter', async () => {
  assert.equal(await readerKey('events', null), await readerKey('events', ''));
  assert.notEqual(await readerKey('events', null), await readerKey('chain', null));
  assert.notEqual(await readerKey('events', null), await readerKey('events', '203.0.113.7'));
});
