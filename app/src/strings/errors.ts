// A sentence for everything that can go wrong, in both languages.
//
// How a screen finds its sentence: the key is the failure's own value.
//
//   strings.errors[lang][failure]
//       for an ApiFailure, a BroadcastFailure or a FaucetFailure (lib/api.ts,
//       lib/wallet-api.ts). The value is one of the contract's refusal codes,
//       "network", "no-token" or "gave-up", and it is the key as it stands.
//
//   strings.errors[lang][`plan_${reason}`]
//       for a PlanFailure, the reason planPayment gives.
//
//   strings.errors[lang][`passkey_${failure.kind}`]
//       for a CeremonyFailure (lib/wallet-api.ts). "reload" and "broken" also
//       come back from restore and from unlocking with the 12 words, and
//       their sentences are written to fit there too.
//
// The last two families carry a prefix because bare words would collide:
// "busy" is a faucet that has paid its limit for the minute, and it is also
// a passkey prompt that is still open.
//
// A sentence is found by its key alone, so it has to be true on every screen
// that can show it. Four places where that shapes the wording:
//
//   - While the faucet waits (FaucetView.phase is "waiting"), `failure` is
//     "limit", "busy" or "refilling", and the page asks again by itself.
//     The last two are only ever seen then, and say so. "limit" is also the
//     answer to a broadcast and to the pot address, where the reader does
//     the asking, so it says only to wait. The countdown is Receive's own
//     line. After three minutes the failure is "gave-up", whichever of the
//     three causes it was.
//   - A CeremonyFailure comes back from Create as well as from Open and
//     Unlock. On Create there is no wallet to open and there are no 12 words
//     yet. On Unlock a wallet is here, so Create refuses. A way out that
//     fits only one of them says which one it is for.
//   - A plan can be refused as "too-much" or "below-dust" with maxSendable
//     0: what the wallet can spend is too small to send once the fee is
//     paid. Both sentences say what to do then. The Send screen may show a
//     line of its own for that case in their place.
//   - "too_large" is never shown for a payment: broadcastFailure reads it as
//     "unavailable" (lib/api.ts). Wherever it can show, this page built the
//     request, so the sentence owns the fault.
//
// Rules for every sentence here:
//   - The cause first, then the way out. Where the fault is ours, it says so.
//   - No slots. A screen can show any of these without having to know which
//     values to pass. Numbers that belong beside one (the most that can be
//     sent, a countdown) are the screen's own lines.
//   - The node's own words for a refused payment never go here. They belong
//     in a details line under the sentence.
//
// ErrorKey lists the keys from the types themselves, and the compiler holds
// the English table to it: a new refusal code, plan failure or passkey
// failure without a sentence does not build, and neither does a stray key.

import type { PlanFailure } from '@learnbitcoin/practice-wallet';
import type { ApiFailure, BroadcastFailure } from '../lib/api.ts';
import type { CeremonyFailure, FaucetFailure } from '../lib/wallet-api.ts';

export type ErrorKey =
  | ApiFailure
  | BroadcastFailure
  | FaucetFailure
  | `plan_${PlanFailure}`
  | `passkey_${CeremonyFailure['kind']}`;

export const en = {
  // -- any request to the practice network --
  bad_request:
    'This page sent the practice network a request it could not read. That is a bug on our side, not something you did. Reload the page and try again.',
  forbidden:
    'The practice network did not accept this request as coming from this site. Reload the page and try again. If it keeps happening, try with browser extensions turned off.',
  not_found:
    'The practice network has no record of that. If it was sent a moment ago, wait for the next block and look again.',
  method:
    'This page asked the practice network in a way it does not accept. That is a bug on our side. Reload the page and try again.',
  too_large:
    'This page sent the practice network more than it takes in one request. That is a bug on our side. Reload the page and try again.',
  limit: 'You are asking the practice network faster than it allows. Wait a minute, and it will take requests again.',
  unavailable: 'The practice network could not answer just now. The fault is on our side. Try again in a minute.',
  network: 'No answer came back from the practice network. Check your internet connection and try again.',

  // -- the faucet --
  closed: 'The faucet is switched off right now. That is on our side, and your wallet is fine. Try again later.',
  bot_check:
    'The bot check did not pass, or its answer was too old to use. Ask for practice coins again and the check will run once more.',
  bad_address:
    'The faucet did not accept this address as a practice address. The wallet made the address, so the bug is on our side. Reload the page and ask again.',
  own_address:
    "That address belongs to the practice network's own wallets, so the faucet does not pay it. Show a new address and ask again.",
  already_paid:
    'This address already got practice coins in the last 24 hours. The faucet pays each address once every 24 hours, so use the coins you have or ask again later.',
  busy: 'The faucet is busy. It pays a set number of requests a minute, so that bots cannot empty it. This page will ask again by itself in a moment.',
  refilling: 'The faucet is out of coins until its refill confirms. This page will ask again by itself in a moment.',
  failed: 'The faucet could not finish the payment. The fault is on our side. Try again in a minute.',
  'no-token':
    'The bot check gave no answer, so the faucet cannot pay. A content blocker may be stopping it. Allow challenges.cloudflare.com on this page and ask again.',
  'gave-up':
    'The faucet did not pay, and after several tries this page stopped asking. Your wallet is fine. Ask again in a few minutes.',

  // -- a payment the practice network's node refused --
  already_sent:
    'The practice network already has this payment in a block, so there is nothing left to send. Look for it under Activity.',
  coin_spent:
    'A coin this payment spends is no longer there. Another payment has spent it, or is spending it right now. Go back, let the wallet refresh, and make the payment again.',
  fee_too_low:
    'The fee is lower than the practice network accepts. Go back, raise the fee rate and sign the payment again.',
  dust: 'One output of this payment is too small for the network to carry. Amounts that small are called dust. Go back and send a larger amount.',
  refused:
    'The practice network refused this payment, for a reason this page has no plain words for. Wait for the next block, let the wallet refresh, and make the payment again. If it is refused again, the bug is on our side.',

  // -- a payment the wallet cannot build --
  'plan_nothing-spendable': 'This wallet has no coins to spend. Get practice coins on the Receive screen first.',
  'plan_unconfirmed-only':
    'The coins in this wallet are still unconfirmed, and this wallet spends a coin someone sent you only once it is in a block. Wait for the next block and try again.',
  'plan_too-much':
    'That is more than this wallet can send right now, once the fee is paid. Send a smaller amount, or send all the wallet can spend. If what is left after the fee is too small to send, get more practice coins on the Receive screen first.',
  'plan_below-dust':
    'That amount is too small for the network to carry. Amounts that small are called dust. Send a larger amount. If this wallet cannot send more once the fee is paid, get more practice coins on the Receive screen first.',
  'plan_bad-address':
    'That is not an address this wallet can pay. Practice addresses start with bcrt1. Copy the address again and check how it starts.',

  // -- a passkey step that did not finish --
  passkey_cancelled:
    'The passkey prompt was closed or ran out of time, so nothing was changed. Try again when you are ready.',
  'passkey_no-prf':
    'That passkey answered without the secret number a wallet is made from, so it cannot make or open a practice wallet. To open a wallet, choose another passkey or use the 12 words. To make one, create it without a passkey.',
  passkey_error:
    'The browser could not finish the passkey step. Try again. If it keeps failing, a wallet can still be opened with its 12 words, and a new one can be made without a passkey.',
  passkey_busy: 'Another passkey prompt is still open. Finish or close it, then try again.',
  passkey_reload:
    "The bot check has loaded in this page, and the wallet's keys are never loaded beside it. Reload the page, then try again.",
  passkey_broken:
    "This browser failed the wallet's self-test. It worked out the wrong keys from a known example, so no wallet can be made or opened here. Use another browser. The bug may be on our side.",
} as const satisfies Record<ErrorKey, string>;

export const es: Record<keyof typeof en, string> = {
  bad_request:
    'Esta página le envió a la red de práctica una solicitud que la red no pudo leer. Es un error nuestro, no algo que hayas hecho tú. Recarga la página y vuelve a intentarlo.',
  forbidden:
    'La red de práctica no aceptó esta solicitud porque no la reconoció como una de este sitio. Recarga la página y vuelve a intentarlo. Si sigue pasando, prueba con las extensiones del navegador desactivadas.',
  not_found:
    'La red de práctica no tiene registro de eso. Si se envió hace un momento, espera al próximo bloque y vuelve a mirar.',
  method:
    'Esta página le pidió algo a la red de práctica de una forma que no acepta. Es un error nuestro. Recarga la página y vuelve a intentarlo.',
  too_large:
    'Esta página le envió a la red de práctica más de lo que acepta en una sola solicitud. Es un error nuestro. Recarga la página y vuelve a intentarlo.',
  limit:
    'Estás haciendo solicitudes a la red de práctica más rápido de lo que permite. Espera un minuto y volverá a aceptarlas.',
  unavailable:
    'La red de práctica no pudo responder en este momento. La falla es nuestra. Vuelve a intentarlo en un minuto.',
  network:
    'No llegó ninguna respuesta de la red de práctica. Revisa tu conexión a internet y vuelve a intentarlo.',

  closed: 'El faucet está apagado por ahora. Es cosa nuestra, y tu billetera está bien. Vuelve a intentarlo más tarde.',
  bot_check:
    'La comprobación contra bots no salió bien, o su respuesta ya había vencido. Vuelve a pedir monedas de práctica y la comprobación se hará otra vez.',
  bad_address:
    'El faucet no aceptó esta dirección como una dirección de práctica. La dirección la hizo la billetera, así que el error es nuestro. Recarga la página y vuelve a pedir.',
  own_address:
    'Esa dirección es de las billeteras de la propia red de práctica, así que el faucet no le paga. Muestra una dirección nueva y vuelve a pedir.',
  already_paid:
    'Esta dirección ya recibió monedas de práctica en las últimas 24 horas. El faucet le paga a cada dirección una vez cada 24 horas, así que usa las monedas que tienes o vuelve a pedir más tarde.',
  busy: 'El faucet está ocupado. Atiende un número fijo de solicitudes por minuto, para que los bots no lo vacíen. Esta página volverá a pedir sola en un momento.',
  refilling: 'El faucet se quedó sin monedas hasta que se confirme su recarga. Esta página volverá a pedir sola en un momento.',
  failed: 'El faucet no pudo terminar el pago. La falla es nuestra. Vuelve a intentarlo en un minuto.',
  'no-token':
    'La comprobación contra bots no dio respuesta, así que el faucet no puede pagar. Puede que un bloqueador de contenido la esté deteniendo. Permite challenges.cloudflare.com en esta página y vuelve a pedir.',
  'gave-up':
    'El faucet no pagó, y después de varios intentos esta página dejó de pedir. Tu billetera está bien. Vuelve a pedir en unos minutos.',

  already_sent:
    'La red de práctica ya tiene este pago en un bloque, así que no queda nada por enviar. Búscalo en Actividad.',
  coin_spent:
    'Una moneda que este pago gasta ya no está. Otro pago la gastó, o la está gastando en este momento. Vuelve atrás, deja que la billetera se actualice y vuelve a hacer el pago.',
  fee_too_low:
    'La comisión es más baja de lo que acepta la red de práctica. Vuelve atrás, sube la tasa de comisión y firma el pago de nuevo.',
  dust: 'Una salida de este pago es demasiado pequeña para que la red la acepte. A montos así de pequeños se les llama polvo (dust). Vuelve atrás y envía un monto mayor.',
  refused:
    'La red de práctica rechazó este pago por un motivo que esta página no sabe decir con palabras sencillas. Espera al próximo bloque, deja que la billetera se actualice y vuelve a hacer el pago. Si lo rechaza otra vez, el error es nuestro.',

  'plan_nothing-spendable':
    'Esta billetera no tiene monedas para gastar. Primero pide monedas de práctica en la pantalla Recibir.',
  'plan_unconfirmed-only':
    'Las monedas de esta billetera siguen sin confirmar, y esta billetera solo gasta una moneda que te enviaron cuando ya está en un bloque. Espera al próximo bloque y vuelve a intentarlo.',
  'plan_too-much':
    'Eso es más de lo que esta billetera puede enviar por ahora, después de pagar la comisión. Envía un monto menor, o envía todo lo que la billetera pueda gastar. Si lo que queda después de la comisión es demasiado pequeño para enviarlo, pide primero más monedas de práctica en la pantalla Recibir.',
  'plan_below-dust':
    'Ese monto es demasiado pequeño para que la red lo acepte. A montos así de pequeños se les llama polvo (dust). Envía un monto mayor. Si esta billetera no puede enviar más después de pagar la comisión, pide primero más monedas de práctica en la pantalla Recibir.',
  'plan_bad-address':
    'Eso no es una dirección a la que esta billetera pueda pagar. Las direcciones de práctica empiezan con bcrt1. Copia la dirección otra vez y revisa cómo empieza.',

  passkey_cancelled:
    'La ventana de la llave de acceso se cerró o se le acabó el tiempo, así que no cambió nada. Vuelve a intentarlo cuando quieras.',
  'passkey_no-prf':
    'Esa llave de acceso respondió sin el número secreto del que sale una billetera, así que no puede crear ni abrir una billetera de práctica. Para abrir una billetera, elige otra llave de acceso o usa las 12 palabras. Para crear una, hazlo sin llave de acceso.',
  passkey_error:
    'El navegador no pudo terminar el paso de la llave de acceso. Vuelve a intentarlo. Si sigue fallando, una billetera todavía se puede abrir con sus 12 palabras, y se puede crear una nueva sin llave de acceso.',
  passkey_busy:
    'Hay otra ventana de llave de acceso todavía abierta. Termina ese paso o ciérrala, y vuelve a intentarlo.',
  passkey_reload:
    'La comprobación contra bots ya se cargó en esta página, y las claves de la billetera nunca se cargan junto a ella. Recarga la página y vuelve a intentarlo.',
  passkey_broken:
    'Este navegador no pasó la comprobación interna de la billetera. Calculó claves equivocadas a partir de un ejemplo conocido, así que aquí no se puede crear ni abrir ninguna billetera. Usa otro navegador. El error puede ser nuestro.',
};
