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
      const body = (await res.text()).slice(0, 300);
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

  addressUtxos(address: string): Promise<EsploraUtxo[]> {
    return this.json(`/address/${encodeURIComponent(address)}/utxo`);
  }

  /** Newest first: mempool transactions, then the latest 25 confirmed. Enough for a practice wallet. */
  addressTxs(address: string): Promise<EsploraTx[]> {
    return this.json(`/address/${encodeURIComponent(address)}/txs`);
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
