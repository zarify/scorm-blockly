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
}
