import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';

// Fails the test if axe finds any WCAG 2.x A/AA violation on the current page.
export async function expectNoAxeViolations(page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(summary).toEqual([]);
}
