import { defineHook } from "eve/hooks";
import { defineState } from "eve/context";
const budget = defineState("visual-user.budget", () => ({ started: Date.now(), steps: 0 }));
export default defineHook({ events: {
  "turn.started"() { budget.update(() => ({ started: Date.now(), steps: 0 })); },
  "step.started"() {
    const b = budget.get();
    if (b.steps >= 100 || Date.now() - b.started > 600_000) throw new Error("LIMIT_REACHED");
    budget.update(s => ({ ...s, steps: s.steps + 1 }));
  },
} });
