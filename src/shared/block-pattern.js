export const BLOCK_PATTERN_TYPE = 'block_pattern';
export const PATTERN_ANY_STATEMENT_TYPE = 'pattern_any_statement';
export const PATTERN_ANY_VALUE_TYPE = 'pattern_any_value';

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
