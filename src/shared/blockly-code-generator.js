import { Order } from 'blockly/javascript';

/**
 * Align Blockly's JavaScript generator with this runtime:
 * - printed output should stream through the in-app console
 * - prompt blocks should pause for console input instead of opening browser dialogs
 * - reading an uninitialised variable should raise a Python-like error
 */
export function configureJavascriptGenerator(javascriptGenerator) {
  javascriptGenerator.forBlock.text_print = function textPrint(block, generator) {
    const argument = generator.valueToCode(block, 'TEXT', Order.NONE) || "''";
    return `await __runtime.writeLine(${argument});\n`;
  };

  javascriptGenerator.forBlock.text_prompt_ext = function textPrompt(block, generator) {
    const message = block.getField('TEXT')
      ? generator.quote_(block.getFieldValue('TEXT'))
      : generator.valueToCode(block, 'TEXT', Order.NONE) || "''";
    const promptMethod = block.getFieldValue('TYPE') === 'NUMBER'
      ? '__runtime.promptNumber'
      : '__runtime.promptText';
    return [`await ${promptMethod}(${message})`, Order.AWAIT];
  };
  javascriptGenerator.forBlock.text_prompt = javascriptGenerator.forBlock.text_prompt_ext;

  javascriptGenerator.forBlock.variables_get = function variablesGet(block, generator) {
    const variableName = generator.getVariableName(block.getFieldValue('VAR'));
    return [`__runtime.readVar(${JSON.stringify(variableName)}, ${variableName})`, Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock.text_append = function textAppend(block, generator) {
    const variableName = generator.getVariableName(block.getFieldValue('VAR'));
    const value = generator.valueToCode(block, 'TEXT', Order.NONE) || "''";
    return `${variableName} = __runtime.readVar(${JSON.stringify(variableName)}, ${variableName}) + String(${value});\n`;
  };

  javascriptGenerator.forBlock.math_change = function mathChange(block, generator) {
    const delta = generator.valueToCode(block, 'DELTA', Order.ADDITION) || '0';
    const variableName = generator.getVariableName(block.getFieldValue('VAR'));
    return `${variableName} = __runtime.readVar(${JSON.stringify(variableName)}, ${variableName}) + ${delta};\n`;
  };

  javascriptGenerator.forBlock.procedures_defnoreturn = function proceduresDefNoReturn(block, generator) {
    return buildAsyncProcedureDefinition(block, generator);
  };

  javascriptGenerator.forBlock.procedures_defreturn = function proceduresDefReturn(block, generator) {
    return buildAsyncProcedureDefinition(block, generator);
  };

  javascriptGenerator.forBlock.procedures_callreturn = function proceduresCallReturn(block, generator) {
    const functionName = generator.getProcedureName(block.getFieldValue('NAME'));
    const argumentCodes = [];
    const argumentVariables = block.getVars();
    for (let index = 0; index < argumentVariables.length; index += 1) {
      argumentCodes[index] = generator.valueToCode(block, `ARG${index}`, Order.NONE) || 'null';
    }
    return [`await ${functionName}(${argumentCodes.join(', ')})`, Order.AWAIT];
  };

  javascriptGenerator.forBlock.procedures_callnoreturn = function proceduresCallNoReturn(block, generator) {
    return `${generator.forBlock.procedures_callreturn(block, generator)[0]};\n`;
  };
}

function buildAsyncProcedureDefinition(block, generator) {
  const functionName = generator.getProcedureName(block.getFieldValue('NAME'));
  let prefix = '';
  if (generator.STATEMENT_PREFIX) {
    prefix += generator.injectId(generator.STATEMENT_PREFIX, block);
  }
  if (generator.STATEMENT_SUFFIX) {
    prefix += generator.injectId(generator.STATEMENT_SUFFIX, block);
  }
  if (prefix) {
    prefix = generator.prefixLines(prefix, generator.INDENT);
  }

  let loopTrap = '';
  if (generator.INFINITE_LOOP_TRAP) {
    loopTrap = generator.prefixLines(generator.injectId(generator.INFINITE_LOOP_TRAP, block), generator.INDENT);
  }

  let branch = '';
  if (block.getInput('STACK')) {
    branch = generator.statementToCode(block, 'STACK');
  }

  let returnValue = '';
  if (block.getInput('RETURN')) {
    returnValue = generator.valueToCode(block, 'RETURN', Order.NONE) || '';
  }

  let returnPrefix = '';
  if (branch && returnValue) {
    returnPrefix = prefix;
  }
  if (returnValue) {
    returnValue = `${generator.INDENT}return ${returnValue};\n`;
  }

  const args = [];
  const variables = block.getVars();
  for (let index = 0; index < variables.length; index += 1) {
    args[index] = generator.getVariableName(variables[index]);
  }

  let code = `async function ${functionName}(${args.join(', ')}) {\n${prefix}${loopTrap}${branch}${returnPrefix}${returnValue}}`;
  code = generator.scrub_(block, code);
  generator.definitions_[`%${functionName}`] = code;
  return null;
}
