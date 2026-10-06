import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./pdf-text-layer.css";
GlobalWorkerOptions.workerSrc = workerUrl;

function PdfPage({
  document,
  number,
  thumbnail = false,
}: {
  document: PDFDocumentProxy;
  number: number;
  thumbnail?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.floor(entries[0].contentRect.width)),
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    let cancel: (() => void) | undefined;
    void document
      .getPage(number)
      .then(async (page) => {
        if (!active || !canvas.current || !host.current || !layer.current)
          return;
        const base = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(
          1,
          host.current.clientWidth - (thumbnail ? 0 : 16),
        );
        const widthScale = availableWidth / base.width;
        const scale = thumbnail
          ? Math.max(0.08, widthScale, host.current.clientHeight / base.height)
          : Math.min(1.5, Math.max(0.3, widthScale));
        const viewport = page.getViewport({ scale });
        const ratio = window.devicePixelRatio || 1;
        const element = canvas.current;
        element.width = Math.floor(viewport.width * ratio);
        element.height = Math.floor(viewport.height * ratio);
        element.style.width = `${viewport.width}px`;
        element.style.height = `${viewport.height}px`;
        layer.current.replaceChildren();
        layer.current.style.width = `${viewport.width}px`;
        layer.current.style.height = `${viewport.height}px`;
        layer.current.style.setProperty("--scale-factor", String(scale));
        layer.current.style.setProperty("--total-scale-factor", String(scale));
        const render = page.render({
          canvas: element,
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        const textLayer: { current?: TextLayer } = {};
        cancel = () => {
          render.cancel();
          textLayer.current?.cancel();
        };
        const textContent = await page.getTextContent();
        if (!active) return;
        const text = new TextLayer({
          textContentSource: textContent,
          container: layer.current,
          viewport,
        });
        textLayer.current = text;
        cancel = () => {
          render.cancel();
          textLayer.current?.cancel();
        };
        await Promise.all([render.promise, text.render()]);
      })
      .catch((failure) => {
        if (active) setError(String(failure));
      });
    return () => {
      active = false;
      cancel?.();
    };
  }, [document, number, thumbnail, width]);
  return (
    <div className="latex-pdf-page" ref={host}>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <div className="latex-pdf-sheet">
          <canvas key={width} ref={canvas} aria-label={`PDF page ${number}`} />
          <div ref={layer} className="textLayer" />
        </div>
      )}
    </div>
  );
}

export default function LatexPdfPreview({
  url,
  data,
  firstPageOnly = false,
  thumbnail = false,
}: {
  url?: string;
  data?: Uint8Array;
  firstPageOnly?: boolean;
  thumbnail?: boolean;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [error, setError] = useState("");
  useEffect(() => {
    setPdf(undefined);
    setError("");
    const task = data
      ? getDocument({ data: data.slice() })
      : getDocument({ url: url || "", withCredentials: true });
    let active = true;
    void task.promise
      .then((value) => {
        if (active) setPdf(value);
      })
      .catch((failure) => {
        if (active) setError(String(failure));
      });
    return () => {
      active = false;
      void task.destroy();
    };
  }, [url, data]);
  return (
    <div
      className={`latex-pdf-preview${thumbnail ? " latex-pdf-thumbnail" : ""}`}
    >
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : pdf ? (
        Array.from(
          { length: firstPageOnly ? Math.min(1, pdf.numPages) : pdf.numPages },
          (_, index) => (
            <PdfPage
              key={`${url || "data"}-${index}`}
              document={pdf}
              number={index + 1}
              thumbnail={thumbnail}
            />
          ),
        )
      ) : (
        <p role="status">Loading PDF…</p>
      )}
    </div>
  );
}
