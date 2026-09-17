import * as Blockly from 'blockly';
import {
  BLOCK_PATTERN_TYPE,
  isPatternStatementWildcard,
  isPatternValueWildcard,
  registerBlockPatternBlocks,
} from './block-pattern.js';
import { getComparableFieldValue } from './blockly-field-values.js';
import {
  createFieldValueMatcher,
  normalizeFieldValueCaseSensitivity,
} from './field-value-matching.js';

registerBlockPatternBlocks(Blockly);

/**
 * Workspace Inspector — Evaluates structural conditions on a Blockly workspace.
 *
 * Shared between the SCORM template (hint engine, test runner) and the
 * activity builder (condition preview / validation).
 *
 * All functions accept a Blockly workspace instance and a condition object
 * that conforms to the "condition" definition in activity-config.schema.json.
 */

/**
 * Evaluate a condition tree against a Blockly workspace.
 * @param {object} workspace - Blockly workspace instance
 * @param {object} condition - Condition object from config
 * @returns {{ passed: boolean, detail: string }}
 */
export function evaluateCondition(workspace, condition) {
  const evaluators = {
    block_exists: evalBlockExists,
    block_missing: evalBlockMissing,
    block_connected: evalBlockConnected,
    block_nested: evalBlockNested,
    [BLOCK_PATTERN_TYPE]: evalBlockPattern,
    block_field_value: evalBlockFieldValue,
    block_count: evalBlockCount,
    workspace_empty: evalWorkspaceEmpty,
    all: evalAll,
    any: evalAny,
    none: evalNone,
  };

  const evaluator = evaluators[condition.type];
  if (!evaluator) {
    return { passed: false, detail: `Unknown condition type: ${condition.type}` };
  }
  return evaluator(workspace, condition);
}

function getBlocksByType(workspace, blockType) {
  return workspace.getAllBlocks(false).filter((b) => b.type === blockType);
}

function evalBlockExists(workspace, condition) {
  const blocks = getBlocksByType(workspace, condition.block_type);
  const minCount = condition.min_count || 1;
  const passed = blocks.length >= minCount;
  return {
    passed,
    detail: passed
      ? `Found ${blocks.length} ${condition.block_type} block(s) (need >= ${minCount})`
      : `Found ${blocks.length} ${condition.block_type} block(s), need at least ${minCount}`,
  };
}

function evalBlockMissing(workspace, condition) {
  const blocks = getBlocksByType(workspace, condition.block_type);
  const passed = blocks.length === 0;
  return {
    passed,
    detail: passed
      ? `No ${condition.block_type} blocks found (as expected)`
      : `Found ${blocks.length} ${condition.block_type} block(s), expected none`,
  };
}

function evalBlockConnected(workspace, condition) {
  const upperBlocks = getBlocksByType(workspace, condition.upper_type);
  for (const upper of upperBlocks) {
    const next = upper.getNextBlock();
    if (next && next.type === condition.lower_type) {
      return {
        passed: true,
        detail: `${condition.upper_type} is connected above ${condition.lower_type}`,
      };
    }
  }
  return {
    passed: false,
    detail: `No ${condition.upper_type} → ${condition.lower_type} connection found`,
  };
}

function evalBlockNested(workspace, condition) {
  const outerBlocks = getBlocksByType(workspace, condition.outer_type);
  const descendantFieldName = condition.field_name ? String(condition.field_name) : '';
  const descendantMatcher = descendantFieldName
    ? createFieldValueMatcher(
        condition.match_mode || 'exact',
        String(condition.expected_value ?? ''),
        {
          caseSensitive: normalizeFieldValueCaseSensitivity(
            condition.case_sensitive,
            condition.regex_flags,
          ),
          regexFlags: condition.regex_flags || '',
        },
      )
    : null;

  if (descendantMatcher && !descendantMatcher.valid) {
    return {
      passed: false,
      detail: descendantMatcher.detail,
    };
  }

  for (const outer of outerBlocks) {
    const input = outer.getInput(condition.input_name);
    if (!input) continue;
    const connected = input.connection && input.connection.targetBlock();
    if (!connected) continue;

    const matchingDescendants = collectNestedBlocks(connected).filter(
      (block) => block.type === condition.inner_type,
    );
    if (matchingDescendants.length === 0) continue;

    if (!descendantMatcher) {
      return {
        passed: true,
        detail: `${condition.inner_type} is nested inside ${condition.outer_type}.${condition.input_name}`,
      };
    }

    const matchingBlock = matchingDescendants.find((block) => {
      const value = getComparableFieldValue(block, descendantFieldName);
      return value !== null && value !== undefined && descendantMatcher.matches(String(value));
    });
    if (matchingBlock) {
      return {
        passed: true,
        detail: `${condition.inner_type}.${descendantFieldName} ${descendantMatcher.description} inside ${condition.outer_type}.${condition.input_name}`,
      };
    }
  }

  if (descendantMatcher) {
    return {
      passed: false,
      detail: `No ${condition.inner_type}.${descendantFieldName} ${descendantMatcher.description} inside ${condition.outer_type}.${condition.input_name}`,
    };
  }
  return {
    passed: false,
    detail: `${condition.inner_type} not found inside ${condition.outer_type}.${condition.input_name}`,
  };
}

function collectNestedBlocks(rootBlock) {
  const visited = new Set();
  const collected = [];
  const queue = [rootBlock];

  while (queue.length > 0) {
    const block = queue.shift();
    if (!block || visited.has(block.id)) continue;

    visited.add(block.id);
    collected.push(block);

    const next = block.getNextBlock?.();
    if (next) {
      queue.push(next);
    }

    for (const input of block.inputList || []) {
      const nested = input.connection?.targetBlock?.();
      if (nested) {
        queue.push(nested);
      }
    }
  }

  return collected;
}

function evalBlockFieldValue(workspace, condition) {
  const blocks = getBlocksByType(workspace, condition.block_type);
  const matchMode = condition.match_mode || 'exact';
  const regexFlags = condition.regex_flags || '';
  const expectedValue = String(condition.expected_value ?? '');
  const matcher = createFieldValueMatcher(matchMode, expectedValue, {
    caseSensitive: normalizeFieldValueCaseSensitivity(
      condition.case_sensitive,
      condition.regex_flags,
    ),
    regexFlags,
  });

  if (!matcher.valid) {
    return {
      passed: false,
      detail: matcher.detail,
    };
  }

  for (const block of blocks) {
    const value = getComparableFieldValue(block, condition.field_name);
    if (value !== null && matcher.matches(String(value))) {
      return {
        passed: true,
        detail: `${condition.block_type}.${condition.field_name} ${matcher.description}`,
      };
    }
  }
  return {
    passed: false,
    detail: `No ${condition.block_type} block has ${condition.field_name} ${matcher.description}`,
  };
}

function evalBlockPattern(workspace, condition) {
  if (!condition.workspace_state || typeof condition.workspace_state !== 'object') {
    return {
      passed: false,
      detail: 'Pattern workspace is missing',
    };
  }

  const patternWorkspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(condition.workspace_state, patternWorkspace);
    const roots = patternWorkspace.getTopBlocks(false);
    if (roots.length !== 1) {
      return {
        passed: false,
        detail: `Pattern workspace must have exactly one root block, found ${roots.length}`,
      };
    }

    const patternRoot = roots[0];
    const fieldConstraints = condition.field_constraints || {};
    const candidates = workspace.getAllBlocks(false);

    for (const candidate of candidates) {
      if (matchPatternChain(patternRoot, candidate, fieldConstraints)) {
        return {
          passed: true,
          detail: `Pattern rooted at ${patternRoot.type} matched workspace block ${candidate.type}`,
        };
      }
    }

    return {
      passed: false,
      detail: `No workspace block matched the pattern rooted at ${patternRoot.type}`,
    };
  } catch (err) {
    return {
      passed: false,
      detail: `Pattern workspace could not be loaded: ${err.message}`,
    };
  } finally {
    if (typeof patternWorkspace.dispose === 'function') {
      patternWorkspace.dispose();
    }
  }
}

function evalBlockCount(workspace, condition) {
  const count = getBlocksByType(workspace, condition.block_type).length;
  const min = condition.min ?? 0;
  const max = condition.max ?? Infinity;
  const passed = count >= min && count <= max;
  return {
    passed,
    detail: `${condition.block_type} count: ${count} (expected ${min}–${max === Infinity ? '∞' : max})`,
  };
}

function evalWorkspaceEmpty(workspace, _condition) {
  const blocks = workspace.getAllBlocks(false);
  const passed = blocks.length === 0;
  return {
    passed,
    detail: passed ? 'Workspace is empty' : `Workspace has ${blocks.length} block(s)`,
  };
}

function evalAll(workspace, condition) {
  const results = condition.conditions.map((c) => evaluateCondition(workspace, c));
  const passed = results.every((r) => r.passed);
  return {
    passed,
    detail: `ALL: ${results.filter((r) => r.passed).length}/${results.length} passed`,
  };
}

function evalAny(workspace, condition) {
  const results = condition.conditions.map((c) => evaluateCondition(workspace, c));
  const passed = results.some((r) => r.passed);
  return {
    passed,
    detail: `ANY: ${results.filter((r) => r.passed).length}/${results.length} passed`,
  };
}

function evalNone(workspace, condition) {
  const results = condition.conditions.map((c) => evaluateCondition(workspace, c));
  const passed = results.every((r) => !r.passed);
  return {
    passed,
    detail: `NONE: ${results.filter((r) => !r.passed).length}/${results.length} failed (good)`,
  };
}

function matchPatternChain(patternBlock, actualBlock, fieldConstraints) {
  if (!patternBlock) return true;

  if (isPatternStatementWildcard(patternBlock)) {
    const nextPattern = patternBlock.getNextBlock();
    if (!nextPattern) return true;

    let cursor = actualBlock;
    if (matchPatternChain(nextPattern, cursor, fieldConstraints)) {
      return true;
    }

    while (cursor) {
      cursor = cursor.getNextBlock?.() || null;
      if (matchPatternChain(nextPattern, cursor, fieldConstraints)) {
        return true;
      }
    }

    return false;
  }

  if (!actualBlock) return false;
  if (!matchPatternBlock(patternBlock, actualBlock, fieldConstraints)) {
    return false;
  }

  return matchPatternChain(
    patternBlock.getNextBlock?.() || null,
    actualBlock.getNextBlock?.() || null,
    fieldConstraints,
  );
}

function matchPatternBlock(patternBlock, actualBlock, fieldConstraints) {
  if (isPatternValueWildcard(patternBlock)) {
    return Boolean(actualBlock);
  }

  if (patternBlock.type !== actualBlock.type) {
    return false;
  }

  const constraints = fieldConstraints?.[patternBlock.id] || {};
  for (const [fieldName, constraint] of Object.entries(constraints)) {
    const value = getComparableFieldValue(actualBlock, fieldName);
    if (value === null || value === undefined) {
      return false;
    }

    const matcher = createFieldValueMatcher(
      constraint.match_mode || 'exact',
      String(constraint.expected_value ?? ''),
      {
        caseSensitive: normalizeFieldValueCaseSensitivity(
          constraint.case_sensitive,
          constraint.regex_flags,
        ),
        regexFlags: constraint.regex_flags || '',
      },
    );
    if (!matcher.valid || !matcher.matches(String(value))) {
      return false;
    }
  }

  for (const patternInput of patternBlock.inputList || []) {
    const patternChild = patternInput.connection?.targetBlock?.();
    if (!patternChild) continue;

    const actualInput = actualBlock.getInput(patternInput.name);
    const actualChild = actualInput?.connection?.targetBlock?.() || null;
    if (!actualChild) {
      return false;
    }

    const isStatementInput = Boolean(patternChild.previousConnection && !patternChild.outputConnection);
    const matches = isStatementInput
      ? matchPatternChain(patternChild, actualChild, fieldConstraints)
      : matchPatternBlock(patternChild, actualChild, fieldConstraints);

    if (!matches) {
      return false;
    }
  }

  return true;
}
