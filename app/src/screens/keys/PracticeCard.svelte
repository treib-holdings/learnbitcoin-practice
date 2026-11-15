<script lang="ts">
  // The practice sheet: the main site's 12-word backup form, blank and
  // marked for practice, to print and fill in by hand.
  //
  // Chapter 4 of the Journey offers a form for the words of a real wallet:
  // a sheet of three cards to cut out, each with a title, two warnings and
  // twelve numbered rows of eight letter cells. This is that form, drawn
  // again here, so that the rehearsal is on the paper the real thing will
  // use. It is drawn in the page and not shown as a picture file, because it
  // has to be in the page's language. Every length is the form's own,
  // measured on its PDF (card-form.ts) and written in points, so a printed
  // card is as wide as the form's card and its parts stand where the
  // form's do.
  //
  // A practice card needs two things the form lacks. The PRACTICE stamp
  // stands on the title's line, at the right, and drops under the title
  // where the two do not fit on one line (the Spanish title is longer).
  // And under row 12 a line says where these words restore. The card is
  // taller than the form's by that line.
  //
  // The sheet never holds a word: the reader writes them. A printout of the
  // words themselves would be one more copy to keep safe, and it would pass
  // through a printer's memory on the way.
  //
  // The sheet is marked data-print="only". The print rules at the end of
  // app.css then leave everything else on the page out of a printout, so
  // what comes out of the printer is the sheet alone, whether the 12 words
  // are showing on screen at that moment or not. On paper the sheet has a
  // heading (the logo with the stamp, the title, and the short form of the
  // exception paragraph) and three cards side by side, each inside crop
  // marks. It is as wide as three cards, the gaps between them and the crop
  // marks at both ends: 520 points, which fits a US Letter sheet and the
  // narrower A4 sheet inside half-inch margins. On paper too narrow for
  // that the third card moves under the first two; no card is ever made
  // smaller.
  //
  // What a printer must not drop is drawn, not painted as a background: a
  // browser leaves backgrounds out of a printout unless the reader asks for
  // them, and the white numbers would vanish with their circles.
  //
  // On screen one card shows, as a picture of what will print. It is drawn
  // a third larger than it prints: a phone shows a card at its own size
  // smaller than paper does, and the card's small print is then too small
  // to make out. A third larger still fits the narrowest phone (320 px).
  // The picture says nothing to a screen reader: the sentence above it says
  // what the sheet is.

  import Badge from '../../components/Badge.svelte';
  import Button from '../../components/Button.svelte';
  import Section from '../../components/Section.svelte';
  import { WORD_COUNT } from '../../components/wallet/words.ts';
  import { fill } from '../../lib/format.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { strings } from '../../strings/index.ts';
  import { BOX_LEFT, BOX_WIDTH, COPIES, ROW, cellLines, formRows, rowsPicture } from './card-form.ts';
  import { isRepeatTap } from './taps.ts';

  interface Props {
    /** The main site's name as its form prints it: "learnbitcoin.com" (siteHost in card-form.ts). */
    site: string;
  }

  let { site }: Props = $props();

  let lang = $derived(router.lang);
  let t = $derived(strings.backup[lang]);
  let c = $derived(strings.common[lang]);
  let w = $derived(strings.wallet[lang]);

  /** The cards of one sheet. Only the first shows on screen. */
  const CARDS = Array.from({ length: COPIES }, (_, index) => index);

  /** The rows of one card: 1 to 12, running down it, one row to a word, as on the form. */
  const ROWS = formRows(WORD_COUNT);
  /** The dashed lines that part the eight cells of a row. */
  const LINES = cellLines();
  /** The picture that holds the rows. */
  const PICTURE = rowsPicture(WORD_COUNT);

  /**
   * The form sets its letters a little closer together than the font does
   * by itself: by 1.5 hundredths of the type's size. The class goes on each
   * piece of text, never on the card: a spacing counted from the size of
   * the card's own type would be handed down to every size as that one length.
   */
  const TIGHT = 'tracking-[-0.015em]';

  /**
   * The crop marks of one card: at each corner a pair of hairlines, 12
   * points long, that start 4 points clear of the corner and point along
   * the card's two edges. All eight are one picture, 16 points larger than
   * the card on every side, so that they stand exactly a card's width and
   * height apart. `x` and `y` say which corner of that picture a pair is
   * measured from; `lines` is the pair, in points.
   */
  const MARKS = [
    { x: '0', y: '0', lines: 'M16 0v12M0 16h12' },
    { x: '100%', y: '0', lines: 'M-16 0v12M-12 16h12' },
    { x: '0', y: '100%', lines: 'M16 -12v12M0 -16h12' },
    { x: '100%', y: '100%', lines: 'M-16 -12v12M-12 -16h12' },
  ];
</script>

<!-- The shield with an exclamation mark that stands before each of the form's two warnings. -->
{#snippet shield()}
  <svg
    viewBox="0 0 11 11"
    width="11pt"
    height="11pt"
    stroke-width="0.77"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="shrink-0 fill-none stroke-current"
  >
    <path
      d="M5.5 1.03C6.6 2 7.85 2.37 8.63 2.37Q9.07 2.37 9.07 2.82V5.95C9.07 8.2 7.6 9.25 5.5 9.96C3.4 9.25 1.93 8.2 1.93 5.95V2.82Q1.93 2.37 2.37 2.37C3.15 2.37 4.4 2 5.5 1.03Z"
    />
    <path d="M5.5 3.71V5.5M5.5 7.28v.01" />
  </svg>
{/snippet}

<!-- The logo, as tall as the text size `size` names. It is the picture in /logo.svg, shown from two
     files: the round mark from /favicon.png, and beside it the part of /logo.svg that holds the
     name (the address ends in the part to show: from 38 across, 125 wide, of a picture 163 wide).
     The logo file holds the mark as a small picture that fills a square. Chrome prints such a fill
     at 72 dots to the inch, which on a card is a blur 12 dots across. The favicon is the same
     picture, byte for byte (a test holds the two together), and as a file of its own it prints sharp. -->
{#snippet logo(size: string)}
  <span class={['flex shrink-0 items-center gap-[0.267em]', size]}>
    <img src="/favicon.png" alt="" width="256" height="256" class="h-[1em] w-[1em]" />
    <img src="/logo.svg#svgView(viewBox(38,0,125,30))" alt={c.siteName} width="125" height="30" class="h-[1em] w-[4.167em]" />
  </span>
{/snippet}

<!-- One card: the form's card, 148 points wide, with 8 points of margin at each side. On paper its
     edge is where the crop marks point; on screen a hairline around it stands for that edge.
     The spaces between its parts put each part where the form has it, counted from the card's top:
     the line the title stands on at 15 points, the lines of the two warnings at 29.36 and 41.08, the
     top of row 1 at 50.43. Under row 12 the card goes its own way, to make room for its last line. -->
{#snippet card()}
  <div
    data-testid="practice-card"
    class="w-[148pt] bg-white px-[8pt] pb-[10pt] pt-[7.5pt] text-ink-900 shadow-sm ring-1 ring-ink-200 print:shadow-none print:ring-0"
  >
    <div class="flex flex-wrap items-center justify-between gap-x-[4pt] gap-y-[2pt]">
      <p class={['text-[8pt] font-bold leading-[10pt]', TIGHT]}>{t.cardName}</p>
      <Badge tone="stamp" small>{c.markerBadge}</Badge>
    </div>

    <ul class="mt-[4.36pt]">
      {#each [t.cardNoCopies, t.cardNoSharing] as warning (warning)}
        <li class={['flex items-start gap-[3pt] text-[7pt] font-medium leading-[11.72pt]', TIGHT]}>
          {@render shield()}
          <span>{warning}</span>
        </li>
      {/each}
    </ul>

    <!-- The rows: a blue circle with the number, a short line, and a box that seven dashed lines part
         into eight letter cells. One unit of this picture is one point. -->
    <svg viewBox="0 0 {PICTURE.width} {PICTURE.height}" width="{PICTURE.width}pt" height="{PICTURE.height}pt" class="mt-[5.13pt]">
      {#each ROWS as row (row.number)}
        <g data-testid="card-row" transform="translate(0 {row.top})">
          <circle cx={ROW.circle / 2} cy={ROW.circle / 2} r={ROW.circle / 2} class="fill-form-blue" />
          <text
            x={ROW.circle / 2}
            y={ROW.number.baseline}
            font-size={ROW.number.size}
            text-anchor="middle"
            class="fill-white font-medium tabular-nums">{row.number}</text
          >
          <line x1={ROW.circle} y1={ROW.link.y} x2={BOX_LEFT} y2={ROW.link.y} stroke-width={ROW.link.width} class="stroke-ink-300" />
          <!-- Half a dash first: the line then ends in half a dash too, and the box's outline covers both halves. -->
          {#each LINES as x (x)}
            <line
              data-testid="card-cell-line"
              x1={x}
              y1="0"
              x2={x}
              y2={ROW.cell}
              stroke-width={ROW.dash.width}
              stroke-dasharray={ROW.dash.length}
              stroke-dashoffset={ROW.dash.length / 2}
              class="stroke-ink-200"
            />
          {/each}
          <!-- The outline lies inside the box's edge: it is drawn half its width in from that edge. -->
          <rect
            data-testid="card-box"
            x={BOX_LEFT + ROW.outline / 2}
            y={ROW.outline / 2}
            width={BOX_WIDTH - ROW.outline}
            height={ROW.cell - ROW.outline}
            rx={ROW.corner - ROW.outline / 2}
            stroke-width={ROW.outline}
            class="fill-none stroke-ink-300"
          />
        </g>
      {/each}
    </svg>

    <p data-testid="card-restores" class={['mt-[4.2pt] text-[7pt] font-medium leading-[9pt]', TIGHT]}>{t.cardRestores}</p>

    <div class="mt-[4.8pt] flex items-center justify-between gap-[4pt]">
      {@render logo('text-[12pt]')}
      <!-- Three quarters of a point down: the site's name then stands on the line the logo's letters stand on. -->
      <span class={['relative top-[0.75pt] text-[7.5pt] leading-[12pt]', TIGHT]}>{site}</span>
    </div>
  </div>
{/snippet}

<Section title={t.cardTitle}>
  <p class="text-pretty leading-relaxed text-ink-700">{fill(t.cardLead, { cards: String(COPIES) })}</p>

  <div data-print="only" data-testid="practice-sheet" aria-hidden="true" class="print:mx-auto print:w-[520pt] print:max-w-full">
    <!-- The sheet's heading, on paper only. As on the form: the logo and the title at the left, the
         site's name at the right. The stamp stands by the logo, as it does at the top of every screen. -->
    <div data-testid="sheet-heading" class="hidden text-ink-900 print:block">
      <div class="flex items-center justify-between gap-[12pt]">
        <div class="flex items-center gap-[8pt]">
          {@render logo('text-[16.5pt]')}
          <Badge tone="stamp">{c.markerBadge}</Badge>
        </div>
        <span class={['text-[7.5pt] leading-[12pt]', TIGHT]}>{site}</span>
      </div>
      <p class={['mt-[4.4pt] text-[8pt] font-bold leading-[10pt]', TIGHT]}>{t.cardName}</p>
      <p class={['mt-[2pt] text-[7pt] font-medium leading-[10pt]', TIGHT]}>{w.wordsException}</p>
    </div>

    <!-- Three cards side by side. On paper each stands in a place of its own that is 16 points larger
         than the card on every side: the room for its crop marks. Two places overlap by 12 points, so
         the marks between two cards meet in one line, and the cards stand at least 20 points apart. A
         place is never cut in two by the end of a page. Only the first card shows on screen, a third
         larger than on paper. -->
    <div class="flex flex-wrap items-start justify-between print:mt-[72pt] print:px-[6pt]">
      {#each CARDS as copy (copy)}
        <div
          class={[
            'relative shrink-0 break-inside-avoid [zoom:1.3333] print:-mx-[6pt] print:p-[16pt] print:[zoom:1]',
            copy > 0 && 'hidden print:block',
          ]}
        >
          <svg class="absolute inset-0 hidden h-full w-full stroke-ink-900 print:block">
            {#each MARKS as mark (mark.lines)}
              <!-- A picture inside the picture, one point square and with nothing cut off at its edge:
                   it puts the corner at 0, 0 and makes one unit one point. -->
              <svg x={mark.x} y={mark.y} width="1pt" height="1pt" viewBox="0 0 1 1" overflow="visible">
                <path data-testid="crop-mark" d={mark.lines} stroke-width="0.25" />
              </svg>
            {/each}
          </svg>
          {@render card()}
        </div>
      {/each}
    </div>
  </div>

  <div>
    <!-- One print for a double tap: its second click is not taken. -->
    <Button
      data-testid="print-card"
      onclick={(event) => {
        if (!isRepeatTap(event)) window.print();
      }}
    >
      {t.cardPrint}
    </Button>
  </div>
</Section>
