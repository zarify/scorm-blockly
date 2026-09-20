/**
 * Activity config fixtures.
 *
 * `activityConfig()` is the smallest config that passes `validateConfig`, so
 * tests can override exactly the field they are probing and leave everything
 * else in a known-good state.
 */

/** Minimal publishable config: one toolbox category, one passing test. */
export function activityConfig(overrides = {}) {
  return deepMerge(
    {
      metadata: {
        activity_id: 'test_activity',
        title: 'Test Activity',
        version: '1.0',
        description: '',
      },
      instructions: { main: '', steps: [] },
      ui_settings: {
        theme: 'default',
        show_code_toggle: false,
        show_hint_panel: true,
        suspend_data_limit: 4096,
      },
      blockly_setup: {
        toolbox: { categories: [{ name: 'Text', colour: '#5CA68D', blocks: ['text_print', 'text'] }] },
        starting_blocks: null,
        max_blocks: null,
        disabled_blocks: [],
      },
      hints: [],
      evaluation: {
        grading_mode: 'pass_fail',
        max_score: 100,
        require_previous_test_pass: true,
        feedback_on_all_pass: '',
        test_cases: [
          {
            id: 'test_print',
            type: 'stdout_match',
            points: 10,
            output_assertion: { enabled: true, expected: 'hi\n', match_mode: 'exact' },
          },
        ],
      },
    },
    overrides,
  );
}

/** A config whose single test grades a visual block pattern. */
export function blockPatternTestConfig(workspaceState, { id = 'test_pattern', points = 10 } = {}) {
  return activityConfig({
    evaluation: {
      test_cases: [
        {
          id,
          type: 'block_structure',
          points,
          conditions: { type: 'block_pattern', workspace_state: workspaceState },
        },
      ],
    },
  });
}

/** A hint config with the given trigger condition. */
export function hint(overrides = {}) {
  return deepMerge(
    {
      id: 'hint_1',
      trigger: { event: 'workspace_change', conditions: { type: 'workspace_empty' } },
      display_mode: 'triggered',
      message: 'Try something.',
      priority: 1,
      delay_seconds: 0,
      show_once: false,
    },
    overrides,
  );
}

/** Recursive merge; arrays and scalars in `patch` replace the base value. */
export function deepMerge(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch === undefined ? base : patch;
  }
  const merged = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = isPlainObject(value) && isPlainObject(base[key])
      ? deepMerge(base[key], value)
      : value;
  }
  return merged;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
