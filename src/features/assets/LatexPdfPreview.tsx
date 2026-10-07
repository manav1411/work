import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button } from "../../components/ui";
import "./pdf-text-layer.css";
GlobalWorkerOptions.workerSrc = workerUrl;

function findZoomAnchor(
  container: HTMLElement,
  clientX: number,
  clientY: number,
) {
  const target = document.elementFromPoint(clientX, clientY);
  let canvas =
    target instanceof Element
      ? target.closest<HTMLElement>(".latex-pdf-sheet")?.querySelector("canvas")
      : null;
  if (!canvas) {
    canvas =
      Array.from(
        container.querySelectorAll<HTMLCanvasElement>(
          ".latex-pdf-sheet canvas",
        ),
      )
        .map((candidate) => {
          const rect = candidate.getBoundingClientRect();
          const x = Math.min(rect.right, Math.max(rect.left, clientX));
          const y = Math.min(rect.bottom, Math.max(rect.top, clientY));
          return {
            candidate,
            distance: Math.hypot(clientX - x, clientY - y),
          };
        })
        .sort((left, right) => left.distance - right.distance)[0]?.candidate ??
      null;
  }
  const page = canvas?.closest<HTMLElement>(".latex-pdf-page");
  const bounds = canvas?.getBoundingClientRect();
  if (!bounds || !page || !bounds.width || !bounds.height) return undefined;
  const containerBounds = container.getBoundingClientRect();
  const anchorX = Math.min(bounds.right, Math.max(bounds.left, clientX));
  const anchorY = Math.min(bounds.bottom, Math.max(bounds.top, clientY));
  return {
    page: Number(page.dataset.pageNumber),
    xRatio: (anchorX - bounds.left) / bounds.width,
    yRatio: (anchorY - bounds.top) / bounds.height,
    viewportX: anchorX - containerBounds.left - container.clientLeft,
    viewportY: anchorY - containerBounds.top - container.clientTop,
  };
}

function PdfPage({
  document,
  number,
  zoom = 1,
  fitWidth = 0,
  thumbnail = false,
  onPageSizeChange,
}: {
  document: PDFDocumentProxy;
  number: number;
  zoom?: number;
  fitWidth?: number;
  thumbnail?: boolean;
  onPageSizeChange?: (number: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!host.current || !thumbnail) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.floor(entries[0].contentRect.width)),
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [thumbnail]);
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
          thumbnail ? host.current.clientWidth : fitWidth,
        );
        const widthScale = availableWidth / base.width;
        const scale = thumbnail
          ? Math.max(0.08, widthScale, host.current.clientHeight / base.height)
          : Math.max(0.1, zoom);
        const viewport = page.getViewport({ scale });
        const ratio = window.devicePixelRatio || 1;
        const element = canvas.current;
        element.width = Math.floor(viewport.width * ratio);
        element.height = Math.floor(viewport.height * ratio);
        element.style.width = `${viewport.width}px`;
        element.style.height = `${viewport.height}px`;
        element.style.maxWidth = thumbnail ? "100%" : "none";
        if (!thumbnail)
          host.current.style.width = `${Math.max(availableWidth, viewport.width) + 32}px`;
        layer.current.replaceChildren();
        layer.current.style.width = `${viewport.width}px`;
        layer.current.style.height = `${viewport.height}px`;
        layer.current.style.setProperty("--scale-factor", String(scale));
        layer.current.style.setProperty("--total-scale-factor", String(scale));
        onPageSizeChange?.(number);
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
  }, [
    document,
    fitWidth,
    number,
    thumbnail,
    width,
    zoom,
    onPageSizeChange,
  ]);
  return (
    <div
      className={`latex-pdf-page${!thumbnail && zoom > 1 ? " is-zoomed" : ""}`}
      ref={host}
      data-page-number={number}
      style={
        thumbnail ? undefined : { width: `${Math.max(1, fitWidth) + 32}px` }
      }
    >
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <div
          className="latex-pdf-sheet"
          style={{ maxWidth: thumbnail ? "100%" : "none" }}
        >
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
  const [zoom, setZoom] = useState(1);
  const [fitToPage, setFitToPage] = useState(true);
  const [renderZoom, setRenderZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(0);
  const [fitHeight, setFitHeight] = useState(0);
  const [fitScale, setFitScale] = useState(0);
  const preview = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  const pages = useRef<HTMLDivElement>(null);
  const pinchStart = useRef<{ distance: number; zoom: number } | undefined>(
    undefined,
  );
  const zoomRef = useRef(zoom);
  const fitToPageRef = useRef(fitToPage);
  const renderZoomRef = useRef(renderZoom);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const zoomAnchor = useRef<
    | {
        page: number;
        xRatio: number;
        yRatio: number;
        viewportX: number;
        viewportY: number;
      }
    | undefined
  >(undefined);
  zoomRef.current = zoom;
  fitToPageRef.current = fitToPage;
  renderZoomRef.current = renderZoom;

  const updateDocumentGeometry = useCallback(() => {
    const container = preview.current;
    const spacerElement = spacer.current;
    const documentElement = pages.current;
    if (!container || !spacerElement || !documentElement) return;

    const viewportWidth = container.clientWidth;
    const viewportHeight = container.clientHeight;
    const pageWidths = Array.from(
      documentElement.querySelectorAll<HTMLElement>(".latex-pdf-page"),
      (page) => page.offsetWidth,
    );
    const baseWidth = Math.max(viewportWidth, ...pageWidths);
    const baseHeight = Math.max(1, documentElement.scrollHeight);
    const scale = zoomRef.current / renderZoomRef.current;
    const scaledWidth = baseWidth * scale;
    const scaledHeight = baseHeight * scale;
    const spacerWidth = Math.max(viewportWidth, scaledWidth);
    const spacerHeight = Math.max(viewportHeight, scaledHeight);
    const offsetX = Math.max(0, (spacerWidth - scaledWidth) / 2);
    const offsetY = Math.max(0, (spacerHeight - scaledHeight) / 2);

    spacerElement.style.width = `${spacerWidth}px`;
    spacerElement.style.height = `${spacerHeight}px`;
    documentElement.style.width = `${baseWidth}px`;
    documentElement.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  }, []);

  const restoreZoomAnchor = useCallback((pageNumber?: number) => {
    const container = preview.current;
    const anchor = zoomAnchor.current;
    if (!container || !anchor || (pageNumber && anchor.page !== pageNumber))
      return;
    const canvas = container.querySelector<HTMLCanvasElement>(
      `.latex-pdf-page[data-page-number="${anchor.page}"] canvas`,
    );
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const containerBounds = container.getBoundingClientRect();
    const currentX = bounds.left + anchor.xRatio * bounds.width;
    const currentY = bounds.top + anchor.yRatio * bounds.height;
    const targetX =
      containerBounds.left + container.clientLeft + anchor.viewportX;
    const targetY =
      containerBounds.top + container.clientTop + anchor.viewportY;
    container.scrollLeft += currentX - targetX;
    container.scrollTop += currentY - targetY;
    if (pageNumber) zoomAnchor.current = undefined;
  }, []);

  const onPageSizeChange = useCallback(
    (number: number) => {
      requestAnimationFrame(() => {
        updateDocumentGeometry();
        restoreZoomAnchor(number);
      });
    },
    [restoreZoomAnchor, updateDocumentGeometry],
  );

  const scheduleZoom = useCallback(
    (
      value: number,
      clientX: number,
      clientY: number,
      returnToFit = false,
    ) => {
      const container = preview.current;
      const next = returnToFit
        ? Math.max(0.1, value)
        : Math.min(2, Math.max(0.5, value));
      if (
        !container ||
        (next === zoomRef.current && returnToFit === fitToPageRef.current)
      )
        return;
      zoomAnchor.current = findZoomAnchor(container, clientX, clientY);
      zoomRef.current = next;
      setZoom(next);
      fitToPageRef.current = returnToFit;
      setFitToPage(returnToFit);
      requestAnimationFrame(() => {
        updateDocumentGeometry();
        restoreZoomAnchor();
      });
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        setRenderZoom(zoomRef.current);
        settleTimer.current = undefined;
      }, 180);
    },
    [restoreZoomAnchor, updateDocumentGeometry],
  );

  useEffect(() => {
    setPdf(undefined);
    setError("");
    setZoom(1);
    setFitToPage(true);
    setRenderZoom(1);
    setFitScale(0);
    zoomRef.current = 1;
    fitToPageRef.current = true;
    renderZoomRef.current = 1;
    zoomAnchor.current = undefined;
    if (settleTimer.current) clearTimeout(settleTimer.current);
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
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, [url, data]);

  useEffect(() => {
    const container = preview.current;
    if (!container || thumbnail) return;
    let observedWidth = -1;
    let observedHeight = -1;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (
        Math.abs(width - observedWidth) < 0.5 &&
        Math.abs(height - observedHeight) < 0.5
      )
        return;
      observedWidth = width;
      observedHeight = height;

      // Only refit after the viewport itself changes. Reading client dimensions
      // for every observer callback feeds scrollbar appearance back into fit scale.
      const nextWidth = Math.max(1, Math.floor(container.clientWidth - 32));
      const nextHeight = Math.max(1, Math.floor(container.clientHeight - 32));
      setFitWidth(nextWidth);
      setFitHeight(nextHeight);
      requestAnimationFrame(updateDocumentGeometry);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [thumbnail, updateDocumentGeometry]);

  useEffect(() => {
    if (!pdf || thumbnail || !fitWidth || !fitHeight) return;
    let active = true;
    void pdf
      .getPage(1)
      .then((page) => {
        if (!active) return;
        const viewport = page.getViewport({ scale: 1 });
        setFitScale(
          Math.max(
            0.1,
            Math.min(fitWidth / viewport.width, fitHeight / viewport.height),
          ),
        );
      })
      .catch((failure) => {
        if (active) setError(String(failure));
      });
    return () => {
      active = false;
    };
  }, [fitHeight, fitWidth, pdf, thumbnail]);

  useEffect(() => {
    if (!pdf || thumbnail || !fitToPage || !fitScale) return;
    zoomRef.current = fitScale;
    renderZoomRef.current = fitScale;
    setZoom(fitScale);
    setRenderZoom(fitScale);
    requestAnimationFrame(updateDocumentGeometry);
  }, [fitScale, fitToPage, pdf, thumbnail, updateDocumentGeometry]);

  useEffect(() => {
    const container = preview.current;
    if (!container || thumbnail) return;
    const touchDistance = (touches: TouchList) => {
      const x = touches[0].clientX - touches[1].clientX;
      const y = touches[0].clientY - touches[1].clientY;
      return Math.hypot(x, y);
    };
    const handleWheel = (event: WheelEvent) => {
      // Trackpad pinch gestures are exposed as a Ctrl/Meta wheel event by browsers.
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.cancelable) event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.006);
      scheduleZoom(zoomRef.current * factor, event.clientX, event.clientY);
    };
    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length < 2) return;
      const distance = touchDistance(event.touches);
      if (!distance) return;
      pinchStart.current = {
        distance,
        zoom: zoomRef.current,
      };
    };
    const handleTouchMove = (event: TouchEvent) => {
      const initial = pinchStart.current;
      if (!initial || event.touches.length < 2) return;
      const distance = touchDistance(event.touches);
      if (!initial.distance || !distance) return;
      if (event.cancelable) event.preventDefault();
      const centerX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
      const centerY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
      const next = Math.min(
        2,
        Math.max(
          0.5,
          initial.zoom * Math.pow(distance / initial.distance, 1.2),
        ),
      );
      scheduleZoom(next, centerX, centerY);
    };
    const handleTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinchStart.current = undefined;
    };
    container.addEventListener("wheel", handleWheel, { passive: false });
    container.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    container.addEventListener("touchmove", handleTouchMove, {
      passive: false,
    });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });
    container.addEventListener("touchcancel", handleTouchEnd, {
      passive: true,
    });
    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchEnd);
      pinchStart.current = undefined;
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, [thumbnail, scheduleZoom]);

  const zoomByStep = (direction: -1 | 1) => {
    const centerX =
      (preview.current?.getBoundingClientRect().left ?? 0) +
      (preview.current?.clientWidth ?? 0) / 2;
    const centerY =
      (preview.current?.getBoundingClientRect().top ?? 0) +
      (preview.current?.clientHeight ?? 0) / 2;
    const next =
      Math.round((zoomRef.current + direction * 0.25) * 100) / 100;
    scheduleZoom(next, centerX, centerY);
  };

  const fitPage = () => {
    const container = preview.current;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    scheduleZoom(
      fitScale,
      bounds.left + container.clientWidth / 2,
      bounds.top + container.clientHeight / 2,
      true,
    );
  };

  useEffect(() => {
    requestAnimationFrame(updateDocumentGeometry);
  }, [pdf, fitWidth, fitScale, updateDocumentGeometry]);

  return (
    <div
      ref={preview}
      className={`latex-pdf-preview${thumbnail ? " latex-pdf-thumbnail" : ""}`}
      aria-label={
        thumbnail
          ? undefined
          : "PDF preview. Scroll to navigate, or pinch or Control-scroll to zoom."
      }
    >
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : pdf && (thumbnail || fitScale > 0) ? (
        <>
          {!thumbnail && (
            <div className="latex-pdf-zoom-dock">
              <div
                className="latex-pdf-zoom-controls"
                aria-label="PDF zoom controls"
              >
                <Button
                  variant="ghost"
                  className="icon-button"
                  aria-label="Zoom out"
                  title="Zoom out"
                  disabled={zoomRef.current <= 0.5}
                  onClick={() => zoomByStep(-1)}
                >
                  <Minus size={16} />
                </Button>
                <output aria-live="polite">
                  {fitToPage ? "Fit" : `${Math.round(zoom * 100)}%`}
                </output>
                <Button
                  variant="ghost"
                  className="icon-button"
                  aria-label="Zoom in"
                  title="Zoom in"
                  disabled={zoomRef.current >= 2}
                  onClick={() => zoomByStep(1)}
                >
                  <Plus size={16} />
                </Button>
                <Button
                  variant="ghost"
                  className="icon-button pdf-zoom-fit"
                  aria-label="Fit to page"
                  title="Fit to page"
                  disabled={fitToPage}
                  onClick={fitPage}
                >
                  <RotateCcw size={15} />
                </Button>
              </div>
            </div>
          )}
          <div className="latex-pdf-document-spacer" ref={spacer}>
            <div className="latex-pdf-document" ref={pages}>
              {Array.from(
                {
                  length: firstPageOnly
                    ? Math.min(1, pdf.numPages)
                    : pdf.numPages,
                },
                (_, index) => (
                  <PdfPage
                    key={`${url || "data"}-${index}`}
                    document={pdf}
                    number={index + 1}
                    zoom={thumbnail ? 1 : renderZoom}
                    fitWidth={thumbnail ? 0 : fitWidth}
                    thumbnail={thumbnail}
                    onPageSizeChange={thumbnail ? undefined : onPageSizeChange}
                  />
                ),
              )}
            </div>
          </div>
        </>
      ) : (
        <p role="status">{pdf ? "Preparing PDF…" : "Loading PDF…"}</p>
      )}
    </div>
  );
}
