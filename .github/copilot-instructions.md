# COPILOT EDITS OPERATIONAL GUIDELINES

### GENERAL INSTRUCTIONS
  - Use snake_case for variable and function names. 
  - Use CamelCase for class names. Follow PEP 8 style guidelines. 
  - Include type hints for function parameters and return types.
  - Write docstrings for all public modules, classes, functions, and methods.
  - Prefer using NumPy for numerical computations. Use vectorized operations instead of loops where possible. 
  - Import NumPy using the alias 'np'. Include comments explaining complex mathematical operations.
  - Do **NOT** generate needless code or boilerplate.
  - Do **NOT** generate functions that are used only once. Instead, inline the code if it is not reused.
  - Do **NOT**, for ANY REASON, generate nested/inner functions, that means functions defined inside other functions. Always define functions either at the module level or as methods of a class.

### MANDATORY PLANNING PHASE
    When working with large files (>300 lines) or complex changes:
        1. ALWAYS start by creating a detailed plan BEFORE making any edits
            2. Your plan MUST include:
                   - All functions/sections that need modification
                   - The order in which changes should be applied
                   - Dependencies between changes
                   - Estimated number of separate edits required

            3. Format your plan as:

## PROPOSED EDIT PLAN
    Working with: [filename]
    Total planned edits: [number]

### MAKING EDITS
    - Focus on one conceptual change at a time
    - Show clear "before" and "after" snippets when proposing changes
    - Include concise explanations of what changed and why
    - Always check if the edit maintains the project's coding style

### Edit sequence:
    1. [First specific change] - Purpose: [why]
    2. [Second specific change] - Purpose: [why]
    3. Do you approve this plan? I'll proceed with Edit [number] after your confirmation.
    4. WAIT for explicit user confirmation before making ANY edits when user ok edit [number]

### EXECUTION PHASE
    - After each individual edit, clearly indicate progress:
        "✅ Completed edit [#] of [total]. Ready for next edit?"
    - If you discover additional needed changes during editing:
    - STOP and update the plan
    - Get approval before continuing

### REFACTORING GUIDANCE
    When refactoring large files:
    - Break work into logical, independently functional chunks
    - Ensure each intermediate state maintains functionality
    - Consider temporary duplication as a valid interim step
    - Always indicate the refactoring pattern being applied