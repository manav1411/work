import { EMPTY_GOAL, newGoal, type Goal } from "../../shared/goals";
import { addDays, localDate } from "../../shared/model";

export function demoGoals(): Goal[] {
  const today = localDate();
  return [
    newGoal({
      ...EMPTY_GOAL,
      title: "Complete the DSA curriculum",
      measure: "curriculum",
      target: 12,
      unit: "tasks",
      startDate: addDays(today, -14),
      targetDate: addDays(today, 35),
      value: 3,
    }),
    newGoal({
      ...EMPTY_GOAL,
      title: "Finish portfolio project",
      measure: "milestones",
      targetDate: addDays(today, 21),
      startDate: addDays(today, -7),
      milestones: [
        {
          id: crypto.randomUUID(),
          title: "Prototype",
          date: addDays(today, -3),
          done: true,
          completedAt: new Date().toISOString(),
        },
        {
          id: crypto.randomUUID(),
          title: "Release",
          date: addDays(today, 21),
          done: false,
          completedAt: null,
        },
      ],
    }),
  ];
}
