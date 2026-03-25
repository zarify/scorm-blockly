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
  for (const outer of outerBlocks) {
    const input = outer.getInput(condition.input_name);
    if (!input) continue;
    const connected = input.connection && input.connection.targetBlock();
    if (connected) {
      // Check the connected block and all blocks nested inside the statement
      const nestedBlocks = [connected];
      if (input.type === Blockly.inputTypes.STATEMENT) {
        let current = connected;
        while (current) {
          nestedBlocks.push(current);
          current = current.getNextBlock();
        }
      }
      if (nestedBlocks.some((b) => b.type === condition.inner_type)) {
        return {
          passed: true,
          detail: `${condition.inner_type} is nested inside ${condition.outer_type}.${condition.input_name}`,
        };
      }
    }
  }
  return {
    passed: false,
    detail: `${condition.inner_type} not found inside ${condition.outer_type}.${condition.input_name}`,
  };
}

function evalBlockFieldValue(workspace, condition) {
  const blocks = getBlocksByType(workspace, condition.block_type);
  for (const block of blocks) {
    const value = block.getFieldValue(condition.field_name);
    if (value !== null && String(value) === String(condition.expected_value)) {
      return {
        passed: true,
        detail: `${condition.block_type}.${condition.field_name} = "${condition.expected_value}"`,
      };
    }
  }
  return {
    passed: false,
    detail: `No ${condition.block_type} block has ${condition.field_name} = "${condition.expected_value}"`,
  };
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
