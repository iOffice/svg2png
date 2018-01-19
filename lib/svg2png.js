/* eslint-env browser */

"use strict";
const fileURL = require("file-url");
const fs = require("pn/fs");
const puppeteer = require("puppeteer");
const tmp = require("tmp");
const sharp = require("sharp");

module.exports = async (source, options) => {
    try {
        options = parseOptions(options);

        return await convertBuffer(source, options);
    } catch (e) {
        throw e;
    }
};

async function convertBuffer(source, options) {
    let browser;
    let output;

    try {
        browser = await puppeteer.launch({args: ['--no-sandbox', '--disable-setuid-sandbox']});
        const page = await browser.newPage();

        await page.goto(source, {
            waitUntil: ['load', 'domcontentloaded', 'networkidle0'],
            timeout: options.timeout
        })

        await setDimensions(page, options);

        const dimensions = await getDimensions(page);
        if (!dimensions) {
            throw new Error("Width or height could not be determined from either the source file or the supplied " +
                            "dimensions");
        }

        const width = Math.round(dimensions.width);
        const fullHeight = Math.round(dimensions.height);
        await page.setViewport({ width, height: fullHeight });

        /* Chrome can only render 16 1024 by 1024 blocks, or 256 256x256
         * in most cases. Solution is to caclulate the number of blocks
         * that can fit in a screenshot, and stich them together.
         * See crbug.com/770769 for more info
         */
        const blocksPerRow = Math.floor(width / 256) - 1; // Subtract 1 row for safety
        const blocksPerCol = Math.floor(256 / blocksPerRow);
        const maxScreenshotHeight = blocksPerCol * 256; 

        if (fullHeight <= maxScreenshotHeight) { // no point in doing all this work if it fits
            output = await page.screenshot({
                fullPage: true,
                omitBackground: true
            });
        } else {
            /* Since our screenshots span the full width, if we want to stack them
             * together, we can just put append the raw data, throw it into
             * a buffer, and tell sharp the correct width, height, and channel
             */
            const chunks = []; 
            for (let ypos = 0; ypos < fullHeight; ypos += maxScreenshotHeight) {
                const height = Math.min(fullHeight - ypos, maxScreenshotHeight);
                const screenshot = await page.screenshot({
                    clip: {
                        x: 0,
                        y: ypos,
                        width,
                        height
                    },
                    omitBackground: true
                });
               const buffer = await sharp(screenshot).raw().toBuffer();
               chunks.push(buffer);
            }
            const channels = 4;
            const bufferSize = width * maxScreenshotHeight * channels;
            const composite = Buffer.allocUnsafe(bufferSize * chunks.length);
            chunks.forEach((s, i) => s.copy(composite, i * bufferSize))
            output = await sharp(composite, {
                raw: {
                    width,
                    height: fullHeight,
                    channels
                }
            }).png().toBuffer();
        }
    } finally {
        if (browser) {
            await browser.close();
        }
    }

    return output;
}

async function getDimensions(page) {
    return await page.evaluate(() => {
        const el = document.querySelector("svg");

        const widthIsPercent = (el.getAttribute("width") || "").endsWith("%");
        const heightIsPercent = (el.getAttribute("height") || "").endsWith("%");
        const width = !widthIsPercent && parseFloat(el.getAttribute("width"));
        const height = !heightIsPercent && parseFloat(el.getAttribute("height"));

        if (width && height) {
            return { width, height };
        }

        const viewBoxWidth = el.viewBox.animVal.width;
        const viewBoxHeight = el.viewBox.animVal.height;

        if (width && viewBoxHeight) {
            return { width, height: width * viewBoxHeight / viewBoxWidth };
        }

        if (height && viewBoxWidth) {
            return { width: height * viewBoxWidth / viewBoxHeight, height };
        }

        return null;
    });
}

async function setDimensions(page, dimensions) {
    if (dimensions.width === undefined && dimensions.height === undefined && dimensions.scale === undefined) {
        return;
    }

    await page.evaluate(({ width, height, scale }) => {
        const el = document.querySelector("svg");
        if (!el) {
            return;
        }

        if (width !== undefined) {
            el.setAttribute("width", `${width}px`);
        } else {
            el.removeAttribute("width");
        }

        if (height !== undefined) {
            el.setAttribute("height", `${height}px`);
        } else {
            el.removeAttribute("height");
        }

        if (scale !== undefined) {
            var viewBoxWidth = el.viewBox.animVal.width;
            var viewBoxHeight = el.viewBox.animVal.height;
            var scaledWidth = viewBoxWidth / scale;
            var scaledHeight = viewBoxHeight / scale;
            el.setAttribute("width", scaledWidth + "px");
            el.setAttribute("height", scaledHeight + "px");
            el.removeAttribute("clip-path");
            /* It might eventually be necessary to scale the clip path of the root svg element
            var clipPathEl = document.querySelector("svg > clipPath > path");
            clipPathEl.setAttribute("d", `M0 0v${scaledHeight}h${scaledWidth}V0z`)
            */
        }
    }, dimensions);
}

function parseOptions(options) {
    options = Object.assign({}, options);

    if (typeof options.width === "string") {
        options.width = parseInt(options.width);
    }
    if (typeof options.height === "string") {
        options.height = parseInt(options.height);
    }
    if (typeof options.scale === "string") {
        options.scale = parseFloat(options.scale);
    }

    if (options.filename !== undefined && options.url !== undefined) {
        throw new Error("Cannot specify both filename and url options");
    }

    // Convert filename option to url option
    if (options.filename !== undefined) {
        options.url = fileURL(options.filename);
        delete options.filename;
    }

    return options;
}
