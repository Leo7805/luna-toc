/** @vitest-environment jsdom */
/** Tests for portalContainer module isolating Shadow DOM portal access. */
import { afterEach, describe, expect, it } from 'vitest';
import {
  getReactPortalContainer,
  setReactPortalContainer,
} from '@/reactHost/portalContainer';
import { getReactPortalContainer as reExportedGetContainer } from '@/reactHost/reactHost';

describe('portalContainer', () => {
  afterEach(() => {
    setReactPortalContainer(null);
  });

  it('throws an error if accessed before initialization', () => {
    expect(() => getReactPortalContainer()).toThrowError(
      'The LunaTOC React host has not been initialized.'
    );
    expect(() => reExportedGetContainer()).toThrowError(
      'The LunaTOC React host has not been initialized.'
    );
  });

  it('returns the active portal container once set', () => {
    const portalElement = document.createElement('div');
    portalElement.id = 'test-portal';

    setReactPortalContainer(portalElement);

    expect(getReactPortalContainer()).toBe(portalElement);
    expect(reExportedGetContainer()).toBe(portalElement);
  });

  it('allows clearing the portal container during cleanup', () => {
    const portalElement = document.createElement('div');
    setReactPortalContainer(portalElement);
    expect(getReactPortalContainer()).toBe(portalElement);

    setReactPortalContainer(null);
    expect(() => getReactPortalContainer()).toThrowError(
      'The LunaTOC React host has not been initialized.'
    );
  });
});
