// Where the development gallery starts. It is main.ts of the app with one
// difference: the wallet is the scripted stand-in, in the state the page's
// query string names.
//
//   /gallery                                 every screen in every state, as links
//   /gallery/pieces                          every shared piece in every state
//   /es/wallet/receive?state=funded          a screen of the app, in a state
//
// The stand-in is made once, when the page loads. A link inside the app
// keeps it, as it would keep the real wallet; to change the state, load a
// page with another query string.

import { mount } from 'svelte';
import './gallery.css';
import { makeDoit } from '../src/lib/doit/doit.svelte.ts';
import { initEvents, track } from '../src/lib/events.ts';
import { router } from '../src/lib/router.svelte.ts';
import Gallery from './Gallery.svelte';
import { fromQuery, makeStandIn } from './stand-in.svelte.ts';

const target = document.getElementById('app');
if (!target) throw new Error('index.html has no #app element');

const { preset, overrides } = fromQuery(location.search);
const wallet = makeStandIn(preset, overrides);

// With ?events=yes the app counts screen views as it would in production, but
// they go into this list and never to the network.
const counted: unknown[] = [];
if (wallet.config.events) initEvents(true, (body) => counted.push(JSON.parse(body)), { strict: true });

// The "Do it" steps, for real, over the stand-in wallet: the same runner as in the app, with its
// note kept in the stand-in's own storage, which lives in this page's memory. A preset can put a
// note there before any screen is drawn (presets/doit.ts).
const doit = makeDoit({ wallet, storage: wallet.storage, count: (step) => track('Do it', step) });

// For a look from the browser's console while building a screen.
(window as unknown as { gallery: unknown }).gallery = { wallet, preset, router, counted, doit };

// As in the app's main.ts: once a screen has told the wallet that the bot
// check is about to load, every move between screens loads a whole page.
wallet.onBotCheck(() => router.fullLoadsFromNowOn());

router.start();
mount(Gallery, { target, props: { wallet, preset, doit } });
