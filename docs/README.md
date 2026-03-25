# Moodle Blockly SCORM — Documentation

Welcome to the documentation for the **Moodle Blockly SCORM** activity engine. This project lets educators create block-coding activities for Moodle without installing any plugins — everything runs client-side inside a standard SCORM 1.2 package.

## Documentation Index

### For Educators

| Guide | Description |
|-------|-------------|
| [Getting Started](getting-started.md) | Install, build, and create your first activity in 10 minutes |
| [Activity Builder Guide](activity-builder-guide.md) | Complete walkthrough of every tab in the builder tool |
| [SCORM Deployment](scorm-deployment.md) | How to upload and configure activities in Moodle |
| [Example Walkthroughs](examples.md) | Step-by-step breakdowns of the included example activities |

### Reference

| Guide | Description |
|-------|-------------|
| [Configuration Reference](config-reference.md) | Every field in `activity_config.json` explained |
| [Condition Reference](condition-reference.md) | All 10 condition types with parameters and examples |
| [Test Types](test-types.md) | The 3 assertion types: stdout, block structure, variable state |
| [Hint System](hint-system.md) | Triggers, conditions, progressive revelation, and timing |

### For Developers

| Guide | Description |
|-------|-------------|
| [Architecture](architecture.md) | System design, module relationships, data flow |
| [Troubleshooting](troubleshooting.md) | Common issues and solutions |

## Quick Links

- **Build everything**: `npm install && npm run build`
- **Open the builder**: `open dist/activity-builder/index.html`
- **Export SCORM zip**: `npm run export`
- **Dev server**: `npm run dev` → http://localhost:3000
