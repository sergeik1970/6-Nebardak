import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import styles from "./measure-tool.module.scss";

type Point = { x: number; y: number };
export default function MeasureTool({
    boardRef,
    active,
    onClose,
    scale,
}: {
    boardRef: RefObject<SVGSVGElement>;
    active: boolean;
    onClose: () => void;
    scale: number;
}) {
    const [board, setBoard] = useState<SVGSVGElement | null>(null);
    const [points, setPoints] = useState<Point[]>([]);
    const [cursor, setCursor] = useState<Point | null>(null);
    useEffect(() => {
        setBoard(boardRef.current);
    }, [boardRef]);
    useEffect(() => {
        setPoints([]);
        setCursor(null);
        if (!board || !active) return;
        const position = (event: PointerEvent): Point | null => {
            const matrix = board.getScreenCTM();
            if (!matrix) return null;
            const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
            return { x: Math.round(p.x / 10) * 10, y: Math.round(p.y / 10) * 10 };
        };
        const down = (event: PointerEvent) => {
            if (event.button !== 0 || !event.isPrimary) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            const p = position(event);
            if (!p) return;
            setPoints((old) => (old.length === 1 ? [...old, p] : [p]));
            setCursor(p);
        };
        const move = (event: PointerEvent) => {
            if (event.buttons) return;
            event.stopImmediatePropagation();
            setCursor(position(event));
        };
        board.addEventListener("pointerdown", down, true);
        board.addEventListener("pointermove", move, true);
        return () => {
            board.removeEventListener("pointerdown", down, true);
            board.removeEventListener("pointermove", move, true);
        };
    }, [active, board]);
    useEffect(() => {
        if (!active) return;
        const key = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopImmediatePropagation();
                onClose();
            }
        };
        window.addEventListener("keydown", key, true);
        return () => window.removeEventListener("keydown", key, true);
    }, [active, onClose]);
    if (!active) return null;
    const start = points[0],
        end = points[1] ?? cursor;
    const distance = start && end ? Math.round(Math.hypot(end.x - start.x, end.y - start.y)) : null;
    return (
        <>
            <div className={styles.hint} role="status">
                <span>
                    {points.length === 0
                        ? "Линейка: укажите первую точку"
                        : points.length === 1
                          ? "Укажите вторую точку · шаг 10 мм"
                          : `${distance} мм · нажмите для нового измерения`}
                </span>
                <button type="button" onClick={onClose} aria-label="Закрыть линейку">
                    ×
                </button>
            </div>
            {board &&
                start &&
                end &&
                createPortal(
                    <g data-draw-measure="true" pointerEvents="none" aria-hidden="true">
                        <line
                            x1={start.x}
                            y1={start.y}
                            x2={end.x}
                            y2={end.y}
                            stroke="#156aa1"
                            strokeWidth={2}
                            vectorEffect="non-scaling-stroke"
                            strokeDasharray="5 3"
                        />
                        {[start, end].map((p, i) => (
                            <circle
                                key={i}
                                cx={p.x}
                                cy={p.y}
                                r={4 * scale}
                                fill="white"
                                stroke="#156aa1"
                                strokeWidth={2}
                                vectorEffect="non-scaling-stroke"
                            />
                        ))}
                        <g
                            transform={`translate(${(start.x + end.x) / 2} ${(start.y + end.y) / 2 - 18 * scale})`}
                        >
                            <rect
                                x={-65 * scale}
                                y={-14 * scale}
                                width={130 * scale}
                                height={26 * scale}
                                rx={4 * scale}
                                fill="white"
                                stroke="#156aa1"
                                strokeWidth={scale}
                            />
                            <text
                                data-draw-measure-distance={distance}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fontSize={14 * scale}
                                fill="#156aa1"
                            >
                                {distance} мм
                            </text>
                        </g>
                    </g>,
                    board,
                )}
        </>
    );
}
