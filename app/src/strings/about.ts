// The text of the About page: what this is, the network facts, what is stored and what our server and others see.
//
// The same shape as every file in this folder (see common.ts): one table per
// language with the same keys, plain strings, slots written {name}.
//
// Every sentence here that says what is stored, sent or seen is a claim
// about the code, and has to stay true of it. Where each one comes from:
//
//   what this browser keeps   src/lib/keystore.ts (the one record, and what a record holds)
//   passkey wallets           src/lib/passkey.ts, wallet/src/keys.ts
//   what our server sees      worker/src/handler.ts (the log line, and which requests write one),
//                             worker/src/reader-key.ts (the limit per reader)
//   what is counted           the contract's EVENTS, src/lib/events.ts, worker/src/events.ts
//   the faucet's bot check    src/lib/turnstile.ts, worker/src/bot-check.ts, beforeBotCheck in src/lib/wallet-api.ts
//
// Change the code and the sentence changes with it. test/info-text.test.ts,
// test/info-kept.test.ts (the 12 words, against the wallet engine) and
// e2e/scenarios/info.test.ts hold the two together where a program can.
//
// What the page may promise is short (SPEC section 12): no account, we set
// no cookies, the 12 words never leave this browser. It never says that
// nothing leaves the browser, and never that nothing says who the reader
// is: the server sees addresses and an IP address, and the page says so.
//
// Facts are slots or values the screen shows beside these sentences: the
// block interval, what the faucet gives, host names and ports all come from
// the wallet's settings.
//
// Wallets are sorted here by how this browser keeps them, never by how they
// were made. A wallet made with a passkey and later restored in this browser
// from its 12 words is kept with the words, as plain text: for that wallet
// every sentence about "a wallet made with a passkey" would be false. So the
// two kinds are "a wallet this browser opens with a passkey" and "a wallet
// whose 12 words are stored here" (src/lib/session.ts: restore and
// keepRestored always store the words).
//
// The Spanish here is a first draft that no native reviewer has read yet.

export const en = {
  // -- the screen --
  title: 'About the practice wallet',
  lede: 'A working Bitcoin wallet on a practice network that LearnBitcoin runs. Its coins are play money with no value.',

  // -- the short version: the three things the page may promise, and where the rest is --
  shortTitle: 'The short version',
  shortBody: 'There is no account, and we set no cookies. The 12 words never leave this browser.',
  shortRest:
    "The rest of this page says what does leave it: what our server sees, what is counted, and what the faucet's bot check does.",

  // -- what this is, and who runs it --
  whatTitle: 'What this is',
  whatBody:
    'This is a real Bitcoin wallet that runs in your browser. It makes keys, shows addresses, and signs and sends payments the way a wallet for real bitcoin does. What differs is the network: its coins are play money. They have no value, and nothing turns them into real bitcoin.',
  whatWho: 'LearnBitcoin runs it, so that you can do each step the site teaches before real money is involved.',
  whatHot: 'Its keys live in a browser. That is acceptable for play money and for nothing else.',
  /** The text of the link to the main site. */
  whatSiteLink: 'LearnBitcoin, the site this wallet belongs to',

  // -- the practice network --
  netTitle: 'The practice network',
  netBody:
    'The practice network is a private Bitcoin network on a server we run. Unlike Bitcoin, it has one operator, and this wallet trusts what that server says about its coins.',
  netBlocks: 'Blocks',
  /** {seconds} is the time between two blocks. */
  netBlocksEvery: 'About one every {seconds} seconds',
  /** The same, for a network that makes a block each second. */
  netBlocksEveryOne: 'About one every second',
  netFaucet: 'Faucet',
  /** {amount} carries its unit, as in "100,000 practice sats". */
  netFaucetGives: '{amount} for each request',
  /** Under it, while the settings name no bot check: the faucet then answers nobody. */
  netFaucetOff: 'The faucet is switched off right now.',
  netExplorer: 'Block explorer',
  netElectrum: 'Electrum server',
  /** The server speaks SSL on this port, and on no other. */
  netElectrumPort: 'Electrum port, with SSL',
  netSparrowLink: 'How to use it from Sparrow',

  // -- what this browser keeps --
  keepTitle: 'What this browser keeps',
  keepBody:
    "One record, in this browser's storage for this site. Nothing else is kept: no cookies set by us, and nothing in any other kind of browser storage.",
  keepPublic:
    "Always in the record: the wallet's public key. With it the page lists the wallet's addresses and coins, and it cannot spend them. The wallet fingerprint, the first address and the time this browser began to keep the wallet are stored beside it.",
  keepPasskey:
    'For a wallet this browser opens with a passkey: which passkey to ask, and the tag in its name. Its 12 words are not stored.',
  keepWords:
    'For a wallet made without a passkey, and for any wallet restored here from its 12 words: the 12 words, as plain text, not encrypted.',
  keepSo:
    'So anyone who uses this browser can see the wallet. If its 12 words are stored here, they can also spend from it.',
  /** The label of the line that says what is stored here at this moment. One of the six lines below follows it. */
  keepNowLabel: 'In this browser right now',
  keepNowNone: 'Nothing. This browser has no practice wallet.',
  keepNowPasskey: 'The record of a wallet that this browser opens with a passkey. Its 12 words are not stored.',
  keepNowWords: 'The record of a wallet kept with its 12 words, as plain text.',
  keepNowUnreadable: "Something is stored where the wallet's record goes, and this page cannot read it.",
  keepNowNewer: 'A record saved by a newer version of this page. This version leaves it alone.',
  keepNowBroken:
    "Not known. This browser failed the wallet's self-test, so this page reads and stores nothing here.",

  // -- wallets this browser opens with a passkey --
  passkeyTitle: 'Wallets opened with a passkey',
  passkeyBody:
    "For a wallet that this browser opens with a passkey, this page stores the 12 words nowhere. Each time you unlock it, the passkey gives this page a secret number, and the page turns that number into the 12 words. The same passkey always gives the same words. They are kept in this tab's memory only, and are gone once you lock the wallet, reload the page or close the tab.",
  /** The other way a wallet made with a passkey can be in this browser. */
  passkeyRestored:
    'A wallet restored here from its 12 words is kept with the words, whatever it was made with.',
  passkeyWhere:
    "The passkey lives in your device's password manager, which may sync it to your other devices. This page never sees the passkey itself, and neither the secret number nor the words are sent to us.",

  // -- what our server sees, and what it writes down --
  serverTitle: 'What our server sees',
  serverBody:
    "The wallet asks our server which coins its addresses hold, and sends its payments through it. So the server sees the wallet's addresses and payments, and the IP address each request comes from. Any wallet that asks someone else's server shares the same.",
  serverLimit: 'It uses the IP address to slow down anyone who asks too fast.',
  serverLog:
    "When the page asks about an address, a transaction or the height of the chain, the server writes nothing down, unless something on our side is broken. For every other request (the page's settings, the faucet, the address of the pot, a payment being sent, a count) it writes one line: what kind of request it was, how it ended and how long it took. The line itself holds no address, no transaction ID and no IP address.",
  // What Cloudflare keeps beside a line is not known until the owner has looked at a stored
  // line (worker/wrangler.jsonc, above "observability"). Until then the page says "may".
  serverCloudflare:
    "The server runs on Cloudflare's network. Cloudflare stores those lines for a short time and may keep, beside each one, the web address that was asked for and the IP address it came from. For a line written while something on our side is broken, that web address can hold a wallet address or a transaction ID. Cloudflare also keeps short-lived logs of its own.",

  // -- what is counted --
  countTitle: 'What is counted',
  countBody:
    'To learn which steps people finish, this page counts a few things. Each count is the name of what happened, at most one detail from a fixed list, and the screen it happened on. It never holds an address, an amount, a transaction ID, a wallet fingerprint or anything you typed.',
  /** One of these two, by whether the settings say that events are wanted. */
  countOn: 'Counting is on right now.',
  countOff: 'Counting is off right now, so none of this is sent.',
  /** Under the list: what the line set in code type at the top of each entry is. */
  countNames: 'The first line of each entry is the name of the count, exactly as it is sent.',
  // One line for each event of the contract. screens/info/facts.ts ties
  // each key to its event, and the compiler refuses an event without one.
  count_pageview: 'A screen was opened. Every transaction screen counts as the same screen.',
  count_walletCreated: 'A wallet was made in this browser, and whether with a passkey or without.',
  count_passkey:
    'How making a passkey ended: it worked, it was left unfinished, the prompt was closed or timed out, or it failed.',
  count_unlock:
    'How unlocking or opening a wallet ended, from a fixed list of outcomes such as: it opened, the 12 words were used, another passkey answered, the prompt was closed.',
  count_restore:
    'A restore from the 12 words: whether practice history was found and, if not, whether the words were kept in this browser or erased.',
  count_faucet:
    'How a request for practice coins ended: paid, already paid, stopped by the bot check, given up or failed.',
  count_payment: 'A payment was sent, and whether it went to the pot, or the network refused it.',
  count_wordsShown:
    'The 12 words were shown, and whether this browser opens the wallet with a passkey. The words themselves are never part of a count.',
  count_walletRemoved: 'The wallet was removed from this browser, and whether this browser opened it with a passkey.',
  countSent:
    'Our server passes each count on to Plausible, the service that adds them up, with the IP address the request came from and what your browser says it is: its name, its version and its system. Plausible uses those to tell a person from a robot and to count a visitor once a day. No ID is sent with a count.',

  // -- the faucet's bot check --
  botTitle: "The faucet's bot check",
  botBody:
    "The faucet hands out practice coins to whoever asks, and a bot check keeps scripts from emptying it. The check is Cloudflare's, and it is the only code this page loads from another site. It loads only when you ask the faucet for coins.",
  botSees:
    'It examines your browser to tell a person from a script, and it is given the address the coins are for.',
  /** What its code could read beside that, for every kind of wallet: the record, and so the public key. */
  botReads:
    "Its code runs in this page, so it could also read the record this browser keeps for the wallet. The record holds the wallet's public key, and with that every address the wallet has and will have.",
  /** What the lock does. No more is promised: see botPasskeyStill. */
  botPasskey:
    "A wallet opened with a passkey is locked before the check loads, and it stays locked until the page is loaded again. So the check's code cannot read keys that were in the page before it.",
  /** What the lock does not do, and what the reader can do about it. */
  botPasskeyStill:
    'The lock goes no further than that. While the check is in the page, its code could ask your passkey itself, or open another window of this site and follow what is done there. After you ask for coins, the wallet itself does neither for as long as you stay on the Receive screen. So if a passkey prompt or a new window shows up there, cancel it or close it.',
  botWords:
    "A wallet whose 12 words are stored here cannot be shielded that way. The words are in this browser's storage, where the check's code could read them.",

  // -- the source code --
  codeTitle: 'The source code',
  codeBody:
    'The code of this wallet, of its server and of the practice network is public. What this page says can be checked against it.',
  /** The text of the link to the code. The Spanish one says the page is in English. */
  codeLink: 'Read the source code',
} as const;

export const es: Record<keyof typeof en, string> = {
  title: 'Acerca de la billetera de práctica',
  lede: 'Una billetera de Bitcoin que funciona de verdad, en una red de práctica que mantiene LearnBitcoin. Sus monedas son dinero de juguete, sin ningún valor.',

  shortTitle: 'En pocas palabras',
  shortBody: 'No hay cuenta, y no ponemos cookies. Las 12 palabras nunca salen de este navegador.',
  shortRest:
    'El resto de esta página dice qué sí sale de él: lo que ve nuestro servidor, lo que se cuenta y lo que hace la comprobación contra bots del faucet.',

  whatTitle: 'Qué es esto',
  whatBody:
    'Es una billetera de Bitcoin de verdad que funciona en tu navegador. Genera claves, muestra direcciones, y firma y envía pagos como lo hace una billetera para bitcoin de verdad. Lo que cambia es la red: sus monedas son dinero de juguete. No tienen valor, y nada las convierte en bitcoin de verdad.',
  whatWho:
    'La mantiene LearnBitcoin, para que puedas hacer cada paso que el sitio enseña antes de que haya dinero de verdad de por medio.',
  whatHot: 'Sus claves viven en un navegador. Eso es aceptable para dinero de juguete y para nada más.',
  whatSiteLink: 'LearnBitcoin, el sitio al que pertenece esta billetera',

  netTitle: 'La red de práctica',
  netBody:
    'La red de práctica es una red privada de Bitcoin en un servidor que mantenemos. A diferencia de Bitcoin, tiene un solo operador, y esta billetera confía en lo que ese servidor dice sobre sus monedas.',
  netBlocks: 'Bloques',
  netBlocksEvery: 'Uno cada {seconds} segundos, más o menos',
  netBlocksEveryOne: 'Uno por segundo, más o menos',
  netFaucet: 'Faucet',
  netFaucetGives: '{amount} por cada solicitud',
  netFaucetOff: 'El faucet está apagado por ahora.',
  netExplorer: 'Explorador de bloques',
  netElectrum: 'Servidor Electrum',
  netElectrumPort: 'Puerto de Electrum, con SSL',
  netSparrowLink: 'Cómo usarla desde Sparrow',

  keepTitle: 'Qué guarda este navegador',
  keepBody:
    'Un solo registro, en el almacenamiento de este navegador para este sitio. No se guarda nada más: ninguna cookie puesta por nosotros, y nada en ningún otro tipo de almacenamiento del navegador.',
  keepPublic:
    'Siempre en el registro: la clave pública de la billetera. Con ella la página lista las direcciones y las monedas de la billetera, y no puede gastarlas. Junto a ella se guardan la huella de la billetera, la primera dirección y el momento en que este navegador empezó a guardar la billetera.',
  keepPasskey:
    'En una billetera que este navegador abre con llave de acceso (passkey): a qué llave de acceso preguntar, y la etiqueta que lleva en su nombre. Sus 12 palabras no se guardan.',
  keepWords:
    'En una billetera creada sin llave de acceso, y en cualquier billetera restaurada aquí desde sus 12 palabras: las 12 palabras, como texto simple, sin cifrar.',
  keepSo:
    'Así que cualquiera que use este navegador puede ver la billetera. Si sus 12 palabras están guardadas aquí, también puede gastar sus monedas.',
  keepNowLabel: 'En este navegador, ahora mismo',
  keepNowNone: 'Nada. Este navegador no tiene billetera de práctica.',
  keepNowPasskey: 'El registro de una billetera que este navegador abre con llave de acceso. Sus 12 palabras no están guardadas.',
  keepNowWords: 'El registro de una billetera guardada con sus 12 palabras, como texto simple.',
  keepNowUnreadable: 'Hay algo guardado donde va el registro de la billetera, y esta página no puede leerlo.',
  keepNowNewer: 'Un registro guardado por una versión más nueva de esta página. Esta versión no lo toca.',
  keepNowBroken:
    'No se sabe. Este navegador no pasó la comprobación interna de la billetera, así que esta página no lee ni guarda nada aquí.',

  passkeyTitle: 'Billeteras que se abren con llave de acceso',
  passkeyBody:
    'En una billetera que este navegador abre con llave de acceso, esta página no guarda las 12 palabras en ningún lado. Cada vez que la desbloqueas, la llave de acceso le entrega a esta página un número secreto, y la página convierte ese número en las 12 palabras. La misma llave de acceso da siempre las mismas palabras. Se quedan solo en la memoria de esta pestaña, y desaparecen cuando bloqueas la billetera, recargas la página o cierras la pestaña.',
  passkeyRestored:
    'Una billetera restaurada aquí desde sus 12 palabras se guarda con las palabras, sin importar cómo se creó.',
  passkeyWhere:
    'La llave de acceso vive en el administrador de contraseñas de tu dispositivo, que puede sincronizarla con tus otros dispositivos. Esta página nunca ve la llave de acceso en sí, y ni el número secreto ni las palabras se nos envían.',

  serverTitle: 'Qué ve nuestro servidor',
  serverBody:
    'La billetera le pregunta a nuestro servidor qué monedas tienen sus direcciones, y envía sus pagos a través de él. Así que el servidor ve las direcciones y los pagos de la billetera, y la dirección IP desde la que llega cada solicitud. Cualquier billetera que le pregunta al servidor de otro comparte lo mismo.',
  serverLimit: 'Usa la dirección IP para frenar a quien pregunta demasiado rápido.',
  serverLog:
    'Cuando la página pregunta por una dirección, una transacción o la altura de bloque actual, el servidor no anota nada, salvo que algo de nuestro lado esté fallando. Por cada una de las demás solicitudes (la configuración de la página, el faucet, la dirección del fondo común, un pago que se envía, un conteo) anota una línea: qué tipo de solicitud fue, cómo terminó y cuánto tardó. La línea en sí no contiene ninguna dirección, ningún txid ni ninguna dirección IP.',
  serverCloudflare:
    'El servidor funciona en la red de Cloudflare. Cloudflare guarda esas líneas por poco tiempo, y puede guardar junto a cada una la dirección web que se pidió y la dirección IP desde la que llegó. En una línea anotada mientras algo de nuestro lado está fallando, esa dirección web puede contener una dirección de la billetera o un txid. Cloudflare también lleva sus propios registros, de corta duración.',

  countTitle: 'Qué se cuenta',
  countBody:
    'Para saber qué pasos se completan, esta página cuenta unas pocas cosas. Cada conteo es el nombre de lo que pasó, como mucho un detalle tomado de una lista fija, y la pantalla donde pasó. Nunca lleva una dirección, un monto, un txid, una huella de la billetera ni nada que hayas escrito.',
  countOn: 'El conteo está activado en este momento.',
  countOff: 'El conteo está desactivado en este momento, así que nada de esto se envía.',
  countNames: 'La primera línea de cada entrada es el nombre del conteo, tal como se envía.',
  count_pageview: 'Se abrió una pantalla. Todas las pantallas de transacción cuentan como la misma pantalla.',
  count_walletCreated: 'Se creó una billetera en este navegador, y si fue con llave de acceso o sin ella.',
  count_passkey:
    'Cómo terminó la creación de una llave de acceso: funcionó, quedó a medias, la ventana se cerró o se agotó el tiempo, o falló.',
  count_unlock:
    'Cómo terminó el desbloqueo o la apertura de una billetera, según una lista fija de resultados como: se abrió, se usaron las 12 palabras, respondió otra llave de acceso, la ventana se cerró.',
  count_restore:
    'Una restauración desde las 12 palabras: si se encontró historial de práctica y, si no, si las palabras se conservaron en este navegador o se borraron.',
  count_faucet:
    'Cómo terminó un pedido de monedas de práctica: pagado, ya pagado antes, detenido por la comprobación contra bots, abandonado o fallido.',
  count_payment: 'Se envió un pago, y si fue al fondo común, o la red lo rechazó.',
  count_wordsShown:
    'Se mostraron las 12 palabras, y si este navegador abre la billetera con llave de acceso. Las palabras mismas nunca forman parte de un conteo.',
  count_walletRemoved: 'Se quitó la billetera de este navegador, y si este navegador la abría con llave de acceso.',
  countSent:
    'Nuestro servidor le pasa cada conteo a Plausible, el servicio que los suma, junto con la dirección IP desde la que llegó la solicitud y lo que tu navegador dice ser: su nombre, su versión y su sistema. Plausible los usa para distinguir a una persona de un robot y para contar a cada visitante una vez al día. Con un conteo no se envía ningún identificador.',

  botTitle: 'La comprobación contra bots del faucet',
  botBody:
    'El faucet reparte monedas de práctica a quien las pide, y una comprobación contra bots evita que un programa lo vacíe. La comprobación es de Cloudflare, y es el único código que esta página carga desde otro sitio. Se carga solo cuando le pides monedas al faucet.',
  botSees:
    'Examina tu navegador para distinguir a una persona de un programa, y recibe la dirección a la que van las monedas.',
  botReads:
    'Su código se ejecuta en esta página, así que también podría leer el registro que este navegador guarda de la billetera. El registro contiene la clave pública de la billetera, y con ella todas las direcciones que la billetera tiene y va a tener.',
  botPasskey:
    'Una billetera que se abre con llave de acceso se bloquea antes de que la comprobación se cargue, y sigue bloqueada hasta que la página se cargue de nuevo. Así que el código de la comprobación no puede leer claves que estaban en la página antes que él.',
  botPasskeyStill:
    'El bloqueo no llega más lejos. Mientras la comprobación está en la página, su código podría pedirle él mismo el secreto a tu llave de acceso, o abrir otra ventana de este sitio y seguir lo que se hace ahí. Después de que pides monedas, la billetera misma no hace ninguna de las dos cosas mientras sigues en la pantalla Recibir. Así que, si ahí aparece una ventana de la llave de acceso o se abre una ventana nueva, cancélala o ciérrala.',
  botWords:
    'Una billetera cuyas 12 palabras están guardadas aquí no se puede proteger así. Las palabras están en el almacenamiento de este navegador, donde el código de la comprobación podría leerlas.',

  codeTitle: 'El código fuente',
  codeBody:
    'El código de esta billetera, de su servidor y de la red de práctica es público. Lo que dice esta página se puede comprobar con él.',
  codeLink: 'Leer el código fuente (en inglés)',
};
