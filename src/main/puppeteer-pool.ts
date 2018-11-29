import { Factory, Options, Pool } from 'generic-pool';
import * as genericPool from 'generic-pool';
import { Browser, LaunchOptions } from 'puppeteer';
import * as puppeteer from 'puppeteer';

import { IPuppeteerPoolConfig } from './interfaces';

const USE_COUNT = Symbol('useCount');
const ID = Symbol('identifier');
let browserId = 0;

/**
 * Originally a fork of https://github.com/latesh/puppeteer-pool.
 */
function createPuppeteerPool(
  config: IPuppeteerPoolConfig,
  puppeteerlaunchOptions: LaunchOptions,
  genericPoolConfig: Options,
): Pool<Browser> {
  const factory: Factory<Browser> = {
    async create() {
      try {
        const browser = await puppeteer.launch(puppeteerlaunchOptions);
        browser[USE_COUNT] = 0;
        browser[ID] = ++browserId;
        return browser;
      } catch (err) {
        return Promise.reject(err);
      }
    },
    async destroy(browser: Browser) {
      try {
        await browser.close();
      } catch (err) {
      }
      return undefined;
    },
    async validate(browser: Browser) {
      const maxUses = config.maxUses || 1;
      const validator = config.validator || (() => Promise.resolve(true));
      try {
        const valid = await validator(browser);
        return valid && (maxUses <= 0 || browser[USE_COUNT] < maxUses);
      } catch (err) {
        return Promise.reject(err);
      }
    },
  };

  const pool = genericPool.createPool<Browser>(factory, genericPoolConfig);
  const genericAcquire = pool.acquire.bind(pool);

  pool.acquire = async () => {
    try {
      const browser = await genericAcquire();
      browser[USE_COUNT] += 1;
      return browser;
    } catch (err) {
      return Promise.reject(err);
    }
  };
  pool.use = async (cb: (browser: Browser) => any) => {
    let browser;
    try {
      browser = await pool.acquire();
      const result = await cb(browser);
      pool.release(browser);
      return result;
    } catch (err) {
      if (browser) {
        pool.release(browser);
      }
      return Promise.reject(err);
    }
  };

  return pool;
}

export {
  USE_COUNT,
  ID,
  IPuppeteerPoolConfig,
  createPuppeteerPool,
};
