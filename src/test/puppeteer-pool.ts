import { createPuppeteerPool, ID } from '../main';
import { Pool } from 'generic-pool';
import { Browser } from 'puppeteer';
import { expect } from 'chai';

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
});


