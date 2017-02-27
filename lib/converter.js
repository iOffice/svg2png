/* eslint-env phantomjs */
/* eslint-disable no-console, no-var, prefer-arrow-callback, object-shorthand */
"use strict";

var webpage = require("webpage");
var system = require("system");

var HTML_PREFIX = "<!DOCTYPE html><style>html, body { margin: 0; padding: 0; } " +
                  "svg { position: absolute; top: 0; left: 0; }</style>";

if (system.args.length !== 3) {
    console.error("Usage: converter.js url options");
    phantom.exit();
} else {
    convert(system.args[1], system.args[2]);
}

function convert(url, options) {
    try {
        options = JSON.parse(options);
    } catch (e) {
        console.error("Unable to parse options.");
        console.error(e);
        phantom.exit();
        return;
    }

    var page = webpage.create();

    page.onResourceError = function(error) {
        page.reason = error.errorString;
        page.reason_url = error.url;
    };

    page.onLoadFinished = function (status) {
        if (status !== "success") {
            console.error("Unable to load the source file.");
            console.error("Error opening url \"" + page.reason_url "\": " + page.reason);
            phantom.exit();
            return;
        }

        try {
            if (options.width !== undefined || options.height !== undefined || options.scale !== undefined) {
                setSVGDimensions(page, options.width, options.height, options.scale);
            }

            var dimensions = getSVGDimensions(page);
            if (!dimensions) {
                console.error("Width or height could not be determined from either the source file or the supplied " +
                              "dimensions");
                phantom.exit();
                return;
            }

            setSVGDimensions(page, dimensions.width, dimensions.height);

            page.viewportSize = {
                width: dimensions.width,
                height: dimensions.height
            };
            page.clipRect = {
                top: 0,
                left: 0,
                width: dimensions.width,
                height: dimensions.height
            };
        } catch (e) {
            console.error("Unable to calculate or set dimensions.");
            console.error(e);
            phantom.exit();
            return;
        }

        var result = "data:image/png;base64," + page.renderBase64("PNG");
        system.stdout.write(result);
        phantom.exit();
    };

    // PhantomJS will always render things empty if you choose about:blank, so that's why the different default URL.
    // PhantomJS's setContent always assumes HTML, not SVG, so we have to massage the page into usable HTML first.
    page.open(url);
}

function setSVGDimensions(page, width, height, scale) {
    if (width === undefined && height === undefined && scale === undefined) {
        return;
    }

    page.evaluate(function (widthInside, heightInside, scaleInside) {
        /* global document: false */
        var el = document.querySelector("svg");

        if (widthInside !== undefined) {
            el.setAttribute("width", widthInside + "px");
        } else {
            el.removeAttribute("width");
        }

        if (heightInside !== undefined) {
            el.setAttribute("height", heightInside + "px");
        } else {
            el.removeAttribute("height");
        }

        if (scaleInside !== undefined) {
            var viewBoxWidth = el.viewBox.animVal.width;
            el.setAttribute("width", Math.round(viewBoxWidth / scaleInside) + "px");
        }
    }, width, height, scale);
}

function getSVGDimensions(page) {
    return page.evaluate(function () {
        /* global document: false */

        var el = document.querySelector("svg");

        var widthIsPercent = /%\s*$/.test(el.getAttribute("width") || ""); // Phantom doesn't have endsWith
        var heightIsPercent = /%\s*$/.test(el.getAttribute("height") || "");
        var width = !widthIsPercent && parseFloat(el.getAttribute("width"));
        var height = !heightIsPercent && parseFloat(el.getAttribute("height"));

        if (width && height) {
            return { width: width, height: height };
        }

        var viewBoxWidth = el.viewBox.animVal.width;
        var viewBoxHeight = el.viewBox.animVal.height;

        if (width && viewBoxHeight) {
            return { width: width, height: width * viewBoxHeight / viewBoxWidth };
        }

        if (height && viewBoxWidth) {
            return { width: height * viewBoxWidth / viewBoxHeight, height: height };
        }

        return null;
    });
}
