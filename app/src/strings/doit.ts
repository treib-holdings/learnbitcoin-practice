// The text of the "Do it" steps: the list of steps, one step's screen, the
// strip that follows the reader through the wallet, "What just happened" on
// the transaction screen, and the sentences other screens gain because the
// progress of the steps is kept in this browser.
//
// The same shape as every file in this folder (see common.ts): one table per
// language with the same keys, plain strings, slots written {name}.
//
// PLACEHOLDER COPY, in the site's voice: a later pass replaces it from the
// content repo. What it has to keep when it does:
//
//   - It is short. A step's lede is two sentences at most, a part's
//     guidance one or two. The chapter did the teaching: the reader is told
//     what to do and what the page will see. Two exceptions. "Hold some"
//     belongs to chapter 2, which has not taught a wallet, an address, the
//     faucet or the 12 words, so each of its parts carries one plain
//     sentence for each new thing. And a warning before a part that removes
//     something says all it has to.
//   - Some keys are built from a step's ID or a reason, so their names are
//     fixed by the code that looks them up: title_<step>, lede_<step>,
//     done_<step>, part_<step>_<number>, guide_<step>_<number>,
//     need_<reason>, stripNeed_<reason> and explain_<sentence>
//     (lib/doit/steps.ts, lib/doit/judge.ts, lib/doit/explain.ts).
//     test/doit-text.test.ts holds the table to those lists.
//   - Facts are slots: the seconds between two practice blocks, a block's
//     height, an amount, a date. What is typed out is true of Bitcoin
//     itself or of this app's design: 10 minutes, six confirmations, the
//     12 words, three of them.
//   - No sentence ever says what the answer to a question is.
//   - The pot's line counts payments, not people.
//
// The Spanish name of "Do it" is "Hazlo", the term the site's voice notes
// propose. The Spanish here is a first draft that no native reviewer has
// read yet.

export const en = {
  // -- the name: the list's heading, the small line over a step's title, the strip's first word --
  name: 'Do it',

  // -- the list of steps (/do) --
  listLede:
    'Each step here is something a chapter of the Journey taught, done in your own practice wallet and checked against the practice chain.',
  /** A chapter's heading in the list, and the line under a step's lede. {number} is 2, 3 or 4. */
  chapterHeading: 'Chapter {number}: {title}',
  chapter_2: 'What Bitcoin Actually Is',
  chapter_3: 'How Bitcoin Works',
  chapter_4: 'Be Your Own Bank',
  /** What a screen reader calls the steps of one chapter. */
  listSteps: 'Steps of chapter {number}',
  stateNotStarted: 'Not started',
  stateStarted: 'Started',
  /** {date} is a day, such as "November 15, 2026". */
  stateDone: 'Done on {date}',
  /** Beside the step the strip is following. */
  stateFollowing: 'Following',
  forgetTitle: 'Your progress',
  /** What is kept is one thing, and what is counted another: the second sentence must not say more than About does. */
  forgetWhat:
    'This browser keeps which steps you have opened and done. The note itself is never sent to us. Opening a step and finishing one are counted, as the About page says.',
  forget: 'Forget my progress',
  forgetAsk: 'Forget your "Do it" progress in this browser?',
  forgetWarn:
    'Every tick and every finished step is erased from this browser. Your wallet and its coins are not touched, and each step can be done again.',
  forgetYes: 'Forget it',
  forgetNo: 'Keep it',
  /** Said by the status region, and shown on the list, once the note is gone. */
  forgotten: 'Your "Do it" progress was forgotten. This browser keeps none of it now.',
  forgetRefused:
    'This browser did not let this page erase your progress, so it is still kept here. Allow site data for this page, then try again.',

  // -- what the list and a step say when progress cannot be read or kept --
  /** A note written by a newer version of this page is stored. Reload is the one way on. */
  newer:
    'This page is out of date. Your "Do it" progress was saved by a newer version of it, so this version shows none of it and changes none of it. Reload the page to get the newer version.',
  noStorage:
    'This browser refuses to store anything for this page, so your "Do it" progress cannot be kept here. That happens in some private windows, and when site data is blocked. Open this page in an ordinary window, or allow site data, and reload.',

  // -- Home's short section, and the Overview's one line --
  homeBody:
    "Short steps that go with the Journey's chapters, each done in your own practice wallet and checked against the practice chain.",
  homeLink: 'See the steps',
  overviewLine: "The Journey's chapters end in steps that you do in this wallet.",
  overviewLink: 'See the "Do it" steps',

  // -- what other screens gain: the progress stays in this browser when the wallet is removed --
  /** In Remove's question, on Settings. */
  staysOnRemove:
    'Your "Do it" progress is not removed with the wallet. It stays in this browser until you choose "Forget my progress" on the Do it screen. It can name this wallet by its wallet fingerprint and, for a step that is not finished, the payment it waits for.',
  /** Under Home's "removed" line, for the one visit that follows a removal. */
  staysAfterRemove:
    'Your "Do it" progress is still in this browser, until you choose "Forget my progress" on the Do it screen. It can name the removed wallet by its wallet fingerprint and, for a step that is not finished, the payment it waits for.',
  /** One more item of Settings' list "What this browser keeps". */
  keepsProgress:
    'Your "Do it" progress: which steps you have opened and done. It stays when the wallet is removed, until you choose "Forget my progress" on the Do it screen. It can name this wallet by its wallet fingerprint and, for a step that is not finished, the payment it waits for.',

  // -- one step (/do/<id>): its title and its lede --
  'title_hold-some': 'Hold some',
  'title_pass-it-on': 'Pass it on',
  'title_no-balances': 'There are no balances',
  'title_waiting-room': 'The waiting room',
  'title_the-seed': 'The seed',
  'title_prove-the-backup': 'Prove the backup',
  'lede_hold-some':
    'Chapter 2 said what bitcoin is. Here you get some to hold: practice coins with no value, on a network that works the way Bitcoin does.',
  'lede_pass-it-on':
    'Chapter 3 opens with Alice tapping Send. Here you tap it yourself, and pay a few practice coins into the pot for the learner who comes after you.',
  'lede_no-balances':
    'Chapter 3 says there are no balances, only coins. Here you count your own, and read what one of your payments did to them.',
  'lede_waiting-room':
    'You send a payment and watch it wait, get into a block, and reach six confirmations. Here the waiting room is almost empty, so the next block takes every payment whatever fee rate it pays; on Bitcoin the fee rate decides the place in line.',
  'lede_the-seed':
    "Chapter 4 says the 12 words are the root of the whole wallet. Here you put this wallet's words on paper, and check that the paper is right.",
  'lede_prove-the-backup':
    "This is chapter 4's drill: remove the wallet, then bring it back from the paper alone. A wallet that comes back with its coins is the only way to know the backup works.",
  /** The link back to the main site: on the step's screen at all times, and its main button once the step is done. */
  back: 'Back to the chapter',
  allSteps: 'All steps',

  // -- the parts of a step --
  partsTitle: 'The parts',
  /** A ticked part says what kind of proof it is. */
  proofChecked: 'Checked',
  proofOpened: 'Opened',
  proofSaid: 'Your word',
  partNow: 'Now',
  partLater: 'Later',
  partBlocked: 'Not yet',
  partUnknown: 'Not known yet',

  'part_hold-some_1': 'Make a practice wallet',
  'part_hold-some_2': 'Ask the faucet for coins',
  'part_hold-some_3': 'See them confirm',
  'part_hold-some_4': 'See it from outside',
  'part_pass-it-on_1': 'Have coins that can be spent',
  'part_pass-it-on_2': 'Send some to the pot',
  'part_pass-it-on_3': 'It gets its first confirmation',
  'part_no-balances_1': 'Open your coins',
  'part_no-balances_2': 'Count your coins',
  'part_no-balances_3': 'Read what one of your payments did',
  'part_waiting-room_1': 'Send a payment',
  'part_waiting-room_2': 'A block takes it in',
  'part_waiting-room_3': 'Six blocks on top',
  'part_the-seed_1': 'Show the 12 words',
  'part_the-seed_2': 'Write them on paper',
  'part_the-seed_3': 'Check three of them',
  'part_prove-the-backup_1': 'Check your paper copy',
  'part_prove-the-backup_2': 'Remove the wallet from this browser',
  'part_prove-the-backup_3': 'Restore it from the 12 words',
  'part_prove-the-backup_4': 'Find your coins again',

  // -- what to do in the part that is open: one or two sentences each --
  // "Hold some" says more: chapter 2 has taught none of these things yet.
  'guide_hold-some_1':
    'A wallet is software that keeps the keys to your coins. Making one starts with a choice, with a passkey or without, and either is fine for practice. The wallet then shows you 12 words, which chapter 4 explains.',
  'guide_hold-some_2':
    'An address is where coins are sent, and your wallet shows one of its own on the Receive screen. The faucet hands practice coins to anyone who asks, so ask it there.',
  /** {seconds} is the time between two practice blocks. */
  'guide_hold-some_3':
    'Your coins are on their way: sent, and not in a block yet. A block takes them in, and that is their first confirmation. On Bitcoin a block comes about every 10 minutes; here, about every {seconds} seconds.',
  'guide_hold-some_4':
    'A block explorer is a website that shows a chain to anyone who asks, with no wallet at all. Look up your coin on the practice explorer, and read there which block took it in.',
  'guide_pass-it-on_1': 'The page checks that this wallet holds coins it may spend.',
  'guide_pass-it-on_2':
    'On the Send screen, press "Pass it on" to fill in an address of the pot, choose an amount and send it. The page sees the payment go out.',
  'guide_pass-it-on_3': 'Your payment is in the waiting room. The next block takes it in, and this part ticks by itself.',
  'guide_no-balances_1': 'Open the Coins screen. Each row there is one coin, an unspent output of some transaction.',
  'guide_no-balances_2': 'Count the rows on the Coins screen.',
  'guide_no-balances_3':
    'Open a payment this wallet sent, and read "What just happened" there: the coin that was used up whole, what went where, and the change that came back as a new coin, if any did.',
  'guide_waiting-room_1':
    'Send a payment to any practice address. If you have none at hand, "Pass it on" on the Send screen fills one in.',
  'guide_waiting-room_2':
    'Your payment is in the waiting room, the mempool: valid, and unconfirmed. Leave this page open and watch a block take it in.',
  /** Three forms, by how long six practice blocks take: {minutes} minutes, one minute, or {seconds} seconds. */
  'guide_waiting-room_3':
    'Each block on top is one more confirmation, and makes the payment harder to undo. Six take about {minutes} minutes here, and about an hour on Bitcoin.',
  'guide_waiting-room_3_minute':
    'Each block on top is one more confirmation, and makes the payment harder to undo. Six take about a minute here, and about an hour on Bitcoin.',
  'guide_waiting-room_3_seconds':
    'Each block on top is one more confirmation, and makes the payment harder to undo. Six take about {seconds} seconds here, and about an hour on Bitcoin.',
  'guide_the-seed_1': 'Open the Backup screen and show the 12 words. This step notes only that they were shown, never the words.',
  'guide_the-seed_2':
    'Write the 12 words on paper, in order, as you would for a real wallet. The Backup screen has a practice card to print.',
  'guide_the-seed_3': 'Take your paper, and type the three words this page asks for.',
  'guide_prove-the-backup_1':
    'Before the wallet goes, check the paper it has to come back from. Type the three words this page asks for.',
  /** Under the guidance of the drill's first part, for a reader with no paper copy. {step} is the title of "The seed". Then its link. */
  paperNone: 'No paper copy yet? Do "{step}" first: it shows the 12 words and has you write them down.',
  /** The same, once "The seed" is done (for another wallet): the Backup screen shows the words. */
  paperNoneHere: 'No paper copy of this wallet yet? The Backup screen shows its 12 words: write them down first.',
  /** Under the drill's first part, once ticked, when the check was passed in "The seed". {step} is that step's title. */
  checkedInSeed: 'Checked in "{step}".',
  'guide_prove-the-backup_2': 'Remove the wallet on the Settings screen. Its coins stay on the practice chain.',
  'guide_prove-the-backup_3':
    'Now bring the wallet back from your paper: restore it from the 12 words. Opening it with a passkey would prove the passkey, not the paper.',
  'guide_prove-the-backup_4': 'The page looks up the coins of the restored wallet.',

  // -- the one action of a part: a link into the wallet --
  actCreate: 'Create a practice wallet',
  actFaucet: 'Get practice coins',
  actSend: 'Open Send',
  actCoins: 'Open Coins',
  actPayment: 'Open your latest payment',
  actActivity: 'Open Activity',
  actBackup: 'Open Backup',
  actSettings: 'Open Settings',
  actRestore: 'Restore from the 12 words',
  actHome: 'Open, restore or create a wallet',
  /** A need that another step meets: {step} is that step's title. */
  actStep: 'Go to "{step}"',

  // -- what is missing, when a part cannot be done yet --
  'need_no-wallet': 'This part needs a practice wallet in this browser, and there is none.',
  /** Under the link to "Hold some", which makes a new wallet: for a reader who has one already. Then its link, to Home. */
  needHadOne: 'If you made one before, open or restore it on the home screen.',
  needHadOneLink: 'Go to the home screen',
  'need_no-coins': 'This part needs coins, and this wallet holds none.',
  /** {seconds} is the time between two practice blocks. */
  'need_not-spendable-yet':
    'Your coins are not in a block yet. They can be spent once the next block has taken them in, in about {seconds} seconds.',
  'need_nothing-sent': 'This part waits for a payment sent while this step is followed, and none is noted.',
  'need_came-back-with-passkey':
    'This wallet came back through its passkey. That proves the passkey, not the paper. Remove it once more and choose Restore from the 12 words.',
  /** {here} and {noted} are wallet fingerprints. */
  'need_another-wallet': 'The wallet in this browser ({here}) is not the one you removed ({noted}).',
  need_storage: 'Progress cannot be kept in this browser, so this part cannot be ticked here.',
  /** The same place under a newer version's note. */
  needNewer: 'This part cannot be ticked while this page is out of date. Reload the page first.',
  /** "There are no balances" needs a payment this wallet has sent. */
  needSentOnce:
    'This step needs a payment this wallet has sent. Without one, no coin was used up whole, and there is no change to see.',
  /** The drill's second part, when no wallet is here and none was removed while the step was followed. */
  needRemovedElsewhere:
    'No wallet is in this browser, and none was removed while this step was followed. Bring your wallet back first, then remove it from here.',
  /** The drill's second part, when the wallet here is not the one whose words were checked. */
  needNotChecked:
    'The wallet in this browser ({here}) is not the one whose words were checked ({noted}). Start this step again to check the words of the wallet that is here.',
  /** The two ways on after "another wallet", under its sentence. */
  needAnotherWays: 'Remove this wallet and restore the first one, or start this step again with the wallet that is here.',
  /** A restored wallet that holds no coin: the drill's last part waits for one. */
  needCoinsAgain: 'The wallet is back, and it holds no coins. This part ticks once it holds one.',

  // -- facts that are not known yet --
  unknownHistory: "Reading this wallet's transactions...",
  /** Under the cause, when the list could not be read. */
  unknownHistoryFailed: 'This page tries again by itself. You can also try now.',

  // -- a part that waits for a block --
  waitNotYet: 'Not in a block yet.',
  /** {ago} is how long ago, such as "12 seconds ago". */
  waitSent: 'Sent {ago}.',
  /** {height} is the height of the practice chain. */
  waitTip: 'The practice chain is at block {height}.',
  /** {seconds} is the time between two practice blocks. */
  waitEvery: 'A block comes about every {seconds} seconds.',
  waitExplorer: 'This payment on the practice explorer',
  /** The network does not know the noted payment, two minutes after it was sent. */
  waitLost:
    'The practice network does not know this payment. The practice chain may have been started again since you sent it. Send another payment, and this step goes on with that one.',
  sendAnother: 'Send another',
  /** The one line a part keeps once its block has come. */
  waited: 'It waited {seconds} seconds. Block {height} took it in.',
  waitedOne: 'It waited 1 second. Block {height} took it in.',
  /** The same, where how long it waited cannot be said. */
  waitedBlock: 'Block {height} took it in.',
  /** {count} goes from 1 to {total}. */
  confirmations: '{count} of {total} confirmations',

  // -- the questions --
  check: 'Check',
  blockLabel: 'Which block took your coin in?',
  blockHint: 'The number of the block, in digits, as the practice explorer shows it.',
  blockExplorer: 'Your coin on the practice explorer',
  blockWrong:
    'That is not the block. On the practice explorer, the page of your coin\'s transaction names the block that holds it.',
  coinsLabel: 'How many separate coins does this wallet hold?',
  coinsHint: 'The number of rows, in digits.',
  coinsWrong: 'That is not it. Count the rows on the Coins screen: each row is one coin.',
  coinsTotal: 'That is what your coins add up to. The question is how many coins hold it.',
  answerEmpty: 'Type a number first.',
  answerPeriod: 'The answer is a whole number. Type it without a period.',
  answerInvalid: 'Type the number in digits, with or without commas.',
  /** The question closed under the reader: another tab answered it, or the wallet changed. */
  answerClosed: 'This question is no longer open. The parts above show where the step stands now.',

  // -- three of the 12 words --
  /** Follows the exception paragraph of the Restore screen (strings/restore.ts), above the three fields. */
  wordsOnce:
    'A real wallet asks for this once, on its own screen, straight after it has shown you the words. Anything else that asks for your words, even for three of them (a web page, an email, a support chat), is the scam chapter 4 describes.',
  /** What a screen reader calls the three fields together. */
  wordsGroup: 'Three of the 12 words',
  wordsCheck: 'Check the three words',
  /** {n} is the word's place in the phrase, from 1. The word itself is never said. */
  wordsWrong: 'Word {n} does not match.',
  wordsWrongWay: 'Look at your paper again, and type all three once more.',
  wordsUnlockWhy: 'Checking three words needs the keys of this wallet, and your passkey loads them.',
  wordsReload:
    "This page has let the faucet's bot check in, so it takes no typed words until it has been loaded again. Reload the page, then check the three words.",
  wordsGone:
    'The wallet in this browser changed in another tab while this page was open, so nothing was checked. The parts above show where the step stands now.',

  // -- the reader's word --
  said: 'I wrote the 12 words on paper, in order.',

  // -- before the wallet is removed: said plainly, and not counted against the lengths above --
  removeWarnTitle: 'Before you remove it',
  removeWarnFunded:
    'With real money this drill is done before the wallet is funded (chapter 4, section 7). Here the coins stay in, to show that the chain kept them.',
  removeWarnNine:
    'Three right words do not prove the other nine. If the restore fails, this wallet and its practice coins are gone, which is what a wrong backup costs.',
  removeWarnKept:
    'A wallet restored from its 12 words is kept in this browser with those words, also when it was opened with a passkey before.',

  // -- what the reader can do to the step itself --
  restart: 'Start this step again',
  stop: 'Stop following',
  /** Under the two buttons: what each does. */
  restartNote: '"Start this step again" unticks its parts, and you do them again.',
  stopNote: '"Stop following" takes the strip for this step off the other screens.',

  // -- a step that is done --
  /** {date} is a day, such as "November 15, 2026". */
  doneOn: 'Done on {date}.',
  'done_hold-some':
    "You hold practice coins, and you did not have to take this page's word for it: the explorer showed the same coin in the same block. On Bitcoin it works the same way. Verify, don't trust.",
  'done_pass-it-on':
    'Your payment is in a block, and the pot holds your coins for a learner who comes after you. The fee was what went in less what came out: the payment\'s own screen shows the figures.',
  'done_no-balances':
    'Your wallet keeps no balance. It holds coins, and its total is what they add up to. A payment uses coins up whole and makes new ones: one for the address paid and, when something is left over, one back to you as change.',
  'done_waiting-room':
    'Your payment has six confirmations: its own block and five on top. To undo it now, someone would have to redo all six faster than the rest of the network adds new ones. That is why six confirmations is the usual line for "settled".',
  'done_the-seed':
    'You said your 12 words are on paper, and three of them matched. Three right words do not prove the other nine: "Prove the backup" does that.',
  'done_prove-the-backup':
    'The wallet came back from its 12 words, with its coins. The chain kept them the whole time, and the words only unlock them: you own keys, not coins.',
  /** Under a done "Pass it on": how many payments, never how many people. */
  potCount: '{count} payments have been passed on to the pot so far, yours among them.',
  potCountOne: 'One payment has been passed on to the pot so far: yours.',
  /** Under a done "The seed". {fingerprint} is a wallet fingerprint. */
  seedChecked: 'The three words were checked for the wallet with the wallet fingerprint {fingerprint}.',
  /** The same place, when another wallet is in this browser now. {here} is its wallet fingerprint. */
  seedOther:
    'Another wallet is in this browser now ({here}). Its paper has not been checked: type three of its words to check it too.',
  seedRechecked: 'Checked. The three words are now checked for the wallet that is here.',
  /** Under a done "Prove the backup", when the wallet was opened with a passkey before the drill. */
  changedTitle: 'What has changed',
  changed:
    'This browser now keeps this wallet with its 12 words, not encrypted, and no longer asks for the passkey. The passkey still opens the same wallet. To go back to that, remove the wallet once more and choose "Open with my passkey".',
  sparrow: 'One more proof: open the same wallet in Sparrow',
  /** {step} is the next step's title. Only within the same chapter. */
  next: 'Next step: {step}',

  // -- the strip under the header, on every screen but the followed step's own --
  /** What a screen reader calls the strip. */
  stripLabel: 'The step you are following',
  stripPart: 'part {n} of {m}',
  /** The short form, on a narrow screen. */
  stripShort: '{n} of {m}',
  stripBack: 'Back to the step',
  stripStop: 'Stop following',
  /** {step} is the step's title. */
  stripDone: '"{step}" is done',
  stripClose: 'Close',
  'stripNeed_no-wallet': 'first: a practice wallet',
  'stripNeed_no-coins': 'first: get practice coins',
  'stripNeed_not-spendable-yet': 'first: wait for the next block',
  'stripNeed_nothing-sent': 'first: send a payment',
  'stripNeed_came-back-with-passkey': 'first: remove it, and restore from the 12 words',
  'stripNeed_another-wallet': 'another wallet is here',
  stripNeed_storage: 'progress cannot be kept here',
  stripNeed_trouble: 'the stored wallet cannot be used',
  stripUnknown: 'looking up your coins...',
  stripFailed: 'your coins could not be looked up',
  /** {ago} is how long ago, such as "12 seconds ago". */
  stripWaiting: 'waiting for a block, sent {ago}',
  stripWaitingBlock: 'waiting for a block',
  stripLost: 'the network does not know the payment',

  // -- what the status region says: outcomes only --
  /** {part} is the part's name. */
  saidTicked: 'Part {n} of {m} is ticked: {part}.',
  /** {step} is the step's title. */
  saidDone: 'Step done: {step}.',

  // -- "What just happened", on the transaction screen --
  // One sentence for each key of EXPLAIN_SLOTS (lib/doit/explain.ts), with exactly its slots.
  // {amount} and {fee} carry their unit ("282 practice sats"); {in} and {out} are bare numbers.
  explainTitle: 'What just happened',
  explain_spentOne: 'One coin of this wallet was spent. It held {amount}, and a coin is always spent whole.',
  explain_spentMany:
    '{count} coins of this wallet were spent. Together they held {amount}, and coins are always spent whole.',
  explain_theirsOne: "The one coin spent was not this wallet's. It held {amount}.",
  explain_theirsMany: "The {count} coins spent were not this wallet's. Together they held {amount}.",
  explain_newCoins: 'Nothing was spent. These are new coins, made by the block itself.',
  explain_paid: '{amount} went to {address}, the address that was paid.',
  explain_paidOdd: '{amount} went to an output that has no address.',
  explain_paidMany: "{amount} went to {count} outputs that are not this wallet's.",
  explain_got: '{amount} came to this wallet, at its address {address}.',
  explain_gotMany: '{amount} came to this wallet, in {count} outputs.',
  explain_other:
    "{amount} went to an address that is not this wallet's, most likely the sender's own change. A wallet knows its own change and can only guess at someone else's.",
  explain_otherMany:
    "{amount} went to {count} outputs that are not this wallet's, most likely with the sender's own change among them. A wallet knows its own change and can only guess at someone else's.",
  explain_selfOne: 'The wallet paid itself. What was left after the fee, {amount}, came back to it in one output.',
  explain_selfMany: 'The wallet paid itself. What was left after the fee, {amount}, came back to it in {count} outputs.',
  explain_change: '{amount} came back as change, to {address}, a fresh address of this wallet. The change is a new coin.',
  explain_back: '{amount} came back to this wallet.',
  explain_noChange:
    'No change came back. The payment and the fee used up everything the coins held: either everything was sent, or what was left over was too small to be a coin and went to the fee.',
  explain_fee:
    'The fee is what went in less what came out: {in} less {out} leaves {fee}. Spread over the {size} vB of the transaction, that is {rate} sat/vB.',
  explain_feeAbout:
    'The fee is what went in less what came out: {in} less {out} leaves {fee}. Spread over the {size} vB of the transaction, that is about {rate} sat/vB.',
  explain_feeTheirs:
    'The sender paid the fee, which is what went in less what came out: {in} less {out} leaves {fee}. Spread over the {size} vB of the transaction, that is {rate} sat/vB.',
  explain_feeTheirsAbout:
    'The sender paid the fee, which is what went in less what came out: {in} less {out} leaves {fee}. Spread over the {size} vB of the transaction, that is about {rate} sat/vB.',
  explain_waiting: 'It is not in a block yet. It waits in the waiting room, the mempool, for a block to take it in.',
  explain_inBlock: 'Block {height} took it in.',
  explain_confirmed: 'A block took it in.',

  // -- links to the main site's glossary: the line in front of them, and each entry's words --
  glossaryLine: 'In the LearnBitcoin glossary:',
  term_utxo: 'coin (UTXO)',
  term_change: 'change',
  term_fee: 'fee',
  term_block: 'block',
  term_mempool: 'waiting room (mempool)',
  term_wallet: 'wallet',
  term_address: 'address',
  term_seed: 'the 12 words (seed phrase)',
  term_explorer: 'block explorer',
  term_height: 'block height',
  term_faucet: 'faucet',
} as const;

export const es: Record<keyof typeof en, string> = {
  name: 'Hazlo',

  listLede:
    'Cada paso de aquí es algo que enseñó un capítulo del Recorrido, hecho en tu propia billetera de práctica y comprobado contra la cadena de práctica.',
  chapterHeading: 'Capítulo {number}: {title}',
  chapter_2: 'Qué es Bitcoin en realidad',
  chapter_3: 'Cómo funciona Bitcoin',
  chapter_4: 'Sé tu propio banco',
  listSteps: 'Pasos del capítulo {number}',
  stateNotStarted: 'Sin empezar',
  stateStarted: 'Empezado',
  stateDone: 'Hecho el {date}',
  stateFollowing: 'En seguimiento',
  forgetTitle: 'Tu progreso',
  forgetWhat:
    'Este navegador guarda qué pasos abriste y cuáles terminaste. La nota en sí nunca se nos envía. Abrir un paso y terminarlo se cuentan, como dice la página Acerca de.',
  forget: 'Olvidar mi progreso',
  forgetAsk: '¿Olvidar tu progreso de "Hazlo" en este navegador?',
  forgetWarn:
    'Cada marca y cada paso terminado se borra de este navegador. Tu billetera y sus monedas no se tocan, y cada paso se puede volver a hacer.',
  forgetYes: 'Olvidarlo',
  forgetNo: 'Conservarlo',
  forgotten: 'Tu progreso de "Hazlo" se olvidó. Este navegador ya no guarda nada de él.',
  forgetRefused:
    'Este navegador no dejó que esta página borrara tu progreso, así que sigue guardado aquí. Permite los datos del sitio para esta página y vuelve a intentarlo.',

  newer:
    'Esta página está desactualizada. Tu progreso de "Hazlo" lo guardó una versión más nueva de ella, así que esta versión no muestra nada de él ni lo cambia. Recarga la página para tener la versión más nueva.',
  noStorage:
    'Este navegador se niega a guardar cualquier cosa de esta página, así que tu progreso de "Hazlo" no se puede conservar aquí. Pasa en algunas ventanas privadas, y cuando los datos del sitio están bloqueados. Abre esta página en una ventana normal, o permite los datos del sitio, y recarga.',

  homeBody:
    'Pasos cortos que acompañan a los capítulos del Recorrido, cada uno hecho en tu propia billetera de práctica y comprobado contra la cadena de práctica.',
  homeLink: 'Ver los pasos',
  overviewLine: 'Los capítulos del Recorrido terminan en pasos que haces en esta billetera.',
  overviewLink: 'Ver los pasos de "Hazlo"',

  staysOnRemove:
    'Tu progreso de "Hazlo" no se quita junto con la billetera. Se queda en este navegador hasta que elijas "Olvidar mi progreso" en la pantalla Hazlo. Puede nombrar esta billetera por su huella de la billetera y, en un paso sin terminar, el pago que ese paso espera.',
  staysAfterRemove:
    'Tu progreso de "Hazlo" sigue en este navegador, hasta que elijas "Olvidar mi progreso" en la pantalla Hazlo. Puede nombrar la billetera que quitaste por su huella de la billetera y, en un paso sin terminar, el pago que ese paso espera.',
  keepsProgress:
    'Tu progreso de "Hazlo": qué pasos abriste y cuáles terminaste. Se queda cuando la billetera se quita, hasta que elijas "Olvidar mi progreso" en la pantalla Hazlo. Puede nombrar esta billetera por su huella de la billetera y, en un paso sin terminar, el pago que ese paso espera.',

  'title_hold-some': 'Ten algunas',
  'title_pass-it-on': 'Pásala',
  'title_no-balances': 'No hay saldos',
  'title_waiting-room': 'La sala de espera',
  'title_the-seed': 'La semilla',
  'title_prove-the-backup': 'Comprueba el respaldo',
  'lede_hold-some':
    'El capítulo 2 dijo qué es bitcoin. Aquí recibes algunas monedas para tener: monedas de práctica sin valor, en una red que funciona como Bitcoin.',
  'lede_pass-it-on':
    'El capítulo 3 empieza con Alice tocando Enviar. Aquí lo tocas tú, y dejas unas monedas de práctica en el fondo común para quien viene después de ti.',
  'lede_no-balances':
    'El capítulo 3 dice que no hay saldos, solo monedas. Aquí cuentas las tuyas, y lees lo que uno de tus pagos hizo con ellas.',
  'lede_waiting-room':
    'Envías un pago y lo ves esperar, entrar en un bloque y llegar a seis confirmaciones. Aquí la sala de espera está casi vacía, así que el siguiente bloque se lleva todos los pagos sin importar su tasa de comisión; en Bitcoin, la tasa de comisión decide el lugar en la fila.',
  'lede_the-seed':
    'El capítulo 4 dice que las 12 palabras son la raíz de toda la billetera. Aquí pasas a papel las palabras de esta billetera, y compruebas que el papel esté bien.',
  'lede_prove-the-backup':
    'Este es el ejercicio del capítulo 4: quitar la billetera, y luego traerla de vuelta solo con el papel. Una billetera que vuelve con sus monedas es la única forma de saber que el respaldo funciona.',
  back: 'Volver al capítulo',
  allSteps: 'Todos los pasos',

  partsTitle: 'Las partes',
  proofChecked: 'Comprobado',
  proofOpened: 'Abierto',
  proofSaid: 'Tu palabra',
  partNow: 'Ahora',
  partLater: 'Después',
  partBlocked: 'Todavía no',
  partUnknown: 'Aún no se sabe',

  'part_hold-some_1': 'Crea una billetera de práctica',
  'part_hold-some_2': 'Pídele monedas al faucet',
  'part_hold-some_3': 'Míralas confirmarse',
  'part_hold-some_4': 'Míralo desde afuera',
  'part_pass-it-on_1': 'Ten monedas que se puedan gastar',
  'part_pass-it-on_2': 'Envía algunas al fondo común',
  'part_pass-it-on_3': 'Recibe su primera confirmación',
  'part_no-balances_1': 'Abre tus monedas',
  'part_no-balances_2': 'Cuenta tus monedas',
  'part_no-balances_3': 'Lee lo que hizo uno de tus pagos',
  'part_waiting-room_1': 'Envía un pago',
  'part_waiting-room_2': 'Un bloque lo incluye',
  'part_waiting-room_3': 'Seis bloques encima',
  'part_the-seed_1': 'Muestra las 12 palabras',
  'part_the-seed_2': 'Escríbelas en papel',
  'part_the-seed_3': 'Comprueba tres de ellas',
  'part_prove-the-backup_1': 'Comprueba tu copia en papel',
  'part_prove-the-backup_2': 'Quita la billetera de este navegador',
  'part_prove-the-backup_3': 'Restáurala desde las 12 palabras',
  'part_prove-the-backup_4': 'Encuentra tus monedas otra vez',

  'guide_hold-some_1':
    'Una billetera es un programa que guarda las claves de tus monedas. Crearla empieza con una elección, con llave de acceso (passkey) o sin ella, y cualquiera de las dos sirve para practicar. Después la billetera te muestra 12 palabras, que el capítulo 4 explica.',
  'guide_hold-some_2':
    'Una dirección es adonde se envían las monedas, y tu billetera muestra una suya en la pantalla Recibir. El faucet reparte monedas de práctica a quien las pide, así que pídeselas ahí.',
  'guide_hold-some_3':
    'Tus monedas están en camino: enviadas, y todavía fuera de un bloque. Un bloque las incluye, y esa es su primera confirmación. En Bitcoin llega un bloque más o menos cada 10 minutos; aquí, más o menos cada {seconds} segundos.',
  'guide_hold-some_4':
    'Un explorador de bloques es un sitio web que le muestra una cadena a quien pregunte, sin ninguna billetera. Busca tu moneda en el explorador de práctica, y lee ahí qué bloque la incluyó.',
  'guide_pass-it-on_1': 'La página comprueba que esta billetera tenga monedas que pueda gastar.',
  'guide_pass-it-on_2':
    'En la pantalla Enviar, toca "Pásala" para llenar una dirección del fondo común, elige un monto y envíalo. La página ve salir el pago.',
  'guide_pass-it-on_3':
    'Tu pago está en la sala de espera. El siguiente bloque lo incluye, y esta parte se marca sola.',
  'guide_no-balances_1':
    'Abre la pantalla Monedas. Cada fila es una moneda, una salida no gastada de alguna transacción.',
  'guide_no-balances_2': 'Cuenta las filas de la pantalla Monedas.',
  'guide_no-balances_3':
    'Abre un pago que esta billetera envió, y lee ahí "Lo que acaba de pasar": la moneda que se gastó entera, qué fue adónde, y el cambio que volvió como una moneda nueva, si lo hubo.',
  'guide_waiting-room_1':
    'Envía un pago a cualquier dirección de práctica. Si no tienes ninguna a mano, "Pásala" en la pantalla Enviar llena una.',
  'guide_waiting-room_2':
    'Tu pago está en la sala de espera, el mempool: válido, y sin confirmar. Deja esta página abierta y mira cómo un bloque lo incluye.',
  'guide_waiting-room_3':
    'Cada bloque encima es una confirmación más, y hace el pago más difícil de deshacer. Seis tardan unos {minutes} minutos aquí, y alrededor de una hora en Bitcoin.',
  'guide_waiting-room_3_minute':
    'Cada bloque encima es una confirmación más, y hace el pago más difícil de deshacer. Seis tardan alrededor de un minuto aquí, y alrededor de una hora en Bitcoin.',
  'guide_waiting-room_3_seconds':
    'Cada bloque encima es una confirmación más, y hace el pago más difícil de deshacer. Seis tardan unos {seconds} segundos aquí, y alrededor de una hora en Bitcoin.',
  'guide_the-seed_1':
    'Abre la pantalla Respaldo y muestra las 12 palabras. Este paso solo anota que se mostraron, nunca las palabras.',
  'guide_the-seed_2':
    'Escribe las 12 palabras en papel, en orden, como lo harías con una billetera de verdad. La pantalla Respaldo tiene una tarjeta de práctica para imprimir.',
  'guide_the-seed_3': 'Toma tu papel, y escribe las tres palabras que esta página te pide.',
  'guide_prove-the-backup_1':
    'Antes de que la billetera se vaya, comprueba el papel del que tiene que volver. Escribe las tres palabras que esta página te pide.',
  paperNone: '¿Todavía no tienes una copia en papel? Haz primero "{step}": muestra las 12 palabras y te pide escribirlas.',
  paperNoneHere:
    '¿Todavía no tienes una copia en papel de esta billetera? La pantalla Respaldo muestra sus 12 palabras: escríbelas primero.',
  checkedInSeed: 'Comprobado en "{step}".',
  'guide_prove-the-backup_2':
    'Quita la billetera en la pantalla Configuración. Sus monedas siguen en la cadena de práctica.',
  'guide_prove-the-backup_3':
    'Ahora trae la billetera de vuelta desde tu papel: restáurala desde las 12 palabras. Abrirla con una llave de acceso (passkey) comprobaría la llave de acceso, no el papel.',
  'guide_prove-the-backup_4': 'La página busca las monedas de la billetera restaurada.',

  actCreate: 'Crear una billetera de práctica',
  actFaucet: 'Pedir monedas de práctica',
  actSend: 'Abrir Enviar',
  actCoins: 'Abrir Monedas',
  actPayment: 'Abrir tu último pago',
  actActivity: 'Abrir Actividad',
  actBackup: 'Abrir Respaldo',
  actSettings: 'Abrir Configuración',
  actRestore: 'Restaurar desde las 12 palabras',
  actHome: 'Abrir, restaurar o crear una billetera',
  actStep: 'Ir a "{step}"',

  'need_no-wallet': 'Esta parte necesita una billetera de práctica en este navegador, y no hay ninguna.',
  needHadOne: 'Si ya creaste una antes, ábrela o restáurala en la pantalla de inicio.',
  needHadOneLink: 'Ir a la pantalla de inicio',
  'need_no-coins': 'Esta parte necesita monedas, y esta billetera no tiene ninguna.',
  'need_not-spendable-yet':
    'Tus monedas todavía no están en un bloque. Se pueden gastar cuando el siguiente bloque las incluya, en unos {seconds} segundos.',
  'need_nothing-sent': 'Esta parte espera un pago enviado mientras se sigue este paso, y no hay ninguno anotado.',
  'need_came-back-with-passkey':
    'Esta billetera volvió con su llave de acceso (passkey). Eso comprueba la llave de acceso, no el papel. Quítala una vez más y elige Restaurar desde las 12 palabras.',
  'need_another-wallet': 'La billetera de este navegador ({here}) no es la que quitaste ({noted}).',
  need_storage: 'El progreso no se puede guardar en este navegador, así que esta parte no se puede marcar aquí.',
  needNewer: 'Esta parte no se puede marcar mientras esta página esté desactualizada. Primero recarga la página.',
  needSentOnce:
    'Este paso necesita un pago que esta billetera haya enviado. Sin uno, ninguna moneda se gastó entera, y no hay cambio que ver.',
  needRemovedElsewhere:
    'No hay ninguna billetera en este navegador, y ninguna se quitó mientras se seguía este paso. Primero trae tu billetera de vuelta, y después quítala desde aquí.',
  needNotChecked:
    'La billetera de este navegador ({here}) no es la billetera cuyas palabras se comprobaron ({noted}). Empieza este paso de nuevo para comprobar las palabras de la billetera que está aquí.',
  needAnotherWays:
    'Quita esta billetera y restaura la primera, o empieza este paso de nuevo con la billetera que está aquí.',
  needCoinsAgain: 'La billetera volvió, y no tiene monedas. Esta parte se marca cuando tenga una.',

  unknownHistory: 'Leyendo las transacciones de esta billetera...',
  unknownHistoryFailed: 'Esta página vuelve a intentarlo sola. También puedes intentarlo ahora.',

  waitNotYet: 'Todavía no está en un bloque.',
  waitSent: 'Se envió {ago}.',
  waitTip: 'La cadena de práctica va en el bloque {height}.',
  waitEvery: 'Llega un bloque más o menos cada {seconds} segundos.',
  waitExplorer: 'Este pago en el explorador de práctica',
  waitLost:
    'La red de práctica no conoce este pago. Puede que la cadena de práctica se haya reiniciado desde que lo enviaste. Envía otro pago, y este paso sigue con ese.',
  sendAnother: 'Enviar otro',
  waited: 'Esperó {seconds} segundos. Lo incluyó el bloque {height}.',
  waitedOne: 'Esperó 1 segundo. Lo incluyó el bloque {height}.',
  waitedBlock: 'Lo incluyó el bloque {height}.',
  confirmations: '{count} de {total} confirmaciones',

  check: 'Comprobar',
  blockLabel: '¿Qué bloque incluyó tu moneda?',
  blockHint: 'El número del bloque, en cifras, como lo muestra el explorador de práctica.',
  blockExplorer: 'Tu moneda en el explorador de práctica',
  blockWrong:
    'Ese no es el bloque. En el explorador de práctica, la página de la transacción de tu moneda dice qué bloque la contiene.',
  coinsLabel: '¿Cuántas monedas separadas tiene esta billetera?',
  coinsHint: 'El número de filas, en cifras.',
  coinsWrong: 'No es eso. Cuenta las filas de la pantalla Monedas: cada fila es una moneda.',
  coinsTotal: 'Eso es lo que suman tus monedas. La pregunta es cuántas monedas lo contienen.',
  answerEmpty: 'Primero escribe un número.',
  answerPeriod: 'La respuesta es un número entero. Escríbelo sin punto.',
  answerInvalid: 'Escribe el número en cifras, con comas o sin ellas.',
  answerClosed: 'Esta pregunta ya no está abierta. Las partes de arriba muestran cómo va el paso ahora.',

  wordsOnce:
    'Una billetera de verdad pide esto una sola vez, en su propia pantalla, justo después de mostrarte las palabras. Cualquier otra cosa que te pida tus palabras, aunque sean tres (una página web, un correo, un chat de soporte), es la estafa que describe el capítulo 4.',
  wordsGroup: 'Tres de las 12 palabras',
  wordsCheck: 'Comprobar las tres palabras',
  wordsWrong: 'La palabra {n} no coincide.',
  wordsWrongWay: 'Mira tu papel otra vez, y escribe las tres de nuevo.',
  wordsUnlockWhy:
    'Comprobar tres palabras necesita las claves de esta billetera, y tu llave de acceso (passkey) las carga.',
  wordsReload:
    'Esta página dejó entrar la comprobación contra bots del faucet, así que no acepta palabras escritas hasta que se cargue de nuevo. Recarga la página, y después comprueba las tres palabras.',
  wordsGone:
    'La billetera de este navegador cambió en otra pestaña mientras esta página estaba abierta, así que no se comprobó nada. Las partes de arriba muestran cómo va el paso ahora.',

  said: 'Escribí las 12 palabras en papel, en orden.',

  removeWarnTitle: 'Antes de quitarla',
  removeWarnFunded:
    'Con dinero de verdad, este ejercicio se hace antes de poner fondos en la billetera (capítulo 4, sección 7). Aquí las monedas se quedan dentro, para mostrar que la cadena las conservó.',
  removeWarnNine:
    'Tres palabras correctas no comprueban las otras nueve. Si la restauración falla, esta billetera y sus monedas de práctica se pierden, que es lo que cuesta un respaldo equivocado.',
  removeWarnKept:
    'Una billetera restaurada desde sus 12 palabras queda guardada en este navegador con esas palabras, también cuando antes se abría con una llave de acceso (passkey).',

  restart: 'Empezar este paso de nuevo',
  stop: 'Dejar de seguir',
  restartNote: '"Empezar este paso de nuevo" desmarca sus partes, y las vuelves a hacer.',
  stopNote: '"Dejar de seguir" quita de las otras pantallas la franja de este paso.',

  doneOn: 'Hecho el {date}.',
  'done_hold-some':
    'Tienes monedas de práctica, y no tuviste que creerle a esta página: el explorador mostró la misma moneda en el mismo bloque. En Bitcoin funciona igual. Verifica, no confíes.',
  'done_pass-it-on':
    'Tu pago está en un bloque, y el fondo común guarda tus monedas para alguien que viene después de ti. La comisión fue lo que entró menos lo que salió: la pantalla del pago muestra las cifras.',
  'done_no-balances':
    'Tu billetera no lleva ningún saldo. Tiene monedas, y su total es lo que suman. Un pago gasta monedas enteras y crea monedas nuevas: una para la dirección de destino y, cuando sobra algo, otra de vuelta para ti como cambio.',
  'done_waiting-room':
    'Tu pago tiene seis confirmaciones: su propio bloque y cinco encima. Para deshacerlo ahora, alguien tendría que rehacer los seis más rápido de lo que el resto de la red agrega bloques nuevos. Por eso seis confirmaciones son la línea habitual de "liquidado".',
  'done_the-seed':
    'Dijiste que tus 12 palabras están en papel, y tres de ellas coincidieron. Tres palabras correctas no comprueban las otras nueve: eso lo hace "Comprueba el respaldo".',
  'done_prove-the-backup':
    'La billetera volvió desde sus 12 palabras, con sus monedas. La cadena las conservó todo el tiempo, y las palabras solo las desbloquean: tienes claves, no monedas.',
  potCount: 'Hasta ahora se han pasado {count} pagos al fondo común, el tuyo entre ellos.',
  potCountOne: 'Hasta ahora se ha pasado un pago al fondo común: el tuyo.',
  seedChecked: 'Las tres palabras se comprobaron para la billetera con la huella de la billetera {fingerprint}.',
  seedOther:
    'Ahora hay otra billetera en este navegador ({here}). Su papel no se ha comprobado: escribe tres de sus palabras para comprobarlo también.',
  seedRechecked: 'Comprobado. Las tres palabras quedan comprobadas para la billetera que está aquí.',
  changedTitle: 'Lo que cambió',
  changed:
    'Este navegador ahora guarda esta billetera con sus 12 palabras, sin cifrar, y ya no pide la llave de acceso (passkey). La llave de acceso sigue abriendo la misma billetera. Para volver a eso, quita la billetera una vez más y elige "Abrir con mi llave de acceso".',
  sparrow: 'Una comprobación más: abre la misma billetera en Sparrow',
  next: 'Siguiente paso: {step}',

  stripLabel: 'El paso que estás siguiendo',
  stripPart: 'parte {n} de {m}',
  stripShort: '{n} de {m}',
  stripBack: 'Volver al paso',
  stripStop: 'Dejar de seguir',
  stripDone: '"{step}": hecho',
  stripClose: 'Cerrar',
  'stripNeed_no-wallet': 'primero: una billetera de práctica',
  'stripNeed_no-coins': 'primero: pide monedas de práctica',
  'stripNeed_not-spendable-yet': 'primero: espera el siguiente bloque',
  'stripNeed_nothing-sent': 'primero: envía un pago',
  'stripNeed_came-back-with-passkey': 'primero: quítala, y restaura desde las 12 palabras',
  'stripNeed_another-wallet': 'aquí hay otra billetera',
  stripNeed_storage: 'el progreso no se puede guardar aquí',
  stripNeed_trouble: 'la billetera guardada no se puede usar',
  stripUnknown: 'buscando tus monedas...',
  stripFailed: 'no se pudieron buscar tus monedas',
  stripWaiting: 'esperando un bloque, se envió {ago}',
  stripWaitingBlock: 'esperando un bloque',
  stripLost: 'la red no conoce el pago',

  saidTicked: 'La parte {n} de {m} quedó marcada: {part}.',
  saidDone: 'Paso terminado: {step}.',

  explainTitle: 'Lo que acaba de pasar',
  explain_spentOne: 'Se gastó una moneda de esta billetera. Tenía {amount}, y una moneda siempre se gasta entera.',
  explain_spentMany:
    'Se gastaron {count} monedas de esta billetera. Juntas tenían {amount}, y las monedas siempre se gastan enteras.',
  explain_theirsOne: 'La única moneda que se gastó no era de esta billetera. Tenía {amount}.',
  explain_theirsMany: 'Las {count} monedas que se gastaron no eran de esta billetera. Juntas tenían {amount}.',
  explain_newCoins: 'No se gastó nada. Son monedas nuevas, creadas por el bloque mismo.',
  explain_paid: '{amount} fueron a {address}, la dirección de destino.',
  explain_paidOdd: '{amount} fueron a una salida que no tiene dirección.',
  explain_paidMany: '{amount} fueron a {count} salidas que no son de esta billetera.',
  explain_got: '{amount} llegaron a esta billetera, a su dirección {address}.',
  explain_gotMany: '{amount} llegaron a esta billetera, en {count} salidas.',
  explain_other:
    '{amount} fueron a una dirección que no es de esta billetera, lo más probable es que sea el cambio de quien envió. Una billetera conoce su propio cambio, y el de otra solo puede adivinarlo.',
  explain_otherMany:
    '{amount} fueron a {count} salidas que no son de esta billetera, lo más probable es que entre ellas esté el cambio de quien envió. Una billetera conoce su propio cambio, y el de otra solo puede adivinarlo.',
  explain_selfOne:
    'La billetera se pagó a sí misma. Lo que quedó después de la comisión, {amount}, volvió a ella en una salida.',
  explain_selfMany:
    'La billetera se pagó a sí misma. Lo que quedó después de la comisión, {amount}, volvió a ella en {count} salidas.',
  explain_change:
    '{amount} volvieron como cambio, a {address}, una dirección nueva de esta billetera. El cambio es una moneda nueva.',
  explain_back: '{amount} volvieron a esta billetera.',
  explain_noChange:
    'No volvió cambio. El pago y la comisión gastaron todo lo que tenían las monedas: o se envió todo, o lo que sobraba era demasiado pequeño para ser una moneda y se fue a la comisión.',
  explain_fee:
    'La comisión es lo que entró menos lo que salió: {in} menos {out} deja {fee}. Repartida entre los {size} vB de la transacción, son {rate} sat/vB.',
  explain_feeAbout:
    'La comisión es lo que entró menos lo que salió: {in} menos {out} deja {fee}. Repartida entre los {size} vB de la transacción, son unos {rate} sat/vB.',
  explain_feeTheirs:
    'La comisión la pagó quien envió, y es lo que entró menos lo que salió: {in} menos {out} deja {fee}. Repartida entre los {size} vB de la transacción, son {rate} sat/vB.',
  explain_feeTheirsAbout:
    'La comisión la pagó quien envió, y es lo que entró menos lo que salió: {in} menos {out} deja {fee}. Repartida entre los {size} vB de la transacción, son unos {rate} sat/vB.',
  explain_waiting:
    'Todavía no está en un bloque. Espera en la sala de espera, el mempool, a que un bloque la incluya.',
  explain_inBlock: 'La incluyó el bloque {height}.',
  explain_confirmed: 'Un bloque la incluyó.',

  glossaryLine: 'En el glosario de LearnBitcoin:',
  term_utxo: 'moneda (UTXO)',
  term_change: 'cambio',
  term_fee: 'comisión',
  term_block: 'bloque',
  term_mempool: 'sala de espera (mempool)',
  term_wallet: 'billetera',
  term_address: 'dirección',
  term_seed: 'las 12 palabras (frase semilla)',
  term_explorer: 'explorador de bloques',
  term_height: 'altura de bloque',
  term_faucet: 'faucet (en inglés)',
};
