import * as fs from 'fs';
import * as path from 'path';
import { normalizeTests } from './util';
import { Svg2png, svg2png } from '../main/svg2png';

const rel = (x: string) => path.resolve(__dirname, x);
const tests = normalizeTests(require('../../src/test/success-tests.json'));

async function main() {
  let index = 0;
  for (const test of tests) {
    console.log(`${index+1}/${tests.length}`);
    try {
      const buffer = await svg2png({
        url: test.file,
        ...test.options,
      });
      fs.writeFileSync(rel(`../../src/test/success-tests/${index}.png`), buffer);
    } catch (e) {
      process.stdout.write(`${test.file}\n\n${e.stack}\n\n\n`);
    }

    index++;
  }

  await Svg2png.closePool();
}

main();
