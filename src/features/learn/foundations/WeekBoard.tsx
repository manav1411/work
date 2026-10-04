import type { Week } from "../../../../shared/learning";
import WeekCard from "./WeekCard";
import type { HomeworkListProps } from "./HomeworkList";

// Personal-website WeekBoard foundation with Work's shared data adapter.
export default function WeekBoard({
  weeks,
  ...progress
}: { weeks: Week[] } & Omit<HomeworkListProps, "problems" | "tasks">) {
  return (
    <div className="learn-week-board">
      {weeks.map((week) => (
        <WeekCard key={week.week} week={week} {...progress} />
      ))}
    </div>
  );
}
