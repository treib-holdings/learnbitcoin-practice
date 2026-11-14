// The text of the Restore screen: typing the 12 words, and what happens when no practice coins are found.
//
// The same shape as every file in this folder (see common.ts): one table per
// language with the same keys, plain strings, slots written {name}.
//
// This is the one screen of the app that asks for 12 words, so it carries
// the exception paragraph: the main site's chapter 4 says never to type a
// seed into a website, and this page says why it is the one exception. The
// reason is about the words, never about the page: they guard play money.
// And it closes the door the word "exception" opens: real words never go
// into a web page, "this one included". The paragraph and the line after
// it are the wording the site's notes settled on. Change one, and change
// the reveal screen's with it.
//
// The Spanish here is a first draft that no native reviewer has read yet.

export const en = {
  lede: 'Type the 12 words of a practice wallet, in order. The page scans the practice chain for their addresses and brings back the same coins.',

  // -- before the fields: why this page may ask, and what happens to the words --
  exception:
    'Chapter 4 of the Journey says never to type your seed into a website, and that a page asking for it is a scam. This page is the one exception, because the 12 words it asks for only guard play money, practice coins that are worth nothing. The words of a wallet that holds real bitcoin never go into a web page, this one included.',
  /** The link under the paragraph, to the chapter it speaks of. */
  chapter: 'Chapter 4 of the Journey: Be Your Own Bank',
  /**
   * {days} is how long Safari keeps what a site stored without the site
   * being used. A restored wallet never passes the "Wallet made" step, so
   * this is where it is told that a browser can erase the words.
   */
  kept: 'Once restored, the 12 words are kept in this browser, not encrypted. Anyone who uses this browser can then open the wallet and spend from it. A browser can also erase them (Safari does if you go {days} days without using the site), so keep your paper copy.',
  never:
    'Never put real money on these 12 words. Words that have been on a web page are for practice only: a real wallet should make its own.',

  // -- the box and the button --
  check: 'These 12 words are from a practice wallet, not from a wallet with real bitcoin.',
  /** Under the box, when "Restore" was pressed without it. */
  checkNeeded: 'Tick this box first. It says that these are practice words.',
  go: 'Restore',
  /** While the practice network is asked about the words. Nothing is stored yet. */
  looking: "Looking for these words' practice coins...",

  // -- a restore that did not go through: under the sentence from the error table --
  failedKept: 'The words were not stored. They are still in the fields above, so you can try again.',
  /** The words that were waiting for "Keep" or "Erase" are gone: the reader is back at the empty fields. */
  lost: 'The 12 words were no longer waiting on this page, so nothing was kept. Type them again to restore the wallet.',

  // -- the step: no practice history was found for the words --
  emptyTitle: 'No practice coins found for these words',
  /** Its name in the document title. */
  emptyName: 'No practice coins found',
  /**
   * The network was asked about addresses, never about the words. This
   * step is where a reader who typed a real wallet's words finds out, so
   * it says what was looked up and that the words stayed in the browser.
   */
  emptyBody:
    'The practice network shows nothing at the addresses these 12 words give: no coins, and no payments in or out. The words themselves did not leave this browser. Nothing has been stored.',
  emptyReal:
    'If they belong to a real wallet, erase them and close this page. They have not been stored, and that wallet is not affected.',
  emptyPractice:
    'If they are practice words, the wallet may never have been used, and you can keep it here. If you expected coins, erase them and type them again from your paper copy.',
  keep: 'Keep them here anyway',
  erase: 'Erase',
  /** The browser would not store the words. They go on waiting, so the two buttons stay. */
  keepRefused:
    'This browser refused to store the words, so nothing was kept. They are still waiting on this page. Allow site data for this page and choose again, or erase them.',
} as const;

export const es: Record<keyof typeof en, string> = {
  lede: 'Escribe en orden las 12 palabras de una billetera de práctica. La página escanea la cadena de práctica en busca de sus direcciones y te devuelve las mismas monedas.',

  exception:
    'El capítulo 4 del Recorrido dice que nunca escribas tu frase semilla en un sitio web, y que una página que te la pide es una estafa. Esta página es la única excepción, porque las 12 palabras que pide solo protegen dinero de juguete, monedas de práctica que no valen nada. Las palabras de una billetera con bitcoin de verdad nunca van en una página web, incluida esta.',
  chapter: 'Capítulo 4 del Recorrido: Sé tu propio banco',
  kept: 'Una vez restauradas, las 12 palabras quedan guardadas en este navegador, sin cifrar. Cualquier persona que use este navegador puede entonces abrir la billetera y gastar sus monedas. Un navegador también puede borrarlas (Safari lo hace si pasas {days} días sin usar el sitio), así que conserva tu copia en papel.',
  never:
    'Nunca pongas dinero de verdad en estas 12 palabras. Las palabras que estuvieron en una página web solo sirven para practicar: una billetera de verdad debe generar las suyas.',

  check: 'Estas 12 palabras son de una billetera de práctica, no de una billetera con bitcoin de verdad.',
  checkNeeded: 'Primero marca esta casilla. Dice que estas son palabras de práctica.',
  go: 'Restaurar',
  looking: 'Buscando las monedas de práctica de estas palabras...',

  failedKept: 'Las palabras no se guardaron. Siguen en los campos de arriba, así que puedes volver a intentarlo.',
  lost: 'Las 12 palabras ya no estaban esperando en esta página, así que no se guardó nada. Escríbelas de nuevo para restaurar la billetera.',

  emptyTitle: 'Sin monedas de práctica para estas palabras',
  emptyName: 'Sin monedas de práctica',
  emptyBody:
    'La red de práctica no muestra nada en las direcciones que dan estas 12 palabras: ni monedas, ni pagos recibidos o enviados. Las palabras no salieron de este navegador. No se guardó nada.',
  emptyReal:
    'Si son de una billetera de verdad, bórralas y cierra esta página. No se guardaron, y esa billetera no se ve afectada.',
  emptyPractice:
    'Si son palabras de práctica, puede que la billetera nunca se haya usado, y puedes conservarla aquí. Si esperabas encontrar monedas, bórralas y vuelve a escribirlas desde tu copia en papel.',
  keep: 'Conservarlas aquí de todos modos',
  erase: 'Borrar',
  keepRefused:
    'Este navegador se negó a guardar las palabras, así que no se conservó nada. Siguen esperando en esta página. Permite los datos del sitio para esta página y vuelve a elegir, o bórralas.',
};
