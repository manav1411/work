import { useEffect, useState } from "react";
import { ClipboardList, LockKeyhole, Presentation } from "lucide-react";
import type { Week } from "../../../../shared/learning";
import { Button } from "../../../components/ui";
import LearnModal from "./LearnModal";
import HomeworkList, { type HomeworkListProps } from "./HomeworkList";
import SlideDeck from "./SlideDeck";
import { Pomodoro } from "../Pomodoro";

// Adapted from Personal-website's WeekCard: authored accessibility, topic jump,
// fullscreen slides, homework and shared checklists retain the same meaning.
export default function WeekCard({
  week,
  ...progress
}: { week: Week } & Omit<HomeworkListProps, "problems" | "tasks">) {
  const [modal, setModal] = useState<
    null | { kind: "slides"; startIndex: number } | { kind: "homework" }
  >(null);
  const locked = !week.accessible;
  const problems = [
    ...new Map(
      week.topics
        .flatMap((topic) => topic.homework)
        .map((problem) => [problem.slug, problem]),
    ).values(),
  ];
  useEffect(() => {
    if (modal?.kind !== "slides") return;
    const changed = () => {
      if (!document.fullscreenElement) setModal(null);
    };
    document.addEventListener("fullscreenchange", changed);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
    };
  }, [modal]);
  const openSlides = (startIndex: number) => {
    if (locked) return;
    setModal({ kind: "slides", startIndex });
    // Fullscreen is optional; the viewport dialog is retained when unsupported.
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  const closeSlides = () => {
    setModal(null);
    if (document.fullscreenElement)
      document.exitFullscreen?.().catch(() => undefined);
  };
  return (
    <article
      className={`learn-week-card learn-week-tone-${(week.week - 1) % 4} ${locked ? "learn-week-locked" : ""}`}
    >
      <div className="learn-week-number">
        <span>Week {week.week.toString().padStart(2, "0")}</span>
        {locked && <LockKeyhole size={14} aria-label="Not published" />}
      </div>
      <h3>{week.title}</h3>
      {progress.personalised &&
        (problems.length > 0 || Boolean(week.tasks?.length)) && (
          <div className="learn-week-progress">
            {problems.length > 0 && (
              <span>
                {
                  problems.filter((problem) =>
                    progress.solvedSlugs.has(problem.slug),
                  ).length
                }
                /{problems.length}
              </span>
            )}
            {!!week.tasks?.length && (
              <span>
                {
                  week.tasks.filter((task) => progress.taskProgress?.[task.id])
                    .length
                }
                /{week.tasks.length} tasks
              </span>
            )}
          </div>
        )}
      <div className="learn-week-actions">
        <Button
          variant="secondary"
          disabled={locked || !week.slides.length}
          onClick={() => openSlides(0)}
        >
          <Presentation size={15} />
          Slides
        </Button>
        <Button
          variant="secondary"
          disabled={locked}
          onClick={() => setModal({ kind: "homework" })}
        >
          <ClipboardList size={15} />
          Homework
        </Button>
      </div>
      <LearnModal
        open={modal?.kind === "slides"}
        onClose={closeSlides}
        title={`Week ${week.week} · ${week.title}`}
        fullscreen
      >
        <div className="learn-topic-jumps">
          <Button
            variant="ghost"
            onClick={() => setModal({ kind: "slides", startIndex: 0 })}
          >
            Topic 1
          </Button>
          {week.topic2SlideStart > 0 &&
            week.topic2SlideStart < week.slides.length && (
              <Button
                variant="ghost"
                onClick={() =>
                  setModal({
                    kind: "slides",
                    startIndex: week.topic2SlideStart,
                  })
                }
              >
                Topic 2
              </Button>
            )}
        </div>
        {modal?.kind === "slides" && (
          <SlideDeck
            key={modal.startIndex}
            slides={week.slides}
            initialIndex={modal.startIndex}
          />
        )}
      </LearnModal>
      <LearnModal
        open={modal?.kind === "homework"}
        onClose={() => setModal(null)}
        title={`Week ${week.week} · Homework`}
      >
        {!!week.tasks?.length && (
          <HomeworkList problems={[]} tasks={week.tasks} {...progress} />
        )}
        {week.topics.map((topic, index) => (
          <section key={index} className="learn-homework-topic">
            <h3>Topic {index + 1}</h3>
            <HomeworkList problems={topic.homework} {...progress} />
          </section>
        ))}
        <div className="learn-homework-timer">
          <Pomodoro />
        </div>
      </LearnModal>
    </article>
  );
}
