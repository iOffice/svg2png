import { Svg2png } from '../main/svg2png';
import './conversion-tests';
import './puppeteer-pool';

describe('Closing', () => {
  // Using the library creates a pool for Svg2png. Thus we need to make sure to close it at
  // the end of the tests.
  it('should close the svg2png browser pool', async () => {
    await Svg2png.closePool();
  });
});
