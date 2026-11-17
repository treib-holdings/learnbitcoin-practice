// The text of the Settings screen: the wallet's facts, what this browser keeps, the descriptors, and Remove.
//
// The same shape as every file in this folder (see common.ts): one table per
// language with the same keys, plain strings, slots written {name}.
//
// A few things the screen shows are not in this table, because they are
// shared: the screen's name ("Settings") and the link to the Sparrow page
// (both in common.ts), and the wallet fingerprint's name with the one line
// that says what it is (wallet.ts). The Lock button of a passkey wallet is
// the wallet frame's, on this screen as on every other.
//
// What the screen says about storage keeps to what is true of this page and
// no more: what this browser keeps, that there is no account, that we set
// no cookies, and that the 12 words never leave this browser. It never says
// that nothing leaves the browser: the practice network is asked about the
// wallet's addresses, and the About screen says so.
//
// The screen says what this browser holds, and nothing about where the
// wallet came from. The record does not know that: it says how this
// browser opens the wallet (with a passkey, or with the 12 words kept
// here) and when the record was written here. A wallet made with a passkey
// and later restored here from its 12 words is kept with its words, so "made
// without a passkey", "made on" and "comes back only with its 12 words"
// would all be false for it.
//
// The Spanish here is a first draft that no native reviewer has read yet.

export const en = {
  // -- the wallet in this browser --
  walletTitle: 'The wallet in this browser',
  kind: 'Kind',
  /** How this browser opens the wallet, which is all the record says of its kind. */
  kindPasskey: 'Opens with a passkey',
  kindWords: 'Opens without a passkey',
  /** The row that holds the tag of the wallet's own passkey. */
  passkeyTag: "Tag in the passkey's name",
  /** In the tag's place when this browser holds none for the wallet's passkey. */
  passkeyTagUnknown: 'Not known',
  /** Under the facts, for a passkey wallet whose tag is known... */
  passkeyTagIs:
    "The tag is a short code that this page put in the passkey's name when it made the passkey. In your password manager, this wallet's passkey is the one with this tag in its name.",
  /** ...and for one whose tag is not. */
  passkeyTagUnknownIs:
    "This browser holds no tag for this wallet's passkey, so it cannot say which name to look for in your password manager. The wallet fingerprint still tells this wallet from another.",
  /**
   * The row that holds the day this browser's record of the wallet was
   * written: the day the wallet was made here, or opened or restored here.
   */
  since: 'In this browser since',
  firstAddress: 'First address',

  // -- what this browser keeps: a short list under the heading, then what the browser said about keeping it --
  keepsTitle: 'What this browser keeps',
  /** The first item of the list, for every wallet. */
  keepsPublic:
    "The wallet's public key, with the facts above. This page finds the wallet's addresses and coins with it, so anyone who uses this browser can see the wallet.",
  /** The second item for a wallet this browser opens with a passkey. */
  keepsPasskey:
    'Not the 12 words. Your passkey makes them again each time you unlock, and they stay in this tab only until you lock the wallet, reload or close the tab.',
  /** The second item for a wallet this browser opens without a passkey. */
  keepsWords: 'The 12 words, not encrypted. So anyone who uses this browser can also spend its coins.',
  /**
   * What the page may say about everything else (SPEC section 12): there is
   * no account, we set no cookies, and the 12 words never leave this browser.
   */
  keepsPromise: 'There is no account, and we set no cookies. The 12 words never leave this browser.',
  /** The browser was asked to keep this page's data, and agreed. */
  keepsPersisted:
    'This browser has agreed to keep what this page stores, so it should not erase the wallet by itself. Clearing your browsing data still erases the wallet.',
  /** The browser was asked, and did not agree. {days} is how long Safari keeps what a page stored when the page is not used. */
  keepsNotPersisted:
    'This browser was asked to keep what this page stores, and did not agree. It may erase the wallet by itself, and Safari does after {days} days without use of this page. Then the 12 words on paper bring the wallet back.',

  // -- the public descriptors --
  descriptorsTitle: 'Public descriptors',
  /** Two sentences on what they are for. */
  descriptorsWhat:
    "A descriptor tells another wallet program which addresses are this wallet's: one descriptor is for receiving, the other for change.",
  descriptorsUse:
    'With both, that program can open this wallet as a watch-only wallet, without the 12 words: it sees every coin and can spend none.',
  /** The name above each descriptor. */
  descriptorReceive: 'Receive descriptor',
  descriptorChange: 'Change descriptor',
  /** The word on each copy button. "Copy" alone, twice on one screen, would not say which. */
  descriptorReceiveCopy: 'Copy receive descriptor',
  descriptorChangeCopy: 'Copy change descriptor',
  /** What the status region says after each is copied. */
  descriptorReceiveCopied: 'Receive descriptor copied',
  descriptorChangeCopied: 'Change descriptor copied',
  descriptorsFailed:
    'This page could not work out the descriptors of this wallet. Reload the page and look again. If they are still missing, the bug is on our side.',

  // -- remove: a step that asks first --
  removeTitle: 'Remove this wallet from this browser',
  removeLead: 'Removing takes the wallet out of this browser. Its coins stay on the practice network.',
  /** The keys chapter's drill: the reason to try this at all. {keysNumber} is that chapter's number, from the table of chapters (lib/doit/steps.ts). */
  removeDrill:
    'This is the first half of the drill in chapter {keysNumber} of the Journey: wipe, then restore from your words, to know the backup works.',
  removeButton: 'Remove this wallet',
  removeAsk: 'Remove this wallet from this browser?',
  /**
   * What brings a passkey wallet back. It promises no passkey: the reader
   * may be here because theirs has just failed.
   */
  removeBackPasskey:
    'This wallet can come back with its passkey, on this device or on another one that has the passkey, and with its 12 words. A passkey can fail, so the 12 words are the sure way back. Check that you have them on paper before you remove the wallet.',
  /**
   * What brings back a wallet that is kept here with its words. Its words
   * do, and its passkey if it was made with one: this browser cannot tell.
   */
  removeBackWords:
    'This erases the 12 words from this browser. The wallet comes back with its 12 words, or with its passkey if it was made with one. Without the words on paper and without a passkey, its practice coins are out of reach for good.',
  /** A link to the Backup screen, inside the question. */
  removeShowWords: 'Show the 12 words on the Backup screen first',
  removeYes: 'Remove it',
  removeNo: 'Keep it',
  /** The wallet the reader was asked about is no longer the one in this browser. The cause, then the way out. */
  removeGone:
    'The wallet in this browser changed in another tab while this page was open, so nothing was removed. This screen now shows the wallet that is here. Check that it is the one you mean to remove before you try again.',
} as const;

export const es: Record<keyof typeof en, string> = {
  walletTitle: 'La billetera de este navegador',
  kind: 'Tipo',
  kindPasskey: 'Se abre con llave de acceso (passkey)',
  kindWords: 'Se abre sin llave de acceso (passkey)',
  passkeyTag: 'Etiqueta en el nombre de la llave de acceso',
  passkeyTagUnknown: 'No se conoce',
  passkeyTagIs:
    'La etiqueta es un código corto que esta página puso en el nombre de la llave de acceso cuando la creó. En tu administrador de contraseñas, la llave de acceso de esta billetera es la que tiene esta etiqueta en su nombre.',
  passkeyTagUnknownIs:
    'Este navegador no tiene ninguna etiqueta de la llave de acceso de esta billetera, así que no puede decirte qué nombre buscar en tu administrador de contraseñas. La huella de la billetera sí distingue esta billetera de otra.',
  since: 'En este navegador desde el',
  firstAddress: 'Primera dirección',

  keepsTitle: 'Lo que este navegador guarda',
  keepsPublic:
    'La clave pública de la billetera, junto con los datos de arriba. Con ella esta página encuentra las direcciones y las monedas de la billetera, así que cualquiera que use este navegador puede ver la billetera.',
  keepsPasskey:
    'Las 12 palabras no. Tu llave de acceso las vuelve a generar cada vez que desbloqueas, y se quedan en esta pestaña solo hasta que bloquees la billetera, recargues la página o cierres la pestaña.',
  keepsWords: 'Las 12 palabras, sin cifrar. Así que cualquiera que use este navegador también puede gastar sus monedas.',
  keepsPromise: 'No hay ninguna cuenta, y no ponemos cookies. Las 12 palabras nunca salen de este navegador.',
  keepsPersisted:
    'Este navegador aceptó conservar lo que esta página guarda, así que no debería borrar la billetera por su cuenta. Si borras los datos de navegación, la billetera se borra igual.',
  keepsNotPersisted:
    'A este navegador se le pidió conservar lo que esta página guarda, y no aceptó. Puede borrar la billetera por su cuenta, y Safari lo hace después de {days} días sin usar esta página. Entonces las 12 palabras en papel devuelven la billetera.',

  descriptorsTitle: 'Descriptores públicos',
  descriptorsWhat:
    'Un descriptor le dice a otro programa de billetera qué direcciones son de esta billetera: un descriptor es para recibir, el otro para el cambio.',
  descriptorsUse:
    'Con los dos, ese programa puede abrir esta billetera como billetera de solo lectura, sin las 12 palabras: ve todas sus monedas y no puede gastar ninguna.',
  descriptorReceive: 'Descriptor de recepción',
  descriptorChange: 'Descriptor de cambio',
  descriptorReceiveCopy: 'Copiar descriptor de recepción',
  descriptorChangeCopy: 'Copiar descriptor de cambio',
  descriptorReceiveCopied: 'Descriptor de recepción copiado',
  descriptorChangeCopied: 'Descriptor de cambio copiado',
  descriptorsFailed:
    'Esta página no pudo calcular los descriptores de esta billetera. Recarga la página y vuelve a mirar. Si siguen sin aparecer, la falla es nuestra.',

  removeTitle: 'Quitar esta billetera de este navegador',
  removeLead: 'Quitarla la saca de este navegador. Sus monedas siguen en la red de práctica.',
  removeDrill:
    'Es la primera mitad del ejercicio del capítulo {keysNumber} del Recorrido: borrar y luego restaurar desde tus palabras, para saber que el respaldo funciona.',
  removeButton: 'Quitar esta billetera',
  removeAsk: '¿Quitar esta billetera de este navegador?',
  removeBackPasskey:
    'Esta billetera puede volver con su llave de acceso, en este dispositivo o en otro que la tenga, y con sus 12 palabras. Una llave de acceso puede fallar, así que las 12 palabras son la forma segura de volver. Revisa que las tengas en papel antes de quitar la billetera.',
  removeBackWords:
    'Esto borra las 12 palabras de este navegador. La billetera vuelve con sus 12 palabras, o con su llave de acceso si se creó con una. Sin las palabras en papel y sin llave de acceso, sus monedas de práctica quedan fuera de alcance para siempre.',
  removeShowWords: 'Mostrar antes las 12 palabras en la pantalla Respaldo',
  removeYes: 'Quitarla',
  removeNo: 'Conservarla',
  removeGone:
    'La billetera de este navegador cambió en otra pestaña mientras esta página estaba abierta, así que no se quitó nada. Esta pantalla muestra ahora la billetera que está aquí. Revisa que sea la que quieres quitar antes de volver a intentarlo.',
};
