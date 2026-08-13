"use client";

import { useRef, useState } from "react";

/**
 * Drawing a signature by hand — mouse or finger — and carrying it into a
 * form as a hidden field. No library: a signature is just ink tracked
 * between pointer-down and pointer-up, which a plain canvas already does.
 *
 * The hidden input's value is refreshed at the end of every stroke rather
 * than read once on submit — simpler than coordinating with whatever form
 * eventually wraps this, and cheap enough that it doesn't matter most of
 * those refreshes are never actually submitted.
 */
export function SignaturePad({ name }: { name: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    drawing.current = true;
    last.current = point(e);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    e.preventDefault();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const p = point(e);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.current!.x, last.current!.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    setEmpty(false);
  }

  function end() {
    if (drawing.current && inputRef.current) {
      inputRef.current.value = canvasRef.current!.toDataURL("image/png");
    }
    drawing.current = false;
    last.current = null;
  }

  function clear() {
    const canvas = canvasRef.current!;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    if (inputRef.current) inputRef.current.value = "";
    setEmpty(true);
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={500}
        height={160}
        className="w-full touch-none rounded-lg border bg-white"
        style={{ aspectRatio: "500 / 160" }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <div className="mt-1.5 flex items-center justify-between">
        <p className="text-xs text-silver-dark">Sign above with your mouse or finger.</p>
        <button type="button" onClick={clear} className="text-xs text-silver-dark underline hover:text-ink">
          Clear
        </button>
      </div>
      <input type="hidden" name={name} ref={inputRef} required={empty ? true : undefined} />
    </div>
  );
}
