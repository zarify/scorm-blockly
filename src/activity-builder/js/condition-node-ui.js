const collapsedConditions = new WeakSet();

export function nodeSummaryText(condition) {
  if (['all', 'any', 'none'].includes(condition.type)) {
    const count = (condition.conditions ?? []).length;
    return `${count} sub-condition${count === 1 ? '' : 's'}`;
  }

  const snippet = [condition.pattern, condition.block_type, condition.upper_type]
    .find((value) => value != null && String(value).trim());
  if (snippet == null) return '';

  const normalized = String(snippet).trim().replace(/\s+/g, ' ');
  return normalized.length > 48 ? `${normalized.slice(0, 48)}…` : normalized;
}

export function refreshConditionNodeSummary(nodeEl, condition) {
  if (!nodeEl) return;
  const summary = nodeEl.querySelector('.condition-node-summary');
  if (summary) summary.textContent = nodeSummaryText(condition);
}

export function initConditionNode(nodeEl, condition) {
  const toggle = nodeEl.querySelector('.condition-node-toggle');
  const body = nodeEl.querySelector('.condition-node-body');
  if (!toggle || !body) return;

  const setExpanded = (expanded) => {
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', expanded ? 'Collapse condition' : 'Expand condition');
  };

  toggle.addEventListener('click', () => {
    const collapsed = !collapsedConditions.has(condition);
    if (collapsed) collapsedConditions.add(condition);
    else collapsedConditions.delete(condition);
    nodeEl.classList.toggle('is-collapsed', collapsed);
    setExpanded(!collapsed);
  });

  const hasEmbeddedEditor = [...body.querySelectorAll('.pattern-builder-mount')]
    .some((host) => host.closest('.condition-node') === nodeEl);
  const restoreCollapse = collapsedConditions.has(condition) && !hasEmbeddedEditor;
  nodeEl.classList.toggle('is-collapsed', restoreCollapse);
  setExpanded(!restoreCollapse);
}

export function resetConditionCollapse(condition) {
  collapsedConditions.delete(condition);
}
