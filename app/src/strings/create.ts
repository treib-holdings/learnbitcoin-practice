// The text of the Create screen: making a wallet with a passkey or without one.
//
// The same shape as every file in this folder (see common.ts): one table per
// language with the same keys, plain strings, slots written {name}.
//
// Before either tap the screen says what is about to happen, in the
// reader's words: what the device will ask, where the 12 words come from,
// and where they are kept. After a tap that made no wallet it says what was
// saved and what was not. The sentence for a passkey step that did not
// finish comes from the error table (errors.ts, through the shared
// PasskeyProblem piece); the lines here are what Create adds under it.
//
// The Spanish here is a first draft that no native reviewer has read yet.

export const en = {
  lede: "There are two ways to make one. They differ in where the wallet's 12 words are kept.",

  // -- with a passkey: where the 12 words come from, and what the device is about to ask, before the tap --
  passkeyTitle: 'With a passkey',
  passkeyMakes:
    "The wallet's 12 words are made from a passkey that your password manager keeps. The same passkey always gives the same 12 words, so the wallet can open on your other devices.",
  /** {name} is how the name of every practice passkey starts (passkeyName in common.ts, up to its tag). */
  passkeyAsk:
    'Your device will ask to save a passkey named "{name}" with a tag of four characters, and to confirm it is you. It may call this signing in. There is no account behind it.',
  passkeySent: 'Neither the passkey nor the 12 words are sent to us.',
  passkeyGo: 'Create with a passkey',
  /** On the button while the device's passkey prompt is open. */
  passkeyBusy: 'Waiting for your passkey...',
  /** On the button until this browser has said whether it offers passkeys. */
  passkeyChecking: 'Checking this browser...',
  passkeyNotOffered:
    "This browser offers no passkey that a wallet can be made from. If you followed a link inside another app, open this page in your device's own browser to get this choice. Or create the wallet without a passkey, below.",

  // -- a passkey that was saved and has not given its secret yet --
  /**
   * {tag} is the four characters in the passkey's name. The last sentence
   * is there because this page holds a waiting passkey in memory only:
   * after a reload Create offers a new one, which would be a second passkey,
   * and the first stays in the password manager. (It is not lost: "Open
   * with my passkey" still makes its wallet. So the text does not say that
   * it must be deleted. And it is kept short: on a small phone the line and
   * the button under it should fit on one screen.)
   */
  unfinishedTagged:
    'Your device saved the passkey with "{tag}" in its name, but the passkey has not yet given this page the secret number a wallet is made from. So no wallet has been made yet. One more confirmation finishes it. Do that before you reload or close this page: a fresh page will not know that this passkey is waiting.',
  unfinished:
    'Your device saved the passkey, but the passkey has not yet given this page the secret number a wallet is made from. So no wallet has been made yet. One more confirmation finishes it. Do that before you reload or close this page: a fresh page will not know that this passkey is waiting.',
  finishGo: 'Finish setting up',
  /** After a try to finish it that did not. */
  unfinishedAgain:
    'The prompt closed before the passkey answered, so the wallet is still not made. If this tab was not in front, bring it to the front and try again. Or create the wallet without a passkey, below.',

  // -- what Create adds under a passkey step that did not finish --
  cancelledNothing: 'No passkey was saved and no wallet was made.',
  cancelledWays:
    'A browser also closes the prompt by itself when this tab is not in front: bring the tab to the front and try again. Or create the wallet without a passkey, below.',
  stillWaiting: 'The passkey is still saved and still waiting. Try again, or create the wallet without a passkey, below.',
  /**
   * {host} is the site the passkey was saved for, {tag} the four characters
   * in its name. By the time this shows, the page has already asked the
   * password manager to drop the passkey. Some do and some do not, so the
   * text holds either way: the reader is not sent looking for a passkey
   * that is gone.
   */
  noPrfDeleteTagged:
    'Your password manager may already have deleted that passkey. If it is still listed there (under {host}, with "{tag}" in its name), delete it: it is of no use now.',
  noPrfDelete:
    'Your password manager may already have deleted that passkey. If it is still listed there (the newest one under {host}), delete it: it is of no use now.',
  noPrfElsewhere:
    'A passkey saved in another password manager, or on a phone, may work: try again and choose that place when your device asks where to save it.',
  /**
   * Under "a wallet arrived from another tab" and "this browser stores nothing", and under the card for a
   * storage this page was not let read, when the tap had opened a passkey prompt.
   */
  orphan:
    'If your device saved a new passkey a moment ago, that passkey has no wallet. You can delete it in your password manager.',

  // -- without a passkey: what it means, before the tap --
  wordsTitle: 'Without a passkey',
  wordsKept:
    'This page will pick 12 random words and keep them in this browser, not encrypted. Anyone who uses this browser can open the wallet and spend from it.',
  /** {days} is how long Safari keeps what a site stored without the site being used. */
  wordsErased:
    'A browser can also erase them: Safari does if you go {days} days without using the site, and clearing your browsing data does in any browser. Write the 12 words on paper when the next screen shows them. They are the only way back to this wallet.',
  wordsGo: 'Create without a passkey',
  wordsBusy: 'Creating the wallet...',
  /** An answer this tap should never get. The browser's or the page's own name for it goes in a details line. */
  wordsFailed:
    'This page could not make the wallet. That is a bug on our side, not something you did. Reload the page and try again.',

  foot: 'Practice only. This wallet cannot hold real bitcoin.',
} as const;

export const es: Record<keyof typeof en, string> = {
  lede: 'Hay dos formas de crearla. Lo que cambia es dónde quedan guardadas las 12 palabras de la billetera.',

  passkeyTitle: 'Con llave de acceso (passkey)',
  passkeyMakes:
    'Las 12 palabras de la billetera salen de una llave de acceso que guarda tu administrador de contraseñas. La misma llave de acceso da siempre las mismas 12 palabras, así que la billetera se puede abrir en tus otros dispositivos.',
  passkeyAsk:
    'Tu dispositivo te va a pedir que guardes una llave de acceso llamada "{name}" con una etiqueta de cuatro caracteres, y que confirmes que eres tú. Puede que lo llame "iniciar sesión". Detrás no hay ninguna cuenta.',
  passkeySent: 'Ni la llave de acceso ni las 12 palabras se nos envían.',
  passkeyGo: 'Crear con llave de acceso',
  passkeyBusy: 'Esperando tu llave de acceso...',
  passkeyChecking: 'Comprobando este navegador...',
  passkeyNotOffered:
    'Este navegador no ofrece ninguna llave de acceso con la que se pueda crear una billetera. Si llegaste por un enlace dentro de otra app, abre esta página en el navegador propio de tu dispositivo para tener esta opción. O crea la billetera sin llave de acceso, más abajo.',

  unfinishedTagged:
    'Tu dispositivo guardó la llave de acceso que tiene "{tag}" en su nombre, pero la llave todavía no le entregó a esta página el número secreto del que sale una billetera. Por eso todavía no se creó ninguna billetera. Con una confirmación más queda lista. Hazlo antes de recargar o cerrar esta página: una página recién cargada no sabrá que esta llave de acceso está esperando.',
  unfinished:
    'Tu dispositivo guardó la llave de acceso, pero la llave todavía no le entregó a esta página el número secreto del que sale una billetera. Por eso todavía no se creó ninguna billetera. Con una confirmación más queda lista. Hazlo antes de recargar o cerrar esta página: una página recién cargada no sabrá que esta llave de acceso está esperando.',
  finishGo: 'Terminar la configuración',
  unfinishedAgain:
    'La ventana se cerró antes de que la llave de acceso respondiera, así que la billetera sigue sin crearse. Si esta pestaña no estaba al frente, tráela al frente y vuelve a intentarlo. O crea la billetera sin llave de acceso, más abajo.',

  cancelledNothing: 'No se guardó ninguna llave de acceso y no se creó ninguna billetera.',
  cancelledWays:
    'Un navegador también cierra esa ventana por su cuenta cuando esta pestaña no está al frente: tráela al frente y vuelve a intentarlo. O crea la billetera sin llave de acceso, más abajo.',
  stillWaiting:
    'La llave de acceso sigue guardada y sigue esperando. Vuelve a intentarlo, o crea la billetera sin llave de acceso, más abajo.',
  noPrfDeleteTagged:
    'Puede que tu administrador de contraseñas ya haya borrado esa llave de acceso. Si todavía aparece ahí (en {host}, con "{tag}" en su nombre), bórrala: ya no sirve.',
  noPrfDelete:
    'Puede que tu administrador de contraseñas ya haya borrado esa llave de acceso. Si todavía aparece ahí (la más reciente de {host}), bórrala: ya no sirve.',
  noPrfElsewhere:
    'Una llave de acceso guardada en otro administrador de contraseñas, o en un celular, puede funcionar: vuelve a intentarlo y elige ese lugar cuando tu dispositivo pregunte dónde guardarla.',
  orphan:
    'Si tu dispositivo guardó una llave de acceso nueva hace un momento, esa llave no tiene billetera. Puedes borrarla en tu administrador de contraseñas.',

  wordsTitle: 'Sin llave de acceso',
  wordsKept:
    'Esta página va a elegir 12 palabras al azar y las va a guardar en este navegador, sin cifrar. Cualquier persona que use este navegador puede abrir la billetera y gastar sus monedas.',
  wordsErased:
    'Un navegador también puede borrarlas: Safari lo hace si pasas {days} días sin usar el sitio, y borrar los datos de navegación las elimina en cualquier navegador. Escribe las 12 palabras en papel cuando la siguiente pantalla las muestre. Son la única forma de volver a esta billetera.',
  wordsGo: 'Crear sin llave de acceso',
  wordsBusy: 'Creando la billetera...',
  wordsFailed:
    'Esta página no pudo crear la billetera. Es un error nuestro, no algo que hayas hecho tú. Recarga la página y vuelve a intentarlo.',

  foot: 'Solo para practicar. Esta billetera no puede guardar bitcoin de verdad.',
};
