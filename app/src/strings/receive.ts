// The text of the Receive screen: the address, its QR code and the faucet.
//
// The same shape as every file in this folder (see common.ts): one table per
// language with the same keys, plain strings, slots written {name}.
//
// What is not here: the screen's heading is the section's name
// (common.section_receive), and the sentence for everything that can go
// wrong with a request to the faucet is in errors.ts, found by the
// failure's own value. The lines here that follow such a sentence say only
// what it leaves out: another cause, where a button is, that a reload is
// the way to look again. One failure has its sentence here and not there:
// a bot check whose box was not ticked in time. The wallet reports it as
// "no-token", whose sentence names a content blocker, and only this screen
// can tell the two apart.
//
// Facts are slots, never written into a sentence: what the faucet pays and
// how often a block comes (from the wallet's settings), how long the faucet
// leaves a paid address alone and Bitcoin's own block time (named constants
// in screens/receive/faucet.ts). test/receive-text.test.ts holds the table
// to that, and to what the screen may say about the bot check.
//
// Above the button the faucet's card says two things in the open: what the
// faucet sends, and that a quick security check may come before it. What
// that check is stands under them, behind a folded line that the reader
// opens: it is Cloudflare's, it loads only when coins are asked for, it
// examines the browser and it is given the address. Nothing here promises
// more. Behind the same line a wallet opened with a passkey is told what
// asking does (it locks the wallet, and the next move loads the page
// afresh) and how far that goes: the check's code cannot read keys that
// were loaded before it. It could still ask the passkey itself or open a
// window, which this page never does after the tap, so the reader is told
// to cancel a prompt and close a window that comes then. The lines never
// say that the check is kept away from the keys.
//
// The Spanish here is a first draft that no native reviewer has read yet.

export const en = {
  // -- under the heading --
  lede: 'The address this wallet is paid at, and the faucet that pays practice coins to it.',

  // -- before the first look at the practice network has finished --
  noAddressYet:
    'There is no address to show yet. The wallet first looks up which of its addresses have been paid, and then shows one that has not.',

  // -- the address --
  addressTitle: 'Address',
  /** What a screen reader says in place of the QR code. */
  qrLabel: 'QR code of this address',
  copyAddress: 'Copy address',
  /** Said by the status region after a copy. */
  addressCopied: 'Address copied.',
  /** What the address is for, and the rule that goes with a practice address. */
  addressFor:
    'Whoever pays this wallet needs this address, as text or as the QR code. It is a practice address: never send real bitcoin to it.',
  /** {amount} is a number of sats, such as "100,000". One sat has a sentence of its own. */
  arrived: '{amount} practice sats arrived at this address.',
  arrivedOne: '1 practice sat arrived at this address.',
  /** The one line that goes with "Show a new address". */
  newAddressWhy: 'A wallet uses a fresh address for each payment. The old one still works.',
  newAddress: 'Show a new address',
  /** Under the button while a request to the faucet is under way: the button then does nothing. */
  newAddressWaits: 'The address stays as it is until the faucet has answered.',
  /** The same, once the faucet has promised a payment that has not arrived yet. */
  newAddressWaitsPayment: "The address stays as it is until the faucet's payment has arrived.",
  /** Under the address after "Show a new address", and what the status region says then. */
  newAddressShown: 'This is a new address. The one shown before still works.',
  /** The folded line under the address, and what it opens. */
  pathSummary: 'Its place in the wallet',
  pathLead:
    'Every address of this wallet is worked out from the 12 words, along a derivation path. The path to this address:',
  pathNote: "The last number counts the wallet's receive addresses, starting from 0.",

  // -- the faucet --
  faucetTitle: 'The faucet',
  /** {amount} carries its unit, as in "100,000 practice sats". */
  faucetPays:
    'The faucet sends {amount} to the address above. They work like bitcoin in this exercise, but have no real-world value.',
  /** Under it while the button is there: what to press, and that a check may come first. {button} is the button's own words. */
  faucetStart: 'Press "{button}" to get started. You may be asked to complete a quick security check first.',
  /** The folded line between that and the button. What it opens says what the check is: the three sentences below. */
  faucetCheckSummary: 'About the security check',
  /** Behind the folded line. What the bot check is, before the reader asks. About says the same and more. */
  faucetCheck:
    "First a bot check runs in this page. It is Cloudflare's: it loads only when you ask for coins, examines your browser and is given this address.",
  /** Behind the folded line too, for a wallet this browser opens with a passkey: what asking does, and what that is good for. */
  faucetLocks:
    "Asking for coins locks this wallet, and your next move to another screen loads the page afresh. So the bot check's code cannot read keys that were loaded before it.",
  /** Under it: what the lock does not stop, said as what the reader can do about it. */
  faucetNoPrompt:
    'After you ask, this screen never asks for your passkey and opens no window by itself. If a passkey prompt or a new window shows up while you are still here, cancel it or close it.',
  /** The same words as the button that leads here from a wallet with no coins (wallet.getCoins). */
  faucetAsk: 'Get practice coins',
  /** On the button while a request is under way. */
  faucetBusy: 'Asking the faucet...',

  // -- the faucet is closed: the settings name no bot check --
  /** Under the sentence for "closed", with a Reload button: when the page learns it, and the way to look again. */
  closedReload: 'This page learns whether the faucet is open when it loads. Reload the page to check again.',
  /**
   * The settings could not be read at all. Under the sentence for a request
   * that got no answer, with a Reload button: what that leaves unknown here.
   */
  settingsFailed: 'So this page does not know whether the faucet is open. Reload the page to ask again.',

  // -- the state of a request to the faucet, one for every phase --
  /** Whose check it is and what it is given stands above the button, behind the folded line, and stays there while the check runs. */
  stateChecking: 'Checking that you are not a bot. This takes a moment. If it shows a box below, tick it.',
  /** Said by the status region when the bot check's box has stood on screen for a moment: for a reader who cannot see it. */
  checkBoxShows: 'The bot check is showing a box under the button. Tick it to go on.',
  stateAsking: "The bot check is done. Waiting for the faucet's answer...",
  /** Under the sentence that says why the faucet refused for now. {time} is a countdown, such as "18 seconds". */
  stateRetryIn: 'Asking again in {time}.',
  /** {amount} carries its unit. */
  statePromised:
    'The faucet has sent {amount} to this address. The payment is on its way and shows here in a moment.',
  /** The faucet answered that it has paid this address before: there is no payment to show. */
  statePaidBefore: 'The faucet has paid this address before. The coins are on their way or already here.',
  /** {seconds} is the practice network's block time, {minutes} is Bitcoin's. */
  stateArrived:
    "The faucet's payment of {amount} has arrived. It is unconfirmed until the next block. Here a block comes every {seconds} seconds. On Bitcoin the average is {minutes} minutes.",
  /** Without a payment record: the faucet had paid before, or coins turned up after a request that failed. */
  stateArrivedNoRecord: 'Practice coins are at this address now, unconfirmed until the next block.',
  stateConfirmed: "The faucet's payment of {amount} is confirmed. It is in a block now, and this wallet can spend it.",
  stateConfirmedNoRecord: 'Practice coins are at this address now, and they are confirmed.',
  /** When the faucet's payment spent a coin from the pay-it-forward pot. */
  statePot: 'This payment spent a coin that someone before you left in the pot. You can leave one for the next person.',
  /** The name of the row that holds the payment's transaction ID. */
  txid: 'Transaction ID',
  /** Why there is no button once the faucet has paid. {hours} is how long it leaves a paid address alone. */
  faucetOnce:
    'The faucet pays an address once, and then not again for {hours} hours. For more practice coins, show a new address and ask again.',

  // -- after the sentence of a request that failed: what the sentence leaves out --
  /** After "no-token", whose sentence names a content blocker: another cause. */
  failedOtherCause:
    'Another cause can be a network that blocks Cloudflare, as some workplaces and schools do. On another connection the check may get through.',
  /** In place of the sentence for "no-token" when the bot check's box was on screen and ran out of time: the cause, then the way out. */
  failedBoxWaited:
    'The bot check showed a box, and it was not ticked in time. Ask again, and tick the box when it shows under the button.',
  /** After a sentence that says to show a new address. {button} is that button's own words. */
  failedNewAddress: 'The button "{button}" is under the address, further up this screen.',
} as const;

export const es: Record<keyof typeof en, string> = {
  lede: 'La dirección donde esta billetera recibe pagos, y el faucet, que le paga monedas de práctica.',

  noAddressYet:
    'Todavía no hay una dirección para mostrar. Primero la billetera averigua cuáles de sus direcciones ya recibieron pagos, y después muestra una que todavía no recibió ninguno.',

  addressTitle: 'Dirección',
  qrLabel: 'Código QR de esta dirección',
  copyAddress: 'Copiar dirección',
  addressCopied: 'Dirección copiada.',
  addressFor:
    'Quien le pague a esta billetera necesita esta dirección, como texto o como código QR. Es una dirección de práctica: nunca le envíes bitcoin de verdad.',
  arrived: 'Llegaron {amount} sats de práctica a esta dirección.',
  arrivedOne: 'Llegó 1 sat de práctica a esta dirección.',
  newAddressWhy: 'Una billetera usa una dirección nueva para cada pago. La anterior sigue funcionando.',
  newAddress: 'Mostrar una dirección nueva',
  newAddressWaits: 'La dirección se queda como está hasta que el faucet responda.',
  newAddressWaitsPayment: 'La dirección se queda como está hasta que llegue el pago del faucet.',
  newAddressShown: 'Esta es una dirección nueva. La que se mostraba antes sigue funcionando.',
  pathSummary: 'Su lugar en la billetera',
  pathLead:
    'Cada dirección de esta billetera se calcula a partir de las 12 palabras, siguiendo una ruta de derivación. La ruta de esta dirección:',
  pathNote: 'El último número dice cuál de las direcciones de recepción de la billetera es, empezando por 0.',

  faucetTitle: 'El faucet',
  faucetPays:
    'El faucet le envía {amount} a la dirección de arriba. En este ejercicio funcionan como bitcoin, pero no tienen ningún valor en el mundo real.',
  faucetStart:
    'Toca "{button}" para empezar. Puede que primero se te pida completar una comprobación de seguridad rápida.',
  faucetCheckSummary: 'Sobre la comprobación de seguridad',
  faucetCheck:
    'Primero se ejecuta en esta página una comprobación contra bots. Es de Cloudflare: se carga solo cuando pides monedas, examina tu navegador y recibe esta dirección.',
  faucetLocks:
    'Pedir monedas bloquea esta billetera, y tu próximo paso a otra pantalla carga la página de nuevo. Así el código de la comprobación contra bots no puede leer claves que se cargaron antes que él.',
  faucetNoPrompt:
    'Después de que pides monedas, esta pantalla nunca te pide tu llave de acceso ni abre ninguna ventana por sí sola. Si mientras sigues aquí aparece una ventana de la llave de acceso, o se abre una ventana nueva, cancélala o ciérrala.',
  faucetAsk: 'Pedir monedas de práctica',
  faucetBusy: 'Pidiéndole al faucet...',

  closedReload: 'Esta página averigua si el faucet está abierto cuando se carga. Recarga la página para volver a comprobarlo.',
  settingsFailed: 'Así que esta página no sabe si el faucet está abierto. Recarga la página para volver a preguntar.',

  stateChecking: 'Comprobando que no eres un bot. Tarda un momento. Si muestra una casilla aquí abajo, márcala.',
  checkBoxShows: 'La comprobación contra bots muestra una casilla debajo del botón. Márcala para continuar.',
  stateAsking: 'La comprobación contra bots terminó. Esperando la respuesta del faucet...',
  stateRetryIn: 'Próximo intento en {time}.',
  statePromised: 'El faucet le envió {amount} a esta dirección. El pago está en camino y aparece aquí en un momento.',
  statePaidBefore: 'El faucet ya le había pagado a esta dirección. Las monedas están en camino o ya llegaron.',
  stateArrived:
    'Llegó el pago del faucet, de {amount}. Está sin confirmar hasta el próximo bloque. Aquí llega un bloque cada {seconds} segundos. En Bitcoin, el promedio es de {minutes} minutos.',
  stateArrivedNoRecord: 'Ya hay monedas de práctica en esta dirección, sin confirmar hasta el próximo bloque.',
  stateConfirmed: 'El pago del faucet, de {amount}, está confirmado. Ya está en un bloque, y esta billetera puede gastarlo.',
  stateConfirmedNoRecord: 'Ya hay monedas de práctica en esta dirección, y están confirmadas.',
  statePot:
    'Este pago gastó una moneda que alguien dejó en el fondo común antes que tú. Tú puedes dejar una para quien sigue.',
  txid: 'Txid',
  faucetOnce:
    'El faucet le paga a una dirección una vez, y después no le vuelve a pagar durante {hours} horas. Para tener más monedas de práctica, muestra una dirección nueva y vuelve a pedir.',

  failedOtherCause:
    'Otra causa puede ser una red que bloquea a Cloudflare, como pasa en algunos trabajos y escuelas. Con otra conexión, puede que la comprobación pase.',
  failedBoxWaited:
    'La comprobación contra bots mostró una casilla, y no se marcó a tiempo. Vuelve a pedir, y marca la casilla cuando aparezca debajo del botón.',
  failedNewAddress: 'El botón "{button}" está debajo de la dirección, más arriba en esta pantalla.',
};
