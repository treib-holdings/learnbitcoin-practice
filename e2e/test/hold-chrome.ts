// A program that starts Chrome the way the tools do, says so, and then waits
// to be ended from outside. chrome-lifecycle.test.ts runs it and ends it in
// every way a run can be ended. (Not a test file itself.)

import { launchChrome } from '../src/browser.ts';

const chrome = await launchChrome();
const page = await chrome.browser.newPage();
await page.goto('about:blank');
// The process number of Chrome itself: the test watches for it to go.
console.log(`up ${chrome.browser.process()?.pid ?? 0}`);
// Nothing ends this by itself.
setInterval(() => {}, 1000);
