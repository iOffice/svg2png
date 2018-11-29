import { Browser } from 'puppeteer';

interface IPuppeteerPoolConfig {
  maxUses: number;
  validator: (instance: Browser) => Promise<boolean>;
}

/**
 * An interface to help us specify the dimensions of an svg object.
 */
interface IDimensions {
  /**
   * The width of the svg. In pixels.
   */
  width: number;

  /**
   * The height of the svg. In pixels.
   */
  height: number;

  /**
   * A scale factor to expand or shrink the svg.
   */
  scale: number;
}

/**
 * A configuration interface to use in the `svg2png` function.
 */
interface IConfig extends Partial<IDimensions> {
  /**
   * The url of the svg to convert.
   */
  url: string;

  /**
   * A limit on the allowed time to load the svg in the browser.
   */
  navigationTimeout?: number;

  /**
   * A limit of the allowed time to spend on the conversion.
   */
  conversionTimeout?: number;

  /**
   * If `true`, console messages will be printed specifying the actions taken during the
   * conversion.
   */
  debug?: boolean;
}

export {
  IConfig,
  IDimensions,
  IPuppeteerPoolConfig,
};
