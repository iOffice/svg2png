import { Page } from 'puppeteer';

import { IDimensions } from './interfaces';

/**
 * Obtain the dimensions of the svg. Note that the scale property has been arbitrarily set 1.
 */
function getDimensions(page: Page): Promise<IDimensions> {
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

/**
 * Sets the dimensions of the svg. The dimensions passed in must be positive numbers. The same
 * goes for the `scale` value. It is not possible to have an infinite picture (scale of 0).
 * Returns of promise which resolves to an array of strings stating the operations that took
 * place.
 */
function setDimensions(page: Page, dimensions: Partial<IDimensions>): Promise<string[]> {
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

export {
  getDimensions,
  setDimensions,
};
