import { useEffect, useRef, type RefObject } from "react";
import type Matter from "matter-js";

type Tile = { x: number; y: number; width: number; height: number };
type Logo = { body: Matter.Body; origin: Matter.Vector; slot: number };

// Use the same painted pixels for display and physics. Greedy rectangles cover
// only ink (including the arrow), leaving letter counters and gaps empty.
function logoSprite(size: number, ink: string, arrow: string) {
  const source = document.createElement("canvas");
  source.width = 440;
  source.height = 160;
  const context = source.getContext("2d", { willReadFrequently: true })!;
  context.scale(2, 2);
  context.font = `750 ${size}px "Space Grotesk Variable"`;
  context.letterSpacing = `${-size * 0.08}px`;
  context.fillStyle = ink;
  const text = context.measureText("work");
  context.fillText("work", 4, 5 + text.actualBoundingBoxAscent);
  const word = document.createElement("canvas");
  word.width = source.width;
  word.height = source.height;
  word.getContext("2d")!.drawImage(source, 0, 0);
  const arrowSize = size * 0.78;
  context.save();
  context.translate(text.width + 7, 3);
  context.scale(arrowSize / 24, arrowSize / 24);
  context.beginPath();
  context.moveTo(5, 23);
  context.lineTo(20, 5);
  context.moveTo(12.5, 5);
  context.lineTo(20, 5);
  context.lineTo(20, 12.5);
  context.strokeStyle = arrow;
  context.lineWidth = 1.9;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke();
  context.restore();

  const pixels = context.getImageData(0, 0, source.width, source.height);
  let left = source.width;
  let top = source.height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      if (pixels.data[(y * source.width + x) * 4 + 3] < 100) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  const sprite = document.createElement("canvas");
  sprite.width = right - left + 3;
  sprite.height = bottom - top + 3;
  const paint = sprite.getContext("2d", { willReadFrequently: true })!;
  paint.drawImage(source, -left + 1, -top + 1);
  const width = sprite.width / 2;
  const height = sprite.height / 2;
  const alpha = paint.getImageData(0, 0, sprite.width, sprite.height).data;
  const cell = 2;
  const columns = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const mask = new Uint8Array(columns * rows);
  for (let y = 0; y < sprite.height; y++) {
    for (let x = 0; x < sprite.width; x++) {
      if (alpha[(y * sprite.width + x) * 4 + 3] >= 100) {
        mask[Math.floor(y / 4) * columns + Math.floor(x / 4)] = 1;
      }
    }
  }
  const tiles: Tile[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      if (!mask[y * columns + x]) continue;
      let w = 1;
      while (x + w < columns && mask[y * columns + x + w]) w++;
      let h = 1;
      while (
        y + h < rows &&
        Array.from(
          { length: w },
          (_, dx) => mask[(y + h) * columns + x + dx],
        ).every(Boolean)
      )
        h++;
      for (let dy = 0; dy < h; dy++) {
        mask.fill(0, (y + dy) * columns + x, (y + dy) * columns + x + w);
      }
      tiles.push({
        x: x * cell,
        y: y * cell,
        width: w * cell,
        height: h * cell,
      });
    }
  }
  // Keep the arrow separate when painting so its colour can animate without
  // rebuilding the collision mesh or rasterising the word every frame.
  paint.clearRect(0, 0, sprite.width, sprite.height);
  paint.drawImage(word, -left + 1, -top + 1);
  return {
    sprite,
    width,
    height,
    tiles,
    arrowX: text.width + 7 + (1 - left) / 2,
    arrowY: 3 + (1 - top) / 2,
    arrowScale: arrowSize / 24,
  };
}

export function AuthLogoPlayground({
  obstacle,
}: {
  obstacle: RefObject<HTMLElement | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const card = obstacle.current;
    if (!canvas || !card) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let cancelled = false;
    let dispose = () => {};

    async function start() {
      const [{ default: physics }] = await Promise.all([
        import("matter-js"),
        document.fonts.load('750 52px "Space Grotesk Variable"'),
      ]);
      if (cancelled) return;
      const {
        Bodies,
        Body,
        Composite,
        Constraint,
        Engine,
        Query,
        Sleeping,
        Vector,
      } = physics;
      const engine = Engine.create({
        enableSleeping: true,
        positionIterations: 8,
        velocityIterations: 6,
      });
      engine.gravity.y = 1.1;
      const style = getComputedStyle(card!);
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const palette = ["--blue", "--pink", "--lime", "--aqua"].map((name) => {
        const value = style.getPropertyValue(name).trim().slice(1);
        return [0, 2, 4].map((offset) =>
          parseInt(value.slice(offset, offset + 2), 16),
        );
      });
      const durationSetting = Number(
        new URLSearchParams(location.search).get("arrow-colour-change-page") ||
          3,
      );
      const cycle =
        (Number.isFinite(durationSetting) && durationSetting > 0
          ? Math.min(60, Math.max(0.5, durationSetting))
          : 3) * 4000;
      let art: ReturnType<typeof logoSprite>;
      const logos: Logo[] = [];
      let walls: Matter.Body[] = [];
      let block: Matter.Body;
      let width = 0;
      let height = 0;
      let frame = 0;
      let previous = 0;
      let lastPaint = 0;
      let pointer: {
        id: number;
        joint: Matter.Constraint;
        target: Matter.Vector;
      } | null = null;

      function keepInside(body: Matter.Body) {
        // Engine bounds include predicted velocity. Clamping those each step
        // fights the floor solver and keeps resting letters jittering forever.
        const bounds = physics.Bounds.create(body.vertices);
        const dx =
          bounds.min.x < -1
            ? -bounds.min.x
            : bounds.max.x > width + 1
              ? width - bounds.max.x
              : 0;
        const dy =
          bounds.min.y < -1
            ? -bounds.min.y
            : bounds.max.y > height + 1
              ? height - bounds.max.y
              : 0;
        if (dx || dy) {
          Body.translate(body, { x: dx, y: dy });
          Body.setVelocity(body, {
            x: dx ? 0 : body.velocity.x,
            y: dy ? 0 : body.velocity.y,
          });
        }
      }
      function release() {
        if (!pointer) return;
        Composite.remove(engine.world, pointer.joint);
        const id = pointer.id;
        pointer = null;
        if (canvas!.hasPointerCapture(id)) canvas!.releasePointerCapture(id);
        canvas!.style.cursor = "default";
      }
      function place(logo: Logo, settled = false) {
        const rect = card!.getBoundingClientRect();
        const left = logo.slot < 5;
        const top = logo.slot === 9;
        const lane = left ? rect.left : width - rect.right;
        const vertical = !top && lane < art.width + 18;
        const row = left ? logo.slot : logo.slot - 5;
        const count = left ? 5 : 4;
        for (let attempt = 0; attempt < 70; attempt++) {
          const angle = top
            ? 0
            : vertical
              ? ((left ? -1 : 1) * Math.PI) / 2 + (Math.random() - 0.5) * 0.06
              : (Math.random() - 0.5) * Math.PI * 2;
          Body.setAngle(logo.body, angle);
          const bounds = physics.Bounds.create(logo.body.vertices);
          const halfWidth = (bounds.max.x - bounds.min.x) / 2;
          const halfHeight = (bounds.max.y - bounds.min.y) / 2;
          let x: number;
          let y: number;
          if (top) {
            x = rect.left + art.width / 2 + 16;
            y =
              rect.top -
              halfHeight -
              (settled
                ? 2
                : Math.min(55, Math.max(6, rect.top - art.height - 8)));
          } else {
            // Spread each side across its whole available width, then vary
            // height and rotation independently. All ten still start together.
            const fraction = vertical
              ? Math.random()
              : (row + 0.15 + Math.random() * 0.7) / count;
            x =
              (left ? 0 : rect.right) +
              halfWidth +
              3 +
              Math.max(0, lane - halfWidth * 2 - 6) * fraction;
            const spacing = Math.min(
              halfHeight * 2 + 8,
              (height - halfHeight * 2 - 12) / (count - 1),
            );
            y = settled
              ? height - halfHeight - row * spacing - 3
              : vertical
                ? halfHeight + 6 + row * spacing
                : halfHeight +
                  8 +
                  Math.random() *
                    Math.max(0, height * 0.58 - halfHeight * 2 - 16);
          }
          Body.translate(logo.body, {
            x: x - (bounds.min.x + bounds.max.x) / 2,
            y: y - (bounds.min.y + bounds.max.y) / 2,
          });
          Body.setVelocity(logo.body, { x: 0, y: 0 });
          Body.setAngularVelocity(
            logo.body,
            !top && !vertical && !settled ? (Math.random() - 0.5) * 0.012 : 0,
          );
          keepInside(logo.body);
          const others = logos
            .filter((other) => other !== logo)
            .map((other) => other.body);
          if (
            !top &&
            attempt < 69 &&
            Query.collides(logo.body, [block, ...others]).length
          )
            continue;
          Sleeping.set(logo.body, reduced);
          return;
        }
      }
      function resize() {
        const changed =
          width !== canvas!.clientWidth || height !== canvas!.clientHeight;
        width = canvas!.clientWidth;
        height = canvas!.clientHeight;
        const ratio = Math.min(devicePixelRatio || 1, 2);
        canvas!.width = Math.round(width * ratio);
        canvas!.height = Math.round(height * ratio);
        context!.setTransform(ratio, 0, 0, ratio, 0, 0);
        release();
        walls.forEach((body) => Composite.remove(engine.world, body));
        if (block) Composite.remove(engine.world, block);
        walls = [
          Bodies.rectangle(width / 2, height + 40, width + 160, 80, {
            isStatic: true,
          }),
          Bodies.rectangle(width / 2, -40, width + 160, 80, { isStatic: true }),
          Bodies.rectangle(-40, height / 2, 80, height + 160, {
            isStatic: true,
          }),
          Bodies.rectangle(width + 40, height / 2, 80, height + 160, {
            isStatic: true,
          }),
        ];
        const rect = card!.getBoundingClientRect();
        block = Bodies.rectangle(
          rect.x + rect.width / 2 + 3,
          rect.y + rect.height / 2 + 3,
          rect.width + 8,
          rect.height + 8,
          { isStatic: true, chamfer: { radius: 16 } },
        );
        Composite.add(engine.world, [...walls, block]);
        if (changed || !logos.length) {
          logos.forEach((logo) => Composite.remove(engine.world, logo.body));
          logos.length = 0;
          // Turn logos upright in narrow side lanes. Their size adapts to the
          // available lane, keeping all ten outside the card on small screens.
          const lane = Math.min(rect.left, width - rect.right);
          const size = Math.min(58, Math.max(16, (lane - 10) / 0.85));
          art = logoSprite(
            size,
            style.getPropertyValue("--ink").trim(),
            style.getPropertyValue("--blue").trim(),
          );
          for (let slot = 0; slot < 10; slot++) {
            const parts = art.tiles.map((tile) =>
              Bodies.rectangle(
                tile.x + tile.width / 2,
                tile.y + tile.height / 2,
                tile.width,
                tile.height,
              ),
            );
            const body = Body.create({
              parts,
              friction: 0.6,
              frictionStatic: 1,
              frictionAir: 0.02,
              restitution: 0,
              sleepThreshold: 24,
              slop: 0.2,
            });
            const logo = { body, origin: { ...body.position }, slot };
            if (slot === 9) Body.setInertia(body, Infinity);
            else Body.setInertia(body, body.inertia * 1.6);
            place(logo, reduced);
            Composite.add(engine.world, body);
            logos.push(logo);
          }
        } else {
          for (const logo of logos) {
            keepInside(logo.body);
            if (Query.collides(logo.body, [block]).length) place(logo, reduced);
          }
        }
        canvas!.dataset.logoCount = String(logos.length);
        previous = 0;
        lastPaint = 0;
      }
      function hit(point: Matter.Vector) {
        return Query.point(logos.map((logo) => logo.body).reverse(), point)[0];
      }
      function move(event: PointerEvent) {
        const point = { x: event.clientX, y: event.clientY };
        if (pointer && event.pointerId === pointer.id) pointer.target = point;
        else if (!pointer)
          canvas!.style.cursor = hit(point) ? "grab" : "default";
      }
      function down(event: PointerEvent) {
        if (pointer || event.button !== 0) return;
        const point = { x: event.clientX, y: event.clientY };
        const body = hit(point);
        if (!body) return;
        event.preventDefault();
        Sleeping.set(body, false);
        const joint = Constraint.create({
          pointA: point,
          bodyB: body,
          pointB: Vector.sub(point, body.position),
          stiffness: 0.14,
          damping: 0.2,
          length: 0,
        });
        Composite.add(engine.world, joint);
        pointer = { id: event.pointerId, joint, target: point };
        canvas!.setPointerCapture(event.pointerId);
        canvas!.style.cursor = "grabbing";
        previous = 0;
      }
      function up(event: PointerEvent) {
        if (pointer?.id === event.pointerId) release();
      }
      function draw(time: number) {
        frame = requestAnimationFrame(draw);
        if (document.hidden) {
          previous = 0;
          return;
        }
        const awake = logos.filter((logo) => !logo.body.isSleeping).length;
        if (canvas!.dataset.activeLogos !== String(awake))
          canvas!.dataset.activeLogos = String(awake);
        const active = Boolean(pointer) || awake > 0;
        // Settled physics does no simulation work; only the colour cycle is
        // repainted at 20 fps. Reduced motion stays still until interacted with.
        if (!active && lastPaint && (reduced || time - lastPaint < 50)) return;
        const delta = Math.min(25, previous ? time - previous : 16.67);
        previous = time;
        if (active) {
          for (let step = 0; step < 3; step++) {
            if (pointer) {
              const offset = Vector.sub(pointer.target, pointer.joint.pointA!);
              const length = Vector.magnitude(offset);
              pointer.joint.pointA = Vector.add(
                pointer.joint.pointA!,
                Vector.mult(offset, Math.min(1, 4 / (length || 1))),
              );
              Sleeping.set(pointer.joint.bodyB!, false);
            }
            Engine.update(engine, delta / 3);
            for (const logo of logos) {
              const speed = Vector.magnitude(logo.body.velocity);
              if (speed > 6)
                Body.setVelocity(
                  logo.body,
                  Vector.mult(logo.body.velocity, 6 / speed),
                );
              if (Math.abs(logo.body.angularVelocity) > 0.1)
                Body.setAngularVelocity(
                  logo.body,
                  Math.sign(logo.body.angularVelocity) * 0.1,
                );
              keepInside(logo.body);
            }
          }
        }
        const phase = ((time % cycle) / cycle) * 4;
        const index = Math.floor(phase);
        const mix = (1 - Math.cos((phase - index) * Math.PI)) / 2;
        const colour = `rgb(${palette[index].map((value, channel) => Math.round(value + (palette[(index + 1) % 4][channel] - value) * mix)).join(",")})`;
        context!.clearRect(0, 0, width, height);
        for (const { body, origin } of logos) {
          context!.save();
          context!.translate(body.position.x, body.position.y);
          context!.rotate(body.angle);
          context!.drawImage(
            art.sprite,
            -origin.x,
            -origin.y,
            art.width,
            art.height,
          );
          context!.translate(art.arrowX - origin.x, art.arrowY - origin.y);
          context!.scale(art.arrowScale, art.arrowScale);
          context!.beginPath();
          context!.moveTo(5, 23);
          context!.lineTo(20, 5);
          context!.moveTo(12.5, 5);
          context!.lineTo(20, 5);
          context!.lineTo(20, 12.5);
          context!.strokeStyle = colour;
          context!.lineWidth = 1.9;
          context!.lineCap = "round";
          context!.lineJoin = "round";
          context!.stroke();
          context!.restore();
        }
        lastPaint = time;
      }
      const observer = new ResizeObserver(resize);
      resize();
      observer.observe(card!);
      observer.observe(canvas!);
      window.addEventListener("resize", resize);
      window.addEventListener("scroll", resize, { passive: true });
      canvas!.addEventListener("pointerdown", down);
      canvas!.addEventListener("pointermove", move);
      canvas!.addEventListener("pointerup", up);
      canvas!.addEventListener("pointercancel", up);
      canvas!.addEventListener("lostpointercapture", up);
      frame = requestAnimationFrame(draw);
      dispose = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        window.removeEventListener("resize", resize);
        window.removeEventListener("scroll", resize);
        canvas!.removeEventListener("pointerdown", down);
        canvas!.removeEventListener("pointermove", move);
        canvas!.removeEventListener("pointerup", up);
        canvas!.removeEventListener("pointercancel", up);
        canvas!.removeEventListener("lostpointercapture", up);
        Composite.clear(engine.world, false);
        Engine.clear(engine);
      };
    }
    void start();
    return () => {
      cancelled = true;
      dispose();
    };
  }, [obstacle]);
  return (
    <canvas
      ref={canvasRef}
      className="auth-logo-playground"
      aria-hidden="true"
    />
  );
}
