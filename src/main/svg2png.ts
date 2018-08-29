import { Page, Browser } from 'puppeteer';
import { Pool } from 'generic-pool';
import * as sharp from 'sharp';
import { createPuppeteerPool } from './puppeteer-pool';
import fileUrl = require('file-url');

interface IDimensions {
  width: number;
  height: number;
  scale: number;
}

interface IConfig extends Partial<IDimensions> {
  url: string;
  navigationTimeout?: number;
  conversionTimeout?: number;
  debug?: boolean;
}

class Svg2png {
  static pages: { [key: number]: Page } = {};
  static pool: Pool<Browser> = createPuppeteerPool(
    {
      maxUses: 50,
      validator: () => Promise.resolve(true),
    }, {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }, {
      min: 1,
      max: 2,
      idleTimeoutMillis: 5000,
      testOnBorrow: true,
    },
  );

  private static idCounter = 0;
  private source: string;
  private id: number;
  private options: IConfig;

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

  static async closePool(): Promise<undefined> {
    try {
      await Svg2png.pool.drain();
      await Svg2png.pool.clear();
    } catch (err) {
      return Promise.reject(err);
    }
  }

  static debug(date: number, id: number, ...args: any[]) {
    console.log(`[SVG2PNG:${id}:${date}]`,...args);
  }

  log(...args: any[]): void {
    if (this.options.debug) {
      Svg2png.debug(this.id, +(new Date()), ...args);
    }
  }

  failure(msg: string): Promise<any> {
    this.log(`FAILURE: ${msg}`);
    return Promise.reject(new Error(msg));
  }

  convert(): Promise<Buffer> {
    return this.convertInBrowser(this.rasterize.bind(this));
  }

  private convertInBrowser(fn: (browser: Browser) => any): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        if (Svg2png.pages[this.id]) {
          Svg2png.pages[this.id].close();
          delete Svg2png.pages[this.id];
          reject(new Error('timeout rasterizing SVG'));
        }
        reject(new Error('this should not have been called, did you cancel the timeout?'));
      }, this.options.conversionTimeout || 30000);

      try {
        const buffer = await Svg2png.pool.use(browser => fn(browser));
        clearTimeout(timeoutHandle);
        this.log('success. closing page');
        await this.closePage();
        resolve(buffer);
      } catch (err) {
        try {
          clearTimeout(timeoutHandle);
          await this.closePage();
        } catch (e) {}
        reject(err);
      }
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
      Svg2png.pages[this.id] = page;
      this.log(`navigating to ${this.source}`);
      const resp = await page.goto(this.source, {
        waitUntil: ['load', 'domcontentloaded', 'networkidle0'],
        timeout: this.options.navigationTimeout,
      });
      if (!resp) {
        return this.failure('obtained null response from `page.goto`');
      }
      if (!resp.ok()) {
        return this.failure(`navigation status: ${resp.status()}`);
      }
      return page;
    } catch (err) {
      return this.failure(`unknown loadPage error: ${err.message}`);
    }
  }

  private async setGetDimensions(page: Page): Promise<{ width: number, height: number}> {
    try {
      this.log('setting dimensions: ', {
        width: this.options.width,
        height: this.options.height,
        scale: this.options.scale,
      });
      const actions = await this.setDimensions(page, this.options);
      this.log(`actions taken: ${actions.join(', ')}.`);
    } catch (err) {
      this.log(`failed to set dimensions: ${err}`);
    }

    try {
      this.log('getting dimensions');
      const dimensions = await this.getDimensions(page);
      if (!dimensions) {
        return Promise.reject(new Error('unable to obtain the dimensions'));
      }
      return {
        width: Math.round(dimensions.width),
        height: Math.round(dimensions.height),
      };
    } catch (err) {
      return this.failure(`unknown setGetDimensions error: ${err.message}`);
    }
  }

  private async rasterize(browser: Browser): Promise<Buffer> {
    try {
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
    }

    const channels = 4;
    const bufferSize = width * maxScreenshotHeight * channels;
    const composite = Buffer.allocUnsafe(bufferSize * chunks.length);
    chunks.forEach((s, i) => s.copy(composite, i * bufferSize));
    this.log('waiting on sharp');
    return await sharp(composite, {
      raw: {
        width: width,
        height: height,
        channels: channels,
      },
    }).png().toBuffer();
  }

  /**
   * Close the page associated with this Svg2Png instance.
   */
  closePage(): Promise<void> {
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
  IDimensions,
  IConfig,
  Svg2png,
  svg2png,
};
