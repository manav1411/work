import { CheckCircle2, Circle, ExternalLink } from "lucide-react";
import type { RoadmapProblem } from "../../../content/problems";
import DifficultyBadge from "./DifficultyBadge";
export default function ProblemList({
  problems,
  solvedSlugs,
  personalised,
}: {
  problems: RoadmapProblem[];
  solvedSlugs: Set<string>;
  personalised: boolean;
}) {
  return (
    <div className="learn-homework">
      <section className="learn-problem-group">
        <ul>
          {problems.map((problem) => (
            <li className="learn-problem-row" key={problem.slug}>
              {personalised &&
                (solvedSlugs.has(problem.slug) ? (
                  <CheckCircle2 size={18} aria-label="Solved" />
                ) : (
                  <Circle
                    size={18}
                    aria-label="Not observed in available solve data"
                  />
                ))}
              <a
                href={`https://leetcode.com/problems/${problem.slug}/`}
                target="_blank"
                rel="noreferrer"
              >
                {problem.name}
                <ExternalLink size={14} />
              </a>
              <DifficultyBadge difficulty={problem.difficulty} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
