import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asset, importMap } from '../../src/views/assets.js';

test('asset URLs carry a content hash, so a deploy reaches browsers at once', () => {
  assert.match(asset('/css/app.css'), /^\/css\/app\.css\?v=[0-9a-f]{10}$/);
  assert.equal(asset('/css/app.css'), asset('/css/app.css'));
  assert.equal(asset('/js/no-such-file.js'), '/js/no-such-file.js');
});

test('the import map sends plain module URLs to the same versioned ones as the script tags', () => {
  const { imports } = JSON.parse(importMap());
  assert.equal(imports['/js/message.js'], asset('/js/message.js'));
  assert.match(imports['/js/fx.js'], /^\/js\/fx\.js\?v=[0-9a-f]{10}$/);
});
