import { Order } from 'blockly/javascript';

/**
 * Align Blockly's JavaScript generator with this runtime:
 * - print blocks should write to stdout-like output instead of alerts
 */
export function configureJavascriptGenerator(javascriptGenerator) {
  javascriptGenerator.forBlock.text_print = function textPrint(block, generator) {
    const argument = generator.valueToCode(block, 'TEXT', Order.NONE) || "''";
    return `console.log(${argument});\n`;
  };
}
