import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ChevronDown, X } from "lucide-react";
import { Button } from "../../../components/ui";
import ProblemList from "./ProblemList";
import {
  roadmapEdges,
  roadmapTopics,
  roadmapTotalProblems,
} from "../../../content/problems";

// Adapted from Personal-website's Roadmap: grid positions, measured curved
// edges, clamped problem popovers and the mobile accordion are retained.
const POPOVER_WIDTH = 310;
const POPOVER_GAP = 12;
const EDGE_MARGIN = 8;
interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}
interface Line {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
interface Props {
  solved: Set<string>;
  personalised: boolean;
  initialTopic?: string;
}
export function topicSolveFraction(
  slugs: string[],
  solved: Set<string>,
): number {
  const unique = [...new Set(slugs)];
  return unique.length
    ? unique.filter((slug) => solved.has(slug)).length / unique.length
    : 0;
}

function RoadmapGraph({
  solved,
  personalised,
  selected,
  toggle,
}: Props & { selected: string | null; toggle: (id: string) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const popRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [rects, setRects] = useState<Record<string, Rect>>({});
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [popHeight, setPopHeight] = useState(0);
  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const bounds = wrap.getBoundingClientRect();
    setSize({ w: wrap.clientWidth, h: wrap.clientHeight });
    const next: Record<string, Rect> = {};
    for (const topic of roadmapTopics) {
      const node = nodeRefs.current[topic.id];
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      next[topic.id] = {
        left: rect.left - bounds.left,
        top: rect.top - bounds.top,
        right: rect.right - bounds.left,
        bottom: rect.bottom - bounds.top,
        width: rect.width,
        height: rect.height,
      };
    }
    setRects(next);
    setLines(
      roadmapEdges.flatMap(([from, to]) => {
        const a = next[from];
        const b = next[to];
        return a && b
          ? [
              {
                id: `${from}-${to}`,
                x1: a.left + a.width / 2,
                y1: a.bottom,
                x2: b.left + b.width / 2,
                y2: b.top,
              },
            ]
          : [];
      }),
    );
  }, []);
  useLayoutEffect(() => {
    measure();
    if (!wrapRef.current) return;
    const observer = new ResizeObserver(measure);
    observer.observe(wrapRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);
  useLayoutEffect(() => {
    setPopHeight(popRef.current?.offsetHeight ?? 0);
  }, [selected, rects]);
  const topic = roadmapTopics.find((item) => item.id === selected);
  const selectedRect = selected ? rects[selected] : null;
  const popStyle = useMemo<CSSProperties | undefined>(() => {
    if (!selectedRect) return;
    const openRight =
      size.w - selectedRect.right >= POPOVER_WIDTH + POPOVER_GAP;
    const left = openRight
      ? Math.min(
          selectedRect.right + POPOVER_GAP,
          size.w - POPOVER_WIDTH - EDGE_MARGIN,
        )
      : Math.max(EDGE_MARGIN, selectedRect.left - POPOVER_GAP - POPOVER_WIDTH);
    const top = Math.max(
      EDGE_MARGIN,
      Math.min(
        selectedRect.top,
        Math.max(EDGE_MARGIN, size.h - popHeight - EDGE_MARGIN),
      ),
    );
    return { width: POPOVER_WIDTH, left, top };
  }, [selectedRect, size, popHeight]);
  return (
    <div ref={wrapRef} className="learn-roadmap-graph">
      <svg
        className="learn-roadmap-edges"
        width={size.w}
        height={size.h}
        aria-hidden="true"
      >
        <defs>
          <marker
            id="learn-roadmap-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 9 5 L 0 9 z" />
          </marker>
        </defs>
        {lines.map((line) => {
          const middle = (line.y1 + line.y2) / 2;
          return (
            <path
              key={line.id}
              d={`M ${line.x1} ${line.y1} C ${line.x1} ${middle}, ${line.x2} ${middle}, ${line.x2} ${line.y2}`}
              fill="none"
              strokeWidth={2}
              markerEnd="url(#learn-roadmap-arrow)"
            />
          );
        })}
      </svg>
      <div className="learn-roadmap-grid">
        {roadmapTopics.map((item, index) => (
          <button
            key={item.id}
            ref={(node) => {
              nodeRefs.current[item.id] = node;
            }}
            style={
              {
                gridColumn: item.col,
                gridRow: item.row,
                "--solved-fill": `${
                  personalised
                    ? topicSolveFraction(
                        item.problems.map((problem) => problem.slug),
                        solved,
                      ) * 100
                    : 0
                }%`,
              } as CSSProperties
            }
            className={`learn-roadmap-node learn-roadmap-tone-${index % 4} ${selected === item.id ? "learn-roadmap-selected" : ""}`}
            aria-expanded={selected === item.id}
            aria-controls={
              selected === item.id ? `learn-roadmap-pop-${item.id}` : undefined
            }
            onClick={() => toggle(item.id)}
          >
            <strong>{item.label}</strong>
            <span>
              {personalised
                ? `${item.problems.filter((problem) => solved.has(problem.slug)).length}/${item.problems.length}`
                : `${item.problems.length} problems`}
            </span>
          </button>
        ))}
      </div>
      {topic && popStyle && (
        <div
          id={`learn-roadmap-pop-${topic.id}`}
          ref={popRef}
          className={`learn-roadmap-popover learn-roadmap-tone-${roadmapTopics.indexOf(topic) % 4}`}
          style={popStyle}
        >
          <header>
            <h3>{topic.label}</h3>
            <Button
              variant="ghost"
              className="icon-button"
              aria-label="Close topic"
              onClick={() => toggle(topic.id)}
            >
              <X size={17} />
            </Button>
          </header>
          <div className="learn-roadmap-popover-scroll">
            <ProblemList
              problems={topic.problems}
              solvedSlugs={solved}
              personalised={personalised}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function Roadmap({ solved, personalised, initialTopic }: Props) {
  const [selected, setSelected] = useState<string | null>(initialTopic ?? null);
  useEffect(() => {
    if (initialTopic) setSelected(initialTopic);
  }, [initialTopic]);
  useEffect(() => {
    if (!selected) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
    };
  }, [selected]);
  const toggle = useCallback(
    (id: string) => setSelected((current) => (current === id ? null : id)),
    [],
  );
  const ordered = useMemo(
    () => [...roadmapTopics].sort((a, b) => a.row - b.row || a.col - b.col),
    [],
  );
  const solvedCount = roadmapTopics
    .flatMap((topic) => topic.problems)
    .filter((problem) => solved.has(problem.slug)).length;
  return (
    <section className="learn-roadmap">
      <header className="learn-roadmap-heading">
        <h2>Roadmap</h2>
        {personalised && (
          <span>
            {solvedCount}/{roadmapTotalProblems}
          </span>
        )}
      </header>
      <RoadmapGraph
        solved={solved}
        personalised={personalised}
        selected={selected}
        toggle={toggle}
      />
      <div className="learn-roadmap-list">
        {ordered.map((topic) => (
          <section key={topic.id}>
            <button
              className={`learn-roadmap-list-trigger learn-roadmap-tone-${roadmapTopics.indexOf(topic) % 4}`}
              style={
                {
                  "--solved-fill": `${
                    personalised
                      ? topicSolveFraction(
                          topic.problems.map((problem) => problem.slug),
                          solved,
                        ) * 100
                      : 0
                  }%`,
                } as CSSProperties
              }
              onClick={() => toggle(topic.id)}
              aria-expanded={selected === topic.id}
              aria-controls={`learn-roadmap-list-${topic.id}`}
            >
              <strong>{topic.label}</strong>
              <span>
                {personalised
                  ? `${topic.problems.filter((problem) => solved.has(problem.slug)).length}/${topic.problems.length}`
                  : topic.problems.length}
                <ChevronDown size={16} />
              </span>
            </button>
            {selected === topic.id && (
              <div id={`learn-roadmap-list-${topic.id}`}>
                <ProblemList
                  problems={topic.problems}
                  solvedSlugs={solved}
                  personalised={personalised}
                />
              </div>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}
