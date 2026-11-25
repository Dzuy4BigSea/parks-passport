import { test } from 'node:test';
import assert from 'node:assert/strict';
import { more } from '../../src/views/nextup.js';

test('"N more" reads right in the singular, "ies" units included', () => {
  const b = (remaining, unit) => ({ remaining, unit });
  assert.equal(more(b(1, 'cities')), '1 more city');
  assert.equal(more(b(1, 'activities')), '1 more activity');
  assert.equal(more(b(1, 'facilities')), '1 more facility');
  assert.equal(more(b(1, 'parks')), '1 more park');
  assert.equal(more(b(1, 'parks in a weekend')), '1 more park in a weekend');
  assert.equal(more(b(1, 'weeks')), '1 more week');
  assert.equal(more(b(2, 'cities')), '2 more cities');
});
