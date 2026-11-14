// The text of the wallet screens: Overview, Coins, Activity and one transaction, and the states they share.
//
// The same shape as every file in this folder (see common.ts): one table per
// language with the same keys, plain strings, slots written {name}.
//
// What is here so far is the text of the pieces every wallet screen shares
// (components/wallet/): the gates that stand in for a screen when this
// browser has no usable wallet, the frame around every wallet screen, the
// unlock step, the fields for typing the 12 words, and the pieces that show
// coins and transactions. A key starts with the name of its piece.
//
// Two words are held to throughout: a payment that is not in a block yet is
// "unconfirmed", never "pending", and the wallet's short ID is its "wallet
// fingerprint", never a bare "fingerprint". A wallet is "removed" from this
// browser, not "deleted": its coins stay on the practice network.
// test/wallet-pieces.test.ts holds the table to them.
//
// The Spanish here is a first draft that no native reviewer has read yet.

export const en = {
  // -- the gate: this browser has no practice wallet (SPEC section 3, "No record") --
  /** The heading of the gate, and its name in the document title. */
  gateNoneTitle: 'This browser has no practice wallet.',
  gateNoneName: 'No wallet here',
  /** {days} is how long Safari keeps what a site stored without the site being used. */
  gateNoneWhy:
    'If you made one before, the browser may have erased its copy (Safari does after {days} days without use), or you made it in another browser or inside another app.',
  /** The heading Home puts over the first two ways in. */
  gateAlreadyHave: 'I already have a practice wallet',
  gateRestore: 'Restore from the 12 words',
  gateCreate: 'Create a practice wallet',

  // -- open with my passkey: the button, and each way it can end --
  openButton: 'Open with my passkey',
  /** On the button while the device's passkey prompt is open. */
  openBusy: 'Waiting for your passkey...',
  /** In the button's place where this browser gives the page no passkeys. */
  openNotOffered:
    "This browser does not let this page use passkeys, so a wallet made with a passkey cannot be opened from here. If you followed a link inside another app, open this page in your device's own browser instead. The 12 words work here either way.",
  /** Under a closed prompt: the device may simply have had no practice passkey to show. */
  openHint:
    'If your device listed no practice passkey, the passkey may not have reached this device yet. Try again and choose the option to use a phone or tablet that has it, or restore from the 12 words.',
  openExists:
    'A practice wallet was put in this browser from another tab while this page was open, so nothing was opened. Reload the page to see it.',
  /** Also true of Create, Restore and a switch: nothing can be kept in this browser. */
  noStorage:
    'This browser refuses to store anything for this page, so a wallet cannot be kept here. That happens in some private windows, and when site data is blocked. Open this page in an ordinary window, or allow site data, and try again.',

  // -- a passkey step that did not finish: what is said beside the sentence from the error table --
  passkeyTimedOut:
    'The passkey prompt stayed open too long without an answer and was closed. Nothing was changed. Try again when you are ready.',
  /** The line that folds away the browser's own name for what went wrong. */
  passkeyDetail: 'What the browser reported.',
  /**
   * {tag} is the four characters in the passkey's name. The whole name is
   * not known here: it was written in the language of the page the passkey
   * was made on.
   */
  passkeyNamed: 'The passkey that answered has "{tag}" in its name.',

  // -- the gate: something is stored here that cannot be read --
  unreadableTitle: 'The practice wallet stored here cannot be read.',
  unreadableName: 'Wallet cannot be read',
  unreadableBody:
    'Something is stored where this browser keeps its practice wallet, and this page cannot read it. Nothing has been overwritten and nothing has been removed.',
  unreadableWay:
    'Reload the page first: the trouble may pass. If it stays, you can remove what is stored, and then open, restore or create a wallet.',
  unreadableRemove: 'Remove what is stored',
  unreadableAsk: 'Remove what is stored here?',
  /** What brings the wallet back, without promising a passkey: this page cannot tell which kind it was. */
  unreadableWarn:
    'This cannot be undone. A wallet made with a passkey can be opened again with that passkey or with its 12 words. A wallet made without one comes back only from its 12 words.',
  unreadableYes: 'Remove it',
  unreadableNo: 'Keep it',
  unreadableGone:
    'What is stored here changed in another tab while this page was open, so nothing was removed. Reload the page to see what is here now.',

  // -- the gate: what is stored was written by a newer version of this page --
  newerTitle: 'This page is out of date.',
  newerName: 'Page out of date',
  newerBody:
    'The practice wallet in this browser was saved by a newer version of this page, most likely in another tab. This older version leaves it alone: nothing was overwritten or removed. Reload to get the current version.',

  // -- the gate: the self-test failed (the sentence itself is passkey_broken in the error table) --
  brokenTitle: 'The practice wallet cannot run in this browser.',
  brokenName: 'Wallet cannot run here',

  // -- the frame of every wallet screen: what the practice network last said about the coins --
  chainLooking: "Looking up this wallet's coins...",
  /** {time} is a countdown, such as "12 seconds". */
  chainRetryIn: 'This page tries again by itself in {time}.',
  /** {when} is how long ago, such as "3 minutes ago". */
  chainStale: 'What is shown here is from the last check that worked, {when}.',
  chainSlow: "The practice network is slow right now. That is our fault, not your wallet's.",
  noCoins: 'No coins yet.',
  getCoins: 'Get practice coins',

  // -- what the status region says: outcomes only --
  noticeArrived: '{amount} practice sats arrived.',
  noticeArrivedOne: '1 practice sat arrived.',
  noticeConfirmed: '1 confirmation.',
  noticeSent: 'Payment sent.',
  noticeUnlocked: 'Wallet unlocked.',
  noticeLocked: 'Wallet locked.',

  // -- what the frame says after an unlock that changed something --
  /** The stored details did not fit the keys, and were rebuilt from them. */
  noteTampered:
    'The details this browser had saved about this wallet were wrong, and they have been replaced with the ones your keys give. The coins are being looked up again. An address shown here before this unlock may have belonged to another wallet, so do not use one you copied from this page earlier.',
  /** The reader chose to switch this browser to the wallet of another passkey. */
  noteSwitched:
    'This browser now holds a different practice wallet, the one named below. The wallet that was here before is still on the practice network, and its own passkey or its 12 words open it again.',
  noteOk: 'OK',

  // -- the unlock step: wherever keys are needed --
  unlockTitle: 'Unlock this wallet',
  unlockPromise: 'Unlocking sends nothing. You will check the payment first.',
  unlockButton: 'Unlock with my passkey',
  unlockBusy: 'Waiting for your passkey...',
  unlockPicker: 'Choose another passkey',
  unlockWords: 'Use the 12 words',
  unlockWordsLead:
    'Type the 12 words of this wallet, in order. They load its keys for this page only, and nothing is stored.',
  unlockWordsGo: 'Unlock with these words',
  unlockWordsBack: 'Back to the passkey',
  /**
   * The stored passkey gave a wallet that fits nothing saved here. Both
   * causes are allowed for, and nothing says the addresses shown so far were
   * this wallet's. It is the gravest thing the step can say, so it comes in
   * four short paragraphs: what happened, the warning by itself, and each
   * of the two ways out.
   */
  unlockChanged:
    'This passkey did not give the wallet this browser has saved. Either the passkey now gives a different wallet than it did before, or what this browser saved about the wallet was replaced. Nothing was opened and nothing was changed.',
  unlockChangedWarn: 'Until this is settled, do not have coins sent to an address shown here.',
  unlockChangedWords: 'You can unlock with the 12 words of this wallet.',
  /** A link to Settings follows it. */
  unlockChangedRemove: 'Or remove the wallet from this browser under Settings, and then open it again with the passkey.',
  unlockGone:
    'This wallet was removed from this browser, or replaced by another, in a different tab while this page was open. Reload the page to see what is here now.',
  unlockOtherWallet:
    'These 12 words are valid, but they belong to another wallet, not the one in this browser. Nothing was changed. To use that wallet here, remove this one under Settings, then restore from those words.',

  // -- another passkey answered: ask before switching --
  switchLead:
    'That passkey belongs to a different practice wallet, not the one in this browser. Nothing has changed yet.',
  switchPasskey: 'Passkey',
  /** {tag} is the four characters in the passkey's name: all of the name that this browser knows. */
  switchPasskeyTagged: 'The one with "{tag}" in its name',
  switchPasskeyUnknown: 'A passkey this page has no name for',
  switchAsk:
    'Switch this browser to that wallet? The wallet that is here now stays on the practice network, and its own passkey or its 12 words open it again.',
  switchYes: 'Switch to that wallet',
  switchNo: 'Keep this wallet',
  switchNoStorage:
    'This browser refused to store the change, so nothing was switched. The wallet that was here is still here.',

  // -- the wallet fingerprint: always by its full name, with the one line on what it is --
  walletFingerprint: 'Wallet fingerprint',
  walletFingerprintIs:
    "A wallet fingerprint is eight characters worked out from a wallet's keys. Two wallets do not share one, so it tells them apart.",

  // -- the fields for typing the 12 words, and the list that shows them --
  /** What a screen reader calls the twelve fields together. */
  wordsGroup: 'The 12 words',
  /** A field's label. Only the number shows; a screen reader says all of it. */
  wordsNumber: 'Word {n}',
  wordsUnknown: 'Word {n} is not on the BIP 39 word list.',
  wordsMissing: 'All 12 words are needed. Fill in the empty fields.',
  wordsInvalid:
    'These 12 words do not pass their checksum. At least one of them is wrong or out of order. Compare them with your paper copy.',
  /** The short form of the exception paragraph, above any field that takes the words. */
  wordsException: 'Practice words only. The words of a real wallet never go into a web page, this one included.',
  /**
   * Shown on Spanish pages only: the words are English in every language.
   * The English lines are their translations, kept so that both tables have
   * the same keys.
   */
  wordsEnglishType:
    'The 12 words are English on purpose: they come from a fixed list. Type them exactly as written, without translating them.',
  wordsEnglishCopy:
    'The 12 words are English on purpose: they come from a fixed list. Copy them exactly as written, without translating them.',

  // -- coins and the total --
  total: 'Total',
  /** {amount} carries its unit, as in "25,000 practice sats". */
  totalUnconfirmed: 'Of that, still unconfirmed: {amount}.',
  /** On a coin that sits on one of the wallet's change addresses. */
  coinChange: 'Change',
  /** In front of the short ID of the transaction that made a coin. */
  coinTransaction: 'Transaction',

  // -- a transaction in a list --
  txReceived: 'Received',
  txSent: 'Sent',
  txInternal: 'Sent to yourself',
  txOther: "Another wallet's transaction",
  txConfirmed: 'Confirmed',
  /** {when} is how long ago, such as "6 minutes ago". */
  txConfirmedAgo: 'Confirmed {when}',
  /** {date} is a day, such as "November 13, 2026". */
  txConfirmedOn: 'Confirmed on {date}',

  // -- one transaction: what goes in, what comes out, what it costs --
  txInputs: 'Inputs',
  txInputsNote: 'The coins this transaction spends.',
  txOutputs: 'Outputs',
  txOutputsNote: 'The coins it makes.',
  /** On an input or an output that is this wallet's. */
  txMine: 'This wallet',
  txChange: 'Change, back to this wallet',
  /** In the address's place on the input of a block's own first transaction. */
  txNewCoins: 'New coins, made by the block itself',
  txNoAddress: 'No address: this script has none',
  txNoChange:
    'There is no change output. The coins spent were used up by the payment and the fee: either everything was sent, or what was left over was too small to send back and went to the fee.',
  txFee: 'Fee',
  txSize: 'Size',
  txFeeRate: 'Fee rate',
} as const;

export const es: Record<keyof typeof en, string> = {
  gateNoneTitle: 'Este navegador no tiene billetera de práctica.',
  gateNoneName: 'Sin billetera aquí',
  gateNoneWhy:
    'Si ya creaste una, puede que el navegador haya borrado su copia (Safari lo hace después de {days} días sin uso), o que la hayas creado en otro navegador o dentro de otra app.',
  gateAlreadyHave: 'Ya tengo una billetera de práctica',
  gateRestore: 'Restaurar con las 12 palabras',
  gateCreate: 'Crear una billetera de práctica',

  openButton: 'Abrir con mi llave de acceso (passkey)',
  openBusy: 'Esperando tu llave de acceso...',
  openNotOffered:
    'Este navegador no deja que esta página use llaves de acceso (passkeys), así que desde aquí no se puede abrir una billetera creada con una. Si llegaste por un enlace dentro de otra app, abre esta página en el navegador propio de tu dispositivo. Las 12 palabras funcionan aquí de todos modos.',
  openHint:
    'Si tu dispositivo no mostró ninguna llave de acceso de práctica, puede que la llave todavía no haya llegado a este dispositivo. Vuelve a intentarlo y elige la opción de usar un celular o una tableta que la tenga, o restaura con las 12 palabras.',
  openExists:
    'Desde otra pestaña se puso una billetera de práctica en este navegador mientras esta página estaba abierta, así que no se abrió nada. Recarga la página para verla.',
  noStorage:
    'Este navegador se niega a guardar datos de esta página, así que aquí no se puede conservar una billetera. Pasa en algunas ventanas privadas, y cuando los datos de los sitios están bloqueados. Abre esta página en una ventana normal, o permite los datos del sitio, y vuelve a intentarlo.',

  passkeyTimedOut:
    'La ventana de la llave de acceso estuvo abierta demasiado tiempo sin respuesta y se cerró. No cambió nada. Vuelve a intentarlo cuando quieras.',
  passkeyDetail: 'Lo que informó el navegador.',
  passkeyNamed: 'La llave de acceso que respondió tiene "{tag}" en su nombre.',

  unreadableTitle: 'La billetera de práctica guardada aquí no se puede leer.',
  unreadableName: 'Billetera ilegible',
  unreadableBody:
    'Hay algo guardado donde este navegador conserva su billetera de práctica, y esta página no puede leerlo. No se sobrescribió nada y no se quitó nada.',
  unreadableWay:
    'Primero recarga la página: puede que el problema se resuelva solo. Si sigue igual, puedes quitar lo que está guardado, y después abrir, restaurar o crear una billetera.',
  unreadableRemove: 'Quitar lo que está guardado',
  unreadableAsk: '¿Quitar lo que está guardado aquí?',
  unreadableWarn:
    'Esto no se puede deshacer. Una billetera creada con llave de acceso se puede volver a abrir con esa llave o con sus 12 palabras. Una creada sin ella solo vuelve con sus 12 palabras.',
  unreadableYes: 'Quitarlo',
  unreadableNo: 'Conservarlo',
  unreadableGone:
    'Lo que está guardado aquí cambió en otra pestaña mientras esta página estaba abierta, así que no se quitó nada. Recarga la página para ver qué hay ahora.',

  newerTitle: 'Esta página está desactualizada.',
  newerName: 'Página desactualizada',
  newerBody:
    'La billetera de práctica de este navegador la guardó una versión más nueva de esta página, lo más probable en otra pestaña. Esta versión anterior no la toca: no se sobrescribió ni se quitó nada. Recarga para obtener la versión actual.',

  brokenTitle: 'La billetera de práctica no puede funcionar en este navegador.',
  brokenName: 'La billetera no funciona aquí',

  chainLooking: 'Buscando las monedas de esta billetera...',
  chainRetryIn: 'Esta página vuelve a intentarlo sola en {time}.',
  chainStale: 'Lo que se muestra aquí es de la última comprobación que funcionó, {when}.',
  chainSlow: 'La red de práctica está lenta en este momento. La falla es nuestra, no de tu billetera.',
  noCoins: 'Todavía no hay monedas.',
  getCoins: 'Pedir monedas de práctica',

  noticeArrived: 'Llegaron {amount} sats de práctica.',
  noticeArrivedOne: 'Llegó 1 sat de práctica.',
  noticeConfirmed: '1 confirmación.',
  noticeSent: 'Pago enviado.',
  noticeUnlocked: 'Billetera desbloqueada.',
  noticeLocked: 'Billetera bloqueada.',

  noteTampered:
    'Los datos que este navegador tenía guardados sobre esta billetera estaban mal, y se reemplazaron por los que dan tus claves. Las monedas se están buscando de nuevo. Una dirección que se mostró aquí antes de este desbloqueo pudo ser de otra billetera, así que no uses ninguna que hayas copiado antes de esta página.',
  noteSwitched:
    'Este navegador ahora tiene otra billetera de práctica, la que se nombra abajo. La billetera que estaba aquí sigue en la red de práctica, y su propia llave de acceso o sus 12 palabras la vuelven a abrir.',
  noteOk: 'De acuerdo',

  unlockTitle: 'Desbloquea esta billetera',
  unlockPromise: 'Desbloquear no envía nada. Antes vas a revisar el pago.',
  unlockButton: 'Desbloquear con mi llave de acceso',
  unlockBusy: 'Esperando tu llave de acceso...',
  unlockPicker: 'Elegir otra llave de acceso',
  unlockWords: 'Usar las 12 palabras',
  unlockWordsLead:
    'Escribe en orden las 12 palabras de esta billetera. Cargan sus claves solo para esta página, y no se guarda nada.',
  unlockWordsGo: 'Desbloquear con estas palabras',
  unlockWordsBack: 'Volver a la llave de acceso',
  unlockChanged:
    'Esta llave de acceso no dio la billetera que este navegador tiene guardada. O la llave de acceso ahora da una billetera distinta de la de antes, o lo que este navegador guardó sobre la billetera fue reemplazado. No se abrió nada y no cambió nada.',
  unlockChangedWarn: 'Mientras esto no se aclare, no pidas que te envíen monedas a una dirección que se muestre aquí.',
  unlockChangedWords: 'Puedes desbloquear con las 12 palabras de esta billetera.',
  unlockChangedRemove: 'O quita la billetera de este navegador en Configuración, y después vuelve a abrirla con la llave de acceso.',
  unlockGone:
    'Esta billetera se quitó de este navegador, o fue reemplazada por otra, en otra pestaña mientras esta página estaba abierta. Recarga la página para ver qué hay ahora.',
  unlockOtherWallet:
    'Estas 12 palabras son válidas, pero son de otra billetera, no de la que está en este navegador. No cambió nada. Para usar esa billetera aquí, quita esta en Configuración y después restaura con esas palabras.',

  switchLead:
    'Esa llave de acceso es de otra billetera de práctica, no de la que está en este navegador. Todavía no cambió nada.',
  switchPasskey: 'Llave de acceso',
  switchPasskeyTagged: 'La que tiene "{tag}" en su nombre',
  switchPasskeyUnknown: 'Una llave de acceso cuyo nombre esta página no conoce',
  switchAsk:
    '¿Cambiar este navegador a esa billetera? La que está aquí ahora sigue en la red de práctica, y su propia llave de acceso o sus 12 palabras la vuelven a abrir.',
  switchYes: 'Cambiar a esa billetera',
  switchNo: 'Conservar esta billetera',
  switchNoStorage:
    'Este navegador se negó a guardar el cambio, así que no se cambió nada. La billetera que estaba aquí sigue aquí.',

  walletFingerprint: 'Huella de la billetera',
  walletFingerprintIs:
    'La huella de la billetera son ocho caracteres que se calculan a partir de las claves de una billetera. Dos billeteras no comparten la misma, así que sirve para distinguirlas.',

  wordsGroup: 'Las 12 palabras',
  wordsNumber: 'Palabra {n}',
  wordsUnknown: 'La palabra {n} no está en la lista de palabras del BIP 39.',
  wordsMissing: 'Hacen falta las 12 palabras. Llena los campos vacíos.',
  wordsInvalid:
    'Estas 12 palabras no pasan su suma de verificación. Al menos una está mal escrita o fuera de orden. Compáralas con tu copia en papel.',
  wordsException:
    'Solo palabras de práctica. Las palabras de una billetera de verdad nunca van en una página web, incluida esta.',
  wordsEnglishType:
    'Las 12 palabras están en inglés a propósito: salen de una lista fija. Escríbelas tal como están, sin traducirlas.',
  wordsEnglishCopy:
    'Las 12 palabras están en inglés a propósito: salen de una lista fija. Cópialas tal como están, sin traducirlas.',

  total: 'Total',
  totalUnconfirmed: 'De ese total, todavía sin confirmar: {amount}.',
  coinChange: 'Cambio',
  coinTransaction: 'Transacción',

  txReceived: 'Recibido',
  txSent: 'Enviado',
  txInternal: 'Enviado a ti',
  txOther: 'Transacción de otra billetera',
  txConfirmed: 'Confirmado',
  txConfirmedAgo: 'Confirmado {when}',
  txConfirmedOn: 'Confirmado el {date}',

  txInputs: 'Entradas',
  txInputsNote: 'Las monedas que esta transacción gasta.',
  txOutputs: 'Salidas',
  txOutputsNote: 'Las monedas que crea.',
  txMine: 'Esta billetera',
  txChange: 'Cambio, vuelve a esta billetera',
  txNewCoins: 'Monedas nuevas, creadas por el propio bloque',
  txNoAddress: 'Sin dirección: este script no tiene',
  txNoChange:
    'No hay salida de cambio. Las monedas gastadas se usaron por completo entre el pago y la comisión: o se envió todo, o lo que sobraba era demasiado pequeño para devolverlo y se fue a la comisión.',
  txFee: 'Comisión',
  txSize: 'Tamaño',
  txFeeRate: 'Tasa de comisión',
};
