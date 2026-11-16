// The Worker's parts, for anything that runs them outside Cloudflare.
//
// The end-to-end server imports this file (the package's "exports") and wires
// the same handler to a stand-in practice network. index.ts, the deployed
// entry, wires it to the real one. Nothing here names a Cloudflare binding.

export { makeHandler } from './handler.ts';
export { makeOrigin } from './origin.ts';
export { makeBotCheck } from './bot-check.ts';
export { makeForwardEvent } from './events.ts';
export { configFromEnv } from './config.ts';
// The holder of the pot's counts, which whoever builds a Deps makes once; how long the counts are kept; and how
// long the origin is left alone after a question that failed.
export { POT_STATS_KEEP_MS, POT_STATS_PAUSE_MS, makePotStatsHolder } from './pot-stats.ts';

export type { OriginOptions } from './origin.ts';
export type { BotCheckOptions } from './bot-check.ts';
export type { ForwardEventOptions } from './events.ts';
export type { ConfigVars } from './config.ts';
export type {
  BotCheck,
  BotCheckResult,
  BotVerdict,
  Deps,
  EventMeta,
  Fault,
  FetchLike,
  ForwardEvent,
  Handler,
  Limiter,
  Limits,
  LogLine,
  Origin,
  OriginAnswer,
  OriginBody,
  PotStatsHolder,
  RouteName,
} from './deps.ts';
