import { FIXTURE_TESTCASE_1 } from "./testcases";
import { FIXTURE_SHARED_STEP_1 } from "./shared-steps";
import { FIXTURE_STORY_1 } from "./stories";

export const FIXTURE_SEARCH_RESULT = {
  query: "login",
  mode: "hybrid",
  hits: [
    {
      ...FIXTURE_TESTCASE_1,
      score: 0.98,
      highlight: "User can **log in** with valid credentials",
    },
    {
      ...FIXTURE_SHARED_STEP_1,
      score: 0.85,
      highlight: "Navigate to **login** page",
    },
    {
      ...FIXTURE_STORY_1,
      score: 0.72,
      highlight: "Authentication flow",
    },
  ],
};
