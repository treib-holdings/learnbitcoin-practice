// The text of the app's shell: what is on screen whichever screen is open.
//
// Every file in this folder has the same shape: one table per language with
// the same keys. A value is a plain string. A slot is written {name} and
// filled with fill() from lib/format.ts, so a whole sentence is written once
// per language and never glued together from parts. English is plain ASCII;
// Spanish adds only its accented letters. test/strings.test.ts holds every
// table to these rules.
//
// The Spanish here is a first draft that no native reviewer has read yet.

export const en = {
  // -- names --
  siteName: 'LearnBitcoin',
  appName: 'Practice wallet',
  /** What a screen reader says for the logo link in the header. */
  homeLabel: 'LearnBitcoin practice wallet, home',
  skipToContent: 'Skip to content',

  // -- the PRACTICE marker: on every screen, so a screenshot taken anywhere says these coins are not real --
  /** The banner across the top, on wide screens. */
  markerBanner: 'LearnBitcoin practice network: play money with no value. These are not real bitcoin.',
  /** The banner on a phone, where the long one would take two lines. */
  markerBannerShort: 'Practice network: play money, no value.',
  /** The badge beside the logo, and the stamp on anything printed. */
  markerBadge: 'Practice',
  /** The words behind the marker, where it needs a text alternative. */
  markerNote: 'Practice network. These coins have no value.',
  /** Every page title starts with the word, so a tab and a bookmark carry the marker too. */
  markerTitle: 'Practice: {screen} | LearnBitcoin',
  /**
   * The title of the Home screen. In English it is the title index.html
   * carries, word for word: Home is the one page a search engine may list,
   * and its title must not change when the script starts.
   */
  homeTitle: 'Practice wallet | LearnBitcoin',

  // -- units: sats, sat/vB and vB are written the same in every language --
  sat: 'sat',
  sats: 'sats',
  /** After an amount of exactly 1. */
  practiceSat: 'practice sat',
  /** After any other amount. An amount never stands without it, and never beside a price. */
  practiceSats: 'practice sats',
  /** The head of a column of amounts, said once for the column. */
  practiceSatsHeading: 'Practice sats',
  feeRateUnit: 'sat/vB',
  vbyteUnit: 'vB',

  // -- the wallet's sections: the key is "section_" and the route's name --
  sectionsLabel: 'Wallet sections',
  section_wallet: 'Overview',
  section_coins: 'Coins',
  section_receive: 'Receive',
  section_send: 'Send',
  section_activity: 'Activity',
  section_backup: 'Backup',
  section_settings: 'Settings',

  // -- links in the header and the footer --
  linkAbout: 'About',
  linkSparrow: 'Practice network in Sparrow',
  linkSite: 'Back to LearnBitcoin.com',
  /**
   * The source is in English only. The Spanish text says so, as the main
   * site does for a link from a Spanish page to an English one.
   */
  linkSource: 'Source code',
  /** What a screen reader calls the header's links and the footer's. */
  navMain: 'Main',
  navFooter: 'Footer',
  /** Read out after a link that leaves this site. Screen readers only. */
  opensNewTab: '(opens in a new tab)',

  // -- the footer --
  footerAbout: 'A working Bitcoin wallet on a practice network. Its coins have no value.',
  footerPromise: 'There is no account to open, and we set no cookies.',
  /** The main site's motto. */
  footerMotto: 'Bitcoin only. No bullshit. Have fun.',
  /**
   * Shown on Spanish pages only, as on the main site: the Spanish text is a
   * machine-made draft. The English line is its translation, kept so that
   * both tables have the same keys.
   */
  footerTranslation: 'Translation drafted with AI assistance; a human review is still pending.',

  // -- the language switch --
  /**
   * This language's own name. The switch is one plain link whose text is the
   * other language's name: an English page shows the Spanish table's value.
   */
  languageName: 'English',

  // -- passkey wallets --
  /**
   * The name the passkey is saved under in the reader's password manager,
   * where it stays for good. {tag} is four characters that tell two practice
   * passkeys apart.
   *
   * It is written once, when the passkey is made, in the language of that
   * page, and this browser keeps only the tag. So only the page that has
   * just made the passkey can show the whole name. Everywhere else the app
   * shows the tag and says it is in the name: a passkey made on the English
   * page is not listed under the Spanish name.
   */
  passkeyName: 'Practice wallet {tag} (no real money)',
  /** The one state line a passkey wallet carries on every wallet screen, while locked... */
  stateLocked: 'Looking and receiving need no passkey. Sending and showing the 12 words do.',
  /** ...and while unlocked, next to the Lock button. */
  stateUnlocked: 'Unlocked in this tab until you lock it, reload or close the tab.',
  lock: 'Lock',

  // -- small words many screens share --
  copy: 'Copy',
  copied: 'Copied',
  /** Said by the status region when the browser refuses to copy. */
  copyFailed: 'This browser did not let the page copy. Select the text and copy it by hand.',
  details: 'Details',
  /** The words that open and close a folded section. */
  show: 'Show',
  hide: 'Hide',
  tryAgain: 'Try again',
  reload: 'Reload',
  back: 'Back',
  loading: 'Loading...',
  /** The one word for a payment that is not in a block yet. Never "pending". */
  unconfirmed: 'Unconfirmed',

  // -- time left, for a countdown: the screen's own sentence carries it, as in "Asking again in 12 seconds." --
  timeSecond: '{count} second',
  timeSeconds: '{count} seconds',
  timeMinute: '{count} minute',
  timeMinutes: '{count} minutes',

  // -- the screens that are not wallet sections: the key is "screen_" and the route's name --
  screen_home: 'Home',
  screen_new: 'Create a practice wallet',
  screen_restore: 'Restore a practice wallet',
  screen_tx: 'Transaction',
  /** On a screen that is still a placeholder. It goes when the last screen is built. */
  notBuiltYet: 'This screen is not built yet.',

  // -- a path that is no screen --
  notFoundTitle: 'Page not found',
  notFoundBody: 'The practice wallet has no page here. Check the link you followed, or start from the home page.',
  notFoundHome: 'Go to the home page',
} as const;

export const es: Record<keyof typeof en, string> = {
  siteName: 'LearnBitcoin',
  appName: 'Billetera de práctica',
  homeLabel: 'Billetera de práctica de LearnBitcoin, inicio',
  skipToContent: 'Saltar al contenido',

  markerBanner: 'Red de práctica de LearnBitcoin: dinero de juguete, sin ningún valor. No son bitcoins de verdad.',
  markerBannerShort: 'Red de práctica: dinero de juguete, sin valor.',
  markerBadge: 'Práctica',
  markerNote: 'Red de práctica. Estas monedas no tienen valor.',
  markerTitle: 'Práctica: {screen} | LearnBitcoin',
  homeTitle: 'Práctica: Inicio | LearnBitcoin',

  sat: 'sat',
  sats: 'sats',
  practiceSat: 'sat de práctica',
  practiceSats: 'sats de práctica',
  practiceSatsHeading: 'Sats de práctica',
  feeRateUnit: 'sat/vB',
  vbyteUnit: 'vB',

  sectionsLabel: 'Secciones de la billetera',
  section_wallet: 'Resumen',
  section_coins: 'Monedas',
  section_receive: 'Recibir',
  section_send: 'Enviar',
  section_activity: 'Actividad',
  section_backup: 'Respaldo',
  section_settings: 'Configuración',

  linkAbout: 'Acerca de',
  linkSparrow: 'La red de práctica en Sparrow',
  linkSite: 'Volver a LearnBitcoin.com',
  linkSource: 'Código fuente (en inglés)',
  navMain: 'Principal',
  navFooter: 'Pie de página',
  opensNewTab: '(se abre en otra pestaña)',

  footerAbout: 'Una billetera de Bitcoin que funciona de verdad, en una red de práctica. Sus monedas no tienen valor.',
  footerPromise: 'No hay ninguna cuenta que abrir, y no ponemos cookies.',
  footerMotto: 'Solo Bitcoin. Sin tonterías. Diviértete.',
  footerTranslation: 'Traducción hecha con ayuda de IA, pendiente de revisión humana.',

  languageName: 'Español',

  passkeyName: 'Billetera de práctica {tag} (sin dinero de verdad)',
  stateLocked:
    'Para mirar y recibir no hace falta la llave de acceso (passkey). Para enviar y para mostrar las 12 palabras, sí.',
  stateUnlocked: 'Desbloqueada en esta pestaña hasta que la bloquees, recargues la página o cierres la pestaña.',
  lock: 'Bloquear',

  copy: 'Copiar',
  copied: 'Copiado',
  copyFailed: 'Este navegador no dejó que la página copiara. Selecciona el texto y cópialo a mano.',
  details: 'Detalles',
  show: 'Mostrar',
  hide: 'Ocultar',
  tryAgain: 'Volver a intentar',
  reload: 'Recargar',
  back: 'Volver',
  loading: 'Cargando...',
  unconfirmed: 'Sin confirmar',

  timeSecond: '{count} segundo',
  timeSeconds: '{count} segundos',
  timeMinute: '{count} minuto',
  timeMinutes: '{count} minutos',

  screen_home: 'Inicio',
  screen_new: 'Crea una billetera de práctica',
  screen_restore: 'Restaura una billetera de práctica',
  screen_tx: 'Transacción',
  notBuiltYet: 'Esta pantalla todavía no está hecha.',

  notFoundTitle: 'Página no encontrada',
  notFoundBody:
    'La billetera de práctica no tiene ninguna página aquí. Revisa el enlace que seguiste, o empieza desde la página de inicio.',
  notFoundHome: 'Ir a la página de inicio',
};
