import {Config} from '@remotion/cli/config';

// On a machine without a display, Remotion's own headless shell may never fire
// requestAnimationFrame. Point REMOTION_BROWSER at Playwright's chrome-headless-shell there.
if (process.env.REMOTION_BROWSER) Config.setBrowserExecutable(process.env.REMOTION_BROWSER);
Config.setChromiumOpenGlRenderer('swangle');
