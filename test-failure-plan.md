# Test Failure → Developer Retry Loop

## Overview
When Playwright tests fail after the developer node writes code, the graph should feed the failure details back to the developer so it can fix the bugs — up to a configurable number of retries. If all retries are exhausted without passing tests, a dedicated human-in-the-loop checkpoint ("tests-failed") asks the user whether to proceed to commit anyway or cancel.

## Graph flow change

**Before:**
```
developer → playwrightRunner → commitApprovalGate (always)
```

**After:**
```
developer → playwrightRunner ─┬─ all pass ─────────────────────────→ commitApprovalGate
                               ├─ some fail, retries left ──────────→ developer (retry with context)
                               └─ some fail, retries exhausted ─────→ [testFailureGate]
                                                                           ├─ approved → commitApprovalGate
                                                                           └─ rejected → END
```

## Files to change

### 1. `packages/shared-types/src/config.ts`
Add `maxTestRetries: number` to `NovaflowProjectConfig.permissions` (default: `3`).

```typescript
permissions: {
  checkpoints: {
    afterBusinessAnalysis: boolean;
    beforeImplementation: boolean;
    beforeCommit: boolean;
  };
  allowAgentUncertaintyPause: boolean;
  maxTestRetries: number;   // NEW
};
```

Update `defaultProjectConfig()`:
```typescript
permissions: {
  checkpoints: { ... },
  allowAgentUncertaintyPause: true,
  maxTestRetries: 3,         // NEW
},
```

### 2. `packages/shared-types/src/run.ts`
Add `"tests-failed"` to `GateName`:
```typescript
export type GateName = "post-ba" | "pre-impl" | "pre-commit" | "agent-uncertainty" | "tests-failed";
```

### 3. `packages/agents/src/graph/state.ts`
Add `testRetryCount` channel:
```typescript
testRetryCount: Annotation<number>({
  reducer: (_, next) => next,
  default: () => 0,
}),
```

### 4. `packages/agents/src/graph/graph.ts`

**Add `testFailureGate` node** (uses the existing `makeCheckpointGate` factory):
```typescript
.addNode("testFailureGate", makeCheckpointGate("tests-failed", true))
```

**Replace the fixed edge** with a conditional edge:
```typescript
// REMOVE: .addEdge("playwrightRunner", "commitApprovalGate")

const maxRetries = projectConfig.permissions.maxTestRetries ?? 3;

.addConditionalEdges("playwrightRunner", (s) => {
  if (s.allTestsPassed) return "commitApprovalGate";
  if ((s.testRetryCount ?? 0) < maxRetries) return "developer";
  return "testFailureGate";
})
.addConditionalEdges("testFailureGate", (s) =>
  s.checkpointDecision === "rejected" ? END : "commitApprovalGate"
)
```

**Extend `getCheckpointPayload`** to include test results:
```typescript
case "tests-failed":
  return state.testResults;
```

### 5. `packages/agents/src/nodes/developer.ts`

**Detect retry mode** by checking if `testResults` has failures:
```typescript
const isRetry = !!state.testResults && !state.allTestsPassed;
```

**Emit a status event when retrying:**
```typescript
if (isRetry) {
  emitAgentEvent(state.runId, {
    type: "agent:thinking",
    agentId: "developer",
    message: `Tests failed (attempt ${state.testRetryCount + 1}). Fixing failures...`,
  });
}
```

**Build failure context for the prompt:**
```typescript
const failingTestsSummary = isRetry
  ? state.testResults!.results
      .filter(r => !r.passed)
      .map(r => `- ${r.testName}: ${r.error ?? "unknown error"}`)
      .join("\n")
  : null;
```

**Append to the prompt's HumanMessage:**
```
${failingTestsSummary
  ? `\n\nPrevious implementation failed ${state.testResults!.failed} automated test(s). Identify the root cause and fix only those tests. Failing tests:\n${failingTestsSummary}`
  : ""}
```

**Increment the counter in the return:**
```typescript
return {
  implementationOutput: { ... },
  testRetryCount: (state.testRetryCount ?? 0) + 1,
};
```

## Rebuild order
```bash
pnpm --filter @novaflow/shared-types build
pnpm --filter @novaflow/agents build
```

## Backward compatibility
- `maxTestRetries` defaults to `3` both in `defaultProjectConfig()` and via `?? 3` in the conditional edge — existing config files without this field work unchanged.
- `testRetryCount` defaults to `0` — existing runs are unaffected.

## Verification
1. Trigger a run with a JIRA ticket
2. Observe the event log for repeated `developer` → `playwright-runner` cycles with "Fixing failures..." messages
3. After 3 failures: `tests-failed` checkpoint appears with the full list of failing tests and their errors
4. Approve → run proceeds to commit gate; Reject → run ends
5. If tests pass on a retry: proceeds normally to `commitApprovalGate` with no `testFailureGate` triggered
