import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
GlobalWorkerOptions.workerSrc = workerUrl;

function PdfPage({
  document,
  number,
}: {
  document: PDFDocumentProxy;
  number: number;
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
        const scale = Math.min(
          1.5,
          Math.max(0.3, (host.current.clientWidth - 16) / base.width),
        );
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
        const text = new TextLayer({
          textContentSource: await page.getTextContent(),
          container: layer.current,
          viewport,
        });
        cancel = () => {
          render.cancel();
          text.cancel();
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
  }, [document, number, width]);
  return (
    <div className="latex-pdf-page" ref={host}>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <div className="latex-pdf-sheet">
          <canvas ref={canvas} aria-label={`PDF page ${number}`} />
          <div ref={layer} className="textLayer" />
        </div>
      )}
    </div>
  );
}

export default function LatexPdfPreview({ url }: { url: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [error, setError] = useState("");
  useEffect(() => {
    setPdf(undefined);
    setError("");
    const task = getDocument({ url, withCredentials: true });
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
  }, [url]);
  return (
    <div className="latex-pdf-preview">
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : pdf ? (
        Array.from({ length: pdf.numPages }, (_, index) => (
          <PdfPage key={index} document={pdf} number={index + 1} />
        ))
      ) : (
        <p role="status">Loading PDF…</p>
      )}
    </div>
  );
}
