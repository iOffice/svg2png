import { createPuppeteerPool, ID } from '../main';
import { Pool } from 'generic-pool';
import { Browser } from 'puppeteer';
import { expect } from 'chai';
import { pause } from './util';

describe('puppeteer-pool', () => {
  let pool: Pool<Browser>;

  beforeEach(() => {
    pool = createPuppeteerPool(
      {
        maxUses: 2,
        validator: () => Promise.resolve(true),
      }, {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      }, {
        min: 1,
        max: 5,
        idleTimeoutMillis: 1000,
        testOnBorrow: true,
      },
    );
  });

  afterEach(async () => {
    // Close the pool
    await pool.drain();
    await pool.clear();
  });

  it('should stay alive', async function stayAlive() {
    await pool.use(async (browser) => {
      const page = await browser.newPage();
      await page.close();
    });
    await pool.use(async (browser) => {
      const page = await browser.newPage();
      await page.close();
    });
  });

  it('should fail if page is accessed after it is closed', async function failIfClosed() {
    await pool.use(async (browser) => {
      const page = await browser.newPage();
      await page.close();

      try {
        await page.goto('https://google.com');
      } catch (err) {
        return;
      }

      throw new Error('We should not be able to access the same page after its been closed');
    });
  });

  it('should fail if we try to use the browser after it is closed', async function failIfClosed() {
    let browser: Browser;
    await pool.use(async (b) => {
      browser = b;
      const page1 = await browser.newPage();
      await page1.close();
    });

    await pool.use(async (b) => {
      if (b[ID] !== browser[ID]) {
        throw new Error('browser should have been used again');
      }
      const page2 = await browser.newPage();
      await page2.close();
    });

    await pool.use(async (b) => {
      if (b[ID] === browser[ID]) {
        throw new Error('browser should be closed by now and we should get a new browser');
      }
      const page3 = await b.newPage();
      await page3.close();
    });

    try {
      // The browser should have been closed by now
      const page4 = await browser!.newPage();
      await page4.close();
    } catch (err) {
      expect(err.message).to.eq('WebSocket is not open: readyState 3 (CLOSED)');
      return;
    }
    throw new Error('The browser should have been used only 2 times and failed on the 3rd use');
  });

  /**
   * This example shows the dangers of having references to out of scope objects within functions.
   * Notice how `obj` will change after the pause due to the timeout executing and changing the
   * value.
   */
  it('timeouts can be dangerous', async () => {
    let obj: number | undefined = 1;

    async function mainTask(): Promise<void> {
      expect(obj).to.eq(1);
      // Waiting for longer than the timeout so that it can modify `obj`.
      await pause(150);
      expect(obj).to.eq(undefined);
    }

    setTimeout(() => {
      // We want the mainTask function to stop. This is not the way to do it.
      obj = undefined;
    }, 100);

    await mainTask();
  });

  /**
   * In this continuation we show a happy path. That is, the pause is small enough that the timeout
   * does not execute until after we have checked the value.
   */
  it('timeouts can be dangerous - Part 2', async () => {
    let obj: number | undefined = 1;

    async function mainTask(): Promise<void> {
      expect(obj).to.eq(1);
      // If we wait less than the timeout nothing should have changed.
      await pause(50);
      expect(obj).to.eq(1);
    }

    setTimeout(() => {
      // We want the mainTask function to stop. This is not the way to do it.
      obj = undefined;
    }, 100);

    await mainTask();
  });

  /**
   * If we must use global objects we need to check for the values of the global objects before we
   * use them. Typescript cannot help us here. Or can it? Currently we are using typescript 2.9.
   */
  it('timeouts can be dangerous - fix?', async () => {
    let obj: number | undefined = 1;

    async function mainTask(): Promise<void> {
      expect(obj).to.eq(1);
      // Waiting for longer than the timeout so that it can modify `obj`.
      await pause(150);
      if (obj !== undefined) {
        // Timeout did not execute... proceed...
      } else {
        // Out of luck, timeout executed and now we don't have the object.
      }
      expect(obj).to.eq(undefined);
    }

    setTimeout(() => {
      // We want the mainTask function to stop. This is not the way to do it.
      obj = undefined;
    }, 100);

    await mainTask();
  });
});
