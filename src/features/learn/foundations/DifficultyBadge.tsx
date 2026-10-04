import type { ProblemDifficulty } from "../../../../shared/learning";
import { Badge } from "../../../components/ui";

// Adapted from Personal-website's DifficultyBadge; Work supplies visual tokens.
export default function DifficultyBadge({
  difficulty,
}: {
  difficulty: ProblemDifficulty;
}) {
  return (
    <Badge
      tone={
        difficulty === "Easy"
          ? "lime"
          : difficulty === "Medium"
            ? "orange"
            : "pink"
      }
    >
      {difficulty}
    </Badge>
  );
}
