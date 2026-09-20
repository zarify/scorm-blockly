export const FIELD_VALUE_MATCH_MODE_EXACT = 'exact';
export const FIELD_VALUE_MATCH_MODE_CONTAINS = 'contains';
export const FIELD_VALUE_MATCH_MODE_REGEX_FULL = 'regex_full';
export const FIELD_VALUE_MATCH_MODE_REGEX_SEARCH = 'regex_search';
export const LEGACY_FIELD_VALUE_MATCH_MODE_REGEX = 'regex';

export const VALID_FIELD_VALUE_MATCH_MODES = [
  FIELD_VALUE_MATCH_MODE_EXACT,
  FIELD_VALUE_MATCH_MODE_CONTAINS,
  FIELD_VALUE_MATCH_MODE_REGEX_FULL,
  FIELD_VALUE_MATCH_MODE_REGEX_SEARCH,
  LEGACY_FIELD_VALUE_MATCH_MODE_REGEX,
];

export const FIELD_VALUE_MATCH_MODE_OPTIONS = [
  { value: FIELD_VALUE_MATCH_MODE_EXACT, label: 'Exact value' },
  { value: FIELD_VALUE_MATCH_MODE_CONTAINS, label: 'Contains text' },
  { value: FIELD_VALUE_MATCH_MODE_REGEX_FULL, label: 'Regex (full match)' },
  { value: FIELD_VALUE_MATCH_MODE_REGEX_SEARCH, label: 'Regex (search)' },
];

export function normalizeFieldValueMatchMode(value) {
  switch (value) {
    case FIELD_VALUE_MATCH_MODE_CONTAINS:
      return FIELD_VALUE_MATCH_MODE_CONTAINS;
    case FIELD_VALUE_MATCH_MODE_REGEX_SEARCH:
      return FIELD_VALUE_MATCH_MODE_REGEX_SEARCH;
    case FIELD_VALUE_MATCH_MODE_REGEX_FULL:
    case LEGACY_FIELD_VALUE_MATCH_MODE_REGEX:
      return FIELD_VALUE_MATCH_MODE_REGEX_FULL;
    default:
      return FIELD_VALUE_MATCH_MODE_EXACT;
  }
}

export function isRegexFieldValueMatchMode(value) {
  const normalizedMode = normalizeFieldValueMatchMode(value);
  return (
    normalizedMode === FIELD_VALUE_MATCH_MODE_REGEX_FULL
    || normalizedMode === FIELD_VALUE_MATCH_MODE_REGEX_SEARCH
  );
}

export function normalizeFieldValueCaseSensitivity(caseSensitive, regexFlags = '') {
  if (typeof caseSensitive === 'boolean') {
    return caseSensitive;
  }
  return !String(regexFlags ?? '').includes('i');
}

/**
 * Flags kept in a config: everything except the two that model something else
 * and the two that make a RegExp stateful.
 *
 * `i` is dropped because case sensitivity is its own setting, and `g`/`y` are
 * dropped because a matcher has to answer the same question many times over —
 * a global RegExp advances `lastIndex` on every `test()`, so the same value
 * would match, then not match, then match again, and a sticky one only ever
 * matches at `lastIndex`, which silently defeats a search.
 */
const DROPPED_REGEX_FLAGS = new Set(['i', 'g', 'y']);

export function getCanonicalRegexFlags(regexFlags = '') {
  return [...new Set(String(regexFlags ?? '').split('').filter(Boolean))]
    .filter((flag) => !DROPPED_REGEX_FLAGS.has(flag))
    .join('');
}

export function getEffectiveRegexFlags(regexFlags = '', caseSensitive = true) {
  const canonicalFlags = getCanonicalRegexFlags(regexFlags);
  return caseSensitive ? canonicalFlags : `${canonicalFlags}i`;
}

export function createFieldValueMatcher(
  matchMode,
  expectedValue,
  { caseSensitive = true, regexFlags = '' } = {},
) {
  const normalizedMode = normalizeFieldValueMatchMode(matchMode);
  const expectedText = String(expectedValue ?? '');

  if (normalizedMode === FIELD_VALUE_MATCH_MODE_CONTAINS) {
    const normalizedExpected = normalizeCase(expectedText, caseSensitive);
    return {
      valid: true,
      matches: (actualValue) => normalizeCase(actualValue, caseSensitive).includes(normalizedExpected),
      description: `${caseSensitive ? 'contains' : 'contains (case-insensitive)'} "${expectedText}"`,
    };
  }

  if (isRegexFieldValueMatchMode(normalizedMode)) {
    const effectiveFlags = getEffectiveRegexFlags(regexFlags, caseSensitive);
    const patternSource = normalizedMode === FIELD_VALUE_MATCH_MODE_REGEX_FULL
      ? `^(?:${expectedText})$`
      : expectedText;
    const description = normalizedMode === FIELD_VALUE_MATCH_MODE_REGEX_FULL
      ? `matches /${expectedText}/${effectiveFlags}`
      : `searches /${expectedText}/${effectiveFlags}`;

    try {
      const regex = new RegExp(patternSource, effectiveFlags);
      return {
        valid: true,
        matches: (actualValue) => regex.test(String(actualValue ?? '')),
        description,
      };
    } catch (err) {
      return {
        valid: false,
        detail: `Invalid regex /${expectedText}/${effectiveFlags}: ${err.message}`,
      };
    }
  }

  const normalizedExpected = normalizeCase(expectedText, caseSensitive);
  return {
    valid: true,
    matches: (actualValue) => normalizeCase(actualValue, caseSensitive) === normalizedExpected,
    description: `${caseSensitive ? '=' : '= (case-insensitive)'} "${expectedText}"`,
  };
}

function normalizeCase(value, caseSensitive) {
  const text = String(value ?? '');
  return caseSensitive ? text : text.toLowerCase();
}
