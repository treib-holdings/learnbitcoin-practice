// The text of the Sparrow page: using the practice network from a desktop wallet.
//
// The same shape as every file in this folder (see common.ts): one table per
// language with the same keys, plain strings, slots written {name}.
//
// The page has six steps, in the order SPEC section 12 gives them, and each
// heading carries its number. Three rules hold for every sentence here:
//
//   - Sparrow is named as one desktop wallet that can do this. Nothing here
//     recommends it, and nothing calls it the best or the safest.
//   - What the page says about Sparrow is what Sparrow's own documentation
//     and code say (screens/info/sparrow-guide.ts lists where each fact was
//     read). Where nobody here has seen it on a screen, the sentence says
//     "should".
//   - Sparrow's menus and buttons are English in every language. A Spanish
//     sentence keeps the English label and adds what it means in
//     parentheses, as the main site does.
//   - A label a reader has to find in Sparrow stands between backticks:
//     `File -> Settings`. The screen draws it in bold and marks it as
//     English that a translating browser leaves alone. That is the work of
//     screens/info/Says.svelte, which draws every sentence that holds a
//     label, a menu arrow or a slot; the backticks never reach the page.
//     The names of rows, and sentences handed to a piece as plain text,
//     carry no marks.
//
// The flag, the commands, the server's host and port and the derivation
// path are not typed here: they are slots, or values the screen shows
// beside these sentences. The address prefixes bcrt1, bc1 and tb1 are part
// of the sentences.
//
// The Spanish here is a first draft that no native reviewer has read yet.

export const en = {
  // -- the screen --
  title: 'Use the practice network from Sparrow',
  /** The screen's name in the document title, after the PRACTICE word. */
  name: 'Sparrow guide',
  lede: 'Sparrow Wallet is one desktop wallet that can open a practice wallet. It has to run in its Regtest mode, and that mode starts only with a flag.',
  /** The main site's stance on naming a product: an example, never an endorsement. */
  example: 'We name Sparrow as an example of a wallet that can do this, not as an endorsement.',
  /**
   * Shown on Spanish pages only. The English line is its translation, kept
   * so that both tables have the same keys.
   */
  interfaceEnglish:
    "Sparrow's menus and buttons are in English. They are written here as Sparrow shows them, with what they mean in parentheses.",

  // -- step 1 --
  computerTitle: '1. This needs a computer',
  computerBody: 'Sparrow is a desktop program for macOS, Windows and Linux. Do this part at a computer.',
  computerGet:
    "If Sparrow is not installed yet, get it from its publisher's own site, and verify the download the way that site explains before you run it.",
  /** The text of the link to that site. The Spanish one says the page is in English. */
  computerGetLink: "Sparrow's download page",

  // -- step 2 --
  startTitle: '2. Start Sparrow in Regtest mode',
  startBody:
    'The practice network is a regtest network: a private Bitcoin network for testing. Sparrow calls its mode for such a network Regtest.',
  /** The warning: nobody should pick Testnet or Signet because Regtest is not on the menu. */
  startMenu:
    "Sparrow's menu `Tools -> Restart In` lists Testnet and Signet networks, and no Regtest. Do not pick one of those in its place. They are other networks, and the practice coins are not on them.",
  /** {flag} is the flag itself. */
  startHow:
    'Regtest mode starts only from a command, with the flag {flag} after the name of the program. Quit Sparrow first if it is open, then run the command for your system.',
  /** The name of each command: which system, and where to type it. */
  startMac: 'macOS, in Terminal',
  startWindows: 'Windows, in a Command Prompt opened in the folder where Sparrow is installed',
  startLinux: 'Linux, in a terminal opened in the folder that holds the unpacked Sparrow folder',
  /** Beside a command the site's owner has run... */
  startRan: 'We ran this one ourselves.',
  /** ...and beside one that is taken from Sparrow's documentation and has not been run here. */
  startDocumented: "From Sparrow's own documentation. We have not run it ourselves.",
  /** {flag} is the flag itself. */
  startOther:
    'If Sparrow sits somewhere else on your system, the rule is the same: start its program with {flag} after it.',
  startApart:
    'Sparrow keeps the settings and wallets of Regtest mode in a folder of their own, apart from those of its other modes.',
  copyCommand: 'Copy command',
  saidCommand: 'Command copied',

  // -- step 3 --
  checkTitle: '3. Check the mode before you type a word',
  checkBody:
    "In Sparrow, choose `File -> New Wallet` and give the wallet any name. A tab opens for it. Sparrow marks every network other than Bitcoin's real one at the right end of that row of tabs, and there it should now say `Regtest`.",
  checkStop:
    'If nothing stands there, or it names another network, stop. Quit Sparrow and start it again with the command from step 2.',
  checkSure: 'The check that settles it is in step 6: the addresses.',

  // -- step 4 --
  serverTitle: '4. Point Sparrow at the practice server',
  serverBody:
    "Open Sparrow's settings (`File -> Settings`, or `Sparrow -> Settings` on a Mac) and go to `Server`. Choose `Private Electrum` and enter these values.",
  /** The names of the three values: two as Sparrow labels them, and the port's box, which has no label in Sparrow. */
  serverHost: 'URL',
  serverPort: 'Port, in the box beside the URL',
  serverSsl: 'Use SSL',
  serverSslOn: 'On',
  serverTest: 'Then press `Test Connection` to see that Sparrow reaches the server.',
  serverSees:
    "Sparrow talks to this server directly. The server sees the wallet's addresses and your computer's IP address, as any wallet's server does.",
  copyHost: 'Copy URL',
  saidHost: 'URL copied',
  copyPort: 'Copy port',
  saidPort: 'Port copied',

  // -- step 5 --
  bringTitle: '5. Bring the wallet in',
  bringBody:
    'There are two ways. The first needs no 12 words, so it is the safer one. Sparrow can then see the wallet and cannot spend from it.',
  watchTitle: 'Watch only, with a descriptor',
  watchBody:
    "A descriptor is a line of text that tells another program which addresses belong to a wallet. It holds public keys only.",
  /** The name of the line that follows, shown above it. */
  watchLabel: 'The receive descriptor of the wallet in this browser',
  copyDescriptor: 'Copy descriptor',
  saidDescriptor: 'Descriptor copied',
  /** A link to Settings follows it. */
  watchSettings: 'Both descriptors, receive and change, are on the Settings screen.',
  watchSettingsLink: 'Open Settings',
  /**
   * In place of the line, should this page fail to work the descriptor out.
   * The cause, whose fault it is, then the way out.
   */
  watchFailed:
    "This page could not work out this wallet's descriptor. That is our fault, not your wallet's. The 12 words, further down, still bring the wallet into Sparrow.",
  /** Above each list of what to do in Sparrow. */
  inSparrow: 'In Sparrow:',
  // The watch-only way, one action to a line.
  watchOpen: 'Open the `Settings` tab of the new wallet.',
  watchEdit: 'Press `Edit` beside `Descriptor`.',
  watchPut: 'Put the line in place of what is there.',
  watchApply: 'Press `Apply`.',
  watchChange: 'Sparrow works out the change addresses from the same key.',
  wordsTitle: 'Or restore from the 12 words',
  wordsBody: 'With the 12 words Sparrow holds the keys as well, so it can send.',
  // The 12-word way, one action to a line. The button's words are the
  // program's own, "Use 24 Words" (screens/info/sparrow-guide.ts says where
  // they were read, and why Sparrow's guide prints other words).
  wordsChoose: 'In the `Settings` tab of the new wallet, choose `New or Imported Software Wallet`.',
  wordsKind: 'Then choose `Mnemonic Words (BIP39)`.',
  wordsCount: 'Open the list beside `Use 24 Words` and choose `Use 12 Words`.',
  wordsType: 'Type the 12 words in order.',
  /** {path} is the wallet's derivation path. */
  wordsPath: 'Sparrow then shows the derivation path. Leave it as it is: it should read {path}.',
  wordsFinish: "Follow Sparrow's steps to the end, and press `Apply`.",
  /** The exception line: these words are for practice, wherever they are typed. */
  wordsException:
    'Practice words only. These words have been on a web page, so they must never guard real bitcoin, in Sparrow or anywhere else.',
  /** A link to Backup follows it. */
  wordsBackup: 'The 12 words are on the Backup screen.',
  wordsBackupLink: 'Open Backup',

  // -- step 5, where this browser has no wallet it can use: the cause, then the way out --
  /** A link to the start page follows it. */
  needNone:
    'This browser has no practice wallet yet, so there is nothing to bring into Sparrow. Create one, or open one you already have, then come back to this step.',
  needNoneLink: 'Create or open a practice wallet',
  /** A link to the wallet's screen follows it: the gate there offers Reload and Remove. */
  needUnreadable:
    'The practice wallet stored in this browser cannot be read, so this page cannot show its descriptor or lead you to its 12 words. The wallet screen says what can be done about it.',
  needUnreadableLink: 'Open the wallet screen',
  /** A Reload button follows it. */
  needNewer:
    'The practice wallet in this browser was saved by a newer version of this page, and this older version leaves it alone. Reload the page, then come back to this step.',
  /** The browser did not let this page read its storage: never "no wallet yet". A Reload button follows it. */
  needBlocked:
    "This browser did not let this page read what it may have stored here, so the page cannot tell whether a practice wallet is here to bring into Sparrow. That happens when site data is blocked, inside some apps' built-in browsers, and when the browser's own storage is not working. Allow site data for this page, or open this page in your device's own browser, then reload it and come back to this step.",

  // -- step 6 --
  addressesTitle: '6. Check that the addresses start bcrt1',
  addressesBody:
    "In Sparrow, open the wallet's `Receive` tab or its `Addresses` tab, and read the first characters of the addresses.",
  addressesGood:
    'If they start bcrt1, Sparrow is in Regtest mode. Connected to the practice server, it shows the same coins as this page.',
  /** Word for word from SPEC section 12. The Send screen says the same of a real address. */
  addressesReal:
    "If they start bc1, Sparrow is on Bitcoin's real network. Delete that wallet in Sparrow and never send bitcoin to it.",
  addressesWhy:
    'Words that have been on a web page are for practice only, because whoever has seen them can spend what they guard.',
  addressesTest:
    'If they start tb1, Sparrow is in another test mode. Quit it and start it again with the command from step 2.',
} as const;

export const es: Record<keyof typeof en, string> = {
  title: 'Usa la red de práctica desde Sparrow',
  name: 'Guía de Sparrow',
  lede: 'Sparrow Wallet es una de las billeteras de escritorio que pueden abrir una billetera de práctica. Tiene que funcionar en su modo Regtest, y ese modo solo arranca con una opción en el comando.',
  example: 'Nombramos a Sparrow como ejemplo de una billetera que puede hacerlo, no como recomendación.',
  interfaceEnglish:
    'Los menús y los botones de Sparrow están en inglés. Aquí aparecen tal como Sparrow los muestra, con su significado entre paréntesis.',

  computerTitle: '1. Hace falta una computadora',
  computerBody: 'Sparrow es un programa de escritorio para macOS, Windows y Linux. Esta parte se hace en una computadora.',
  computerGet:
    'Si todavía no tienes Sparrow instalado, descárgalo del sitio de quien lo publica y, antes de abrirlo, verifica la descarga como ese sitio explica.',
  computerGetLink: 'Página de descargas de Sparrow (en inglés)',

  startTitle: '2. Abre Sparrow en modo Regtest',
  startBody:
    'La red de práctica es una red regtest: una red privada de Bitcoin para hacer pruebas. Sparrow llama Regtest a su modo para una red así.',
  startMenu:
    'El menú `Tools -> Restart In` (Herramientas -> Reiniciar en) de Sparrow ofrece redes Testnet y Signet, y ninguna Regtest. No elijas una de esas en su lugar. Son otras redes, y las monedas de práctica no están en ellas.',
  startHow:
    'El modo Regtest solo arranca desde un comando, con la opción {flag} después del nombre del programa. Si Sparrow está abierto, ciérralo primero, y luego ejecuta el comando de tu sistema.',
  startMac: 'macOS, en la app Terminal',
  startWindows: 'Windows, en un Símbolo del sistema abierto en la carpeta donde está instalado Sparrow',
  startLinux: 'Linux, en una terminal abierta en la carpeta que contiene la carpeta Sparrow ya descomprimida',
  startRan: 'Este lo ejecutamos nosotros.',
  startDocumented: 'Viene de la documentación de Sparrow. No lo hemos ejecutado.',
  startOther:
    'Si Sparrow está en otro lugar de tu sistema, la regla es la misma: abre su programa con {flag} al final.',
  startApart:
    'Sparrow guarda la configuración y las billeteras del modo Regtest en una carpeta propia, aparte de las de sus otros modos.',
  copyCommand: 'Copiar comando',
  saidCommand: 'Comando copiado',

  checkTitle: '3. Comprueba el modo antes de escribir una sola palabra',
  checkBody:
    'En Sparrow, elige `File -> New Wallet` (Archivo -> Nueva billetera) y ponle cualquier nombre a la billetera. Se abre una pestaña para ella. Sparrow marca toda red que no sea la red real de Bitcoin en el extremo derecho de esa fila de pestañas, y ahí ahora debería decir `Regtest`.',
  checkStop:
    'Si ahí no hay nada, o aparece el nombre de otra red, detente. Cierra Sparrow y vuelve a abrirlo con el comando del paso 2.',
  checkSure: 'La comprobación que lo confirma está en el paso 6: las direcciones.',

  serverTitle: '4. Conecta Sparrow al servidor de práctica',
  serverBody:
    'Abre la configuración de Sparrow (`File -> Settings`, o `Sparrow -> Settings` en una Mac) y ve a `Server` (Servidor). Elige `Private Electrum` (Electrum privado) y escribe estos valores.',
  serverHost: 'URL',
  serverPort: 'Puerto, en el campo junto a la URL',
  serverSsl: 'Use SSL (usar SSL)',
  serverSslOn: 'Activado',
  serverTest: 'Luego presiona `Test Connection` (Probar conexión) para ver que Sparrow llega al servidor.',
  serverSees:
    'Sparrow habla directamente con este servidor. El servidor ve las direcciones de la billetera y la dirección IP de tu computadora, como el servidor de cualquier billetera.',
  copyHost: 'Copiar URL',
  saidHost: 'URL copiada',
  copyPort: 'Copiar puerto',
  saidPort: 'Puerto copiado',

  bringTitle: '5. Lleva la billetera a Sparrow',
  bringBody:
    'Hay dos formas. La primera no necesita las 12 palabras, así que es la más segura. Con ella Sparrow puede ver la billetera y no puede gastar sus monedas.',
  watchTitle: 'Solo lectura, con un descriptor',
  watchBody:
    'Un descriptor (descriptor de salida) es una línea de texto que le dice a otro programa qué direcciones pertenecen a una billetera. Contiene solo claves públicas.',
  watchLabel: 'El descriptor de recepción de la billetera de este navegador',
  copyDescriptor: 'Copiar descriptor',
  saidDescriptor: 'Descriptor copiado',
  watchSettings: 'Los dos descriptores, el de recepción y el de cambio, están en la pantalla Configuración.',
  watchSettingsLink: 'Abrir Configuración',
  watchFailed:
    'Esta página no pudo calcular el descriptor de esta billetera. Es un error nuestro, no de tu billetera. Las 12 palabras, más abajo, todavía sirven para llevar la billetera a Sparrow.',
  inSparrow: 'En Sparrow:',
  watchOpen: 'Abre la pestaña `Settings` (Configuración) de la billetera nueva.',
  watchEdit: 'Presiona `Edit` (Editar) junto a `Descriptor`.',
  watchPut: 'Pon la línea en lugar de lo que haya.',
  watchApply: 'Presiona `Apply` (Aplicar).',
  watchChange: 'Sparrow calcula las direcciones de cambio a partir de la misma clave.',
  wordsTitle: 'O restaura desde las 12 palabras',
  wordsBody: 'Con las 12 palabras Sparrow tiene también las claves, así que puede enviar.',
  wordsChoose:
    'En la pestaña `Settings` (Configuración) de la billetera nueva, elige `New or Imported Software Wallet` (billetera de software nueva o importada).',
  wordsKind: 'Luego elige `Mnemonic Words (BIP39)`.',
  wordsCount: 'Abre la lista junto a `Use 24 Words` y elige `Use 12 Words` (usar 12 palabras).',
  wordsType: 'Escribe las 12 palabras en orden.',
  wordsPath: 'Sparrow muestra después la ruta de derivación. Déjala como está: debería decir {path}.',
  wordsFinish: 'Sigue los pasos de Sparrow hasta el final, y presiona `Apply` (Aplicar).',
  wordsException:
    'Solo palabras de práctica. Estas palabras estuvieron en una página web, así que nunca deben proteger bitcoin de verdad, ni en Sparrow ni en ningún otro lugar.',
  wordsBackup: 'Las 12 palabras están en la pantalla Respaldo.',
  wordsBackupLink: 'Abrir Respaldo',

  needNone:
    'Este navegador todavía no tiene billetera de práctica, así que no hay nada que llevar a Sparrow. Crea una, o abre una que ya tengas, y vuelve a este paso.',
  needNoneLink: 'Crear o abrir una billetera de práctica',
  needUnreadable:
    'La billetera de práctica guardada en este navegador no se puede leer, así que esta página no puede mostrar su descriptor ni llevarte a sus 12 palabras. La pantalla de la billetera dice qué se puede hacer.',
  needUnreadableLink: 'Abrir la pantalla de la billetera',
  needNewer:
    'La billetera de práctica de este navegador fue guardada por una versión más nueva de esta página, y esta versión más vieja no la toca. Recarga la página y vuelve a este paso.',
  needBlocked:
    'Este navegador no dejó que esta página leyera lo que pueda tener guardado aquí, así que la página no puede saber si aquí hay una billetera de práctica para llevar a Sparrow. Pasa cuando los datos del sitio están bloqueados, dentro del navegador integrado de algunas apps, y cuando el almacenamiento del propio navegador no funciona. Permite los datos del sitio para esta página, o abre esta página en el navegador propio de tu dispositivo, y después recárgala y vuelve a este paso.',

  addressesTitle: '6. Comprueba que las direcciones empiecen por bcrt1',
  addressesBody:
    'En Sparrow, abre la pestaña `Receive` (Recibir) o la pestaña `Addresses` (Direcciones) de la billetera, y lee los primeros caracteres de las direcciones.',
  addressesGood:
    'Si empiezan por bcrt1, Sparrow está en modo Regtest. Conectado al servidor de práctica, muestra las mismas monedas que esta página.',
  addressesReal:
    'Si empiezan por bc1, Sparrow está en la red real de Bitcoin. Elimina esa billetera en Sparrow y nunca le envíes bitcoin.',
  addressesWhy:
    'Las palabras que estuvieron en una página web solo sirven para practicar, porque quien las haya visto puede gastar lo que protegen.',
  addressesTest:
    'Si empiezan por tb1, Sparrow está en otro modo de prueba. Ciérralo y vuelve a abrirlo con el comando del paso 2.',
};
