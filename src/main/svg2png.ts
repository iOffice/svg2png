import fileUrl = require('file-url');
import { Pool } from 'generic-pool';
import { Browser, Page } from 'puppeteer';
import * as sharp from 'sharp';

import { IConfig, IDimensions, ISvg2pngConfig } from './interfaces';
import { getDimensions, setDimensions } from './page-utils';
import { createPuppeteerPool } from './puppeteer-pool';

/**
 * The possible status of a conversion.
 */
enum Status { NOT_STARTED, PENDING, DONE, FAILED, CANCELLED }

/**
 * To convert an SVG to PNG we use a headless browser. Creating and destroying browsers can be
 * an expensive operation. For this reason we use a pool that manages these resources. Note that
 * if the `svg2png` function is used at least once we will need to call `Svg2png.closePool`
 * if we want our application or tests to finish properly.
 */
class Svg2png {
  private static inProgress: { [key: number]: number } = {};
  // Default configuration. Can be overriden by using `Svg2Png.setConfiguration`.
  private static configuration: ISvg2pngConfig = {
    puppeteerPoolConfig: {
      maxUses: 1,
      validator: () => Promise.resolve(true),
    },
    puppeteerlaunchOptions: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
    genericPoolConfig: {
      min: 1,
      max: 2,
      idleTimeoutMillis: 5000,
      testOnBorrow: true,
    },
  };
  // Keeping track of pages that fail to close. This will help us determine if we need to
  // restart the server. Ids of the conversions will be appended to this array.
  private static pageCloseErrors: number[] = [];
  private static pool?: Pool<Browser>;
  private static idCounter = 0;
  private source: string;
  private id: number;
  private options: IConfig;
  private history: ([string, any] | string)[] = [];
  private status = Status.NOT_STARTED;
  private cancellingReason = '';

  constructor(config: IConfig) {
    this.id = ++Svg2png.idCounter;
    const opt = Object.assign({}, config);
    const protocols = ['http:', 'https:', 'file:'];
    if (!protocols.find(x => opt.url.startsWith(x))) {
      opt.url = fileUrl(opt.url);
    }
    this.source = opt.url;
    this.options = opt;
    Svg2png.inProgress[this.id] = Date.now();
  }

  tic(label: string): void {
    console.time(`    [${this.id}] ${label}`);
  }

  toc(label: string): void {
    console.timeEnd(`    [${this.id}] ${label}`);
  }

  /**
   * Returns an array with the conversion ids that failed to close the browser page.
   */
  static getPageClosingFailures(): number[] {
    return [...Svg2png.pageCloseErrors];
  }

  /**
   * Provides an array of times (in milliseconds) which a conversion has taken up to the time
   * that the method was called.
   */
  static getTimeSpentOnConversions(): number[] {
    const ids = Object.keys(Svg2png.inProgress);
    return ids.map(id => Date.now() - Svg2png.inProgress[id]);
  }

  /**
   * To be used before any call to `svg2png`. This will override the settings used to create the
   * singleton pool of browsers.
   *
   * @param options The options object for the pool.
   */
  static setConfiguration(options: ISvg2pngConfig) {
    if (!Svg2png.pool) {
      this.configuration = {
        puppeteerPoolConfig: {
          ...options.puppeteerPoolConfig,
          maxUses: 1,
          validator: () => Promise.resolve(true),
        },
        puppeteerlaunchOptions: {
          ...options.puppeteerlaunchOptions,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
        genericPoolConfig: {
          ...options.genericPoolConfig,
          min: 1,
          max: 2,
          idleTimeoutMillis: 5000,
          testOnBorrow: true,
        },
      };
    } else {
      throw new Error('The pool has already been initialized, it is too late to set the options');
    }
  }

  /*
   * Returns the singleton pool of browsers. This is made as a method so that we only create
   * a pool the moment we need it. (trying to avoid side effects from loading the svg2png module).
   */
  private static getPool(): Pool<Browser> {
    if (!Svg2png.pool) {
      Svg2png.pool = createPuppeteerPool(
        Svg2png.configuration.puppeteerPoolConfig,
        Svg2png.configuration.puppeteerlaunchOptions,
        Svg2png.configuration.genericPoolConfig,
      );
    }
    return Svg2png.pool;
  }

  /**
   * Do not use `this.status = Status.CANCELLED`. Use this method instead.
   *
   * @param reason Provide a reason as to why the conversion was cancelled.
   */
  private cancelConversion(reason: string) {
    if (!this.cancellingReason && this.status !== Status.CANCELLED) {
      this.cancellingReason = reason;
      this.status = Status.CANCELLED;
    } else {
      throw new Error('The conversion has already been cancelled');
    }
  }

  /**
   * There is a timeout that cancels the conversion. This does not halt the conversion operation,
   * all it does it go back to the user to inform that the operation failed. For this reason we have
   * to use this method after every `await` statement since that will give the timeout a chance to
   * cancel the conversion. VERY IMPORTANT TO USE IT AFTER EVERY AWAIT.
   */
  private async throwIfCancelled(page?: Page) {
    if (this.status === Status.CANCELLED) {
      if (page && !page.isClosed()) {
        await this.closePage(page);
      }
      throw new Error(`Conversion was cancelled: ${this.cancellingReason}`);
    }
  }

  /**
   * Needs to be called if we wish the server to properly shut down. If the pool
   * remains open then node won't be able to exit.
   */
  static async closePool(): Promise<undefined> {
    if (!Svg2png.pool) return;
    try {
      await Svg2png.pool.drain();
      await Svg2png.pool.clear();
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /**
   * Overwrite in your program to debug messages.
   * @param id: The id of the drawing
   * @param msg: The message provided by svg2png
   * @param meta: Any optional metadata provided along with the message.
   */
  static debug(id: number, msg: string, meta?: object) {
    console.log(`[SVG2PNG:${id}]`, msg, meta || '');
  }

  /**
   * For debugging purposes only. In case of a failure the conversion will reject with the
   * history.
   */
  private log(msg: string, meta?: object): void {
    this.history.push(meta ? [msg, meta] : msg);
    if (this.options.debug) {
      Svg2png.debug(this.id, msg, meta);
    }
  }

  /**
   * To be used when rejecting a promise. Note that this will log the failure.
   */
  private failure(err: Error): Promise<any> {
    this.log(`[FAILURE]: ${err.message}`);
    return Promise.reject(err);
  }

  /**
   * Convert the svg.
   */
  async convert(): Promise<Buffer> {
    try {
      const result = await this.convertInBrowser(this.rasterize.bind(this));
      this.status = Status.DONE;
      this.log('SVG2PNG::success');
      delete Svg2png.inProgress[this.id];
      return result;
    } catch (err) {
      this.status = Status.FAILED;
      this.log('SVG2PNG::failure', { error: err.message });
      err.meta = {
        id: this.id,
        history: this.history,
      };
      delete Svg2png.inProgress[this.id];
      return Promise.reject(err);
    }
  }

  private convertInBrowser(fn: (browser: Browser) => any): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      const timeout = this.options.conversionTimeout || 300000;
      this.log('setting timeout', { conversionId: this.id, timeout });
      const timeoutHandle = setTimeout(() => {
        let errorMsg = '';
        if (this.status === Status.PENDING) {
          errorMsg = `timeout rasterizing SVG ${this.id} after ${timeout}ms`;
        } else if (this.status === Status.NOT_STARTED) {
          errorMsg = `conversionId[${this.id}] timeout after ${timeout}ms before it could use the browser`;
        } else {
          errorMsg = `Developer ERROR: timeout not cancelled for conversionId[${this.id}]`;
        }
        this.cancelConversion(errorMsg);
      }, timeout);

      let buffer: Buffer;
      try {
        this.log('requesting browser for conversion', this.options);
        buffer = await Svg2png.getPool().use(browser => fn(browser));
      } catch (err) {
        this.log('clearing timeout due to caught error');
        clearTimeout(timeoutHandle);
        return reject(err);
      }
      this.log('clearing timeout');
      clearTimeout(timeoutHandle);
      resolve(buffer);
    });
  }

  /**
   * Obtain the page with the svg loaded.
   * @return {Promise<Page>}
   */
  private async loadPage(browser: Browser): Promise<Page> {
    try {
      this.log('requesting a page');
      const page = await browser.newPage();
      await this.throwIfCancelled(page);

      this.status = Status.PENDING;
      this.tic('page_navigation');
      this.log(`navigating to page`, { url: this.source });
      await this.navigateToSource(page);
      this.toc('page_navigation');
      await this.throwIfCancelled(page);

      return page;
    } catch (err) {
      err.message = `Unknown loadPage error: ${err.message}`;
      return this.failure(err);
    }
  }

  private async navigateToSource(page: Page): Promise<void> {
    const resp = await page.goto(this.source, {
      waitUntil: ['load', 'domcontentloaded', 'networkidle0'],
      timeout: this.options.navigationTimeout,
    });
    if (!resp) {
      return this.failure(new Error('obtained null response from `page.goto`'));
    }
    if (!resp.ok()) {
      return this.failure(new Error(`navigation status: ${resp.status()}`));
    }
  }

  private async setGetDimensions(page: Page): Promise<{ width: number, height: number}> {
    try {
      this.log('setting dimensions', {
        width: this.options.width,
        height: this.options.height,
        scale: this.options.scale,
      });
      const actions = await setDimensions(page, this.options);
      this.log(`actions taken: ${actions.join(', ')}.`);
    } catch (err) {
      this.log(`failed to set dimensions`, { error: err });
    }

    try {
      this.log('getting dimensions');
      const dimensions = await getDimensions(page);
      if (!dimensions) {
        return this.failure(new Error('unable to obtain the dimensions'));
      }
      return {
        width: Math.round(dimensions.width),
        height: Math.round(dimensions.height),
      };
    } catch (err) {
      err.message = `unknown setGetDimensions error: ${err.message}`;
      return this.failure(err);
    }
  }

  private async closePage(page: Page) {
    try {
      await page.close();
    } catch (err) {
      // If for some reason the browser is stuck and it fails to close we will let it go but
      // we will make sure to note this so that a health check may be used to determine if
      // the application should be restarted.
      Svg2png.pageCloseErrors.push(this.id);
    }
  }

  private async rasterize(browser: Browser): Promise<Buffer> {
    try {
      // We may have already cancelled the conversion before we even load a page.
      await this.throwIfCancelled();

      this.log('starting conversion');
      const page = await this.loadPage(browser);
      await this.throwIfCancelled(page);

      const { width, height } = await this.setGetDimensions(page);
      await this.throwIfCancelled(page);

      this.log(`setting viewport to [${width}, ${height}]`);
      await page.setViewport({ width, height });
      await this.throwIfCancelled(page);

      const safeOffset = width > 256 ? 256 : 0;
      const blocksPerRow = Math.floor((width - safeOffset) / 256) || 1;
      const blocksPerCol = Math.floor(256 / blocksPerRow);
      const maxScreenshotHeight = blocksPerCol * 256;
      if (height <= maxScreenshotHeight) {
        this.log('generating screenshot, no need to stitch');
        const result = await page.screenshot({
          fullPage: true,
          omitBackground: true,
          type: 'png',
        });
        await this.closePage(page);
        return result;
      } else {
        const totalBlocks = Math.ceil(height / maxScreenshotHeight);
        this.log(`stitching ${totalBlocks} blocks`);
        const stitchedResult = await this.stitchBlocks(page, width, height, maxScreenshotHeight);
        await this.closePage(page);
        return stitchedResult;
      }
    } catch (err) {
      return Promise.reject(err);
    }
  }

  private async stitchBlocks(
    page: Page,
    width: number,
    height: number,
    maxScreenshotHeight: number,
  ): Promise<Buffer> {
    const totalChunks = Math.ceil(height / maxScreenshotHeight);
    const chunks = [];
    for (let ypos = 0, chunk = 1; ypos < height; ypos += maxScreenshotHeight, chunk++) {
      this.tic(`chunk_${chunk}_of_${totalChunks}`);
      this.log(`processing ${chunk}/${totalChunks}`);
      const clipHeight = Math.min(height - ypos, maxScreenshotHeight);
      try {
        const screenshot = await page.screenshot({
          clip: {
            x: 0,
            y: ypos,
            width: width,
            height: clipHeight,
          },
          omitBackground: true,
        });
        await this.throwIfCancelled(page);

        const buffer = await sharp(screenshot).raw().toBuffer();
        this.toc(`chunk_${chunk}_of_${totalChunks}`);
        await this.throwIfCancelled(page);

        chunks.push(buffer);
      } catch (err) {
        err.message = `chunk collection failure: ${err.message}`;
        return this.failure(err);
      }
    }

    const channels = 4;
    const bufferSize = width * maxScreenshotHeight * channels;
    const composite = Buffer.allocUnsafe(bufferSize * chunks.length);

    chunks.forEach((s, i) => s.copy(composite, i * bufferSize));
    this.log('waiting on sharp');

    try {
      // We already have everything to create the image. If we proceed can we still have a way
      // to cancel the operation?
      this.tic('stitch');
      const result = await sharp(composite, {
        raw: {
          width: width,
          height: height,
          channels: channels,
        },
      }).limitInputPixels(false).png().toBuffer();
      this.toc('stitch');

      return result;
    } catch (err) {
      err.message = `sharp failure: ${err.message}`;
      return this.failure(err);
    }
  }
}

function svg2png(config: IConfig): Promise<Buffer> {
  const s2pInstance = new Svg2png(config);
  return s2pInstance.convert();
}

export {
  Status,
  IDimensions,
  IConfig,
  Svg2png,
  svg2png,
};
