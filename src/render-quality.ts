export type RenderTier = 'high' | 'balanced' | 'low';
export const renderSettings = {
  high: {pixelRatio: 1.5, shadowSize: 2048},
  balanced: {pixelRatio: 1, shadowSize: 1024},
  low: {pixelRatio: .75, shadowSize: 512},
} as const;

// Sustained frame times, with hysteresis, avoid oscillating resolution on a single stall.
export class RenderQuality {
  tier: RenderTier;
  private elapsed = 0;
  private samples = 0;
  private slow = 0;
  private fast = 0;
  constructor(private ceiling: RenderTier = 'high') {this.tier = ceiling;}
  resetSampling() {this.elapsed = 0;this.samples = 0;this.slow = 0;this.fast = 0;}
  sample(seconds: number): boolean {
    if(seconds <= 0 || seconds > 1) {this.resetSampling();return false;}
    this.elapsed += seconds;this.samples++;
    if(this.elapsed < 1) return false;
    const average = this.elapsed / this.samples;this.elapsed = 0;this.samples = 0;
    this.slow = average > 1/28 ? this.slow + 1 : 0;
    this.fast = average < 1/55 ? this.fast + 1 : 0;
    const tiers: RenderTier[] = ['low','balanced','high'];
    const index = tiers.indexOf(this.tier);
    const next = this.slow >= 3 ? Math.max(0,index-1) : this.fast >= 5 ? Math.min(tiers.indexOf(this.ceiling),index+1) : index;
    if(next === index) return false;
    this.tier = tiers[next];this.resetSampling();return true;
  }
}
