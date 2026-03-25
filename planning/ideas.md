Creating a blockly environment in Moodle that interacts with the marks book.

# Technical Specification: Configurable Blockly-SCORM Activity Engine

## 1. Overview
This document outlines the architecture and implementation strategy for a client-side, SCORM 1.2 compliant block-coding environment. The engine utilizes Google Blockly for the user interface, executes student logic entirely within the browser, and reports grades back to a standard Moodle LMS instance without requiring administrative plugin installation.

### 1.1 Objectives
* **Bypass LMS Constraints:** Operate completely client-side within a standard SCORM 1.2 package.
* **High Reusability:** Separate the execution engine from the activity content to allow rapid creation of new activities by only modifying a single JSON configuration file.
* **Automated Assessment:** Evaluate student block arrangements against predefined test cases and automatically pass a score to the Moodle gradebook.

---

## 2. System Architecture

The system is a self-contained web application packaged as a `.zip` file adhering to the SCORM 1.2 standard. It requires no backend server or database beyond the host LMS.

### 2.1 File Structure
The SCORM package will contain the following directory structure:

```text
/blockly-scorm-package
│
├── imsmanifest.xml           # SCORM 1.2 manifest defining the package structure
├── index.html                # Main UI container (Canvas, instructions, run button)
│
├── /config
│   └── activity_config.json  # The standalone configuration file for the specific activity
│
├── /js
│   ├── scorm_wrapper.js      # Abstraction layer for Moodle SCORM API communication
│   ├── blockly_engine.js     # Initializes Blockly, loads toolbox, and handles workspace
│   ├── test_runner.js        # Compiles blocks to JS, executes, and asserts output
│   └── app.js                # Main controller orchestrating the flow
│
└── /lib                      # Local copies of required libraries to ensure offline/sandbox capability
    ├── blockly_compressed.js
    ├── blocks_compressed.js
    ├── javascript_compressed.js
    └── pipwerks_scorm.js     # Standard open-source SCORM API wrapper
````

---

## 3. Core Components

## 3.1 SCORM Wrapper (`scorm_wrapper.js`)

Responsible for establishing and terminating the LMS communication session.

- **`init()`**: Locates the `API` object in the Moodle parent frame and calls `LMSInitialize`.
    
- **`setScore(score)`**: Normalizes the score (0-100) and calls `LMSSetValue("cmi.core.score.raw", score)`.
    
- **`complete()`**: Sets `cmi.core.lesson_status` to `completed` or `passed`/`failed`.
    
- **`terminate()`**: Calls `LMSCommit` and `LMSFinish` to save data before window closure.
    

## 3.2 Blockly Engine (`blockly_engine.js`)

Manages the visual workspace.

- Reads the `toolbox` array from `activity_config.json` to dynamically render only the allowed blocks.
    
- Loads any `starting_blocks` XML into the workspace on initialization.
    
- On user submission, utilizes Blockly's built-in generator to convert the visual blocks into executable JavaScript code as a string.
    

## 3.3 Test Runner (`test_runner.js`)

Safely executes the generated code and verifies the output.

- **Output Capture:** Overrides standard browser output functions (like `console.log` or `window.alert`) temporarily to capture the student's output into a string variable.
    
- **Execution:** Wraps the generated JavaScript string in a secure execution context (e.g., using a `Function` constructor rather than a raw `eval()`) to prevent namespace collisions.
    
- **Assertion:** Compares the captured output string against the `expected_output` defined in the configuration JSON.
    

---

## 4. Data Model: Activity Configuration

The entire behavior of the SCORM package is dictated by `activity_config.json`. To create a new Moodle activity, the teacher duplicates the base SCORM package and modifies only this file.

**Schema Definition (`activity_config.json`):**

JSON

```
{
  "metadata": {
    "activity_id": "loop_basics_01",
    "title": "Basic For-Loops",
    "description": "Use a loop to print the numbers 1 through 3."
  },
  "ui_settings": {
    "theme": "default",
    "show_code_toggle": true 
  },
  "blockly_setup": {
    "allowed_categories": [
      "controls_loops",
      "math",
      "text"
    ],
    "starting_workspace_xml": "<xml>...</xml>" 
  },
  "evaluation": {
    "grading_mode": "pass_fail", 
    "max_score": 100,
    "test_cases": [
      {
        "id": "test_1",
        "type": "stdout_match",
        "expected_output": "1\n2\n3\n",
        "weight": 100,
        "feedback_on_fail": "Check your loop boundaries. Are you starting at 1 and ending at 3?"
      }
    ]
  }
}
```

---

## 5. Application Execution Flow

1. **Initialization:** Student opens the activity in Moodle. `app.js` calls `scorm_wrapper.init()`.
    
2. **Configuration Load:** `app.js` fetches `activity_config.json` via the Fetch API.
    
3. **UI Render:** `blockly_engine.js` injects the instructions into the DOM and initializes the Blockly workspace with the configured toolbox.
    
4. **Student Interaction:** Student arranges blocks and clicks "Run Code".
    
5. **Compilation & Execution:**
    
    - `blockly_engine.js` translates blocks to a JavaScript string.
        
    - `test_runner.js` intercepts `console.log`, executes the string, and captures the output.
        
6. **Evaluation:** The captured output is compared against the `test_cases` in the configuration.
    
7. **Reporting:** * UI updates to show success/failure feedback to the student.
    
    - `scorm_wrapper.setScore()` pushes the calculated grade to Moodle.
        
    - `scorm_wrapper.terminate()` ensures the grade is saved to the Moodle database.
        

---

## 6. Known Limitations & Security

- **Client-Side Vulnerability:** Because execution and grading happen in the browser, technically proficient students can theoretically manipulate the DOM or the SCORM API directly to spoof a 100% score. This architecture is strictly recommended for formative assessments, low-stakes grading, and skill practice.
    
- **Execution Sandboxing:** While the `Function` constructor is safer than `eval()`, it is not a true sandbox. Infinite loops created by students _will_ freeze the browser tab. A web worker implementation could mitigate this in future iterations but increases initial architectural complexity.
    

