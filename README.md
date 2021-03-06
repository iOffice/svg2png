# SVG-to-PNG Converter Using Chromium

You have a SVG file. For whatever reason, you need a PNG. **svg2png** can help.

```js
const fs = require("pn/fs"); // https://www.npmjs.com/package/pn
const svg2png = require("svg2png");

svg2png("~/test.svg")
    .then(buffer => fs.writeFile("dest.png", buffer))
    .catch(e => console.error(e));
```

In the above example, we use the `width` and `height` attributes specified in the SVG file to automatically determine the size of the SVG. You can also explicitly set the size:

```js
svg2png(url, { width: 300, height: 400 })
    .then(buffer => ...)
    .catch(e => console.error(e));
```

This is especially useful for images without `width` or `height`s. You can even specify just one of them and (if the image has an appropriate `viewBox`) the other will be set to scale.


<<<<<<< HEAD
## Sync variant

There's also a sync variant, for use in your shell scripts:

```js
const outputBuffer = svg2png.sync(url, options);
```

=======
>>>>>>> 61541144915ed9c54bb680e53fa42faba9e22abc
## How the conversion is done

svg2png uses [puppeteer](https://github.com/GoogleChrome/puppeteer) to render your SVGs using a headless Chromium instance. I have found this to produce much more accurate renderings than other solutions like GraphicsMagick or Inkscape. Plus, it's easy to install cross-platform since it downloads Chromium on install so you don't even need to have it in your `PATH`.

## Exact resizing behavior

Previous versions of svg2png attempted to infer a good size based on the `width`, `height`, and `viewBox` attributes. As of our 3.0 release, we attempt to stick as close to the behavior of loading a SVG file in your browser as possible. The rules are:

- Any `width` or `height` attributes that are in percentages are ignored and do not count for the subsequent rules.
- The dimensions option `{ width, height }` overrides any `width` or `height` attributes in the SVG file, including for the subsequent rules. If a key is missing from the dimensions object (i.e. `{ width }` or `{ height }`) the corresponding attribute in the SVG file will be deleted.
- `width` and `height` attributes without a `viewBox` attribute cause the output to be of those dimensions; this might crop the image or expand it with empty space to the bottom and to the right.
- `width` and/or `height` attributes with a `viewBox` attribute cause the image to scale to those dimensions. If the ratio does not match the `viewBox`'s aspect ratio, the image will be expanded and centered with empty space in the extra dimensions. When a `viewBox` is present, one of either `width` or `height` can be omitted, with the missing one inferred from the `viewBox`'s aspect ratio.
- When there are neither `width` nor `height` attributes, the promise rejects.

One thing to note is that svg2png does not and cannot stretch your images to new aspect ratios.

## CLI

This package comes with a CLI version as well; you can install it globally with `npm install svg2png -g`. Use it as follows:

```
$ svg2png --help
Converts SVGs to PNGs, using Chromium

svg2png input.svg [--output=output.png] [--width=300] [--height=150]

Options:
  -o, --output  The output filename; if not provided, will be inferred  [string]
  -w, --width   The output file width, in pixels                        [string]
  -h, --height  The output file height, in pixels                       [string]
  --help        Show help                                              [boolean]
  --version     Show version number                                    [boolean]
```

## Node.js requirements

svg2png uses the latest in ES2017 features, and as such requires a recent version of Node.js. Only the 8.x series onward is supported.

## TODO:
Create the tests for the cli
