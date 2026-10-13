// Real touches (Chromium's Input.dispatchTouchEvent): the page gets touchstart/move/end and pointer events of type
// 'touch', as from a finger — what page.mouse cannot give, and page.touchscreen only as taps.

/**
 * A finger from one point to another, in steps, then lifted.
 * @param {import('@playwright/test').Page} page
 * @param {{ x: number, y: number }} from @param {{ x: number, y: number }} to
 * @param {{ steps?: number }} [options]
 */
export async function swipe(page, from, to, { steps = 10 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const send = (/** @type {string} */ type, /** @type {{ x: number, y: number }[]} */ points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  await send('touchStart', [from]);
  for (let i = 1; i <= steps; i++) {
    await send('touchMove', [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }]);
  }
  await send('touchEnd', []);
  await cdp.detach();
}

/** The centre of an element on the page. @param {import('@playwright/test').Locator} locator */
export async function centre(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not on screen: ' + locator);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
