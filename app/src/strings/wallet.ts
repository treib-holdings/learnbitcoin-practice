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

  // -- the gate: the browser did not let this page read its storage, so nobody knows whether a wallet is here --
  // Never "no wallet": a browser that blocks a site's data deletes none of it, so a wallet made before may still
  // be stored. The sentences are in the past tense on purpose: they say what happened when this page looked, and
  // stay true until it looks again (after a reload).
  //
  // Why the read failed, the page cannot tell: a storage that is not there and one that throws, whatever it
  // throws, are the same to it (lib/keystore.ts, lib/wallet.svelte.ts). So the cause is said as what it can be:
  // site data that is blocked, an app's built-in browser that hands a page no storage, a storage that does
  // not work. The way out is what a reader can do about the first two; for the third there is only Reload.
  blockedTitle: 'This page cannot tell whether this browser has a practice wallet.',
  blockedName: 'Wallet not known',
  blockedBody:
    "This browser did not let this page read what it may have stored here. That happens when site data is blocked, inside some apps' built-in browsers, and when the browser's own storage is not working. If you made a practice wallet in this browser before, it may still be stored.",
  /** A way out for each of those causes that has one. A Reload button follows it. */
  blockedWay: "Allow site data for this page, or open this page in your device's own browser, then reload.",

  // -- the frame of every wallet screen: what the practice network last said about the coins --
  chainLooking: "Looking up this wallet's coins...",
  /** {time} is a countdown, such as "12 seconds". */
  chainRetryIn: 'This page tries again by itself in {time}.',
  /** {when} is how long ago, such as "3 minutes ago". */
  chainStale: 'What is shown here is from the last check that worked, {when}.',
  chainSlow: "The practice network is slow right now. That is our fault, not your wallet's.",
  noCoins: 'No coins yet.',
  /** The same place, for a wallet that has held coins and holds none now. */
  noCoinsLeft: 'No coins left.',
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
  /** Another tab put a different wallet in this browser while a wallet screen was open here. Its first sentence is also said by the status region. */
  noteReplaced: 'The wallet in this browser was replaced in another tab. This screen now shows the other wallet.',
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

  // -- the Overview --
  /** At the top, for the one visit that follows a restore: the Overview would otherwise simply appear. */
  restoredHere: 'This wallet was restored from its 12 words. This browser now keeps them.',
  overviewAllCoins: 'See all coins',
  overviewActivity: 'Recent activity',
  overviewAllActivity: 'See all activity',
  /** The small line over what tells this browser's wallet from another. */
  overviewWallet: "This browser's wallet",
  /**
   * In front of the four characters this browser knows of its passkey's
   * name: the tag. The label is the one Settings gives the same value
   * (settings.passkeyTag), so the thing has one name on every screen.
   */
  walletPasskeyHas: "Tag in the passkey's name",
  /**
   * The same label where it is the first thing on the screen to name a
   * passkey. In Spanish the first mention on a screen carries "(passkey)"
   * beside the Spanish term; in English the two are alike.
   */
  walletPasskeyHasFirst: "Tag in the passkey's name",

  // -- the Overview of a wallet just opened with a passkey, when nothing was found (SPEC section 6) --
  emptyOpenedTitle: 'This passkey opened a wallet with no history',
  emptyOpenedLead:
    'The practice network knows no coins and no transactions for it. That has three possible causes, the most likely first.',
  /** The same sentence where it is the first thing on the screen to name a passkey (see walletPasskeyHasFirst). */
  emptyOpenedLeadFirst:
    'The practice network knows no coins and no transactions for it. That has three possible causes, the most likely first.',
  emptyNewTitle: 'It is a new wallet with no coins yet',
  emptyNewBody:
    "If you have not used this passkey's wallet before, nothing is wrong. The faucet gives it its first practice coins.",
  emptyOtherTitle: 'You chose a different practice passkey',
  emptyOtherBody:
    'Each practice passkey opens a wallet of its own. If you have made more than one, your coins may be in the wallet of another. The one you just used is named below.',
  /** On the unlock step that follows "Choose another passkey": the wallet is locked for it. */
  emptyOtherWhy:
    'This wallet was locked so that you could choose another passkey. Its own passkey unlocks it again.',
  emptyOtherSame:
    'That is the same passkey as before, so it opened the same wallet. If you have another practice passkey, choose again and pick that one.',
  emptyChangedTitle: 'The same passkey gave a different wallet',
  emptyChangedBody:
    'A passkey should give the same wallet every time, so this is the least likely cause. The wallet fingerprint of the wallet it opened is below. If your wallet showed a different one, its 12 words bring it back: remove this wallet under Settings, then restore from the 12 words.',

  // -- the list of transactions: Activity, and the latest few on the Overview --
  activityLede: 'Every transaction of this wallet, newest first.',
  activityLoading: 'Loading the activity...',
  activityEmpty: 'No transactions yet. The first one shows here when coins arrive.',
  /** Under the cause, when the list could not be read. It names no time: the wallet does not say when it tries next. */
  activityRetries: 'This page tries again by itself. You can also try now.',
  /** The same line for a reader who was refused for asking too fast: nothing invites them to ask again at once. */
  activityRetriesAlone: 'This page tries again by itself.',
  /** Added while an older list is still shown. */
  activityStale: 'The list below is as it was last read.',
  /** Where the list would be, while it has never been read and the screen already says above why the network cannot be read. */
  activityUnread: 'The list of transactions has not been read yet.',
  /** On the "Try again" button while the wallet reads again. */
  activityReading: 'Reading again...',

  // -- the Coins screen --
  coinsLede: 'A wallet holds coins, not a balance.',
  coinsWhatTitle: 'What a coin is',
  coinsWhat:
    'Each payment this wallet receives is a coin of its own, a UTXO (unspent transaction output). A payment spends whole coins and makes new ones: one for whoever is paid, and one for the change that comes back to this wallet.',
  coinsGlossary: 'UTXO in the LearnBitcoin glossary',
  /** {unconfirmed} and {change} are the two marks, as the list shows them. */
  coinsMarks:
    '"{unconfirmed}" marks a coin that is not in a block yet. "{change}" marks a coin that came back from a payment this wallet made. A coin with neither mark is confirmed and was received at one of this wallet\'s receive addresses.',
  coinsEmpty: 'This wallet holds no coins. One shows here as soon as a payment arrives.',

  // -- the screen of one transaction --
  txLooking: 'Looking up this transaction...',
  txWaiting: 'Waiting for the practice network to list this transaction...',
  txWaitingNote:
    'It was sent a moment ago, and the network takes a few seconds to list a new transaction. This page asks again by itself.',
  txNotFound:
    "The practice network lists no transaction with this ID. One sent a moment ago can take a few seconds to show, so try again. An ID from Bitcoin's real network is never listed here.",
  /** {minutes} is how long the page went on asking. */
  txNotFoundWaited:
    "After {minutes} minutes the practice network still does not list this transaction. It may have been dropped, or replaced by another version, before it reached a block. This wallet's activity shows what became of the coins.",
  /** {amount} carries its unit, as in "25,000 practice sats". */
  txSumReceived: 'This wallet received {amount}.',
  txSumSent: 'This wallet sent {amount} in all, the fee included.',
  txSumInternal: 'This wallet paid itself. Only the fee left it: {amount}.',
  txSumOther: 'This transaction does not touch this wallet.',
  txSumOtherNote: "None of its inputs and none of its outputs is at one of this wallet's addresses.",
  /** {seconds} is the time between two practice blocks. */
  txStatusUnconfirmed:
    'Unconfirmed: it is not in a block yet. On the practice network a block comes about every {seconds} seconds.',
  /** {height} is the block's number, {date} a day such as "November 13, 2026". */
  txStatusBlockDate: 'Confirmed in block {height}, on {date}.',
  txStatusBlock: 'Confirmed in block {height}.',
  txStatusConfirmed: 'Confirmed: it is in a block.',
  txPartsTitle: 'Inputs and outputs',
  /** A fact's name, and its two values. */
  txReplace: 'Can still be replaced',
  txReplaceYes: 'Yes, until it is in a block',
  txReplaceNo: 'No, it is in a block',
  /** Under the facts of an unconfirmed transaction: why it can be replaced. */
  txReplaceSignals:
    'It can be replaced because it signals replace-by-fee (RBF): until it is in a block, its sender can send a version that pays a higher fee in its place.',
  txReplaceSilent:
    'It does not signal replace-by-fee (RBF). Nodes today take a version that pays a higher fee either way, so it can be replaced until it is in a block.',
  txReplaceGlossary: 'RBF in the LearnBitcoin glossary',
  txId: 'Transaction ID',
  txIdCopied: 'Transaction ID copied',
  txExplorer: 'See it on the practice explorer',
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

  blockedTitle: 'Esta página no puede saber si este navegador tiene una billetera de práctica.',
  blockedName: 'No se sabe si hay billetera',
  blockedBody:
    'Este navegador no dejó que esta página leyera lo que pueda tener guardado aquí. Pasa cuando los datos de los sitios están bloqueados, dentro del navegador integrado de algunas apps, y cuando el almacenamiento del propio navegador no funciona. Si antes creaste una billetera de práctica en este navegador, puede que siga guardada.',
  blockedWay: 'Permite los datos del sitio para esta página, o abre esta página en el navegador propio de tu dispositivo, y después recarga.',

  chainLooking: 'Buscando las monedas de esta billetera...',
  chainRetryIn: 'Esta página vuelve a intentarlo sola en {time}.',
  chainStale: 'Lo que se muestra aquí es de la última comprobación que funcionó, {when}.',
  chainSlow: 'La red de práctica está lenta en este momento. La falla es nuestra, no de tu billetera.',
  noCoins: 'Todavía no hay monedas.',
  noCoinsLeft: 'No quedan monedas.',
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
  noteReplaced: 'La billetera de este navegador fue reemplazada en otra pestaña. Esta pantalla ahora muestra la otra billetera.',
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

  restoredHere: 'Esta billetera se restauró con sus 12 palabras. Este navegador ahora las guarda.',
  overviewAllCoins: 'Ver todas las monedas',
  overviewActivity: 'Actividad reciente',
  overviewAllActivity: 'Ver toda la actividad',
  overviewWallet: 'La billetera de este navegador',
  walletPasskeyHas: 'Etiqueta en el nombre de la llave de acceso',
  walletPasskeyHasFirst: 'Etiqueta en el nombre de la llave de acceso (passkey)',

  emptyOpenedTitle: 'Se abrió una billetera sin historial',
  emptyOpenedLead:
    'La red de práctica no conoce monedas ni transacciones de la billetera que abrió tu llave de acceso. Eso tiene tres causas posibles, de la más probable a la menos probable.',
  emptyOpenedLeadFirst:
    'La red de práctica no conoce monedas ni transacciones de la billetera que abrió tu llave de acceso (passkey). Eso tiene tres causas posibles, de la más probable a la menos probable.',
  emptyNewTitle: 'Es una billetera nueva que todavía no tiene monedas',
  emptyNewBody:
    'Si nunca usaste la billetera de esta llave de acceso, no hay ningún problema. El faucet le da sus primeras monedas de práctica.',
  emptyOtherTitle: 'Elegiste otra llave de acceso de práctica',
  emptyOtherBody:
    'Cada llave de acceso de práctica abre su propia billetera. Si creaste más de una, puede que tus monedas estén en la billetera de otra. Abajo se nombra la que acabas de usar.',
  emptyOtherWhy:
    'Esta billetera se bloqueó para que pudieras elegir otra llave de acceso. Su propia llave de acceso la vuelve a desbloquear.',
  emptyOtherSame:
    'Esa es la misma llave de acceso de antes, así que abrió la misma billetera. Si tienes otra llave de acceso de práctica, vuelve a elegir y selecciona esa.',
  emptyChangedTitle: 'La misma llave de acceso dio otra billetera',
  emptyChangedBody:
    'Una llave de acceso debería dar siempre la misma billetera, así que esta es la causa menos probable. Abajo está la huella de la billetera que se abrió. Si tu billetera mostraba otra, sus 12 palabras la recuperan: quita esta billetera en Configuración y después restaura con las 12 palabras.',

  activityLede: 'Todas las transacciones de esta billetera, de la más nueva a la más antigua.',
  activityLoading: 'Cargando la actividad...',
  activityEmpty: 'Todavía no hay transacciones. La primera aparece aquí cuando lleguen monedas.',
  activityRetries: 'Esta página vuelve a intentarlo sola. También puedes intentarlo ahora.',
  activityRetriesAlone: 'Esta página vuelve a intentarlo sola.',
  activityStale: 'La lista de abajo está como se leyó la última vez.',
  activityUnread: 'La lista de transacciones todavía no se ha leído.',
  activityReading: 'Leyendo de nuevo...',

  coinsLede: 'Una billetera guarda monedas, no un saldo.',
  coinsWhatTitle: 'Qué es una moneda',
  coinsWhat:
    'Cada pago que esta billetera recibe es una moneda aparte, un UTXO (salida de transacción no gastada). Un pago gasta monedas enteras y crea monedas nuevas: una para quien recibe el pago y otra para el cambio que vuelve a esta billetera.',
  coinsGlossary: 'UTXO en el glosario de LearnBitcoin',
  coinsMarks:
    '"{unconfirmed}" marca una moneda que todavía no está en un bloque. "{change}" marca una moneda que volvió de un pago hecho por esta billetera. Una moneda sin ninguna de las dos marcas está confirmada y se recibió en una dirección de recepción de esta billetera.',
  coinsEmpty: 'Esta billetera no tiene monedas. Aparece una aquí en cuanto llega un pago.',

  txLooking: 'Buscando esta transacción...',
  txWaiting: 'Esperando a que la red de práctica muestre esta transacción...',
  txWaitingNote:
    'Se envió hace un momento, y la red tarda unos segundos en mostrar una transacción nueva. Esta página vuelve a preguntar sola.',
  txNotFound:
    'La red de práctica no muestra ninguna transacción con este txid. Una enviada hace un momento puede tardar unos segundos en aparecer, así que vuelve a intentarlo. Un txid de la red real de Bitcoin nunca aparece aquí.',
  txNotFoundWaited:
    'Después de {minutes} minutos, la red de práctica sigue sin mostrar esta transacción. Puede que se haya descartado, o que otra versión la haya reemplazado, antes de entrar en un bloque. La actividad de esta billetera muestra qué pasó con las monedas.',
  txSumReceived: 'Esta billetera recibió {amount}.',
  txSumSent: 'Esta billetera envió {amount} en total, con la comisión incluida.',
  txSumInternal: 'Esta billetera se pagó a sí misma. Solo salió la comisión: {amount}.',
  txSumOther: 'Esta transacción no toca esta billetera.',
  txSumOtherNote: 'Ninguna de sus entradas ni de sus salidas está en una dirección de esta billetera.',
  txStatusUnconfirmed:
    'Sin confirmar: todavía no está en un bloque. En la red de práctica llega un bloque más o menos cada {seconds} segundos.',
  txStatusBlockDate: 'Confirmada en el bloque {height}, el {date}.',
  txStatusBlock: 'Confirmada en el bloque {height}.',
  txStatusConfirmed: 'Confirmada: ya está en un bloque.',
  txPartsTitle: 'Entradas y salidas',
  txReplace: 'Todavía se puede reemplazar',
  txReplaceYes: 'Sí, hasta que entre en un bloque',
  txReplaceNo: 'No, ya está en un bloque',
  txReplaceSignals:
    'Se puede reemplazar porque señala Replace-by-Fee (RBF): hasta que entre en un bloque, quien la envió puede enviar en su lugar una versión que pague una comisión más alta.',
  txReplaceSilent:
    'No señala Replace-by-Fee (RBF). Hoy los nodos aceptan de todos modos una versión que pague una comisión más alta, así que se puede reemplazar hasta que entre en un bloque.',
  txReplaceGlossary: 'RBF en el glosario de LearnBitcoin',
  txId: 'Txid',
  txIdCopied: 'Txid copiado',
  txExplorer: 'Verla en el explorador de práctica',
};
