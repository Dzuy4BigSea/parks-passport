// Levels core: names and thresholds come from the app ([{ name, min }], ascending, first min 0).

/**
 * createLevels(levels) -> levelFor(points) =
 * { index, name, min, next (level or null), toNext (points needed), progress (0..1 to next) }
 */
export function createLevels(levels) {
  if (!levels.length || levels[0].min !== 0) throw new Error('The first level must start at 0 points.');
  return function levelFor(points) {
    let index = 0;
    for (let i = 0; i < levels.length; i++) if (points >= levels[i].min) index = i;
    const level = levels[index];
    const next = levels[index + 1] || null;
    return {
      index,
      name: level.name,
      min: level.min,
      next,
      toNext: next ? next.min - points : 0,
      progress: next ? (points - level.min) / (next.min - level.min) : 1,
    };
  };
}
