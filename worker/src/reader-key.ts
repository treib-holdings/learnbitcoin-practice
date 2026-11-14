// The key a rate limiter counts one reader under.
//
// The practice wallet has no accounts, so the only thing that tells one
// reader from another is the address their request came from. The limiters
// never get that address. They get a short hash of it, and the hash is made
// and used within one request: it is never stored, logged or sent anywhere
// else. (A hash of an IPv4 address is not anonymous, since all four billion
// can be tried. That is why it is treated as carefully as the address.)

/** One name per limiter, so the same reader has a different key at each. */
export type LimiterName = 'chain' | 'broadcast' | 'faucet' | 'pot' | 'events';

/**
 * The limiter key for a reader: 24 hex characters.
 *
 * An IPv6 reader is counted by their /64, because one home or phone usually
 * holds a whole /64 and could otherwise pick a fresh address per request.
 * With no address at all (a local run), every request shares one key.
 */
export async function readerKey(limiter: LimiterName, ip: string | null): Promise<string> {
  const address = ip ?? '';
  const reduced = address.includes(':') ? ipv6Prefix64(address) : address;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`lbp-${limiter}:${reduced}`));
  return [...new Uint8Array(digest).slice(0, 12)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The first four groups of an IPv6 address, with "::" written out and leading zeros dropped. */
export function ipv6Prefix64(ip: string): string {
  const [head, tail] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups =
    tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':');
}
