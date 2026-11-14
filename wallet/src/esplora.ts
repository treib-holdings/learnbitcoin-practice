// A small client for the Esplora HTTP API (served by electrs).
//
// The practice wallet holds no chain data of its own. It asks the practice
// network's Esplora server about its addresses and hands it finished,
// signed transactions to broadcast. Only the endpoints the wallet needs.

export interface TxStatus {
  confirmed: boolean;
  block_height?: number;
  block_hash?: string;
  block_time?: number;
}

export interface EsploraUtxo {
  txid: string;
  vout: number;
  /** In satoshis. */
  value: number;
  status: TxStatus;
}

interface TxoStats {
  funded_txo_count: number;
  funded_txo_sum: number;
  spent_txo_count: number;
  spent_txo_sum: number;
  tx_count: number;
}

export interface EsploraAddress {
  address: string;
  chain_stats: TxoStats;
  mempool_stats: TxoStats;
}

export interface EsploraVin {
  txid: string;
  vout: number;
  is_coinbase: boolean;
  sequence: number;
  prevout: { scriptpubkey: string; scriptpubkey_address?: string; value: number } | null;
}

export interface EsploraVout {
  scriptpubkey: string;
  scriptpubkey_type: string;
  scriptpubkey_address?: string;
  value: number;
}

export interface EsploraTx {
  txid: string;
  version: number;
  locktime: number;
  vin: EsploraVin[];
  vout: EsploraVout[];
  size: number;
  weight: number;
  fee: number;
  status: TxStatus;
}

export class EsploraError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'EsploraError';
    this.status = status;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * How much of a failed answer's body is kept in the error, in characters.
 * There has to be a limit, because the body can be anything: a whole error
 * page says no more about what went wrong than its first lines do.
 *
 * The limit is there to leave whole what the practice app's own server
 * answers. That server stands between the app and Esplora and reports every
 * failure as a short piece of JSON. When the node refuses a transaction, the
 * JSON carries the node's own words, up to 300 characters of them. JSON
 * writes a quote or a backslash as two characters, so words of plain text
 * make a body of a little over 600 at most. It writes most control
 * characters (the characters below a space; a tab and a line break are
 * among the few it writes as two) as six characters each, so the longest
 * body that server can write, 300 of those under its longest code, comes to
 * 1,836. A limit of 2,000 leaves every one of its answers whole. Cut short,
 * a body is no longer JSON, and the app would have to piece the node's
 * words together from what is left of it.
 */
const ERROR_BODY_MAX = 2000;

/** The most transactions Esplora lists for an address in one answer (GET /address/<address>/txs). */
const FIRST_PAGE = 50;
/** How many confirmed transactions each further page holds (GET /address/<address>/txs/chain/<txid>). */
const CHAIN_PAGE = 25;
/** The most answers read for the transactions of one address: the first page and 39 more. */
const MAX_PAGES = 40;

/** The ID of the last confirmed transaction in a page, if the page holds one. */
function lastConfirmed(page: EsploraTx[]): string | undefined {
  for (let i = page.length - 1; i >= 0; i -= 1) {
    const tx = page[i]!;
    if (tx.status.confirmed) return tx.txid;
  }
  return undefined;
}

export class Esplora {
  readonly baseUrl: string;
  private readonly fetchFn: FetchLike;

  /** baseUrl without a trailing slash, e.g. https://practice.learnbitcoin.com/api/esplora */
  constructor(baseUrl: string, fetchFn: FetchLike = (input, init) => fetch(input, init)) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchFn = fetchFn;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, init);
    if (!res.ok) {
      const body = (await res.text()).slice(0, ERROR_BODY_MAX);
      throw new EsploraError(`Esplora ${init?.method ?? 'GET'} ${path} failed (${res.status}): ${body}`, res.status);
    }
    return res;
  }

  private async json<T>(path: string): Promise<T> {
    return (await (await this.request(path)).json()) as T;
  }

  async tipHeight(): Promise<number> {
    return Number((await (await this.request('/blocks/tip/height')).text()).trim());
  }

  address(address: string): Promise<EsploraAddress> {
    return this.json(`/address/${encodeURIComponent(address)}`);
  }

  /**
   * The address's unspent coins, all of them in one answer: this list has
   * no pages. It has a limit instead. By the Esplora server's source, the
   * list of an address that holds more than 500 unspent confirmed coins is
   * refused whole (HTTP 400), not cut short: 500 is the server's own
   * setting, unless it is started with another. That was read, not
   * measured on the practice network.
   */
  addressUtxos(address: string): Promise<EsploraUtxo[]> {
    return this.json(`/address/${encodeURIComponent(address)}/utxo`);
  }

  /**
   * The first page of an address's transactions: 50 at most, all told. The
   * unconfirmed ones come first, in the order the server heard of them. The
   * confirmed ones fill the room that is left, newest first. An address can
   * have more than one page: addressTxsAll() reads them all.
   */
  addressTxs(address: string): Promise<EsploraTx[]> {
    return this.json(`/address/${encodeURIComponent(address)}/txs`);
  }

  /**
   * One page of an address's confirmed transactions, newest first, 25 at
   * most: the ones that come after the transaction `after` in that order,
   * or the newest 25 when no ID is given. An empty list means that nothing
   * comes after it.
   */
  addressTxsChain(address: string, after?: string): Promise<EsploraTx[]> {
    const from = after === undefined ? '' : `/${encodeURIComponent(after)}`;
    return this.json(`/address/${encodeURIComponent(address)}/txs/chain${from}`);
  }

  /**
   * Every transaction of an address, each one once, in the order Esplora
   * lists them: the unconfirmed ones, then the confirmed ones, newest first.
   *
   * Esplora hands them out in pages. The first page (addressTxs) holds 50
   * at most. When it is full there may be more, and the rest are older
   * confirmed ones. They come 25 at a time: each page is asked for by the
   * ID of the last confirmed transaction of the page before (or by no ID
   * at all, when the first page was 50 unconfirmed ones), until a page comes
   * back short. A page that is exactly full is followed by one more
   * question, and its answer is then an empty list.
   *
   * At most 40 answers are read for one address, the first page included.
   * Two things are left out by this, and neither can matter for a practice
   * wallet:
   *
   *   - Unconfirmed transactions beyond the first 50 of one address. The
   *     first page lists no more than 50 of them, and the further pages
   *     asked for here hold confirmed ones only. The Esplora server itself
   *     gives more of a list when the question carries a query string:
   *     the part after a given ID ("?after_txid=") or a longer page
   *     ("?max_txs="). The practice network was seen to answer both
   *     (e2e/fixtures/address-lists.json), though not with more than 50
   *     unconfirmed ones. The practice app's server passes on no question
   *     that has a query string, so neither is open to the wallet. It
   *     sees those transactions as soon as a block holds them, which on
   *     the practice network is half a minute later.
   *   - Confirmed transactions beyond the 40th answer: with all of them
   *     confirmed, those beyond the newest 1,025 (50, then 39 times 25).
   *     The limit is there so that one address can never cost an endless
   *     run of requests.
   *
   * A wallet shows a new address for every payment and sends its change to
   * a new one, so an address of a practice wallet takes part in a handful
   * of transactions: as a rule one that pays it and one that spends the
   * coin. It takes a program to pay one address more than 50 times between
   * two blocks, or more than a thousand times in all. What stops short
   * then is the list of past payments, of that one address's oldest ones.
   * The wallet's coins and its total do not come from this list: they are
   * read another way (addressUtxos, the address's unspent coins). That
   * other list has a harder limit of its own, though. An address that
   * holds more than 500 unspent coins is refused it, and with it the whole
   * scan of the wallet fails (scanWallet): no coins and no total are
   * shown, however many transactions are listed here.
   */
  async addressTxsAll(address: string): Promise<EsploraTx[]> {
    const found = new Map<string, EsploraTx>();
    const take = (page: EsploraTx[]): void => {
      for (const tx of page) {
        const known = found.get(tx.txid);
        if (known === undefined) {
          found.set(tx.txid, tx);
        } else if (tx.status.confirmed && !known.status.confirmed) {
          // A block arrived between two answers: the confirmed copy is kept, in the place the later answer gives it.
          found.delete(tx.txid);
          found.set(tx.txid, tx);
        }
      }
    };

    let page = await this.addressTxs(address);
    take(page);
    let full = page.length >= FIRST_PAGE;
    for (let pages = 1; full && pages < MAX_PAGES; pages += 1) {
      page = await this.addressTxsChain(address, lastConfirmed(page));
      take(page);
      full = page.length >= CHAIN_PAGE;
    }
    return [...found.values()];
  }

  tx(txid: string): Promise<EsploraTx> {
    return this.json(`/tx/${encodeURIComponent(txid)}`);
  }

  async txHex(txid: string): Promise<string> {
    return (await (await this.request(`/tx/${encodeURIComponent(txid)}/hex`)).text()).trim();
  }

  /** Broadcast a signed transaction; returns its txid. */
  async broadcast(hex: string): Promise<string> {
    const res = await this.request('/tx', { method: 'POST', body: hex, headers: { 'Content-Type': 'text/plain' } });
    return (await res.text()).trim();
  }

  /** Fee estimates in sat/vB, keyed by confirmation target in blocks. */
  feeEstimates(): Promise<Record<string, number>> {
    return this.json('/fee-estimates');
  }
}
