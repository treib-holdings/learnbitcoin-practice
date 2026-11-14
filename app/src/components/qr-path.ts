// A QR code as one SVG path.
//
// The page's security policy allows no "data:" image and no style
// attribute, so the code is not a picture file: it is drawn in the page, as
// shapes. This file turns a text into the path that draws every dark
// square. QrCode.svelte puts it in an <svg>.

import encodeQR from 'qr';

/**
 * The quiet zone: blank squares on every side of the code. A scanner needs
 * them to find the code's edge, and the standard asks for four.
 */
export const QUIET_ZONE = 4;

export interface QrShape {
  /** Squares per side, quiet zone included. The <svg> is this many units wide and tall. */
  size: number;
  /** The path that fills every dark square. */
  d: string;
}

/** The path for a grid of squares (true: dark). Each run of dark squares in a row is one rectangle. */
export function pathOfSquares(rows: readonly (readonly boolean[])[]): string {
  let d = '';
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      let run = 1;
      while (row[x + run]) run += 1;
      // Move to the run's top left corner, then right, down, back, and close.
      d += `M${x} ${y}h${run}v1h-${run}z`;
      x += run;
    }
  });
  return d;
}

/** The QR code for `text`: medium error correction, with its quiet zone. */
export function qrShape(text: string): QrShape {
  const rows = encodeQR(text, 'raw', { ecc: 'medium', border: QUIET_ZONE });
  return { size: rows.length, d: pathOfSquares(rows) };
}
