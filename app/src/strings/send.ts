// The text of the Send screen: the form, the plan, the review of the signed payment and the sent view.
//
// The same shape as every file in this folder (see common.ts): one table per
// language with the same keys, plain strings, slots written {name}.
//
// What is not here, because it is said in one place for the whole app:
//   - the sentence for a plan the wallet cannot make, for a refused
//     broadcast and for a failed request: strings/errors.ts, found by the
//     failure's own value. The form shows "plan_bad-address" for text that
//     is no address and "plan_bad-fee" for a fee rate under the lowest, in
//     the planner's own words, although it never asks the planner about them;
//   - "Unlocking sends nothing. You will check the payment first." and the
//     rest of the unlock step: strings/wallet.ts;
//   - the names of a transaction's parts, its fee, its size and its fee
//     rate: strings/wallet.ts, with the pieces that draw them.
//
// Facts are slots: {seconds} is the time between practice blocks, {min} and
// {max} are the fee rates the form takes, {height} is a block's height, and
// an {amount} comes with its unit ("25,000 practice sats"). The prefixes bcrt1, tb1 and bc1 are how
// addresses are spelled, and are written out.
//
// The Spanish here is a first draft that no native reviewer has read yet.

export const en = {
  // -- the form --
  lede: 'Pay a practice address. You see what the payment is made of and what it costs before anything is signed or sent.',

  // -- what can be spent --
  fundsTitle: 'What this wallet can spend',
  spendable: 'Can be spent now',
  waiting: 'Unconfirmed, cannot be spent yet',
  /** {seconds} is the time between practice blocks. */
  waitingNote:
    'A coin that someone sent you can be spent once it is in a block. A practice block comes about every {seconds} seconds.',
  /** While the first look at the wallet's coins has not worked: the frame says why above this line. */
  coinsUnknown: "A payment can be planned once this wallet's coins are known.",

  // -- the address --
  formTitle: 'The payment',
  toLabel: 'To',
  toHint: 'A practice address, which starts with bcrt1. A payment link, which starts with "bitcoin:", works as well.',
  /** A tb1 address: the same address as another test network writes it. */
  toOtherNet: 'This address is written for another test network (it starts with tb1), so it cannot be paid as it stands.',
  /** The practice spelling follows it. */
  toOtherNetSame: 'Written the way the practice network writes it, the same address is:',
  toOtherNetUse: 'Use the practice spelling',
  /** A link to the Sparrow page follows it. */
  toOtherNetSparrow:
    'If you copied it from Sparrow, Sparrow is in the wrong mode. The Sparrow page shows how to start it in Regtest mode.',
  /** An address of Bitcoin's real network. Word for word as the task for this screen gives it. */
  toMainnet: "This is an address on Bitcoin's real network. Practice coins cannot be sent there.",
  /** Leads to the next sentence, whose "they" are the addresses Sparrow shows. */
  toMainnetFrom: 'If you copied it from Sparrow, look at the addresses Sparrow shows for your practice wallet.',
  /** Word for word the sentence of the Sparrow page (SPEC section 12). */
  toMainnetSparrow:
    "If they start bc1, Sparrow is on Bitcoin's real network. Delete that wallet in Sparrow and never send bitcoin to it.",
  /** Under the field, while it holds the address "Pass it on" filled in. */
  toPot: 'This is an address of the pot.',
  /** Under the field and in the plan, while the address is one of this wallet's own (the Receive screen shows them). */
  toOwn: 'This is an address of this wallet. The amount comes back to it, and only the fee leaves the wallet.',

  // -- pass it on --
  potAbout:
    'The pot is where learners leave coins for those who come after them. Coins sent there are what the faucet hands to the next learner.',
  potButton: 'Pass it on',
  potBusy: 'Asking for a pot address...',
  /** Said through the status region once the address has arrived: the field it filled stands above the button. */
  potFilled: 'A pot address is in the To field.',

  // -- the amount --
  amountLabel: 'Amount, practice sats',
  amountHint: 'Whole sats. Commas between thousands are fine.',
  amountPeriod:
    'There are no fractions of a sat, so an amount cannot have a period in it. Type whole sats, with commas between thousands or with none.',
  amountInvalid: 'That is not an amount in sats. Use digits only, with commas between thousands or with none.',
  sendAll: 'Send all',
  sendAllNote: 'Every coin this wallet can spend now goes into the payment. The fee comes out of them, and the rest arrives.',
  /** {amount} carries its unit. Shown while "Send all" is on and the payment can be made. */
  sendAllArrives: '{amount} would arrive.',

  // -- the fee rate --
  feeLabel: 'Fee rate, sat/vB',
  feeHint:
    'The fee is the size of the payment in virtual bytes (vB) times this rate. A higher rate gets an earlier place in line when blocks are full.',
  /** For an empty field and for text that is not a whole number. */
  feeRange: 'A fee rate here is a whole number from {min} to {max} sat/vB. Type digits only.',
  /** The limit is this wallet's own, and the sentence says so. */
  feeHigh: 'That fee rate is above {max} sat/vB, the highest this wallet takes. Use a fee rate of {max} or less.',

  // -- the plan --
  planTitle: 'The plan',
  /** In the plan's place until the three fields are good. It has to be true whichever of them is not. */
  planWaiting:
    'The plan shows here once the address, the amount and the fee rate are good: the fee, the change and the coins the payment will spend.',
  planNote: 'Worked out from the coins this wallet holds, without your keys. Nothing is signed yet.',
  planTo: 'To',
  planAmount: 'Amount',
  planChange: 'Change, back to this wallet',
  planNoChange: 'None',
  /** Why there is no change, when "Send all" is on. A coin that is still unconfirmed stays where it is. */
  noChangeAll: 'Send all spends every coin this wallet can spend now, whole, so nothing is left to come back as change.',
  /** Why there is no change, for an amount the reader typed. */
  noChangeLeftover:
    'After the amount and the fee, too little is left to make a coin of its own, so that remainder goes to the fee.',
  /** The sum, named for what it is: paid to an address of this wallet, the amount does not leave it. */
  planTotal: 'Amount and fee together',
  /** Shown when the rate the plan pays is not the one in the field. */
  planRateNote:
    'The fee rate paid comes out above the one you chose. The wallet works the fee out with a spare byte for each signature, and a remainder too small for change goes to the fee as well.',
  planCoins: 'Coins this payment will spend',
  /** {amount} carries its unit. Shown only when the figure is above 0. */
  sendAllWould: 'Send all would deliver {amount} to this address at this fee rate.',
  /** All that a figure of 0 says. It never means that nothing can be sent. */
  sendAllCannot: 'Send all cannot be used for this payment at this fee rate.',
  continue: 'Continue',
  continueNote: 'Next, the payment is signed with your keys. It is not sent until you have checked it.',

  // -- keys --
  unlockTitle: 'Unlock to sign',
  unlockWhy: 'Signing this payment needs the keys of this wallet, and your passkey loads them.',
  backToForm: 'Back to the form',
  /** Signing answered "locked" although the keys had just been loaded. */
  keysProblem: 'The keys of this wallet could not be loaded, so the payment was not signed. Reload the page and try again.',

  // -- the review of the signed payment --
  reviewTitle: 'Signed, not sent yet',
  reviewLead: 'This payment is signed with your keys, and it is still on this page only. Nothing has been sent.',
  reviewCheck:
    'Compare the whole address with the one you were given. A payment cannot be called back once it is sent, here or on Bitcoin.',
  reviewParts: 'What goes in and what comes out',
  send: 'Send it',
  sending: 'Sending...',
  change: 'Change it',

  // -- a payment the practice network did not take --
  refusedTitle: 'Payment not sent',
  /** The heading when the network says the payment is in a block already: "not sent" would be wrong then. */
  alreadyTitle: 'Payment already sent',
  /** The heading when no answer came, or the network could not give one: nothing is known about the payment. */
  unansweredTitle: 'No answer about this payment',
  /** Under the sentence for such an answer, above "Try sending again". */
  unansweredNote:
    'This page cannot tell whether the payment went out. Sending this same payment again is safe: it can go out only once. A new payment made from the form could pay a second time.',
  /** The line that folds away the node's own words for a refusal. */
  refusedDetail: 'What the practice network said.',
  sendAgain: 'Try sending again',

  // -- sent --
  sentTitle: 'Payment sent',
  /** {seconds} is the time between practice blocks. */
  sentNext:
    'It went into the mempool, the waiting room for payments that are not in a block yet. A practice block comes about every {seconds} seconds, and the next one should take it in.',
  /** In the place of the sentence above once a block has taken the payment in. {height} is that block's height. */
  sentConfirmed: 'It is confirmed. Block {height} of the practice chain took it in.',
  sentPot: 'It went to the pot. The faucet will hand these coins to a learner who comes after you.',
  sentLink: 'See this transaction',
  sentAnother: 'Send another',
} as const;

export const es: Record<keyof typeof en, string> = {
  lede: 'Paga a una dirección de práctica. Ves de qué está hecho el pago y cuánto cuesta antes de que se firme o se envíe nada.',

  fundsTitle: 'Lo que esta billetera puede gastar',
  spendable: 'Se puede gastar ahora',
  waiting: 'Sin confirmar, todavía no se puede gastar',
  waitingNote:
    'Una moneda que alguien te envió se puede gastar cuando ya está en un bloque. Llega un bloque de práctica más o menos cada {seconds} segundos.',
  coinsUnknown: 'Se podrá planear un pago cuando se conozcan las monedas de esta billetera.',

  formTitle: 'El pago',
  toLabel: 'Dirección de destino',
  toHint: 'Una dirección de práctica, que empieza con bcrt1. También sirve un enlace de pago, que empieza con "bitcoin:".',
  toOtherNet:
    'Esta dirección está escrita para otra red de pruebas (empieza con tb1), así que no se le puede pagar tal como está.',
  toOtherNetSame: 'Escrita como la escribe la red de práctica, la misma dirección es:',
  toOtherNetUse: 'Usar la forma de práctica',
  toOtherNetSparrow:
    'Si la copiaste de Sparrow, Sparrow está en el modo equivocado. La página de Sparrow explica cómo abrirlo en modo Regtest.',
  toMainnet: 'Esta es una dirección de la red real de Bitcoin. Ahí no se pueden enviar monedas de práctica.',
  toMainnetFrom: 'Si la copiaste de Sparrow, mira las direcciones que Sparrow muestra para tu billetera de práctica.',
  toMainnetSparrow:
    'Si empiezan por bc1, Sparrow está en la red real de Bitcoin. Elimina esa billetera en Sparrow y nunca le envíes bitcoin.',
  toPot: 'Esta es una dirección del fondo común.',
  toOwn: 'Esta es una dirección de esta billetera. El monto vuelve a ella, y solo la comisión sale de la billetera.',

  potAbout:
    'El fondo común es donde quienes aprenden dejan monedas para quienes vienen después. Las monedas que se envían ahí son las que el faucet le entrega a la siguiente persona.',
  potButton: 'Pásala',
  potBusy: 'Pidiendo una dirección del fondo común...',
  potFilled: 'Hay una dirección del fondo común en el campo de destino.',

  amountLabel: 'Monto, sats de práctica',
  amountHint: 'Sats enteros. Puedes poner comas entre los miles.',
  amountPeriod:
    'No hay fracciones de un sat, así que un monto no puede llevar punto. Escribe sats enteros, con comas entre los miles o sin ellas.',
  amountInvalid: 'Eso no es un monto en sats. Usa solo dígitos, con comas entre los miles o sin ellas.',
  sendAll: 'Enviar todo',
  sendAllNote:
    'Todas las monedas que esta billetera puede gastar ahora entran en el pago. La comisión sale de ellas, y el resto llega a su destino.',
  sendAllArrives: 'Llegarían {amount}.',

  feeLabel: 'Tasa de comisión, sat/vB',
  feeHint:
    'La comisión es el tamaño del pago en bytes virtuales (vB) por esta tasa. Una tasa más alta te da un lugar más adelante en la fila cuando los bloques se llenan.',
  feeRange: 'Aquí una tasa de comisión es un número entero de {min} a {max} sat/vB. Escribe solo dígitos.',
  feeHigh:
    'Esa tasa de comisión es mayor que {max} sat/vB, la más alta que acepta esta billetera. Usa una tasa de comisión de {max} o menos.',

  planTitle: 'El plan',
  planWaiting:
    'El plan aparece aquí cuando la dirección, el monto y la tasa de comisión estén bien: la comisión, el cambio y las monedas que el pago va a gastar.',
  planNote: 'Calculado con las monedas que tiene esta billetera, sin tus claves. Todavía no se firma nada.',
  planTo: 'Dirección de destino',
  planAmount: 'Monto',
  planChange: 'Cambio, vuelve a esta billetera',
  planNoChange: 'Ninguno',
  noChangeAll:
    'Enviar todo gasta enteras todas las monedas que esta billetera puede gastar ahora, así que no queda nada que vuelva como cambio.',
  noChangeLeftover:
    'Después del monto y la comisión queda demasiado poco para hacer una moneda propia, así que ese resto se suma a la comisión.',
  planTotal: 'Monto más comisión',
  planRateNote:
    'La tasa de comisión que se paga queda por encima de la que elegiste. La billetera calcula la comisión con un byte de sobra por cada firma, y un resto demasiado pequeño para ser cambio también se suma a la comisión.',
  planCoins: 'Monedas que este pago va a gastar',
  sendAllWould: 'Enviar todo entregaría {amount} a esta dirección con esta tasa de comisión.',
  sendAllCannot: 'Enviar todo no se puede usar para este pago con esta tasa de comisión.',
  continue: 'Continuar',
  continueNote: 'Lo que sigue es firmar el pago con tus claves. No se envía hasta que lo hayas revisado.',

  unlockTitle: 'Desbloquea para firmar',
  unlockWhy: 'Para firmar este pago hacen falta las claves de esta billetera, y tu llave de acceso las carga.',
  backToForm: 'Volver al formulario',
  keysProblem:
    'No se pudieron cargar las claves de esta billetera, así que el pago no se firmó. Recarga la página y vuelve a intentarlo.',

  reviewTitle: 'Firmado, aún sin enviar',
  reviewLead: 'Este pago está firmado con tus claves y sigue solo en esta página. No se ha enviado nada.',
  reviewCheck:
    'Compara la dirección completa con la que te dieron. Un pago enviado no se puede deshacer, ni aquí ni en Bitcoin.',
  reviewParts: 'Lo que entra y lo que sale',
  send: 'Enviarlo',
  sending: 'Enviando...',
  change: 'Cambiarlo',

  refusedTitle: 'El pago no se envió',
  alreadyTitle: 'El pago ya estaba enviado',
  unansweredTitle: 'Sin respuesta sobre este pago',
  unansweredNote:
    'Esta página no puede saber si el pago salió. Enviar otra vez este mismo pago es seguro: solo puede salir una vez. Un pago nuevo hecho desde el formulario podría pagar por segunda vez.',
  refusedDetail: 'Lo que dijo la red de práctica.',
  sendAgain: 'Intentar enviarlo otra vez',

  sentTitle: 'Pago enviado',
  sentNext:
    'Entró al mempool, la sala de espera de los pagos que todavía no entran en un bloque. Llega un bloque de práctica más o menos cada {seconds} segundos, y el próximo debería incluirlo.',
  sentConfirmed: 'Ya está confirmado. El bloque {height} de la cadena de práctica lo incluyó.',
  sentPot: 'Fue al fondo común. El faucet le entregará estas monedas a alguien que llegue después de ti.',
  sentLink: 'Ver esta transacción',
  sentAnother: 'Enviar otro',
};
