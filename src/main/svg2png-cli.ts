#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import * as yargs from 'yargs';

import { svg2png } from './svg2png';

async function main() {
  const name = 'svg2png';
  const argv = yargs
    .usage(`${name} input.svg ` +
      "[--output=output.png] [--width=300] [--height=150]")
    .option('o', {
      alias: 'output',
      type: 'string',
      describe: 'The output filename; if not provided, will be inferred',
    })
    .option('w', {
      alias: 'width',
      type: 'string',
      describe: 'The output file width, in pixels',
    })
    .option('h', {
      alias: 'height',
      type: 'string',
      describe: 'The output file height, in pixels',
    })
    .option('s', {
      alias: 'scale',
      type: 'string',
      describe: 'The inverted scale to use fo the output file',
    })
    .option('d', {
      alias: 'debug',
      type: 'boolean',
      describe: 'Print debug messages.',
    })
    .demand(1)
    .help(false)
    .version()
    .argv;
  try {
    const inputFilename = argv._[0];
    const outputFilename = argv.output || path.basename(inputFilename, '.svg') + '.png';
    const output = await svg2png({
      width: +argv.width,
      height: +argv.height,
      scale: +argv.scale,
      url: inputFilename,
      debug: !!argv.debug,
    });
    fs.writeFileSync(outputFilename, output);
    process.exit(0);
  } catch (e) {
    if (e.stack) {
      process.stderr.write(`${e.stack}\n`);
    } else {
      process.stderr.write(`${e}\n`);
    }
    process.exit(1);
  }
}

main();
