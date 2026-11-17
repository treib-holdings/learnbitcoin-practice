<script lang="ts">
  // Every shared piece in every state, on one page, in the page's language.
  // Look at it at 320 px and at 1280 px, in English and in Spanish, whenever
  // a piece changes:
  //
  //   pnpm gallery /gallery/pieces --width 320 --shot pieces.png
  //   pnpm gallery /es/gallery/pieces --width 320 --shot pieces-es.png
  //
  // The sample text is long on purpose, and the Spanish is longer than the
  // English: that is what finds a button that overflows or a line that wraps badly.

  import { accountDescriptor } from '@learnbitcoin/practice-wallet';
  import Actions from '../src/components/Actions.svelte';
  import Amount from '../src/components/Amount.svelte';
  import Badge from '../src/components/Badge.svelte';
  import Button from '../src/components/Button.svelte';
  import Card from '../src/components/Card.svelte';
  import Checkbox from '../src/components/Checkbox.svelte';
  import Chips from '../src/components/Chips.svelte';
  import CodeBlock from '../src/components/CodeBlock.svelte';
  import CopyButton from '../src/components/CopyButton.svelte';
  import Countdown from '../src/components/Countdown.svelte';
  import Details from '../src/components/Details.svelte';
  import Empty from '../src/components/Empty.svelte';
  import Field from '../src/components/Field.svelte';
  import Mono from '../src/components/Mono.svelte';
  import Notice from '../src/components/Notice.svelte';
  import OutLink from '../src/components/OutLink.svelte';
  import Page from '../src/components/Page.svelte';
  import Prose from '../src/components/Prose.svelte';
  import QrCode from '../src/components/QrCode.svelte';
  import Row from '../src/components/Row.svelte';
  import Rows from '../src/components/Rows.svelte';
  import Section from '../src/components/Section.svelte';
  import TextInput from '../src/components/TextInput.svelte';
  import TextLink from '../src/components/TextLink.svelte';
  import Waiting from '../src/components/Waiting.svelte';
  import { announce, statusText } from '../src/components/status.svelte.ts';
  import { router } from '../src/lib/router.svelte.ts';
  import { useWallet } from '../src/lib/wallet-context.ts';
  import { strings } from '../src/strings/index.ts';
  import { ACCOUNT, POT_ADDRESS, TXID, ownAddress } from './sample.ts';

  const wallet = useWallet();

  let lang = $derived(router.lang);
  let t = $derived(strings.common[lang]);
  let errors = $derived(strings.errors[lang]);

  // Sample text for the pieces, in both languages. It is not the app's text:
  // each screen's own words live in its string table.
  const SAMPLE = {
    en: {
      lede: 'Every shared piece of the practice wallet, in every state. Development only.',
      create: 'Create with a passkey',
      createWords: 'Create and show the 12 words',
      back: 'Go back',
      sending: 'Sending...',
      newAddress: 'Show a new address',
      address: 'Destination address',
      addressHint: 'A practice address starts with bcrt1. Compare the whole address with the one you were given.',
      amount: 'Amount, in practice sats',
      amountError: 'That amount has a period in it. Sats are whole: type 100000 or 100,000.',
      addressError: 'That address is on another test network. A practice address starts with bcrt1.',
      addressMore: 'The same keys have an address on the practice network, too.',
      addressUse: 'Use the practice address',
      read: 'I have written the 12 words on paper, in order, and nobody else can see my screen.',
      info: 'Looking and receiving need no passkey. Sending and showing the 12 words do.',
      cautionLabel: 'Practice only',
      caution:
        'These 12 words guard play money. The words of any wallet that is not a practice wallet never go into a web page, this one included. That includes the words of a wallet for real bitcoin, even an empty one.',
      cardLabel: 'Receive',
      cardTitle: 'Your practice address',
      cardBody: 'Give this address to whoever is paying you. It stays the same until you ask for a new one.',
      notYet: 'Guided steps come in a later phase.',
      to: 'To',
      fee: 'Fee',
      total: 'Total',
      change: 'Change back to you',
      txid: 'Transaction ID',
      detailsLead: 'What the practice network said.',
      detailsNote: 'For a bug report.',
      copyAddress: 'Copy address',
      addressCopied: 'Address copied.',
      changeBadge: 'Change',
      planned: 'Planned',
      looking: "Looking up this wallet's coins...",
      working: 'Working...',
      noCoins: 'No coins yet.',
      getCoins: 'Get practice coins',
      retry: 'Asking again in {time}.',
      reached: 'The short countdown has reached its time and is gone. One whose time had passed was never drawn.',
      refused: 'A link that is switched off, and one that is busy:',
      qr: 'QR code of this practice address',
      say: 'Say "1 confirmation."',
      said: '1 confirmation.',
      statusNow: 'The status region says:',
      nothing: '(nothing)',
      site: 'the main site',
      about: 'About this practice wallet',
      download: 'A link with a download attribute',
      fresh: 'A link that loads the page afresh',
      cancelled: 'A link whose own handler cancels the click',
      proseOne:
        "A fee pays for the space your payment takes in a block. It depends on the payment's size in bytes, not on the amount you send.",
      proseTwo: 'Start Sparrow with the flag',
      proseThree: 'and check that its addresses start with',
      stepOne: 'This needs a computer.',
      stepTwo: 'Start Sparrow in Regtest mode.',
      command: 'How to start Sparrow in Regtest mode',
      sectionTitle: 'A part of a screen',
    },
    es: {
      lede: 'Todas las piezas compartidas de la billetera de práctica, en todos sus estados. Solo para desarrollo.',
      create: 'Crear con llave de acceso (passkey)',
      createWords: 'Crear y mostrar las 12 palabras',
      back: 'Volver',
      sending: 'Enviando...',
      newAddress: 'Mostrar una dirección nueva',
      address: 'Dirección de destino',
      addressHint: 'Una dirección de práctica empieza con bcrt1. Compara la dirección completa con la que te dieron.',
      amount: 'Monto, en sats de práctica',
      amountError: 'Ese monto tiene un punto. Los sats son enteros: escribe 100000 o 100,000.',
      addressError: 'Esa dirección es de otra red de pruebas. Una dirección de práctica empieza con bcrt1.',
      addressMore: 'Las mismas claves también tienen una dirección en la red de práctica.',
      addressUse: 'Usar la dirección de práctica',
      read: 'Escribí las 12 palabras en papel, en orden, y nadie más puede ver mi pantalla.',
      info: 'Para mirar y recibir no hace falta la llave de acceso (passkey). Para enviar y para mostrar las 12 palabras, sí.',
      cautionLabel: 'Solo para practicar',
      caution:
        'Estas 12 palabras protegen dinero de juguete. Las palabras de una billetera que no sea de práctica nunca van en una página web, incluida esta. Eso incluye las de una billetera para bitcoin de verdad, aunque esté vacía.',
      cardLabel: 'Recibir',
      cardTitle: 'Tu dirección de práctica',
      cardBody: 'Dale esta dirección a quien te vaya a pagar. Se queda igual hasta que pidas una nueva.',
      notYet: 'Los pasos guiados llegan en una fase posterior.',
      to: 'Dirección de destino',
      fee: 'Comisión',
      total: 'Total',
      change: 'Cambio que vuelve a ti',
      txid: 'Txid',
      detailsLead: 'Lo que dijo la red de práctica.',
      detailsNote: 'Para un reporte de falla.',
      copyAddress: 'Copiar dirección',
      addressCopied: 'Dirección copiada.',
      changeBadge: 'Cambio',
      planned: 'Planeado',
      looking: 'Buscando las monedas de esta billetera...',
      working: 'Calculando...',
      noCoins: 'Todavía no hay monedas.',
      getCoins: 'Pedir monedas de práctica',
      retry: 'Nuevo intento en {time}.',
      reached: 'La cuenta corta llegó a su hora y ya no está. Una cuya hora ya había pasado nunca se dibujó.',
      refused: 'Un enlace apagado, y uno ocupado:',
      qr: 'Código QR de esta dirección de práctica',
      say: 'Decir "1 confirmación."',
      said: '1 confirmación.',
      statusNow: 'La región de estado dice:',
      nothing: '(nada)',
      site: 'el sitio principal',
      about: 'Acerca de esta billetera de práctica',
      download: 'Un enlace con el atributo download',
      fresh: 'Un enlace que carga la página de nuevo',
      cancelled: 'Un enlace cuyo propio código cancela el clic',
      proseOne:
        'La comisión paga el espacio que tu pago ocupa en un bloque. Depende del tamaño del pago en bytes, no del monto que envías.',
      proseTwo: 'Abre Sparrow con la opción',
      proseThree: 'y revisa que sus direcciones empiecen con',
      stepOne: 'Para esto hace falta una computadora.',
      stepTwo: 'Abre Sparrow en modo Regtest.',
      command: 'Cómo abrir Sparrow en modo Regtest',
      sectionTitle: 'Una parte de una pantalla',
    },
  } as const;

  let s = $derived(SAMPLE[lang]);

  const address = ownAddress(0, 4).address;
  const loaded = Date.now();

  let to = $state('');
  let amount = $state('100.000');
  let read = $state(false);
  let agreed = $state(true);
  let busy = $state(false);
  let reached = $state(false);

  /** A busy button, for a second and a half. */
  function work(): void {
    busy = true;
    setTimeout(() => (busy = false), 1500);
  }
</script>

<Page eyebrow="Gallery" title="Pieces" lede={s.lede}>
  <Section title="Button, Actions">
    <Actions>
      <Button variant="primary" data-testid="piece-primary">{s.create}</Button>
      <Button>{s.back}</Button>
      <Button variant="quiet">{s.newAddress}</Button>
    </Actions>
    <Actions>
      <Button variant="primary" href={router.link({ name: 'new' })}>{s.createWords}</Button>
      <Button href={router.link({ name: 'home' })}>{s.back}</Button>
      <Button variant="quiet" href={router.link({ name: 'receive' })}>{s.newAddress}</Button>
    </Actions>
    <Actions>
      <Button variant="primary" disabled>{s.create}</Button>
      <Button disabled>{s.back}</Button>
      <Button variant="quiet" disabled>{s.newAddress}</Button>
    </Actions>
    <Actions>
      <Button variant="primary" {busy} busyText={s.sending} onclick={work} data-testid="piece-busy">{s.create}</Button>
      <Button variant="primary" busy busyText={s.sending}>{s.create}</Button>
    </Actions>
    <p class="text-sm text-ink-500">{s.refused}</p>
    <Actions>
      <Button variant="primary" href={router.link({ name: 'new' })} disabled data-testid="piece-link-disabled">
        {s.createWords}
      </Button>
      <Button href={router.link({ name: 'home' })} busy busyText={s.sending} data-testid="piece-link-busy">{s.back}</Button>
    </Actions>
    <Actions tight>
      <Button variant="primary" small>{s.getCoins}</Button>
      <Button variant="quiet">{t.copy}</Button>
      <Button variant="quiet">{t.lock}</Button>
    </Actions>
  </Section>

  <Section title="Field, TextInput">
    <Field label={s.address} hint={s.addressHint}>
      {#snippet children(field)}
        <TextInput
          {...field}
          bind:value={to}
          mono
          spellcheck="false"
          autocomplete="off"
          autocapitalize="none"
          translate="no"
          data-testid="piece-field"
        />
      {/snippet}
    </Field>
    <Field label={s.amount} error={s.amountError}>
      {#snippet children(field)}
        <TextInput {...field} bind:value={amount} mono inputmode="numeric" autocomplete="off" />
      {/snippet}
    </Field>
    <!-- An error with more under it (`after`): the field names the sentence and the rest as its description. -->
    <Field label={s.address} error={s.addressError}>
      {#snippet children(field)}
        <TextInput {...field} value="tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx" mono data-testid="piece-field-more" />
      {/snippet}
      {#snippet after()}
        <p class="text-sm leading-relaxed text-ink-600">{s.addressMore}</p>
        <div><Button variant="quiet">{s.addressUse}</Button></div>
      {/snippet}
    </Field>
    <Field label={s.address}>
      {#snippet children(field)}
        <TextInput {...field} value={address} mono disabled />
      {/snippet}
    </Field>
  </Section>

  <Section title="Checkbox">
    <Checkbox bind:checked={read}>{s.read}</Checkbox>
    <Checkbox bind:checked={agreed}>{s.read}</Checkbox>
  </Section>

  <Section title="Notice">
    <Notice text={s.info} />
    <Notice kind="caution" label={s.cautionLabel} text={s.caution} />
    <Notice kind="caution" text={s.caution} />
    <Notice kind="problem" silent text={errors.unavailable} />
    <Notice kind="problem" silent text={errors.coin_spent}>
      <Details summary={s.detailsLead} note={s.detailsNote}>
        <Mono value="bad-txns-inputs-missingorspent" />
      </Details>
    </Notice>
    <Notice kind="problem" silent text={errors['plan_bad-address']}>
      <Button variant="quiet">{t.tryAgain}</Button>
    </Notice>
  </Section>

  <Section title="Card">
    <Card label={s.cardLabel} title={s.cardTitle}>
      <p class="text-sm text-ink-600">{s.cardBody}</p>
      <p class="mt-3"><Mono value={address} size="lead" /></p>
      <Actions tight class="mt-3">
        <CopyButton text={address} label={s.copyAddress} said={s.addressCopied} data-testid="piece-copy" />
        <Button variant="quiet">{s.newAddress}</Button>
      </Actions>
    </Card>
    <Card tone="grey" title={s.cardTitle}>
      <p class="text-sm text-ink-600">{s.cardBody}</p>
    </Card>
    <Card tone="dashed">
      <p class="text-sm text-ink-500">{s.notYet}</p>
    </Card>
  </Section>

  <Section title="Rows, Row, Amount, Mono">
    <Rows>
      <Row name={s.to}><Mono value={POT_ADDRESS} /></Row>
      <Row name={s.amount}><Amount sats={30_000n} /></Row>
      <Row name={s.fee}><Amount sats={282n} /></Row>
      <Row name={s.total}><Amount sats={30_282n} /></Row>
      <Row name={s.change}><Amount sats={18_500n} /> <Badge tone="kind">{s.changeBadge}</Badge></Row>
      <Row name={s.txid}><Mono value={TXID.sent} /></Row>
    </Rows>
    <p><Amount sats={197_821n} headline data-testid="piece-total" /></p>
    <p class="flex flex-wrap gap-x-6 gap-y-2">
      <Amount sats={1n} />
      <Amount sats={0n} />
      <Amount sats={100_000n} signed />
      <Amount sats={-30_282n} signed />
      <Amount sats={2_100_000_000_000_000n} />
      <Amount sats={54_321n} unit={false} />
    </p>
    <p><Mono value={address} size="lead" /></p>
    <p><Mono value={TXID.faucet} /></p>
    <p><Mono value={accountDescriptor(ACCOUNT.masterFingerprint, ACCOUNT.xpub, 0)} size="small" /></p>
  </Section>

  <Section title="Details">
    <Details summary={s.detailsLead} note={s.detailsNote}>
      <Mono value="bad-txns-inputs-missingorspent" />
    </Details>
    <Details summary={s.detailsLead} open>
      <Mono value="bad-txns-inputs-missingorspent" />
    </Details>
  </Section>

  <Section title="CopyButton, Status">
    <Actions tight>
      <CopyButton text={address} data-testid="piece-copy-plain" />
      <CopyButton text={address} label={s.copyAddress} said={s.addressCopied} />
      <Button variant="quiet" onclick={() => announce(s.said)} data-testid="piece-say">{s.say}</Button>
    </Actions>
    <p class="text-sm text-ink-500">
      {s.statusNow} <span class="font-semibold text-ink-800" data-testid="piece-status-copy">{statusText() || s.nothing}</span>
    </p>
  </Section>

  <Section title="Chips">
    <Chips
      label={t.sectionsLabel}
      items={(['wallet', 'coins', 'receive', 'send', 'activity', 'backup', 'settings'] as const).map((name) => ({
        href: router.link({ name }),
        text: t[`section_${name}`],
        current: name === 'receive',
      }))}
    />
  </Section>

  <Section title="Badge">
    <p class="flex flex-wrap items-center gap-4">
      <Badge tone="practice">{t.markerBadge}</Badge>
      <Badge tone="stamp">{t.markerBadge}</Badge>
      <!-- The stamp of the practice card, in the card's own sizes (points): made for paper, so it is small on a screen. -->
      <Badge tone="stamp" small>{t.markerBadge}</Badge>
      <Badge tone="kind">{s.changeBadge}</Badge>
      <Badge tone="fact">{t.unconfirmed}</Badge>
      <Badge tone="tag">{s.planned}</Badge>
    </p>
  </Section>

  <Section title="Waiting, Empty">
    <Card>
      <Waiting text={s.looking} />
    </Card>
    <Card>
      <Waiting />
    </Card>
    <Card>
      <Mono value={address} class="opacity-40" />
      <Waiting inline text={s.working} class="mt-2" />
    </Card>
    <Card>
      <Empty text={s.noCoins}>
        <Button variant="primary" small href={router.link({ name: 'receive' })}>{s.getCoins}</Button>
      </Empty>
    </Card>
    <Card>
      <Empty text={s.noCoins} />
    </Card>
  </Section>

  <Section title="Countdown">
    <p><Countdown to={loaded + 45_000} text={s.retry} data-testid="piece-countdown" /></p>
    <p><Countdown to={loaded + 150_000} text={s.retry} /></p>
    <p>
      <Countdown to={loaded + 3_000} ondone={() => (reached = true)} data-testid="piece-countdown-short" />
      <!-- A time that has already passed: nothing is drawn. -->
      <Countdown to={loaded - 1_000} data-testid="piece-countdown-past" />
      <span data-testid="piece-countdown-done">{reached ? s.reached : ''}</span>
    </p>
  </Section>

  <Section title="QrCode">
    <QrCode text={address} label={s.qr} data-testid="piece-qr" />
    <p><Mono value={address} /></p>
  </Section>

  <Section title="TextLink, OutLink">
    <Prose>
      <p>
        <TextLink href={router.link({ name: 'about' })} data-testid="piece-link">{s.about}</TextLink>,
        <OutLink href={wallet.config.siteUrl} text={s.site} data-testid="piece-outside" />.
      </p>
      <p class="text-sm text-ink-500">
        <OutLink quiet href={wallet.config.sourceUrl} text={t.linkSource} />
      </p>
      <p>
        <TextLink href={router.link({ name: 'about' })} download data-testid="piece-download">{s.download}</TextLink>.
        <TextLink href={router.link({ name: 'about' })} rel="external" data-testid="piece-fresh">{s.fresh}</TextLink>.
        <TextLink
          href={router.link({ name: 'about' })}
          onclick={(event) => event.preventDefault()}
          data-testid="piece-cancelled">{s.cancelled}</TextLink
        >.
      </p>
    </Prose>
  </Section>

  <Section title="Section, Prose, CodeBlock">
    <Section title={s.sectionTitle}>
      <Prose>
        <p>{s.proseOne}</p>
        <p>{s.proseTwo} <code>-n regtest</code> {s.proseThree} <strong>bcrt1</strong>.</p>
        <ol>
          <li>{s.stepOne}</li>
          <li>{s.stepTwo}</li>
        </ol>
        <CodeBlock
          label={s.command}
          text={'/Applications/Sparrow.app/Contents/MacOS/Sparrow -n regtest'}
          data-testid="piece-code"
        />
        <!-- The same line with `wrap`: it breaks at its space, shows whole, and is no Tab stop. -->
        <CodeBlock
          wrap
          label={s.command}
          text={'/Applications/Sparrow.app/Contents/MacOS/Sparrow -n regtest'}
          data-testid="piece-code-wrap"
        />
      </Prose>
    </Section>
  </Section>
</Page>
