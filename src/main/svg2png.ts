import fileUrl = require('file-url');
import { Pool } from 'generic-pool';
import { Browser, Page } from 'puppeteer';
import * as sharp from 'sharp';

import { IConfig, IDimensions, ISvg2pngPoolConfig } from './interfaces';
import { createPuppeteerPool } from './puppeteer-pool';

/**
 * The possible status of a conversion.
 */
enum Status { NOT_STARTED, PENDING, DONE, FAILED }

/**
 * To convert an SVG to PNG we use a headless browser. Creating and destroying browsers can be
 * an expensive operation. For this reason we use a pool that manages these resources. Note that
 * if the `svg2png` function is used at least once we will need to call `Svg2png.closePool`
 * if we want our application or tests to finish properly.
 */
class Svg2png {
  /**
   * A map containing all the browser pages opened.
   */
  static pages: { [key: number]: Page } = {};

  // Default configuration. Can be overriden by using `Svg2Png.setPoolConfig`.
  private static configuration: ISvg2pngPoolConfig = {
    config: {
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
  private static pool?: Pool<Browser>;
  private static idCounter = 0;
  private source: string;
  private id: number;
  private options: IConfig;
  private history: ([string, any] | string)[] = [];
  private status = Status.NOT_STARTED;

  constructor(config: IConfig) {
    this.id = ++Svg2png.idCounter;
    const opt = Object.assign({}, config);
    const protocols = ['http:', 'https:', 'file:'];
    if (!protocols.find(x => opt.url.startsWith(x))) {
      opt.url = fileUrl(opt.url);
    }
    this.source = opt.url;
    this.options = opt;
  }

  /**
   * To be used before any call to `svg2png`. This will override the settings used to create the
   * singleton pool of browsers.
   *
   * @param options The options object for the pool.
   */
  static setPoolConfig(options: ISvg2pngPoolConfig) {
    if (!Svg2png.pool) {
      this.configuration = {
        config: {
          ...options.config,
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
   * a pool the moment we need it. (trying to avoid side effects from loading the file).
   */
  private static getPool(): Pool<Browser> {
    if (!Svg2png.pool) {
      Svg2png.pool = createPuppeteerPool(
        Svg2png.configuration.config,
        Svg2png.configuration.puppeteerlaunchOptions,
        Svg2png.configuration.genericPoolConfig,
      );
    }
    return Svg2png.pool;
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
      return result;
    } catch (err) {
      this.status = Status.FAILED;
      this.log('SVG2PNG::failure', { error: err.message });
      err.meta = {
        id: this.id,
        history: this.history,
      };
      return Promise.reject(err);
    }
  }

  private convertInBrowser(fn: (browser: Browser) => any): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      const timeout = this.options.conversionTimeout || 30000;
      this.log('setting timeout', { conversionId: this.id, timeout });
      const timeoutHandle = setTimeout(() => {
        if (Svg2png.pages[this.id]) {
          Svg2png.pages[this.id].close();
          delete Svg2png.pages[this.id];
          return reject(new Error(`timeout rasterizing SVG ${this.id} after ${timeout}ms`));
        }
        if (this.status === Status.NOT_STARTED) {
          reject(new Error(`conversionId[${this.id}] timed out before it could use the browser`));
        } else {
          reject(new Error(`timeout was not cancelled for conversionId[${this.id}]`));
        }
      }, timeout);

      let buffer: Buffer;
      try {
        this.log('requesting browser for conversion', this.options);
        buffer = await Svg2png.getPool().use(browser => fn(browser));
      } catch (err) {
        this.cleanUp(timeoutHandle);
        return reject(err);
      }

      this.cleanUp(timeoutHandle);
      resolve(buffer);
    });
  }

  private async cleanUp(timeoutHandle: NodeJS.Timer): Promise<void> {
    this.log('clearing timeout');
    clearTimeout(timeoutHandle);
    try {
      this.log('closing page');
      await this.closePage();
    } catch (err) {
      this.log('failed to close page', { error: err });
    }
  }

  /**
   * Obtain the page with the svg loaded.
   * @return {Promise<Page>}
   */
  private async loadPage(browser: Browser): Promise<Page> {
    try {
      this.log('requesting a page');
      const page = await browser.newPage();
      Svg2png.pages[this.id] = page;
      this.status = Status.PENDING;
      this.log(`navigating to page`, { url: this.source });
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
      return page;
    } catch (err) {
      err.message = `Unknown loadPage error: ${err.message}`;
      return this.failure(err);
    }
  }

  private async setGetDimensions(page: Page): Promise<{ width: number, height: number}> {
    try {
      this.log('setting dimensions', {
        width: this.options.width,
        height: this.options.height,
        scale: this.options.scale,
      });
      const actions = await this.setDimensions(page, this.options);
      this.log(`actions taken: ${actions.join(', ')}.`);
    } catch (err) {
      this.log(`failed to set dimensions`, { error: err });
    }

    try {
      this.log('getting dimensions');
      const dimensions = await this.getDimensions(page);
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

  private async rasterize(browser: Browser): Promise<Buffer> {
    try {
      this.log('starting conversion');
      const page = await this.loadPage(browser);
      const { width, height } = await this.setGetDimensions(page);
      this.log(`setting viewport to [${width}, ${height}]`);
      await page.setViewport({ width, height });

      const safeOffset = width > 256 ? 256 : 0;
      const blocksPerRow = Math.floor((width - safeOffset) / 256) || 1;
      const blocksPerCol = Math.floor(256 / blocksPerRow);
      const maxScreenshotHeight = blocksPerCol * 256;
      if (height <= maxScreenshotHeight) {
        this.log('generating screenshot, no need to stitch');
        return await page.screenshot({
          fullPage: true,
          omitBackground: true,
          type: 'png',
        });
      } else {
        const totalBlocks = Math.ceil(height / maxScreenshotHeight);
        this.log(`stitching ${totalBlocks} blocks`);
        return await this.stitchBlocks(page, width, height, maxScreenshotHeight);
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
        const buffer = await sharp(screenshot).raw().toBuffer();
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
      return await sharp(composite, {
        raw: {
          width: width,
          height: height,
          channels: channels,
        },
      }).png().toBuffer();
    } catch (err) {
      err.message = `sharp failure: ${err.message}`;
      return this.failure(err);
    }
  }

  /**
   * Close the page associated with this Svg2Png instance.
   */
  private closePage(): Promise<void> {
    const page = Svg2png.pages[this.id];
    if (page) {
      delete Svg2png.pages[this.id];
      return page.close();
    }
    return Promise.reject(new Error('no page found to closed.'));
  }

  /**
   * Sets the dimensions of the svg. The dimensions passed in must be positive numbers. The same
   * goes for the `scale` value. It is not possible to have an infinite picture (scale of 0).
   * Returns of promise which resolves to an array of strings stating the operations that took
   * place.
   */
  setDimensions(page: Page, dimensions: Partial<IDimensions>): Promise<string[]> {
    if (!dimensions.width && !dimensions.height && !dimensions.scale) {
      return Promise.resolve(['nothing to set']);
    }
    return page.evaluate(({ width, height, scale }) => {
      const el = document.querySelector('svg');
      if (!el) {
        return Promise.reject(new Error('setDimensions: no svg element found'));
      }
      const actions = [];
      if (width) {
        el.setAttribute('width', `${width}px`);
        actions.push(`set width to ${width}px`);
      } else {
        el.removeAttribute('width');
        actions.push("removed width");
      }
      if (height) {
        el.setAttribute('height', height + "px");
        actions.push("set height to " + height + "px");
      } else {
        el.removeAttribute('height');
        actions.push("removed height");
      }
      if (scale) {
        const viewBoxWidth = el.viewBox.animVal.width;
        const viewBoxHeight = el.viewBox.animVal.height;
        const scaledWidth = viewBoxWidth / scale;
        const scaledHeight = viewBoxHeight / scale;
        el.setAttribute('width', scaledWidth + 'px');
        el.setAttribute('height', scaledHeight + 'px');
        actions.push(`set scaled dimensions to [${scaledWidth}px, ${scaledHeight}px]`);
        el.removeAttribute('clip-path');
        /* It might eventually be necessary to scale the clip path of the root svg element
        const clipPathEl = document.querySelector("svg > clipPath > path");
        clipPathEl.setAttribute("d", `M0 0v${scaledHeight}h${scaledWidth}V0z`)
        */
      }
      return Promise.resolve(actions);
    }, dimensions);
  }

  /**
   * Obtain the dimensions of the svg. Note that the scale property has been arbitrarily set 1.
   */
  getDimensions(page: Page): Promise<IDimensions> {
    return page.evaluate(() => {
      const el = document.querySelector('svg');
      if (!el) {
        return Promise.reject(new Error('getDimensions: no svg element found'));
      }
      const widthIsPercent = (el.getAttribute('width') || '').endsWith('%');
      const heightIsPercent = (el.getAttribute('height') || '').endsWith('%');
      const width = !widthIsPercent && parseFloat(el.getAttribute('width') || '0');
      const height = !heightIsPercent && parseFloat(el.getAttribute('height') || '0');
      if (width && height) {
        return Promise.resolve({ width: width, height: height, scale: 1 });
      }
      const viewBoxWidth = el.viewBox.animVal.width;
      const viewBoxHeight = el.viewBox.animVal.height;
      if (width && viewBoxHeight) {
        return Promise.resolve({ width: width, height: width * viewBoxHeight / viewBoxWidth, scale: 1 });
      }
      if (height && viewBoxWidth) {
        return Promise.resolve({ width: height * viewBoxWidth / viewBoxHeight, height: height, scale: 1 });
      }
      return Promise.reject(new Error('getDimensions: no width/height found'));
    });
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
