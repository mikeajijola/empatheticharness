import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { mouseInputSchema, mouseSchema, keyboardInputSchema, keyboardSchema, normalizePhysicalInput } from '../agent/lib/physical';
test('model schemas expose action as a required root property', () => {
  for (const schema of [mouseInputSchema, keyboardInputSchema]) {
    const json = z.toJSONSchema(schema);
    assert.ok(json.required?.includes('action'));
    assert.ok(json.properties?.action);
    assert.equal(json.anyOf, undefined);
  }
});
test('execution validates the fields required by each physical action', () => {
  assert.equal(mouseSchema.safeParse({ action: 'click' }).success, false);
  assert.equal(mouseSchema.safeParse({ action: 'click', x: 20, y: 30 }).success, true);
  assert.equal(mouseSchema.safeParse({ action: 'scroll', deltaY: 200 }).success, true);
  assert.deepEqual(mouseSchema.parse({ action: 'click', x: 20, y: 30, deltaY: 0 }), { action: 'click', x: 20, y: 30 });
  assert.equal(mouseInputSchema.safeParse({ action: 'click', x: 20, y: 30, url: 'https://example.com' }).success, false);
  assert.equal(keyboardSchema.safeParse({ action: 'type' }).success, false);
  assert.equal(keyboardSchema.safeParse({ action: 'press', key: 'Tab' }).success, true);
});

test('inactive optional fields accept provider null placeholders without weakening active fields', () => {
  const wire = mouseInputSchema.parse({ action: 'click', x: 30, y: 40, button: null, deltaX: null, deltaY: null });
  assert.deepEqual(mouseSchema.parse(normalizePhysicalInput(wire)), { action: 'click', x: 30, y: 40 });
  assert.equal(mouseSchema.safeParse(normalizePhysicalInput({ action: 'click', x: null, y: 40 })).success, false);
  const typed = keyboardInputSchema.parse({ action: 'type', text: 'Alex', key: '', keys: [] });
  assert.deepEqual(keyboardSchema.parse(normalizePhysicalInput(typed)), { action: 'type', text: 'Alex' });
});
