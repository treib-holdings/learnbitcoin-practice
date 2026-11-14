// Where the page starts: the stylesheet, the router, the wallet, the app.
//
// This is the only file that imports wallet.svelte.ts. It hands the wallet
// to App.svelte, which puts it in Svelte's context; everything else reaches
// it with useWallet() and knows only the WalletApi interface.
//
// It is also the only file that sees both the wallet and the router, so
// the one thing the two have to agree on is joined here: the bot check.

import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { router } from './lib/router.svelte.ts';
import { onBotCheck, wallet } from './lib/wallet.svelte.ts';

const target = document.getElementById('app');
if (!target) throw new Error('index.html has no #app element');

// Keys and the bot check's script never share a page. When a screen tells
// the wallet that the script is about to load (wallet.beforeBotCheck()), the
// wallet drops a passkey wallet's keys, and from then on every move between
// screens has to load a whole page, so that the script is gone before any
// key is loaded again. Only the router can make it so. The wallet tells it
// through this one line, and no screen has to remember to.
onBotCheck(() => router.fullLoadsFromNowOn());

// Before the app is drawn, so the first screen is already the one the address asks for.
router.start();
mount(App, { target, props: { wallet } });
