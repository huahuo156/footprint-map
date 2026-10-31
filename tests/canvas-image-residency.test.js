import { describe, expect, it } from 'vitest';
import { planImageResidency } from '../src/journal/images/canvasImageResidency.js';

const photo = (id, x = 0, y = 0, extra = {}) => ({ id, x, y, w: 100, h: 100, ...extra });
const plan = (items, extra = {}) => planImageResidency({ items, camera: { x: 0, y: 0, scale: 1 }, viewport: { width: 1000, height: 800 }, ...extra });

describe('canvas image residency', () => {
  it('includes intersecting edges and rotated bounds even when centers are outside', () => {
    const result = plan([photo('edge', 530), photo('rotated', 550, 0, { w: 40, h: 200, rotation: 90 }), photo('far', 2000)]);
    expect(result.visibleIds).toEqual(['edge', 'rotated']);
    expect(result.displayIds).toEqual(['edge', 'rotated']);
  });

  it.each([[500, 'desktop', 48, 120], [2000, 'tablet', 24, 60]])('bounds %i objects on %s and retains complete overview membership', (count, profile, images, details) => {
    const items = Array.from({ length: count }, (_, i) => photo(String(i), i % 10, Math.floor(i / 10) % 10));
    const before = JSON.stringify(items);
    const result = plan(items, { profile, selectedIds: items.map(item => item.id) });
    expect(result.displayIds).toHaveLength(images);
    expect(result.detailIds).toHaveLength(details);
    const overviewIds = result.overview.flatMap(cell => cell.ids);
    expect(new Set([...result.detailIds, ...overviewIds]).size).toBe(count);
    expect(overviewIds).toHaveLength(count - details);
    expect(result.prefetchIds.length).toBeLessThanOrEqual(profile === 'desktop' ? 8 : 4);
    expect(JSON.stringify(items)).toBe(before);
  });

  it('keeps ranking stable, ignores selection pins, prioritizes focus and drag', () => {
    const items = [photo('b'), photo('a'), photo('focus', 300), photo('drag', 400)];
    expect(plan(items, { previousIds: ['b'] }).displayIds).toEqual(['b', 'a', 'focus', 'drag']);
    expect(plan(items, { previousIds: ['b'], focusId: 'focus', dragIds: ['drag'], selectedIds: ['a'] }).displayIds).toEqual(['focus', 'drag', 'b', 'a']);
    expect(plan(items.toReversed()).displayIds).toEqual(plan(items).displayIds);
  });

  it('retains an already resident captured target offscreen without pinning unrelated targets', () => {
    const result = plan([photo('held', 3000), photo('unmounted', 3000)], { previousIds: ['held'], dragIds: ['held', 'unmounted'] });
    expect(result.displayIds).toEqual(['held']);
  });

  it('aggregates tiny photos in screen cells with world bounds and an explicit zoom target', () => {
    const result = plan([photo('a'), photo('b', 10)], { camera: { x: 0, y: 0, scale: 0.1 } });
    expect(result.displayIds).toEqual([]);
    expect(result.detailIds).toEqual([]);
    expect(result.overview).toHaveLength(1);
    expect(result.overview[0]).toMatchObject({ ids: ['a', 'b'], count: 2, bounds: { left: -50, top: -50, right: 60, bottom: 50 } });
    expect(result.overview[0].zoomTarget.scale).toBeGreaterThan(0.1);
  });

  it('excludes hidden and nested folded descendants using the actual group schema', () => {
    const items = [photo('folded'), photo('nested'), photo('hidden'), photo('ok'), photo('self', 0, 0, { hidden: true })];
    const groups = [{ id: 'outer', collapsed: true, photo_ids: ['folded'], child_group_ids: ['inner'] }, { id: 'inner', parent_id: 'outer', photo_ids: ['nested'] }, { id: 'secret', hidden: true, photo_ids: ['hidden'] }];
    expect(plan(items, { groups }).displayIds).toEqual(['ok']);
  });

  it('prefetches only nearby non-display photos and accepts width/height plus camera offsets', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: String(i), x: 650 + i, y: 0, width: 80, height: 80 }));
    const result = plan(items);
    expect(result.visibleIds).toEqual([]);
    expect(result.displayIds).toEqual([]);
    expect(result.prefetchIds).toHaveLength(8);
    expect(plan(items, { camera: { x: -650, y: 0, scale: 1 } }).visibleIds).toHaveLength(20);
  });
});

it('reserves image preference for covers ahead of retained noninteractive photos', () => {
  const photos = Array.from({ length: 48 }, (_, i) => photo(`photo-${i}`, 0, 0))
  const result = plan([...photos, photo('cover', 350, 0, { priority: 1 })], { previousIds: photos.map(item => item.id) })
  expect(result.displayIds).toContain('cover')
  expect(result.displayIds).toHaveLength(48)
})

it('keeps non-image detail cards accessible without spending image or prefetch slots', () => {
  const result = plan(Array.from({ length: 121 }, (_, i) => photo(`note-${i}`, 0, 0, { hasImage: false })))
  expect(result.detailIds).toHaveLength(120)
  expect(result.displayIds).toHaveLength(0)
  expect(result.overview.flatMap(cell => cell.ids)).toHaveLength(1)
})
