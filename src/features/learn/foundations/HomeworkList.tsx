import { CheckCircle2, Circle, ExternalLink } from "lucide-react";
import type { HomeworkProblem, WeekTask } from "../../../../shared/learning";
import DifficultyBadge from "./DifficultyBadge";

// Adapted from Personal-website's HomeworkList, retaining shared task IDs and
// accumulated-history checks; unchecked solves mean unobserved, not unsolved.
export interface HomeworkListProps {
  problems: HomeworkProblem[];
  solvedSlugs: Set<string>;
  personalised: boolean;
  tasks?: WeekTask[];
  taskProgress?: Record<string, boolean>;
  pendingTasks?: Set<string>;
  onToggleTask?: (id: string, done: boolean) => void;
}
export default function HomeworkList({
  problems,
  solvedSlugs,
  personalised,
  tasks = [],
  taskProgress = {},
  pendingTasks = new Set(),
  onToggleTask,
}: HomeworkListProps) {
  return (
    <div className="learn-homework">
      {tasks.length > 0 && (
        <section className="learn-problem-group">
          <header>
            <h4>Tasks</h4>
            {personalised && (
              <span>
                {tasks.filter((task) => taskProgress[task.id]).length}/
                {tasks.length} complete
              </span>
            )}
          </header>
          <ul>
            {tasks.map((task) => (
              <li key={task.id} className="learn-task-row">
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(taskProgress[task.id])}
                    disabled={!personalised || pendingTasks.has(task.id)}
                    onChange={(event) =>
                      onToggleTask?.(task.id, event.target.checked)
                    }
                  />
                  <span>{task.label}</span>
                  {pendingTasks.has(task.id) && (
                    <span className="muted">Saving…</span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}
      {problems.length > 0 && (
        <section className="learn-problem-group">
          <header>
            <h4>Problems</h4>
            {personalised && (
              <span>
                {
                  problems.filter((problem) => solvedSlugs.has(problem.slug))
                    .length
                }
                /{problems.length}
              </span>
            )}
          </header>
          <ul>
            {problems.map((problem) => {
              const confirmed = personalised && solvedSlugs.has(problem.slug);
              return (
                <li key={problem.slug} className="learn-problem-row">
                  <span
                    className={confirmed ? "learn-solved" : "muted"}
                    title={
                      confirmed
                        ? "Solved"
                        : "Not observed in available solve history"
                    }
                  >
                    {confirmed ? (
                      <CheckCircle2 size={18} aria-label="Solved" />
                    ) : (
                      <Circle
                        size={18}
                        aria-label="Not observed in available history"
                      />
                    )}
                  </span>
                  <a
                    href={`https://leetcode.com/problems/${problem.slug}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span>{problem.name}</span>
                    <ExternalLink size={13} />
                  </a>
                  <DifficultyBadge difficulty={problem.difficulty} />
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {!problems.length && !tasks.length && (
        <p className="muted">No homework published.</p>
      )}
    </div>
  );
}
