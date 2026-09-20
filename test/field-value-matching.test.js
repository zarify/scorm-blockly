/**
 * Field value matching — the matcher behind `block_field_value` conditions,
 * pattern field constraints and the builder's condition preview.
 *
 * The interesting edges are the ones the builder lets an author type into a
 * config: legacy match modes, case sensitivity that can come from either a
 * boolean or an `i` flag, invalid regexes, and flags that make a RegExp
 * stateful.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createFieldValueMatcher,
  getCanonicalRegexFlags,
  getEffectiveRegexFlags,
  isRegexFieldValueMatchMode,
  normalizeFieldValueCaseSensitivity,
  normalizeFieldValueMatchMode,
} from '../src/shared/field-value-matching.js';

test('unknown match modes fall back to exact, legacy regex maps to full match', () => {
  assert.equal(normalizeFieldValueMatchMode(undefined), 'exact');
  assert.equal(normalizeFieldValueMatchMode(null), 'exact');
  assert.equal(normalizeFieldValueMatchMode(''), 'exact');
  assert.equal(normalizeFieldValueMatchMode('nonsense'), 'exact');
  assert.equal(normalizeFieldValueMatchMode('exact'), 'exact');
  assert.equal(normalizeFieldValueMatchMode('contains'), 'contains');
  assert.equal(normalizeFieldValueMatchMode('regex_search'), 'regex_search');
  assert.equal(normalizeFieldValueMatchMode('regex_full'), 'regex_full');
  assert.equal(normalizeFieldValueMatchMode('regex'), 'regex_full');
});

test('only the two regex modes count as regex', () => {
  assert.equal(isRegexFieldValueMatchMode('regex'), true);
  assert.equal(isRegexFieldValueMatchMode('regex_full'), true);
  assert.equal(isRegexFieldValueMatchMode('regex_search'), true);
  assert.equal(isRegexFieldValueMatchMode('contains'), false);
  assert.equal(isRegexFieldValueMatchMode(undefined), false);
});

test('an explicit case sensitivity wins over the flag, otherwise the i flag decides', () => {
  assert.equal(normalizeFieldValueCaseSensitivity(true, 'i'), true);
  assert.equal(normalizeFieldValueCaseSensitivity(false, ''), false);
  assert.equal(normalizeFieldValueCaseSensitivity(undefined, 'i'), false);
  assert.equal(normalizeFieldValueCaseSensitivity(undefined, 'gi'), false);
  assert.equal(normalizeFieldValueCaseSensitivity(undefined, 'g'), true);
  assert.equal(normalizeFieldValueCaseSensitivity(undefined), true);
  assert.equal(normalizeFieldValueCaseSensitivity(null, null), true);
});

test('canonical flags drop the i flag, duplicates and stateful flags', () => {
  assert.equal(getCanonicalRegexFlags('i'), '');
  assert.equal(getCanonicalRegexFlags('gi'), '');
  assert.equal(getCanonicalRegexFlags('mism'), 'ms');
  assert.equal(getCanonicalRegexFlags('g'), '');
  assert.equal(getCanonicalRegexFlags('y'), '');
  assert.equal(getCanonicalRegexFlags('gyimu'), 'mu');
  assert.equal(getCanonicalRegexFlags(''), '');
  assert.equal(getCanonicalRegexFlags(undefined), '');
  assert.equal(getCanonicalRegexFlags(null), '');
});

test('effective flags add i once, only when the match is case-insensitive', () => {
  assert.equal(getEffectiveRegexFlags('', true), '');
  assert.equal(getEffectiveRegexFlags('', false), 'i');
  assert.equal(getEffectiveRegexFlags('m', false), 'mi');
  assert.equal(getEffectiveRegexFlags('im', true), 'm');
  assert.equal(getEffectiveRegexFlags('i', false), 'i');
});

test('exact mode compares the whole value, case-sensitively by default', () => {
  const sensitive = createFieldValueMatcher('exact', 'Hello');
  assert.equal(sensitive.valid, true);
  assert.equal(sensitive.matches('Hello'), true);
  assert.equal(sensitive.matches('hello'), false);
  assert.equal(sensitive.matches('Hello '), false);

  const insensitive = createFieldValueMatcher('exact', 'Hello', { caseSensitive: false });
  assert.equal(insensitive.matches('hello'), true);
  assert.equal(insensitive.matches('HELLO'), true);
});

test('non-string values are compared as text, and a missing value is the empty string', () => {
  const matcher = createFieldValueMatcher('exact', 5);
  assert.equal(matcher.matches(5), true);
  assert.equal(matcher.matches('5'), true);
  assert.equal(matcher.matches('05'), false);

  const empty = createFieldValueMatcher('exact', undefined);
  assert.equal(empty.matches(undefined), true);
  assert.equal(empty.matches(null), true);
  assert.equal(empty.matches(''), true);
  assert.equal(empty.matches('x'), false);
});

test('contains mode matches a substring, and an empty needle matches anything', () => {
  const matcher = createFieldValueMatcher('contains', 'ell');
  assert.equal(matcher.matches('Hello'), true);
  assert.equal(matcher.matches('hELLo'.toLowerCase()), true);
  assert.equal(matcher.matches('Hello'.toLowerCase()), true);
  assert.equal(matcher.matches('Hxllo'), false);

  const insensitive = createFieldValueMatcher('contains', 'ELL', { caseSensitive: false });
  assert.equal(insensitive.matches('hello'), true);

  const emptyNeedle = createFieldValueMatcher('contains', '');
  assert.equal(emptyNeedle.matches('anything'), true);
  assert.equal(emptyNeedle.matches(''), true);
});

test('full-match mode anchors both ends, search mode does not', () => {
  const full = createFieldValueMatcher('regex_full', 'a+');
  assert.equal(full.matches('aaa'), true);
  assert.equal(full.matches('baaa'), false);
  assert.equal(full.matches('aaab'), false);

  const search = createFieldValueMatcher('regex_search', 'a+');
  assert.equal(search.matches('baaa'), true);
  assert.equal(search.matches('bbb'), false);
});

test('full-match anchoring survives alternation and anchors inside the pattern', () => {
  const alternation = createFieldValueMatcher('regex_full', 'cat|dog');
  assert.equal(alternation.matches('cat'), true);
  assert.equal(alternation.matches('dog'), true);
  assert.equal(alternation.matches('catdog'), false);

  const anchored = createFieldValueMatcher('regex_full', '^ab$');
  assert.equal(anchored.matches('ab'), true);
  assert.equal(anchored.matches('xabx'), false);
});

test('a dot does not cross a newline unless the s flag is given', () => {
  const withoutDotAll = createFieldValueMatcher('regex_full', 'a.b');
  assert.equal(withoutDotAll.matches('a\nb'), false);

  const withDotAll = createFieldValueMatcher('regex_full', 'a.b', { regexFlags: 's' });
  assert.equal(withDotAll.matches('a\nb'), true);
});

test('an invalid regex is reported instead of throwing, and carries no matcher', () => {
  const matcher = createFieldValueMatcher('regex_full', 'a(');
  assert.equal(matcher.valid, false);
  assert.match(matcher.detail, /Invalid regex/);
  assert.equal(matcher.matches, undefined);
});

test('flags that make a RegExp stateful are stripped, so repeated matches agree', () => {
  // A global RegExp advances lastIndex on every test(), which made the same
  // value match, then not match, then match again within one evaluation.
  const global = createFieldValueMatcher('regex_search', 'a', { regexFlags: 'g' });
  assert.deepEqual(
    [global.matches('a'), global.matches('a'), global.matches('a')],
    [true, true, true],
  );

  // A sticky RegExp only matches at lastIndex, so a search silently failed
  // everywhere except the start of the string.
  const sticky = createFieldValueMatcher('regex_search', 'b', { regexFlags: 'y' });
  assert.equal(sticky.matches('abc'), true);
  assert.equal(sticky.matches('abc'), true);

  const globalFull = createFieldValueMatcher('regex_full', 'a+', { regexFlags: 'g' });
  assert.equal(globalFull.matches('aa'), true);
  assert.equal(globalFull.matches('aa'), true);
});

test('stateless flags still reach the RegExp', () => {
  const unicode = createFieldValueMatcher('regex_full', '\\p{L}+', { regexFlags: 'u' });
  assert.equal(unicode.matches('café'), true);

  const multiline = createFieldValueMatcher('regex_full', '^b$', { regexFlags: 'm' });
  assert.equal(multiline.matches('a\nb'), true);
});

test('case sensitivity reaches the matcher as a boolean derived from the i flag', () => {
  // The matcher itself only consults the boolean, in every mode.
  assert.equal(createFieldValueMatcher('exact', 'Hello', { regexFlags: 'i' }).matches('hello'), false);
  assert.equal(createFieldValueMatcher('exact', 'Hello', { caseSensitive: false }).matches('hello'), true);
  assert.equal(createFieldValueMatcher('regex_full', 'HELLO', { regexFlags: 'i' }).matches('hello'), false);

  // Callers derive it from the author's flag with the shared helper.
  const derived = { caseSensitive: normalizeFieldValueCaseSensitivity(undefined, 'i') };
  assert.equal(createFieldValueMatcher('exact', 'Hello', derived).matches('hello'), true);
  assert.equal(createFieldValueMatcher('contains', 'ELL', derived).matches('hello'), true);
  assert.equal(createFieldValueMatcher('regex_full', 'HELLO', derived).matches('hello'), true);
});
