// import * as fs from 'fs';
// import * as path from 'path';
import { expect } from 'chai';
import { ITest, normalizeTests } from './util';
import { Svg2png, svg2png } from '../main/svg2png';

// const rel = (x: string) => path.resolve(__dirname, x);
const successTests = normalizeTests(require('../../src/test/success-tests.json'));


describe('async', () => {
  describe('should fulfill', () => successTests.forEach(successTest));

  describe('closing', () => {
    it('should close', (done) => {
      Svg2png.closePool().then(done, done);
    });
  });
});


function successTest(test: ITest, _index: number) {
  it(test.name, (done) => {
    // const expected = fs.readFileSync(rel(`../../src/test/success-tests/${index}.png`));
    svg2png({
      url: test.file,
    }).then(() => {
      console.log('hello?');
      try {
        expect(5).to.equal(4);
        done();
        console.log('done...');
      } catch (err) {
        console.log('err:', err);
        done(err);
      }
    }, done);

    //
  });
}
