import { Options } from 'generic-pool';
import { Browser, LaunchOptions } from 'puppeteer';

/**
 * Custom configuration to control how the pool of browser will behave.
 */
interface IPuppeteerPoolConfig {
  /**
   * The amount of times a browser will be used before the pool discards it.
   */
  maxUses?: number;

  /**
   * A function that should resolve to a boolean specifying if the browser should be used or not.
   *
   * @param instance The browser in question.
   */
  validator?: (instance: Browser) => Promise<boolean>;
}

/**
 * A global configuration object for the Svg2png static class.
 */
interface ISvg2pngConfig {
  /**
   * Our custom configuration which is used to specify the maximum number of uses for each browser.
   */
  puppeteerPoolConfig: IPuppeteerPoolConfig;

  /**
   * The options to be used when a new browser gets launched.
   */
  puppeteerlaunchOptions: LaunchOptions;

  /**
   * Pool configuration.
   */
  genericPoolConfig: Options;
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
  ISvg2pngConfig,
};
