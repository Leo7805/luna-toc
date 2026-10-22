/** Tests measured context-menu placement at viewport edges. */
import { describe, expect, it } from 'vitest';
import { fitContextMenuPosition } from '@/components/ui/context-menu';

describe('context-menu placement', () => {
  it('moves a multi-row menu above a lower-edge click', () => {
    expect(fitContextMenuPosition(
      { left: 950, top: 580 },
      { width: 220, height: 240 },
      { width: 1024, height: 600 }
    )).toEqual({ left: 796, top: 352 });
  });

  it('leaves a fully visible menu at the clicked location', () => {
    expect(fitContextMenuPosition(
      { left: 40, top: 60 },
      { width: 220, height: 180 },
      { width: 1024, height: 600 }
    )).toEqual({ left: 40, top: 60 });
  });

  it('clamps to the viewport margin at the top-left corner', () => {
    expect(fitContextMenuPosition(
      { left: -40, top: -20 },
      { width: 220, height: 240 },
      { width: 1024, height: 600 }
    )).toEqual({ left: 8, top: 8 });
  });
});
