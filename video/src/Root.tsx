import {Composition} from 'remotion';
import {FinPilot} from './FinPilot';
import {FPS, TOTAL_FRAMES} from './timeline';

export const Root = () => (
  <Composition id="FinPilot" component={FinPilot} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />
);
