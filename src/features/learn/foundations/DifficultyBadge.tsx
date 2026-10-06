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
      className={`difficulty-badge difficulty-badge-${difficulty.toLowerCase()}`}
    >
      {difficulty}
    </Badge>
  );
}
