# Hint System

The hint system provides real-time, context-sensitive guidance to students as they work. Hints can be triggered by workspace changes, test failures, student requests, or timers.

## How Hints Work

1. The **hint engine** monitors the Blockly workspace for changes (debounced — configurable, default 250ms)
2. When an event occurs, each hint's **trigger conditions** are evaluated
3. Hints that pass all checks either become **visible** or get **ticked off** if that individual hint is configured as a checklist item
4. Students can **dismiss** hints; `show_once` hints won't return, while other hints stay hidden until the triggering situation changes or the event happens again
5. Hints are sorted by **priority** — higher priority hints appear first

## Hint Configuration

Each hint is an object in the `hints` array:

```json
{
  "id": "hint_need_loop",
  "display_mode": "triggered",
  "trigger": {
    "event": "workspace_change",
    "conditions": {
      "type": "block_missing",
      "block_type": "controls_for"
    },
    "after_attempts": 0
  },
  "message": "Try using a for-loop from the Loops category.",
  "priority": 1,
  "delay_seconds": 15,
  "show_once": false
}
```

### Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | ✅ | — | Unique identifier for this hint |
| `trigger` | object | ✅ | — | When and why the hint appears |
| `message` | string | ✅ | — | Text shown to the student |
| `display_mode` | string | No | `triggered` | `triggered`: hide until this hint fires. `checklist`: always show in the sidebar and tick off once triggered. |
| `priority` | integer | No | `1` | Higher priority hints appear first |
| `delay_seconds` | integer | No | `0` | Wait this long after condition is met before showing |
| `show_once` | boolean | No | `false` | If true, don't re-show after student dismisses |

Checklist items work best when their condition represents a completed milestone, such as adding the required block or matching a finished pattern.

### Trigger Object

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `event` | string | ✅ | — | `"workspace_change"`, `"test_fail"`, `"manual"`, or `"timed"` |
| `conditions` | condition | No | — | Workspace condition that must be true. This can be a simple predicate or a visual `block_pattern`. See [Condition Reference](condition-reference.md) |
| `after_attempts` | integer | No | `0` | Only show after this many failed test runs |
| `invalidate_on_condition_false` | boolean | No | `false` | If true, when the hint's condition becomes false the hint is treated as invalidated/dismissed and won't reappear. Useful for transient warnings that should not re-trigger once the situation resolves. |

Additionally, per-hint UI controls:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `style` | string | No | — | Optional style variant: `"success"`, `"warning"`, or `"error"`. Drives CSS classes (e.g. `hint-success`) for visual cues. |
| `allow_manual_dismiss` | boolean | No | `true` | If false, the hint will not render a manual dismiss (✕) button and will instead obey configured dismissal/invalidations. Useful for triggered hints authors want to control via config. |
---

## Trigger Events

### `workspace_change`

The most common trigger. Fires when the student adds, removes, moves, or modifies blocks.

**Debouncing:** Evaluations are debounced to avoid flicker during rapid edits. The engine uses a short default debounce (250ms) so hints feel responsive; authors can override this with `ui_settings.hint_debounce_ms` in activity config.

**Event coverage:** The hint engine now listens for any non-UI Blockly events (not just move/create/delete). This ensures field edits (text value updates), variable renames, and other non-drag edits trigger hint evaluations immediately.

**Automatic delayed hints:** If a `workspace_change` hint has `delay_seconds`, the timer starts as soon as the condition becomes true and the hint now appears automatically once that delay elapses, even if the student pauses and makes no further edits.

**Conditions are required** for this trigger type — without a condition, the hint would appear on every change.

```json
{
  "trigger": {
    "event": "workspace_change",
    "conditions": {
      "type": "block_missing",
      "block_type": "controls_for"
    }
  }
}
```

### `test_fail`

Fires after a student clicks **✓ Check** and at least one automated test fails.

```json
{
  "trigger": {
    "event": "test_fail",
    "after_attempts": 2
  },
  "message": "Still not quite right. Check that your loop counts from 1 to 3."
}
```

Conditions are optional — if provided, the workspace is also checked.

### `manual`

Fires when the student clicks **💡 Get Hint** (or requests a hint programmatically).

```json
{
  "trigger": {
    "event": "manual"
  },
  "message": "Think about what block repeats an action multiple times."
}
```

**Special behaviour:** When the event is `manual`, the hint engine evaluates **all eligible hints** regardless of their configured trigger event. This means a `workspace_change` hint with a satisfied condition will also appear on manual request.

### `timed`

Intended for time-based hints that appear after a period of inactivity.

> ⚠️ **Not yet implemented.** No scheduler or inactivity timer fires `timed` events at runtime. The `delay_seconds` field on other trigger types works correctly (it delays after the trigger event fires), but a standalone `timed` trigger with no other event will not activate. Use `workspace_change` with `delay_seconds` as a workaround.

```json
{
  "trigger": {
    "event": "timed"
  },
  "message": "Need some help? Start by looking at the Loops category.",
  "delay_seconds": 60
}
```

---

## Visibility Logic

When an event occurs, each hint goes through this evaluation pipeline:

```
1. show_once check
   → If hint.show_once AND student already dismissed it → HIDE

2. Event match
   → If event ≠ 'manual' AND hint.trigger.event ≠ event → HIDE
   → (manual event bypasses this check — evaluates all eligible hints)

3. Attempt threshold
   → If hint.trigger.after_attempts > 0
     AND student's failed attempts < after_attempts → HIDE

4. Condition check (if conditions exist)
   → Evaluate condition against workspace
   → If condition fails → HIDE (and reset delay timer)

5. Delay check (if delay_seconds > 0)
   → Record when condition first became true
   → If elapsed time < delay_seconds → HIDE
   → If condition was false and becomes true again → timer resets

6. All checks passed → SHOW
```

### Delay Timer Behaviour

The delay timer is tied to the condition:

- **Condition becomes true** → Timer starts (records timestamp)
- **Condition remains true** → Timer keeps counting
- **Condition becomes false** → Timer resets (timestamp cleared)
- **Condition becomes true again** → Timer restarts from 0

This means if a student adds a block (making the condition false) and then removes it (making the condition true again), the delay restarts.

---

## Priority System

When multiple hints are visible, they're sorted by priority **descending** (higher numbers first).

| Priority | Use For |
|----------|---------|
| 1 | General, low-urgency hints |
| 2–3 | Specific guidance |
| 4–5 | Critical hints that should appear above others |

Hints with equal priority appear in their original array order.

---

## Progressive Hint Strategy

Build hints that escalate from vague to specific:

### Level 1: Nudge (low priority, with delay)

```json
{
  "id": "hint_1_nudge",
  "trigger": {
    "event": "workspace_change",
    "conditions": { "type": "workspace_empty" }
  },
  "message": "Start by thinking about which type of block repeats actions.",
  "priority": 1,
  "delay_seconds": 20,
  "show_once": true
}
```

### Level 2: Direction (medium priority, after failures)

```json
{
  "id": "hint_2_direction",
  "trigger": {
    "event": "test_fail",
    "after_attempts": 2
  },
  "message": "Try a for-loop block. Set it to count from 1 to 3.",
  "priority": 2,
  "show_once": false
}
```

### Level 3: Solution Guide (high priority, after many failures)

```json
{
  "id": "hint_3_solution",
  "trigger": {
    "event": "test_fail",
    "after_attempts": 5
  },
  "message": "Step by step:\n1. Drag a 'count with i' loop\n2. Set FROM to 1 and TO to 3\n3. Put a print block inside\n4. Connect 'i' to the print",
  "priority": 3,
  "show_once": false
}
```

---

## Hint Design Tips

### Do

- ✅ **Start vague, get specific** — Let students think before giving answers
- ✅ **Use delay_seconds** on early hints — Give students time to try first
- ✅ **Use after_attempts** for test-fail hints — Don't overwhelm on first failure
- ✅ **Use show_once** for one-time nudges — Don't nag about things they've already seen
- ✅ **Use conditions** to make hints context-sensitive — Show the right hint at the right time

### Don't

- ❌ **Give the answer immediately** — That defeats the learning purpose
- ❌ **Show too many hints at once** — Use priority to control which appears
- ❌ **Use very short delays** — 15–30 seconds is a good minimum
- ❌ **Forget to test your conditions** — Verify hints appear when expected

---

## State Tracking

The hint engine tracks state internally:

| State | Type | Description |
|-------|------|-------------|
| `dismissed` | `Set<string>` | IDs of hints the student has dismissed |
| `firstTriggered` | `Map<string, number>` | Hint ID → timestamp when condition first became true |
| `attemptCount` | `number` | Number of failed test runs |
| `elapsedSeconds` | `number` | Seconds since activity opened |

This state is **not persisted** across page reloads. If the student refreshes the page, hint state resets.

---

## Student UI

When `ui_settings.show_hint_panel` is enabled, hints can be mixed:

- Hints with `display_mode: "triggered"` show as hint cards only after their trigger conditions fire. Each card includes the hint message and a **dismiss button** (✕).
- Hints with `display_mode: "checklist"` stay visible in the sidebar from the start and tick off once they have triggered.

Set `ui_settings.show_hint_panel: false` to disable the student-facing hint UI entirely.

> **Note:** The student UI now includes a **💡 Get Hint** button, so `manual` trigger hints can be exercised directly in both the exported activity and the builder preview.
