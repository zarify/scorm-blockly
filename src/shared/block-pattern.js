export const BLOCK_PATTERN_TYPE = 'block_pattern';
export const PATTERN_ANY_STATEMENT_TYPE = 'pattern_any_statement';
export const PATTERN_ANY_VALUE_TYPE = 'pattern_any_value';

export const PARAM_COUNT_COMPARISON_EQUALS = 'equals';
export const PARAM_COUNT_COMPARISON_GTE = 'gte';
export const PARAM_COUNT_COMPARISON_LTE = 'lte';

export const VALID_PARAM_COUNT_COMPARISONS = [
  PARAM_COUNT_COMPARISON_EQUALS,
  PARAM_COUNT_COMPARISON_GTE,
  PARAM_COUNT_COMPARISON_LTE,
];

export const PARAM_COUNT_COMPARISON_OPTIONS = [
  { value: PARAM_COUNT_COMPARISON_EQUALS, label: 'Exactly' },
  { value: PARAM_COUNT_COMPARISON_GTE, label: 'At least' },
  { value: PARAM_COUNT_COMPARISON_LTE, label: 'At most' },
];

const PROCEDURE_DEFINITION_BLOCK_TYPES = new Set([
  'procedures_defnoreturn',
  'procedures_defreturn',
]);

const PROCEDURE_CALL_BLOCK_TYPES = new Set([
  'procedures_callnoreturn',
  'procedures_callreturn',
]);

let registered = false;

export function registerBlockPatternBlocks(Blockly) {
  if (registered || !Blockly?.Blocks) return;

  Blockly.Blocks[PATTERN_ANY_STATEMENT_TYPE] = {
    init() {
      this.appendDummyInput().appendField('any block(s)');
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour('#9aa4b2');
      this.setTooltip('Matches zero or more blocks in a statement sequence.');
    },
  };

  Blockly.Blocks[PATTERN_ANY_VALUE_TYPE] = {
    init() {
      this.appendDummyInput().appendField('any value');
      this.setOutput(true);
      this.setColour('#9aa4b2');
      this.setTooltip('Matches any block subtree connected to a value input.');
    },
  };

  registered = true;
}

export function isPatternStatementWildcard(block) {
  return block?.type === PATTERN_ANY_STATEMENT_TYPE;
}

export function isPatternValueWildcard(block) {
  return block?.type === PATTERN_ANY_VALUE_TYPE;
}

export function isPatternWildcardType(blockType) {
  return blockType === PATTERN_ANY_STATEMENT_TYPE || blockType === PATTERN_ANY_VALUE_TYPE;
}

export function createPatternToolboxCategory() {
  return {
    name: 'Pattern',
    colour: '#6b7280',
    blocks: [PATTERN_ANY_STATEMENT_TYPE, PATTERN_ANY_VALUE_TYPE],
  };
}

/**
 * Normalize the comparison used by a parameter count constraint.
 * @param {string} value
 * @returns {string}
 */
export function normalizeParamCountComparison(value) {
  return VALID_PARAM_COUNT_COMPARISONS.includes(value) ? value : PARAM_COUNT_COMPARISON_EQUALS;
}

/**
 * Whether a block type carries a function signature or call argument list.
 * @param {string} blockType
 * @returns {boolean}
 */
export function isProcedureBlockType(blockType) {
  return PROCEDURE_DEFINITION_BLOCK_TYPES.has(blockType)
    || PROCEDURE_CALL_BLOCK_TYPES.has(blockType);
}

/**
 * Count the parameters of a procedure definition or the arguments of a call.
 * Uses Blockly's own extra-state, so it follows mutator edits.
 * @param {object} block - Blockly block instance
 * @returns {number}
 */
export function getBlockParamCount(block) {
  const extraState = block?.saveExtraState?.();
  if (!extraState || typeof extraState !== 'object') return 0;
  return Array.isArray(extraState.params) ? extraState.params.length : 0;
}

/**
 * Normalize a parameter count constraint into a predictable shape.
 * @param {object} constraint
 * @returns {{ count: number, comparison: string } | null}
 */
export function normalizeParamCountConstraint(constraint) {
  if (!constraint || typeof constraint !== 'object' || Array.isArray(constraint)) return null;

  const count = Number(constraint.count);
  return {
    count: Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0,
    comparison: normalizeParamCountComparison(constraint.comparison),
  };
}

/**
 * Test a parameter count against a constraint.
 * Malformed counts fall back to 0, matching the block_count condition defaults.
 * @param {number} actualCount
 * @param {object} constraint
 * @returns {boolean}
 */
export function matchesParamCountConstraint(actualCount, constraint) {
  const normalized = normalizeParamCountConstraint(constraint);
  if (!normalized) return true;

  switch (normalized.comparison) {
    case PARAM_COUNT_COMPARISON_GTE:
      return actualCount >= normalized.count;
    case PARAM_COUNT_COMPARISON_LTE:
      return actualCount <= normalized.count;
    default:
      return actualCount === normalized.count;
  }
}
