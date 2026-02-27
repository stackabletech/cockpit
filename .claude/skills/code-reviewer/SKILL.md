---
name: code-review
description: Review TypeScript/SvelteKit code for bugs, security, maintainability, and duplication. Use when reviewing code changes, PRs, or checking code quality. Identifies duplicate utilities/components and suggests refactoring only when clearly beneficial.
allowed-tools: Read, Grep, Glob
---

# Code Review Skill

Conduct thorough, constructive code reviews that identify issues and provide actionable recommendations. Read AGENTS.md for project conventions.

## Stack

- TypeScript
- Svelte 5
- SvelteKit
- TailwindCSS 4
- DaisyUI
- Zod + Superforms for forms

## Analysis Framework

1. **Correctness**: Logic errors, type issues, edge cases, things that will break at runtime
2. **Security**: Input validation, auth/authorisation flaws, data exposure risks, injection vulnerabilities
3. **Accessibility (BITV 2.0)**: Semantic HTML, keyboard navigation, ARIA attributes, colour contrast, form labels, screen reader support
4. **Browser compatibility**: Must work in Firefox and Chromium. Flag browser-specific APIs or CSS without fallbacks
5. **Mobile friendliness**: Responsive layouts, touch targets, viewport behaviour
6. **Duplication**: Code that duplicates existing utilities, components, or patterns in the codebase
7. **Readability**: Naming, code organisation, adherence to established patterns
8. **Maintainability**: Complexity, coupling, unnecessary abstractions, long-term sustainability

## Review Process

### 1. Understand Context

- Read the changed files and understand their purpose
- Check AGENTS.md for project conventions
- If reviewing uncommitted changes, run `git diff` mentally to understand scope

### 2. Check for Duplication

Search the codebase before flagging duplicates using Grep and Glob tools.

Common duplication areas:

- Date formatting functions
- API call wrappers
- Form validation helpers
- Data transformations
- Error handling patterns

### 3. Component Extraction Guidelines

**Create components ONLY when:**

- Code is reused in 2+ places
- Complex logic benefits from isolation for readability
- NOT for simple markup that appears once

### 4. Code Quality Checks

**Correctness:**

- Edge cases: null, undefined, empty arrays handled?
- Error handling present and reasonable?
- Logic errors that will break at runtime?

**Security:**

- User input validated and sanitised?
- Auth checks in place where needed?
- Sensitive data not exposed to client?
- No injection vectors (SQL, XSS, command)?

**Readability:**

- Clear variable/function names?
- Logic understandable in 6 months?
- Types actually useful or just `any` with extra steps?

**Svelte/SvelteKit specific:**

- Proper use of `$state`, `$derived`, `$effect`?
- Server vs client code separation makes sense?
- Superforms used correctly with Zod schemas?
- Zod schemas defined once, not duplicated?

**Logging (server-side code only):**

- Server-side load functions, API endpoints, and hooks should include logging at appropriate levels
- Uses `event.locals.logger` (request-scoped) in request handlers, not the root `logger` import
- Module-level singletons/services use `logger.child({ module: '...' })`, not bare `console.log`
- Context object first, message string second: `log.info({ user_id }, 'User logged in')`
- Field names use snake_case consistently (`request_id`, `user_id`, `duration_ms`, `status_code`) — not camelCase variants
- Tokens, credentials, passwords, or full request/session objects are never logged directly
- If new sensitive fields are logged, redaction paths should be added to `src/lib/server/logging/redaction.ts`
- No leftover `console.log`/`console.error` in server code (use pino logger instead)

**Accessibility (BITV 2.0 / WCAG 2.1 AA):**

- Semantic HTML elements used (`<nav>`, `<main>`, `<button>`, `<a>`, correct heading levels)?
- `<div>`/`<span>` used as interactive elements without `role` and keyboard handling?
- Every form control has an associated `<label>` with `for`/`id`?
- Images have meaningful `alt` text (or `alt=""` for decorative)?
- Keyboard-only navigation works (focus order, visible focus indicators)?
- ARIA attributes correct and not redundant with semantic HTML?
- Colour contrast sufficient (4.5:1 normal text, 3:1 large text)?
- Information not conveyed through colour alone?

**Internationalisation:**

- User-visible strings not wrapped in `m.*()` calls (text content, aria-labels, title attributes, placeholder text)?
- Missing translations — new `m.*()` keys used but not present in both `messages/en.json` and `messages/de.json`?
- Reactive data structures containing translated strings not using `$derived`?

**Browser compatibility & mobile:**

- Any Firefox-incompatible APIs or CSS (e.g., `isMobile` in Playwright, webkit-only features)?
- Responsive layout works at mobile widths (393px+)?
- Touch targets large enough (minimum 44x44px for WCAG)?

### 5. Anti-patterns to Flag

- Nested ternaries (more than 2 levels)
- Functions longer than ~50 lines without clear sections
- Prop drilling more than 2 levels deep
- Magic numbers/strings without constants
- Commented-out code (remove it)
- `console.log`/`console.error` in server-side code (use pino logger)
- Root `logger` import used inside request handlers instead of `event.locals.logger`
- Logging sensitive data (tokens, passwords, full session objects) without redaction
- Inconsistent field naming in log context (camelCase vs snake_case)
- Hard-coded colours instead of DaisyUI semantic classes
- Hardcoded user-facing strings in `.svelte` files instead of using `m.*()` from Paraglide

## What NOT to Flag

- Formatting/linting (handled by tools)
- Micro-optimizations
- Personal style preferences (unless it hurts readability)
- Missing comments (code should be self-documenting)

## Output Format

Prioritise issues by severity: critical > important > minor. Only include sections that have findings — skip empty sections.

```markdown
# Code Review Report

## Critical Issues

[Bugs, security vulnerabilities, things that will break]

- **File**: path/to/file.ts:42
- **Issue**: Describe the problem
- **Impact**: What happens if this ships

## Security Notes

[Auth flaws, input validation gaps, data exposure risks]

- **File**: path/to/file.ts:15
- **Risk**: Describe the vulnerability
- **Recommendation**: How to fix it

## Accessibility Issues

[BITV 2.0 / WCAG 2.1 AA violations]

- **File**: path/to/file.svelte:20
- **Violation**: Missing label, wrong element, keyboard trap, contrast, etc.
- **Fix**: How to resolve it

## Browser / Mobile Issues

[Cross-browser problems, responsive layout failures, touch target issues]

- **File**: path/to/file.svelte:30
- **Problem**: What breaks and where
- **Fix**: How to resolve it

## Logging Issues

[Missing logging, wrong logger used, sensitive data exposure, inconsistent field names]

- **File**: path/to/file.ts:20
- **Issue**: Describe the logging problem
- **Fix**: How to resolve it

## Duplication Found

[Existing code that could be reused, with exact file paths]

- **Duplicate in**: path/to/new-code.ts:15-30
- **Existing**: path/to/existing-util.ts:42-50
- **Action**: Use existing function instead

## Maintainability Concerns

[Hard to read, confusing logic, unclear intent, unnecessary complexity]

- **File**: path/to/file.ts:100
- **Problem**: Describe what's confusing
- **Suggestion**: How to improve it

## Positive Observations

[Well-implemented aspects worth noting — good patterns, clean logic, smart decisions]

## Verdict

[One paragraph: overall assessment, main action items, ready to merge or needs work]
```

## Guidelines

- Be direct and honest — flag real problems, not nitpicks
- If something is broken, say it's broken
- If code is fine, say it's fine (don't invent issues)
- Focus on "why" not just "what" — provide reasoning
- Include specific file paths and line numbers
- Highlight good practices too, not just problems
- Don't modify code — report only

## Workflow

1. Read the changed files using Read tool
2. Search for similar patterns using Grep and Glob
3. Check for existing utilities/components
4. Assess security considerations
5. Identify actual problems (not theoretical ones)
6. Write report with actionable findings
