// The text of the Backup screen: the 12 words, the "Wallet made" step and the printable sheet.
//
// The same shape as every file in this folder (see common.ts): one table per
// language with the same keys, plain strings, slots written {name}.
//
// Four things the screen shows are not in this table. Three are shared: the
// screen's name ("Backup", in common.ts), the short form of the exception
// paragraph that is printed at the top of the sheet (wordsException, in
// wallet.ts), and the line a Spanish screen puts under the words to say that
// they are English on purpose (the words list adds it itself). The fourth is
// the name of a passkey this page has just made: the wallet hands it over as
// it wrote it then, in whichever language the page had at that moment.
//
// The exception paragraph is here in full. Chapter 4 of the main site tells
// its readers never to type a seed into a website, and this screen puts 12
// words on a web page. The paragraph gives the one reason that makes this
// page an exception: the words guard play money. It never argues that the
// page can be trusted, because a scam page could say the same.
//
// The Spanish here is a first draft that no native reviewer has read yet.

export const en = {
  // -- the screen before the words are shown --
  /** The heading of the part that shows the words. */
  wordsTitle: 'The 12 words',
  /** The exception paragraph: three sentences, the reason in the middle one. */
  exception:
    'Chapter 4 of the Journey says never to type your seed into a website, and to keep it only on your wallet device and on backups you made yourself. This page is the one exception, because the 12 words here only guard play money, practice coins that are worth nothing. The words of a wallet that holds real bitcoin never go into a web page, this one included.',
  /**
   * A link to that chapter on the main site, under the paragraph. It is kept
   * short: it stands at the start of a line of its own and must never reach
   * the line's end, where the arrow that marks an outside link could wrap
   * onto a line by itself.
   */
  chapterLink: 'Chapter 4 of the Journey',
  /** What the reader should know before the words are on screen. */
  before:
    'These 12 words are the whole wallet. Anyone who sees them can spend its coins from any device. Check that nobody else can see your screen.',
  /** Said before the words are shown: a screen reader reads out whatever is on the page. */
  spokenAloud: 'A screen reader will read the 12 words aloud. Use headphones, or check that nobody else can hear.',
  show: 'Show the 12 words',
  /** The one line the unlock step shows: what the keys are needed for here. */
  unlockWhy: 'Showing the 12 words needs the keys of this wallet, and your passkey loads them.',
  /** The wallet said it was unlocked and still gave no words. The cause, then the way out. */
  revealFailed:
    'The 12 words could not be shown. The wallet in this browser may have changed in another tab while this page was open. Reload the page and try again.',
  /**
   * The words were on screen and left it, because another tab changed the
   * wallet in this browser. What happened, whose words they were, then the
   * way on.
   */
  wordsWithdrawn:
    'The wallet in this browser changed in another tab, so the 12 words were taken off the screen. They belonged to the wallet that was here before. Ask again to see the words of the wallet that is here now.',

  // -- the words, shown --
  /** The heading while the words are on screen, and of the words at the "Wallet made" step. */
  shownTitle: 'Your 12 words',
  after:
    'Write them on paper, in order, as you would for a real wallet. Take no photo and no screenshot, even though these are practice words. This is a rehearsal for the day the words guard real money.',
  /** The line that keeps practice words from ever being used for a real wallet. */
  neverRealMoney:
    'Never put real money on these 12 words. Words that have been on a web page are for practice only: a real wallet should make its own.',
  hide: 'Hide them',

  // -- the "Wallet made" step, straight after a create --
  madeTitle: 'Wallet made',
  madeLede: 'This browser now has a practice wallet. Write down its 12 words before you go on.',
  /** A wallet made with a passkey: the name its passkey was saved under and where the passkey lives, above the words. */
  madePasskeyTitle: 'Your passkey',
  /**
   * The row that holds the passkey's whole name. The wallet hands it over
   * as it wrote it when it made the passkey (WalletApi.createdName): this
   * step is the one place that can show it.
   */
  madePasskeyName: 'Saved as',
  /** Under that row: whose name it is, where the reader meets it, and what the tag in it is for. */
  madePasskeyNameIs:
    'This page gave the passkey this name when it made it, a moment ago. A password manager lists the passkey under it. The tag of four characters in the name tells this passkey from any other you have.',
  /**
   * The row that holds the tag, where the wallet has no name to hand over.
   * The tag then stands for the name: a whole name built on this screen
   * could be the one in the other language, which the reader's password
   * manager does not list.
   */
  madePasskeyTag: 'Tag in its name',
  /** Under the row: what the tag is, and what it is for. */
  madePasskeyTagIs:
    'The tag is a short code that this page put in the name it gave the passkey. It tells this passkey from any other you have.',
  /**
   * Where the passkey lives. The reader chose that at the prompt: a
   * password manager, or a security key, which syncs nowhere.
   */
  madePasskeyWhere:
    'The passkey is kept by your password manager, or on the security key you used. A password manager may sync it to your other devices.',
  /** Under the words: the one line that says what they are for when there is a passkey. */
  madePasskeyBack: 'If the passkey ever fails or is lost, these 12 words are the way back to this wallet.',
  /** A wallet made without a passkey, under the words: what this browser now keeps, and who can look and spend. */
  madeKeepsTitle: 'What this browser now keeps',
  madeKeepsWords: 'This browser now keeps the 12 words of this wallet, not encrypted.',
  madeKeepsWho: 'Anyone who uses this browser can see the wallet and spend its coins.',
  /** {days} is how long Safari keeps what a page stored when the page is not used. */
  madeKeepsCleared:
    'A browser can erase what a page has stored. Safari does if you go {days} days without using this page, and clearing your browsing data does it in any browser. After that, only the 12 words on paper bring the wallet back.',
  /** Only when the browser was asked to keep the page's data and said no. */
  madeNotPersisted:
    'This browser was asked to keep what this page stores, and did not agree. So it may also erase the wallet by itself when the device runs short of space.',
  written: 'I have written them down',

  // -- the practice sheet: the main site's 12-word backup form, blank, for paper --
  //
  // The form is the one chapter 4 of the Journey offers for a real wallet.
  // The three lines printed on each card are the form's own, word for word:
  // its title and its two warnings. This is working copy: a copy pass comes later.
  cardTitle: 'A practice backup sheet to print',
  /**
   * What the sheet is, how many cards it prints ({cards}), that the words
   * are written by hand, and that they are never printed.
   */
  cardLead:
    "This is LearnBitcoin's 12-word backup form, marked for practice. The sheet prints {cards} blank cards: write the 12 words on one by hand, in order. The words themselves are never printed, whether they are showing or not.",
  /** The form's title: printed at the top of each card, and at the top of the sheet. */
  cardName: 'Recovery Seed Phrases',
  /** The form's two warnings, each beside a small shield. */
  cardNoCopies: "Don't make digital copies",
  cardNoSharing: 'Never share with anyone',
  /** Printed under the last row of each card. The form has no such line: a practice card needs it. */
  cardRestores: 'Restores only on the practice network.',
  cardPrint: 'Print the sheet',
} as const;

export const es: Record<keyof typeof en, string> = {
  wordsTitle: 'Las 12 palabras',
  exception:
    'El capítulo 4 del Recorrido dice que nunca escribas tu frase semilla en un sitio web, y que solo debe vivir en tu dispositivo de billetera y en los respaldos que tú hiciste. Esta página es la única excepción, porque sus 12 palabras solo protegen dinero de juguete, monedas de práctica que no valen nada. Las palabras de una billetera con bitcoin de verdad nunca van en una página web, incluida esta.',
  chapterLink: 'Capítulo 4 del Recorrido',
  before:
    'Estas 12 palabras son la billetera entera. Quien las vea puede gastar sus monedas desde cualquier dispositivo. Revisa que nadie más pueda ver tu pantalla.',
  spokenAloud:
    'Un lector de pantalla va a leer las 12 palabras en voz alta. Usa audífonos, o revisa que nadie más pueda oír.',
  show: 'Mostrar las 12 palabras',
  unlockWhy:
    'Para mostrar las 12 palabras hacen falta las claves de esta billetera, y tu llave de acceso (passkey) las carga.',
  revealFailed:
    'No se pudieron mostrar las 12 palabras. Puede que la billetera de este navegador haya cambiado en otra pestaña mientras esta página estaba abierta. Recarga la página y vuelve a intentarlo.',
  wordsWithdrawn:
    'La billetera de este navegador cambió en otra pestaña, así que las 12 palabras se quitaron de la pantalla. Eran de la billetera que estaba aquí antes. Vuelve a pedirlas para ver las palabras de la billetera que está aquí ahora.',

  shownTitle: 'Tus 12 palabras',
  after:
    'Escríbelas en papel, en orden, como lo harías con una billetera de verdad. No les tomes foto ni captura de pantalla, aunque sean palabras de práctica. Es un ensayo para el día en que las palabras protejan dinero de verdad.',
  neverRealMoney:
    'Nunca pongas dinero de verdad en estas 12 palabras. Las palabras que estuvieron en una página web solo sirven para practicar: una billetera de verdad debe generar las suyas.',
  hide: 'Ocultarlas',

  madeTitle: 'Billetera creada',
  madeLede: 'Este navegador ya tiene una billetera de práctica. Antes de seguir, escribe sus 12 palabras en papel.',
  madePasskeyTitle: 'Tu llave de acceso (passkey)',
  madePasskeyName: 'Guardada como',
  madePasskeyNameIs:
    'Esta página le dio este nombre a la llave de acceso al crearla, hace un momento. Un administrador de contraseñas la muestra con ese nombre. La etiqueta de cuatro caracteres que va en el nombre la distingue de cualquier otra que tengas.',
  madePasskeyTag: 'Etiqueta en su nombre',
  madePasskeyTagIs:
    'La etiqueta es un código corto que esta página puso en el nombre que le dio a la llave de acceso. La distingue de cualquier otra que tengas.',
  madePasskeyWhere:
    'La llave de acceso la guarda tu administrador de contraseñas, o queda en la llave de seguridad que usaste. Un administrador de contraseñas puede sincronizarla con tus otros dispositivos.',
  madePasskeyBack:
    'Si alguna vez la llave de acceso falla o se pierde, estas 12 palabras son la forma de volver a esta billetera.',
  madeKeepsTitle: 'Lo que este navegador guarda ahora',
  madeKeepsWords: 'Este navegador ahora guarda las 12 palabras de esta billetera, sin cifrar.',
  madeKeepsWho: 'Cualquiera que use este navegador puede ver la billetera y gastar sus monedas.',
  madeKeepsCleared:
    'Un navegador puede borrar lo que una página guardó. Safari lo hace si pasas {days} días sin usar esta página, y borrar los datos de navegación lo hace en cualquier navegador. Después de eso, solo las 12 palabras en papel devuelven la billetera.',
  madeNotPersisted:
    'A este navegador se le pidió conservar lo que esta página guarda, y no aceptó. Así que también puede borrar la billetera por su cuenta cuando al dispositivo le falte espacio.',
  written: 'Ya las escribí',

  cardTitle: 'Una hoja de respaldo de práctica para imprimir',
  cardLead:
    'Este es el formulario de respaldo de 12 palabras de LearnBitcoin, marcado para práctica. La hoja imprime {cards} tarjetas en blanco: escribe las 12 palabras en una, a mano y en orden. Las palabras mismas nunca se imprimen, se estén mostrando o no.',
  cardName: 'Frases semilla de recuperación',
  cardNoCopies: 'No hagas copias digitales',
  cardNoSharing: 'No las compartas con nadie',
  cardRestores: 'Solo se restaura en la red de práctica.',
  cardPrint: 'Imprimir la hoja',
};
