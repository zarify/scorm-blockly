export function getComparableFieldValue(block, fieldName) {
  const field = block?.getField?.(fieldName);
  if (!field) {
    return block?.getFieldValue?.(fieldName) ?? null;
  }

  const variable = field.getVariable?.();
  if (variable?.name) {
    return String(variable.name);
  }

  const text = field.getText?.();
  if (text !== undefined && text !== null && text !== '') {
    return String(text);
  }

  const rawValue = block?.getFieldValue?.(fieldName);
  return rawValue == null ? null : String(rawValue);
}

export function isVariableField(block, fieldName) {
  return Boolean(block?.getField?.(fieldName)?.getVariable?.());
}
