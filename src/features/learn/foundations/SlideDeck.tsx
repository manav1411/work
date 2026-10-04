import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Slide } from "../../../../shared/learning";
import { Button } from "../../../components/ui";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Adapted from Personal-website's SlideDeck. Keep the authored Markdown as data,
// never executable JSX/HTML; keyboard paging and topic jumps match the source.
export default function SlideDeck({
  slides,
  initialIndex = 0,
}: {
  slides: Slide[];
  initialIndex?: number;
}) {
  const count = slides.length;
  const start = count
    ? Math.min(Math.max(Math.floor(initialIndex), 0), count - 1)
    : 0;
  const [index, setIndex] = useState(start);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setIndex(start);
  }, [start]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [index]);
  const go = useCallback(
    (delta: number) =>
      setIndex((current) => Math.min(Math.max(current + delta, 0), count - 1)),
    [count],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches("input, textarea, select"))
        return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        go(1);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);
  if (!count) return <p className="muted">No slides published.</p>;
  // The source also contains legacy heading tags; translate only simple title
  // wrappers so headings render while raw authored HTML remains inert.
  const content = slides[index].content.replace(
    /<h([1-6])(?:\s[^>]*)?>([^<]*)<\/h\1>/gi,
    (_match, level: string, title: string) =>
      `${"#".repeat(Number(level))} ${title}`,
  );
  return (
    <div className="learn-slide-deck">
      <div ref={scrollRef} className="learn-slide-scroll">
        <div className="markdown learn-slide-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ children, ...props }) => (
                <a {...props} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
      <footer>
        <Button
          variant="secondary"
          onClick={() => go(-1)}
          disabled={index === 0}
        >
          <ChevronLeft size={17} />
          Previous
        </Button>
        <span aria-live="polite">
          {index + 1} / {count}
        </span>
        <Button
          variant="secondary"
          onClick={() => go(1)}
          disabled={index === count - 1}
        >
          Next
          <ChevronRight size={17} />
        </Button>
      </footer>
    </div>
  );
}
