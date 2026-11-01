import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    getRotatedGeometry,
    type DrawWallSegment,
    type FurnitureDefinition,
    type Rotation,
    type Rect,
} from "@/shared/lib/furniture-planner";
import {
    furnitureBelongsToRoom,
    furnitureDefinition,
    furnitureError,
    furnitureConflicts,
    furnitureWallDistances,
    turnsToWall,
    furnitureGeometry,
    furniturePassages,
    passageBlocked,
    rotatedFurnitureCandidates,
    placeFurniture,
    type DrawFurniture,
    type FurnitureRoom,
} from "./furniture";
import {
    OFFERED_FURNITURE_MENU,
    furnitureMenuOrder,
    menuGroupDefinitions,
    searchFurnitureMenu,
} from "./catalog-menu";
import styles from "./furniture.module.scss";
import { byPointer } from "./pointer-wording";
import FurnitureSymbol, { FurnitureThumbnail } from "./FurnitureSymbol";
import { isSchematicFurnitureSource } from "@/shared/lib/furniture-planner/catalog";

const snap = (n: number) => Math.round(n / 10) * 10;
/** The rail's last row: arranging what already stands in the room. */
const AUTO_LAYOUT = "auto-layout";
/** The rail's footer: the list of keyboard shortcuts. */
const SHORTCUTS = "shortcuts";
const AUTO_TURN_KEY = "stylefinder:furniture-auto-turn";
const SHORTCUT_LIST: [string, string][] = [
    ["R", "Повернуть на 90°"],
    ["E", "Зеркально"],
    ["← ↑ → ↓", "Сдвинуть на 10 мм"],
    ["Shift + стрелка", "Сдвинуть на 100 мм"],
    ["⌘C / Ctrl+C", "Копировать предмет"],
    ["⌘V / Ctrl+V", "Поставить копию"],
    ["Delete", "Удалить предмет"],
    ["Shift + щелчок", "Поставить несколько одинаковых"],
    ["⌥ / Alt при переносе", "Без магнитов и автоповорота"],
    ["⌘Z / Ctrl+Z", "Отменить"],
    ["Esc", "Снять выбор, отменить перенос"],
];
export default function FurnitureEditor({
    boardRef,
    active,
    onActivate,
    items,
    walls,
    thickness,
    doorObstacles,
    radiatorObstacles,
    room,
    presented = false,
    autoLayout,
    onChange,
}: {
    boardRef: React.RefObject<SVGSVGElement>;
    active: boolean;
    onActivate: () => void;
    items: DrawFurniture[];
    walls: DrawWallSegment[];
    thickness: number;
    doorObstacles: readonly Rect[];
    /** Radiators with the free air in front of them. */
    radiatorObstacles: readonly Rect[];
    /** The result step shows every piece at full strength, read-only. */
    presented?: boolean;
    /** «Авторасстановка» for the room, the catalogue rail's last row. */
    autoLayout?: React.ReactNode;
    /** Pieces are placed in this room only; others' furniture stays a quiet layer. */
    room: FurnitureRoom | null;
    onChange: (items: DrawFurniture[]) => void;
}) {
    const [board, setBoard] = useState<SVGSVGElement | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [pending, setPending] = useState<DrawFurniture | null>(null);
    const [reposition, setReposition] = useState<DrawFurniture | null>(null);
    const [preview, setPreview] = useState<DrawFurniture | null>(null);
    const [query, setQuery] = useState("");
    const [section, setSection] = useState<string | null>(null);
    const [message, setMessage] = useState("");
    /** A piece is being dragged: the phone's bottom sheet steps aside meanwhile. */
    const [moving, setMoving] = useState(false);
    const drag = useRef<{ initial: DrawFurniture; start: DOMPoint; last: DrawFurniture } | null>(
        null,
    );
    // «Автоповорот»: a carried piece turns its back to the nearest wall, as in Remplanner.
    const [autoTurn, setAutoTurn] = useState(() => {
        try {
            return localStorage.getItem(AUTO_TURN_KEY) !== "off";
        } catch {
            return true;
        }
    });
    // A piece the person turned with R keeps that turn while it is carried.
    const turnedByHand = useRef(false);
    // Cmd+C keeps a piece here for Cmd+V.
    const clipboard = useRef<DrawFurniture | null>(null);
    const storedSelected = items.find((item) => item.id === selectedId);
    const selected = storedSelected && reposition?.id === selectedId ? reposition : storedSelected;
    useEffect(() => {
        setReposition(null);
    }, [selectedId, active]);
    const editing = pending ?? selected;
    useEffect(() => {
        setBoard(boardRef.current);
    }, [boardRef]);
    useEffect(() => {
        if (!active) {
            setSelectedId(null);
            setReposition(null);
            setPending(null);
            setPreview(null);
            setMessage("");
            setSection(null);
            setMoving(false);
            drag.current = null;
        }
    }, [active]);
    useEffect(() => {
        if (!board || !active || pending) return;
        const clearSelection = (event: PointerEvent) => {
            if (event.button !== 0 || drag.current) return;
            const target = event.target;
            if (target instanceof Element && target.closest("[data-draw-furniture]")) return;
            setSelectedId(null);
            setReposition(null);
            setPreview(null);
            setMessage("");
        };
        board.addEventListener("pointerdown", clearSelection, true);
        return () => board.removeEventListener("pointerdown", clearSelection, true);
    }, [board, active, pending]);
    const point = (clientX: number, clientY: number) => {
        const matrix = board?.getScreenCTM();
        return matrix ? new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse()) : null;
    };
    const error = (item: DrawFurniture) =>
        furnitureError(item, items, walls, thickness, doorObstacles, room, radiatorObstacles);
    const inRoom = (item: DrawFurniture) => !room || furnitureBelongsToRoom(item, room);
    const settle = (item: DrawFurniture, free = false) =>
        placeFurniture(item, items, walls, thickness, {
            magnets: !free,
            turn: autoTurn && !turnedByHand.current,
        });
    // Pick up a piece for placing; a new piece starts with the automatic turn.
    const takeInHand = (piece: DrawFurniture) => {
        turnedByHand.current = false;
        setPending(piece);
    };
    const mirror = () => {
        if (!editing || editing.locked) return;
        const next = { ...editing, mirrored: !editing.mirrored };
        if (pending) {
            setPending(next);
            setPreview(null);
        } else update(next);
    };
    const update = (item: DrawFurniture) => {
        if (items.find((old) => old.id === item.id)?.locked) {
            setMessage("Предмет закреплён. Разблокируйте его для редактирования.");
            return;
        }
        const reason = error(item);
        if (reason) {
            setMessage(`Это положение не сохранено. ${reason}`);
            if (reposition) setReposition(item);
            return;
        }
        setReposition(null);
        onChange(items.map((old) => (old.id === item.id ? item : old)));
        setMessage("");
    };
    const rotate = () => {
        if (!editing || editing.locked) return;
        const next = { ...editing, rotation: ((editing.rotation + 90) % 360) as Rotation };
        turnedByHand.current = true;
        if (pending) {
            setPending(next);
            setPreview(null);
        } else {
            const rotated = rotatedFurnitureCandidates(editing)[0];
            if (!error(rotated)) update(rotated);
            else {
                setReposition(rotated);
                setPreview(null);
                setMessage(
                    byPointer(
                        "Предмет повёрнут. Перетащите предмет на свободное место. Esc — отменить перестановку.",
                        "Предмет повёрнут. Перетащите его на свободное место.",
                    ),
                );
            }
        }
    };
    useEffect(() => {
        if (!board || !active || !pending) return;
        const candidate = (event: PointerEvent) => {
            const p = point(event.clientX, event.clientY);
            if (!p) return null;
            const geometry = furnitureGeometry(pending);
            return settle(
                {
                    ...pending,
                    x: snap(p.x - geometry.width / 2),
                    y: snap(p.y - geometry.depth / 2),
                },
                event.altKey,
            );
        };
        const move = (event: PointerEvent) => {
            if (event.buttons) return;
            event.stopPropagation();
            setPreview(candidate(event));
        };
        const down = (event: PointerEvent) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            const item = candidate(event);
            if (!item) return;
            const reason = error(item);
            if (reason) {
                setMessage(reason);
                return;
            }
            const placed = { ...item, id: `furniture-${crypto.randomUUID()}` };
            onChange([...items, placed]);
            // Shift keeps the same piece in hand for the next spot.
            if (event.shiftKey) {
                setMessage("Предмет добавлен. Укажите следующее место или нажмите Esc.");
                return;
            }
            setSelectedId(placed.id);
            setPending(null);
            setPreview(null);
            setMessage("Предмет добавлен. Потяните его, чтобы переместить.");
        };
        board.addEventListener("pointermove", move, true);
        board.addEventListener("pointerdown", down, true);
        return () => {
            board.removeEventListener("pointermove", move, true);
            board.removeEventListener("pointerdown", down, true);
        };
    });
    useEffect(() => {
        if (!active) return;
        const key = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement;
            if (target.closest('input,textarea,select,[contenteditable="true"]')) return;
            // Cmd+C / Cmd+V (Ctrl on Windows): copy the chosen piece, take a copy in hand.
            if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
                if (event.code === "KeyC" && selected && !pending) {
                    event.preventDefault();
                    clipboard.current = selected;
                    setMessage("Скопировано. ⌘V или Ctrl+V — поставить копию.");
                } else if (event.code === "KeyV" && clipboard.current) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    takeInHand({ ...clipboard.current, id: "pending-copy", locked: false });
                    setSelectedId(null);
                    setReposition(null);
                    setPreview(null);
                    setMessage("Копия в руке. Укажите место на плане. Esc — отмена.");
                }
                return;
            }
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.key === "Escape") {
                event.stopImmediatePropagation();
                drag.current = null;
                setMoving(false);
                setSection(null);
                setPreview(null);
                setPending(null);
                setSelectedId(null);
                setReposition(null);
                setMessage("");
                return;
            }
            if (!editing) return;
            if (
                [
                    "Delete",
                    "Backspace",
                    "r",
                    "R",
                    "к",
                    "К",
                    "e",
                    "E",
                    "у",
                    "У",
                    "ArrowLeft",
                    "ArrowRight",
                    "ArrowUp",
                    "ArrowDown",
                ].includes(event.key)
            ) {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (editing.locked) {
                    setMessage("Предмет закреплён. Разблокируйте его для редактирования.");
                    return;
                }
                if (["r", "R", "к", "К"].includes(event.key)) rotate();
                else if (["e", "E", "у", "У"].includes(event.key)) mirror();
                else if (event.key === "Delete" || event.key === "Backspace") {
                    if (pending) setPending(null);
                    else onChange(items.filter((item) => item.id !== selectedId));
                    setSelectedId(null);
                    setReposition(null);
                    setPreview(null);
                } else if (selected && !pending) {
                    const step = event.shiftKey ? 100 : 10;
                    update({
                        ...selected,
                        x:
                            selected.x +
                            (event.key === "ArrowRight"
                                ? step
                                : event.key === "ArrowLeft"
                                  ? -step
                                  : 0),
                        y:
                            selected.y +
                            (event.key === "ArrowDown"
                                ? step
                                : event.key === "ArrowUp"
                                  ? -step
                                  : 0),
                    });
                }
            }
        };
        window.addEventListener("keydown", key, true);
        return () => window.removeEventListener("keydown", key, true);
    });
    const symbol = (item: DrawFurniture, ghost = false) => {
        const geometry = furnitureGeometry(item);
        const definition = furnitureDefinition(item.definitionId)!;
        const own = ghost || inRoom(item);
        // Another room's furniture is judged on its own ground, not this room's.
        const invalid = Boolean(
            own
                ? error(item)
                : furnitureError(
                      item,
                      items,
                      walls,
                      thickness,
                      doorObstacles,
                      null,
                      radiatorObstacles,
                  ),
        );
        const editable = active && own && !ghost;
        // The symbol is drawn unflipped and mirrored as a whole.
        const baseGeometry = furnitureGeometry({ ...item, rotation: 0, mirrored: false });
        const transform =
            item.rotation === 90
                ? `translate(${item.depth} 0) rotate(90)`
                : item.rotation === 180
                  ? `translate(${item.width} ${item.depth}) rotate(180)`
                  : item.rotation === 270
                    ? `translate(0 ${item.width}) rotate(270)`
                    : undefined;
        return (
            <g
                key={ghost ? "preview" : item.id}
                data-draw-furniture={ghost ? "preview" : item.id}
                data-definition-id={item.definitionId}
                transform={`translate(${item.x} ${item.y})`}
                className={styles.item}
                data-selected={active && selectedId === item.id}
                data-invalid={invalid}
                data-locked={Boolean(item.locked)}
                data-mounting={definition.mounting ?? "floor"}
                style={{
                    pointerEvents: editable && !pending ? "auto" : "none",
                    // Outside the furniture step, or the selected room, pieces stay a quiet layer.
                    opacity: ghost ? 0.65 : editable || presented ? 1 : 0.45,
                    cursor: item.locked ? "pointer" : undefined,
                }}
                role={ghost ? undefined : "button"}
                tabIndex={editable ? 0 : undefined}
                aria-label={ghost ? undefined : definition.label}
                onFocus={() => {
                    onActivate();
                    setSelectedId(item.id);
                }}
                onPointerDown={(event) => {
                    if (!editable || event.button !== 0 || pending) return;
                    onActivate();
                    const p = point(event.clientX, event.clientY);
                    if (!p) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setSelectedId(item.id);
                    setMessage(
                        item.locked
                            ? "Предмет закреплён. Разблокируйте его для редактирования."
                            : "",
                    );
                    if (item.locked) return;
                    // Pointer-event session; this assignment never runs during rendering.
                    // eslint-disable-next-line react-hooks/refs
                    drag.current = { initial: item, start: p, last: item };
                    turnedByHand.current = false;
                    event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                    const session = drag.current;
                    if (!session || session.initial.id !== item.id) return;
                    event.stopPropagation();
                    const p = point(event.clientX, event.clientY);
                    if (!p) return;
                    // Pointer-event handler; settle reads the hand-turn ref, never during rendering.
                    // eslint-disable-next-line react-hooks/refs
                    const next = settle(
                        {
                            ...session.initial,
                            x: snap(session.initial.x + p.x - session.start.x),
                            y: snap(session.initial.y + p.y - session.start.y),
                        },
                        event.altKey,
                    );
                    const reason = error(next);
                    // Follow the pointer across obstacles; validate the destination on release.
                    session.last = next;
                    setMessage(reason ?? "");
                    setPreview(next);
                    setMoving(true);
                }}
                onPointerUp={(event) => {
                    if (!drag.current || drag.current.initial.id !== item.id) return;
                    event.stopPropagation();
                    const next = drag.current.last;
                    const initial = drag.current.initial;
                    drag.current = null;
                    setPreview(null);
                    setMoving(false);
                    if (event.currentTarget.hasPointerCapture(event.pointerId))
                        event.currentTarget.releasePointerCapture(event.pointerId);
                    if (
                        next.x !== initial.x ||
                        next.y !== initial.y ||
                        next.rotation !== initial.rotation
                    )
                        update(next);
                }}
                onPointerCancel={(event) => {
                    event.stopPropagation();
                    drag.current = null;
                    setPreview(null);
                    setMoving(false);
                }}
                onLostPointerCapture={() => {
                    drag.current = null;
                    setPreview(null);
                    setMoving(false);
                }}
            >
                <title>
                    {definition.label} · {item.width} × {item.depth} мм
                </title>
                <g transform={transform}>
                    <g
                        transform={
                            item.mirrored
                                ? `translate(${baseGeometry.width} 0) scale(-1 1)`
                                : undefined
                        }
                    >
                        <FurnitureSymbol
                            definitionId={item.definitionId}
                            rects={baseGeometry.bodyRects}
                            width={baseGeometry.width}
                            depth={baseGeometry.depth}
                        />
                    </g>
                </g>
                {active &&
                    own &&
                    // Upper units overlie base units: their sizes show when selected.
                    (definition.mounting !== "upper" || selectedId === item.id || ghost) && (
                        // Plan sizes in centimetres along the front and the side, as on a drawing.
                        <g className={styles.sizeLabels} style={{ fontSize: 12 * screenUnit }}>
                            <text
                                data-furniture-size="width"
                                x={geometry.width / 2}
                                y={geometry.depth - 7 * screenUnit}
                                textAnchor="middle"
                            >
                                {Math.round(geometry.width)}
                            </text>
                            <text
                                data-furniture-size="depth"
                                transform={`translate(${geometry.width - 7 * screenUnit} ${geometry.depth / 2}) rotate(-90)`}
                                textAnchor="middle"
                            >
                                {Math.round(geometry.depth)}
                            </text>
                        </g>
                    )}
            </g>
        );
    };
    const inspected = active ? preview ?? reposition ?? selected : null;
    const conflicts = inspected
        ? furnitureConflicts(
              inspected,
              items,
              walls,
              thickness,
              doorObstacles,
              room,
              radiatorObstacles,
          )
        : [];
    // What stands on the plan right now, the piece being moved where it is moved to.
    const shown = [
        ...items.map((item) =>
            preview?.id === item.id && !pending
                ? preview
                : reposition?.id === item.id && selectedId === item.id
                  ? reposition
                  : item,
        ),
        ...(pending && preview ? [preview] : []),
    ];
    // Passages are a warning, not a ban: shown for the room's every piece.
    const passages = active ? furniturePassages(shown.filter(inRoom), walls, thickness) : [];
    const passageWarnings = inspected
        ? passages
              .filter(passageBlocked)
              .filter(
                  (passage) =>
                      passage.itemId === inspected.id ||
                      furnitureGeometry(inspected).bodyRects.some(
                          (body) =>
                              body.x + inspected.x < passage.rect.x + passage.rect.width &&
                              body.x + inspected.x + body.width > passage.rect.x &&
                              body.y + inspected.y < passage.rect.y + passage.rect.depth &&
                              body.y + inspected.y + body.depth > passage.rect.y,
                      ),
              )
              .map((passage) => {
                  const owner = shown.find((item) => item.id === passage.itemId);
                  const name = owner ? furnitureDefinition(owner.definitionId)?.label : "";
                  return `${passage.label}${passage.itemId === inspected.id ? "" : ` у «${name}»`}: свободно ${Math.round(passage.free)} мм из ${Math.round(passage.need)}.`;
              })
        : [];
    const distances =
        selected && !pending && !preview && !reposition
            ? furnitureWallDistances(selected, walls, thickness)
            : [];
    const sideLabels = { left: "Слева", right: "Справа", top: "Сверху", bottom: "Снизу" };
    const screenUnit = 1 / (board?.getScreenCTM()?.a || 0.1);
    const layerHost =
        board?.querySelector<SVGGElement>("[data-draw-furniture-host='true']") ?? board;
    const openSection = OFFERED_FURNITURE_MENU.find((menuSection) => menuSection.id === section);
    const autoLayoutOpen = section === AUTO_LAYOUT && Boolean(autoLayout);
    const shortcutsOpen = section === SHORTCUTS;
    const flyoutOpen = Boolean(query.trim() || openSection || autoLayoutOpen || shortcutsOpen);
    const furnitureButton = (definition: FurnitureDefinition) => {
        const geometry = getRotatedGeometry(definition, 0);
        return (
            <button
                key={definition.id}
                type="button"
                className={styles.railButton}
                data-add-furniture={definition.id}
                aria-pressed={pending?.definitionId === definition.id}
                onClick={() => {
                    takeInHand({
                        id: "pending",
                        definitionId: definition.id,
                        x: 0,
                        y: 0,
                        width: geometry.width,
                        depth: geometry.depth,
                        rotation: 0,
                    });
                    setSelectedId(null);
                    setReposition(null);
                    setPreview(null);
                    setMessage("");
                    // The menu and the search step aside once a piece is chosen, as in Remplanner.
                    setSection(null);
                    setQuery("");
                }}
            >
                <FurnitureThumbnail definition={definition} />
                <span className={styles.railCopy}>
                    <b>{definition.label}</b>
                    <small>
                        {geometry.width} × {geometry.depth} мм
                    </small>
                </span>
            </button>
        );
    };
    return (
        <>
            {layerHost &&
                createPortal(
                    <g data-draw-furniture-layer="true">
                        <g pointerEvents="none" aria-hidden="true" data-furniture-passages="true">
                            {passages.map((passage, index) => {
                                const blocked = passageBlocked(passage);
                                return (
                                    <g
                                        key={`${passage.itemId}-${index}`}
                                        className={styles.passage}
                                        data-furniture-passage={passage.itemId}
                                        data-passage-blocked={blocked}
                                    >
                                        <rect
                                            x={passage.rect.x}
                                            y={passage.rect.y}
                                            width={passage.rect.width}
                                            height={passage.rect.depth}
                                        />
                                    </g>
                                );
                            })}
                        </g>
                        {[...items]
                            .sort(
                                (first, second) =>
                                    Number(
                                        furnitureDefinition(first.definitionId)?.mounting ===
                                            "upper",
                                    ) -
                                    Number(
                                        furnitureDefinition(second.definitionId)?.mounting ===
                                            "upper",
                                    ),
                            )
                            .map((item) =>
                                symbol(
                                    preview?.id === item.id && !pending
                                        ? preview
                                        : reposition?.id === item.id && selectedId === item.id
                                          ? reposition
                                          : item,
                                ),
                            )}
                        {pending && preview && symbol(preview, true)}
                        {/* What is left of a blocked passage reads over the pieces in it. */}
                        <g pointerEvents="none" aria-hidden="true" className={styles.passage}>
                            {passages.filter(passageBlocked).map((passage, index) => (
                                <text
                                    key={`${passage.itemId}-${index}`}
                                    data-furniture-passage-free={passage.itemId}
                                    x={passage.rect.x + passage.rect.width / 2}
                                    y={passage.rect.y + passage.rect.depth / 2}
                                    fontSize={11 * screenUnit}
                                    textAnchor="middle"
                                    dominantBaseline="middle"
                                >
                                    {Math.round(passage.free)} из {Math.round(passage.need)} мм
                                </text>
                            ))}
                        </g>
                        <g pointerEvents="none" aria-hidden="true" data-furniture-conflicts="true">
                            {conflicts.map((conflict, index) => (
                                <rect
                                    key={index}
                                    data-furniture-conflict={conflict.kind}
                                    x={conflict.rect.x}
                                    y={conflict.rect.y}
                                    width={conflict.rect.width}
                                    height={conflict.rect.depth}
                                    fill="#d13c2926"
                                    stroke="#bd3424"
                                    strokeWidth={2}
                                    strokeDasharray="6 4"
                                    vectorEffect="non-scaling-stroke"
                                />
                            ))}
                            {inspected && conflicts.length > 0 && (
                                <g
                                    transform={`translate(${inspected.x} ${inspected.y - 32 * screenUnit})`}
                                >
                                    <rect
                                        width={245 * screenUnit}
                                        height={26 * screenUnit}
                                        rx={4 * screenUnit}
                                        fill="#fff8f3"
                                        stroke="#bd3424"
                                        strokeWidth={screenUnit}
                                    />
                                    <text
                                        x={8 * screenUnit}
                                        y={17 * screenUnit}
                                        fontSize={12 * screenUnit}
                                        fill="#8f271c"
                                    >
                                        {conflicts[0].kind === "door"
                                            ? "Освободите проход перед дверью"
                                            : conflicts[0].kind === "wall"
                                              ? "Предмет пересекает стену"
                                              : conflicts[0].kind === "room"
                                                ? "За пределами выбранной комнаты"
                                                : conflicts[0].kind === "radiator"
                                                  ? "Закрывает радиатор"
                                                  : "Место занято другой мебелью"}
                                    </text>
                                </g>
                            )}
                        </g>
                    </g>,
                    layerHost,
                )}
            {active && (
                <aside
                    className={styles.furniture}
                    aria-label="Мебель на чертеже"
                    data-editing={Boolean(editing)}
                    data-flyout-open={flyoutOpen}
                    data-moving={moving}
                    data-draw-room-bottom-sheet
                    data-section-open={Boolean(
                        (openSection || autoLayoutOpen || shortcutsOpen) && !query.trim(),
                    )}
                    data-searching={Boolean(query.trim())}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    {/* Sections in a dark rail, like the doors and windows step. */}
                    <nav
                        className={styles.rail}
                        aria-label="Разделы каталога"
                        data-open={Boolean(
                            openSection || autoLayoutOpen || shortcutsOpen || query.trim(),
                        )}
                    >
                        <div className={styles.railIntro}>
                            <span data-furniture-room>{room ? room.name : "Каталог мебели"}</span>
                            <button
                                type="button"
                                className={styles.railKeys}
                                data-furniture-shortcuts
                                aria-expanded={shortcutsOpen}
                                aria-label="Быстрые клавиши"
                                title="Быстрые клавиши"
                                onClick={() => {
                                    setQuery("");
                                    setSection(shortcutsOpen ? null : SHORTCUTS);
                                }}
                            >
                                <svg viewBox="0 0 26 26" aria-hidden="true">
                                    <rect x="2" y="7" width="22" height="13" rx="2" />
                                    <path d="M6 11h2M10 11h2M14 11h2M18 11h2M8 15h10" />
                                </svg>
                                Клавиши
                            </button>
                        </div>
                        {/* The magnifier shows in the folded rail; the field opens with it. */}
                        <label className={styles.railSearch}>
                            <svg
                                className={styles.thumbnail}
                                viewBox="0 0 26 26"
                                aria-hidden="true"
                            >
                                <circle cx="11" cy="11" r="7" />
                                <path d="m16 16 6 6" />
                            </svg>
                            <input
                                aria-label="Поиск мебели"
                                placeholder="Найти мебель"
                                value={query}
                                onChange={(event) => {
                                    setQuery(event.target.value);
                                    setSection(null);
                                }}
                            />
                        </label>
                        {furnitureMenuOrder(room?.kind).map((menuSection) => (
                            <button
                                key={menuSection.id}
                                type="button"
                                className={styles.railButton}
                                data-furniture-section={menuSection.id}
                                data-furniture-section-items={menuSection.groups
                                    .flatMap((group) => group.ids)
                                    .join(" ")}
                                aria-expanded={openSection?.id === menuSection.id}
                                onClick={() => {
                                    setQuery("");
                                    setSection(
                                        openSection?.id === menuSection.id ? null : menuSection.id,
                                    );
                                }}
                            >
                                <FurnitureThumbnail
                                    definition={furnitureDefinition(menuSection.icon)!}
                                />
                                <span className={styles.railCopy}>
                                    <b>{menuSection.label}</b>
                                    <small>
                                        {menuSection.groups.map((group) => group.label).join(", ")}
                                    </small>
                                </span>
                            </button>
                        ))}
                        {autoLayout && (
                            <button
                                type="button"
                                className={styles.railButton}
                                data-furniture-auto-layout
                                aria-expanded={autoLayoutOpen}
                                onClick={() => {
                                    setQuery("");
                                    setSection(autoLayoutOpen ? null : AUTO_LAYOUT);
                                }}
                            >
                                <svg
                                    className={styles.thumbnail}
                                    viewBox="0 0 26 26"
                                    aria-hidden="true"
                                >
                                    <path d="M4 22 16 10M14 8l4 4" />
                                    <path d="M19 2.5v4M17 4.5h4M22.5 10v3M21 11.5h3M9.5 3v3M8 4.5h3" />
                                </svg>
                                <span className={styles.railCopy}>
                                    <b>Авторасстановка</b>
                                    <small>Переставить мебель этой комнаты</small>
                                </span>
                            </button>
                        )}
                    </nav>
                    {query.trim() ? (
                        <div
                            className={styles.flyout}
                            role="region"
                            aria-label="Найденная мебель"
                            data-furniture-search
                        >
                            <header>
                                <b>Поиск</b>
                                <button
                                    type="button"
                                    aria-label="Закрыть поиск"
                                    onClick={() => setQuery("")}
                                >
                                    ×
                                </button>
                            </header>
                            {searchFurnitureMenu(query).map(furnitureButton)}
                            {searchFurnitureMenu(query).length === 0 && <p>Ничего не найдено.</p>}
                        </div>
                    ) : shortcutsOpen ? (
                        <div
                            className={styles.flyout}
                            role="region"
                            aria-label="Быстрые клавиши"
                            data-furniture-flyout={SHORTCUTS}
                        >
                            <header>
                                <b>Быстрые клавиши</b>
                                <button
                                    type="button"
                                    aria-label="Закрыть раздел"
                                    onClick={() => setSection(null)}
                                >
                                    ×
                                </button>
                            </header>
                            <dl className={styles.shortcuts}>
                                {SHORTCUT_LIST.map(([keys, action]) => (
                                    <div key={keys}>
                                        <dt>
                                            <kbd>{keys}</kbd>
                                        </dt>
                                        <dd>{action}</dd>
                                    </div>
                                ))}
                            </dl>
                        </div>
                    ) : autoLayoutOpen ? (
                        <div
                            className={styles.flyout}
                            role="region"
                            aria-label="Авторасстановка"
                            data-furniture-flyout={AUTO_LAYOUT}
                        >
                            <header>
                                <b>Авторасстановка</b>
                                <button
                                    type="button"
                                    aria-label="Закрыть раздел"
                                    onClick={() => setSection(null)}
                                >
                                    ×
                                </button>
                            </header>
                            {autoLayout}
                        </div>
                    ) : (
                        openSection && (
                            // Like Remplanner: the section's groups open beside the rail.
                            <div
                                className={styles.flyout}
                                role="region"
                                aria-label={openSection.label}
                                data-furniture-flyout={openSection.id}
                            >
                                <header>
                                    <b>{openSection.label}</b>
                                    <button
                                        type="button"
                                        aria-label="Закрыть раздел"
                                        onClick={() => setSection(null)}
                                    >
                                        ×
                                    </button>
                                </header>
                                {openSection.groups.map((group) => (
                                    <section key={group.label}>
                                        <h3>{group.label}</h3>
                                        {menuGroupDefinitions(group).map(furnitureButton)}
                                    </section>
                                ))}
                            </div>
                        )
                    )}
                    {/* The piece's parameters, as Remplanner shows them: only while one is chosen. */}
                    {editing ? (
                        <div className={styles.panel}>
                            <header>
                                <b>{furnitureDefinition(editing.definitionId)?.label}</b>
                                {/* Done with this piece: the card closes, the catalogue stays. */}
                                <button
                                    type="button"
                                    className={styles.panelClose}
                                    aria-label="Закрыть"
                                    title="Готово — снять выбор"
                                    onClick={() => {
                                        setPending(null);
                                        setSelectedId(null);
                                        setReposition(null);
                                        setPreview(null);
                                        setMessage("");
                                    }}
                                >
                                    ×
                                </button>
                            </header>
                            {editing && (
                                <section className={styles.properties}>
                                    {isSchematicFurnitureSource(
                                        furnitureDefinition(editing.definitionId)!.source,
                                    ) && (
                                        <small>
                                            Типовые габариты. Уточните размеры вашего предмета
                                            {editing.definitionId.startsWith("dining-")
                                                ? ": вместе со стульями"
                                                : editing.definitionId.startsWith("desk")
                                                  ? ": вместе со стулом"
                                                  : ""}
                                            .
                                        </small>
                                    )}
                                    {furnitureDefinition(editing.definitionId)?.sizes && (
                                        <div
                                            className={styles.presets}
                                            role="group"
                                            aria-label="Типовые размеры"
                                        >
                                            {furnitureDefinition(editing.definitionId)!.sizes!.map(
                                                ({ width, depth }) => (
                                                    <button
                                                        key={`${width}x${depth}`}
                                                        type="button"
                                                        data-furniture-preset={`${width}x${depth}`}
                                                        disabled={Boolean(editing.locked)}
                                                        aria-pressed={
                                                            editing.width === width &&
                                                            editing.depth === depth
                                                        }
                                                        onClick={() => {
                                                            const next = {
                                                                ...editing,
                                                                width,
                                                                depth,
                                                            };
                                                            if (pending) {
                                                                setPending(next);
                                                                setPreview(null);
                                                            } else update(next);
                                                        }}
                                                    >
                                                        {width} × {depth}
                                                    </button>
                                                ),
                                            )}
                                        </div>
                                    )}
                                    <div className={styles.sizes}>
                                        {(["width", "depth"] as const).map((field) => (
                                            <label key={`${editing.id}-${field}`}>
                                                {field === "width" ? "Ширина, мм" : "Глубина, мм"}
                                                <input
                                                    key={`${editing.id}-${editing[field]}`}
                                                    type="number"
                                                    min={10}
                                                    max={10000}
                                                    step={10}
                                                    disabled={Boolean(editing.locked)}
                                                    defaultValue={editing[field]}
                                                    onBlur={(event) => {
                                                        const value = Number(event.target.value);
                                                        if (
                                                            !Number.isFinite(value) ||
                                                            value < 10 ||
                                                            value > 10000
                                                        ) {
                                                            event.target.value = String(
                                                                editing[field],
                                                            );
                                                            return;
                                                        }
                                                        const next = { ...editing, [field]: value };
                                                        if (pending) {
                                                            setPending(next);
                                                            setPreview(null);
                                                        } else {
                                                            update(next);
                                                            if (error(next))
                                                                event.target.value = String(
                                                                    editing[field],
                                                                );
                                                        }
                                                    }}
                                                    onKeyDown={(event) => {
                                                        if (event.key === "Enter")
                                                            event.currentTarget.blur();
                                                    }}
                                                />
                                            </label>
                                        ))}
                                    </div>
                                    {distances.length > 0 && (
                                        <fieldset className={styles.distances}>
                                            <legend>До стен, мм</legend>
                                            <div className={styles.sizes}>
                                                {distances.map((entry) => (
                                                    <label key={entry.side}>
                                                        {sideLabels[entry.side]}
                                                        <input
                                                            aria-label={`До стены ${sideLabels[entry.side].toLowerCase()}, мм`}
                                                            key={`${selected!.id}-${entry.distance}-${entry.side}`}
                                                            type="number"
                                                            disabled={Boolean(editing.locked)}
                                                            min={0}
                                                            step={10}
                                                            defaultValue={Math.round(
                                                                entry.distance,
                                                            )}
                                                            onBlur={(event) => {
                                                                const value = Number(
                                                                    event.target.value,
                                                                );
                                                                if (
                                                                    !event.target.value.trim() ||
                                                                    !Number.isFinite(value) ||
                                                                    value < 0
                                                                ) {
                                                                    event.target.value = String(
                                                                        Math.round(entry.distance),
                                                                    );
                                                                    return;
                                                                }
                                                                const next = {
                                                                    ...selected!,
                                                                    [entry.axis]:
                                                                        selected![entry.axis] +
                                                                        entry.direction *
                                                                            (value -
                                                                                entry.distance),
                                                                };
                                                                update(next);
                                                                if (error(next))
                                                                    event.target.value = String(
                                                                        Math.round(entry.distance),
                                                                    );
                                                            }}
                                                            onKeyDown={(event) => {
                                                                if (event.key === "Enter")
                                                                    event.currentTarget.blur();
                                                            }}
                                                        />
                                                    </label>
                                                ))}
                                            </div>
                                        </fieldset>
                                    )}
                                    <div className={styles.actions}>
                                        <button onClick={rotate} disabled={Boolean(editing.locked)}>
                                            Повернуть ↻
                                        </button>
                                        <button
                                            onClick={mirror}
                                            disabled={Boolean(editing.locked)}
                                            aria-pressed={Boolean(editing.mirrored)}
                                        >
                                            Зеркально ⇋
                                        </button>
                                        <button
                                            disabled={Boolean(editing.locked)}
                                            onClick={() => {
                                                if (pending) setPending(null);
                                                else
                                                    onChange(
                                                        items.filter(
                                                            (item) => item.id !== selectedId,
                                                        ),
                                                    );
                                                setSelectedId(null);
                                                setReposition(null);
                                                setPreview(null);
                                            }}
                                        >
                                            {pending ? "Отменить" : "Удалить"}
                                        </button>
                                    </div>
                                    {!pending && (
                                        <div className={styles.actions}>
                                            <button
                                                onClick={() => {
                                                    takeInHand({
                                                        ...editing,
                                                        id: "pending-copy",
                                                        locked: false,
                                                    });
                                                    setSelectedId(null);
                                                    setReposition(null);
                                                    setPreview(null);
                                                    setMessage(
                                                        byPointer(
                                                            "Копия готова. Укажите свободное место на плане. Esc — отмена.",
                                                            "Копия готова. Коснитесь свободного места на плане.",
                                                        ),
                                                    );
                                                }}
                                            >
                                                Копировать
                                            </button>
                                            <button
                                                aria-pressed={Boolean(editing.locked)}
                                                disabled={Boolean(reposition)}
                                                onClick={() => {
                                                    onChange(
                                                        items.map((item) =>
                                                            item.id === editing.id
                                                                ? { ...item, locked: !item.locked }
                                                                : item,
                                                        ),
                                                    );
                                                    setMessage(
                                                        editing.locked
                                                            ? "Предмет разблокирован."
                                                            : "Предмет закреплён. Его нельзя случайно сдвинуть или удалить.",
                                                    );
                                                }}
                                            >
                                                {editing.locked ? "Разблокировать" : "Закрепить"}
                                            </button>
                                        </div>
                                    )}
                                </section>
                            )}
                            {turnsToWall(editing.definitionId) && (
                                <label className={styles.toggle}>
                                    <input
                                        type="checkbox"
                                        id="furniture-auto-turn"
                                        checked={autoTurn}
                                        onChange={(event) => {
                                            setAutoTurn(event.target.checked);
                                            try {
                                                localStorage.setItem(
                                                    AUTO_TURN_KEY,
                                                    event.target.checked ? "on" : "off",
                                                );
                                            } catch {
                                                // A private window keeps the choice for this visit only.
                                            }
                                        }}
                                    />
                                    Автоповорот к стене
                                </label>
                            )}
                            {passageWarnings.length > 0 && (
                                <ul
                                    className={styles.passageWarnings}
                                    data-furniture-passage-warning
                                >
                                    {passageWarnings.map((warning) => (
                                        <li key={warning}>{warning}</li>
                                    ))}
                                </ul>
                            )}
                            <p role="status">
                                {message ||
                                    (pending
                                        ? byPointer(
                                              "Щёлкните по свободному месту. У стены предмет развернётся и прилипнет к ней. R — поворот, Shift — несколько, Alt — без магнитов, Esc — отмена.",
                                              "Коснитесь свободного места на плане. У стены предмет развернётся и прилипнет к ней.",
                                          )
                                        : byPointer(
                                              "Потяните предмет, чтобы переместить. Alt — без магнитов. R — повернуть, E — зеркально.",
                                              "Потяните предмет пальцем, чтобы переместить.",
                                          ))}
                            </p>
                        </div>
                    ) : (
                        // Nothing chosen: a note such as «вне комнаты» shows over the drawing.
                        message && (
                            <p role="status" className={styles.toast}>
                                {message}
                            </p>
                        )
                    )}
                </aside>
            )}
        </>
    );
}
