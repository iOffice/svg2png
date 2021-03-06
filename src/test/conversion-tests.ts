import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

import { svg2png } from '../main/svg2png';
import { ITest, normalizeTests, pngCompare } from './util';

const rel = (x: string) => path.resolve(__dirname, x);
const successTests = normalizeTests(require('../../src/test/success-tests.json'));
const failureTests = normalizeTests(require('../../src/test/failure-tests.json'));

describe('async', () => {
  describe('should fulfill', () => successTests.forEach(successTest));
  describe("should reject", () => failureTests.forEach(failureTest));
});

function successTest(test: ITest, index: number) {
  it(test.name, async () => {
    const expected = fs.readFileSync(rel(`../../src/test/success-tests/${index}.png`));
    const actual = await svg2png({
      url: test.file,
      ...test.options,
    });
    const result = await pngCompare(expected, actual);
    const ratio = result.diffPixels/result.totalPixels;
    try {
      expect(ratio).to.be.lessThan(0.05, 'More than 5% of the pixels are different');
    } catch (err) {
      result.png.pipe(fs.createWriteStream(`err_${index}.png`));
      throw err;
    }
  });
}

function failureTest(test: ITest) {
  it(test.name, async () => {
    try {
      await svg2png({
        url: test.file,
        ...test.options,
      });
    } catch (err) {
      return expect(err.message).to.include(test['expectedErrorSubstring']);
    }
    throw new Error('Did not get the exception');
  });
}
