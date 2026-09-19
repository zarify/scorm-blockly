export const DEFAULT_WORKSPACE_CONNECTEDNESS_MODE = 'all_connected';

export const VALID_WORKSPACE_CONNECTEDNESS_MODES = [
  DEFAULT_WORKSPACE_CONNECTEDNESS_MODE,
  'all_active',
];

export const WORKSPACE_CONNECTEDNESS_MODE_OPTIONS = Object.freeze([
  {
    value: 'all_connected',
    label: 'All blocks are connected (no orphan roots)',
  },
  {
    value: 'all_active',
    label: 'All top-level blocks are active (no loose value blocks)',
  },
]);

export function normalizeWorkspaceConnectednessMode(value) {
  return VALID_WORKSPACE_CONNECTEDNESS_MODES.includes(value)
    ? value
    : DEFAULT_WORKSPACE_CONNECTEDNESS_MODE;
}
