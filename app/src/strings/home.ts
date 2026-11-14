// The text of the Home screen: what this is, and the ways in (open with a passkey, restore, create).
//
// The same shape as every file in this folder (see common.ts): one table per
// language with the same keys, plain strings, slots written {name}.
//
// The keys that start with "here" say which wallet is in this browser. Home
// shows them above the way in, and Create and Restore show them in their own
// place when a wallet is here already (screens/front/WalletHere.svelte). The
// buttons that lead to Create and Restore, the heading "I already have a
// practice wallet" and the Sparrow link take their words from the shared
// tables (wallet.ts, common.ts), so they read the same wherever they stand.
//
// The Spanish here is a first draft that no native reviewer has read yet.

export const en = {
  // -- what this is: the one page a search engine may list says it at the top --
  lede: "This is a working Bitcoin wallet on LearnBitcoin's practice network. Its coins are play money with no value, so you can do each step here before real money is at stake.",

  // -- a wallet is in this browser: which one it is, and the way in --
  hereTitle: 'This browser has a practice wallet',
  /** The heading on Create and Restore, where the reader came to put a wallet here. */
  hereAlready: 'This browser already has a practice wallet',
  /** {tag} is the four characters in the passkey's name: all of the name that this browser keeps. */
  herePasskeyTagged: 'It was made with a passkey, the one with "{tag}" in its name.',
  herePasskey: 'It was made with a passkey.',
  /** True of a wallet made without a passkey and of one restored from its 12 words: both are kept the same way. */
  hereWords: 'It works without a passkey, because its 12 words are kept in this browser.',
  hereOpen: 'Open my practice wallet',
  /** On Create and Restore: why nothing more can be made here, and the way out. */
  hereOne: 'A browser keeps one practice wallet at a time. To put another one here, first remove this one under Settings.',
  /** The wallet came from another tab while a tap on this page was being answered. */
  hereArrived:
    'A practice wallet was put in this browser from another tab while this page was open, so nothing was added here.',
  /** The same, where this page cannot show that wallet yet. */
  hereUnseen:
    'A practice wallet was put in this browser from another tab while this page was open, so nothing was added here. Reload the page to see it.',

  // -- no wallet here: under the heading "I already have a practice wallet" --
  /** SPEC section 3's "No record" sentences, shortened. {days} is how long Safari keeps what a site stored without the site being used. */
  haveWhy:
    'This browser has none right now. It may have erased its copy (Safari does after {days} days without use), or you made yours in another browser or inside another app.',

  // -- what you can do here --
  canTitle: 'What you can do here',
  canCoins: 'Get practice coins from the faucet, which hands them out to anyone who asks.',
  canSend: 'Send them on, and see the fee and the change.',
  canLook: 'Look at your coins and at every transaction.',
  canWords: 'See the 12 words, and test that they bring the wallet back.',
  canDesktop: 'Open the same wallet in a desktop wallet.',
  /** {seconds} and {sats} come from the settings: the time between practice blocks, and what one faucet request pays. */
  facts: 'Here a block comes about every {seconds} seconds, and the faucet gives {sats} practice sats.',
  linkAbout: 'About the practice wallet',
} as const;

export const es: Record<keyof typeof en, string> = {
  lede: 'Esta es una billetera de Bitcoin que funciona de verdad, en la red de práctica de LearnBitcoin. Sus monedas son dinero de juguete, sin ningún valor, así que aquí puedes hacer cada paso antes de que haya dinero de verdad en juego.',

  hereTitle: 'Este navegador tiene una billetera de práctica',
  hereAlready: 'Este navegador ya tiene una billetera de práctica',
  herePasskeyTagged: 'Se creó con una llave de acceso (passkey), la que tiene "{tag}" en su nombre.',
  herePasskey: 'Se creó con una llave de acceso (passkey).',
  hereWords: 'Funciona sin llave de acceso (passkey), porque sus 12 palabras están guardadas en este navegador.',
  hereOpen: 'Abrir mi billetera de práctica',
  hereOne:
    'Un navegador guarda una sola billetera de práctica a la vez. Para poner otra aquí, primero quita esta en Configuración.',
  hereArrived:
    'Desde otra pestaña se puso una billetera de práctica en este navegador mientras esta página estaba abierta, así que aquí no se agregó nada.',
  hereUnseen:
    'Desde otra pestaña se puso una billetera de práctica en este navegador mientras esta página estaba abierta, así que aquí no se agregó nada. Recarga la página para verla.',

  haveWhy:
    'Este navegador no tiene ninguna en este momento. Puede que haya borrado su copia (Safari lo hace después de {days} días sin uso), o que la hayas creado en otro navegador o dentro de otra app.',

  canTitle: 'Lo que puedes hacer aquí',
  canCoins: 'Pedir monedas de práctica al faucet, que las reparte a quien las pide.',
  canSend: 'Enviarlas, y ver la comisión y el cambio.',
  canLook: 'Mirar tus monedas y cada transacción.',
  canWords: 'Ver las 12 palabras, y comprobar que devuelven la billetera.',
  canDesktop: 'Abrir la misma billetera en una billetera de escritorio.',
  facts: 'Aquí llega un bloque más o menos cada {seconds} segundos, y el faucet entrega {sats} sats de práctica.',
  linkAbout: 'Acerca de la billetera de práctica',
};
