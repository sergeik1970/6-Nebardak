/**
 * The API stores the planner document without interpreting it: the browser
 * owns the schema and its migrations. The server only guarantees a sane
 * envelope — a known version, known top-level sections, bounded size and
 * nesting — so one account cannot store arbitrary blobs or pathological JSON.
 */

/** Document versions the frontend may write (older drafts migrate locally first). */
export const SUPPORTED_DOCUMENT_VERSIONS = [4, 5] as const;

export const PROJECT_DOCUMENT_SECTIONS = new Set([
    "version",
    "updatedAt",
    "visualTest",
    "questionnaire",
    "drawing",
    "planner",
]);

export const MAX_PROJECT_DOCUMENT_BYTES = 1024 * 1024;
export const MAX_PROJECT_DOCUMENT_DEPTH = 32;
export const MAX_PROJECTS_PER_USER = 50;

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type ProjectDocumentProblem =
    | "not-object"
    | "unsupported-version"
    | "unknown-section"
    | "too-large"
    | "too-deep"
    | "forbidden-key";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

function inspectNesting(
    value: unknown,
    depth: number,
): ProjectDocumentProblem | null {
    if (depth > MAX_PROJECT_DOCUMENT_DEPTH) return "too-deep";
    if (Array.isArray(value)) {
        for (const item of value) {
            const problem = inspectNesting(item, depth + 1);
            if (problem) return problem;
        }
        return null;
    }
    if (isPlainObject(value)) {
        for (const [key, child] of Object.entries(value)) {
            if (FORBIDDEN_KEYS.has(key)) return "forbidden-key";
            const problem = inspectNesting(child, depth + 1);
            if (problem) return problem;
        }
    }
    return null;
}

export function findProjectDocumentProblem(
    document: unknown,
): ProjectDocumentProblem | null {
    if (!isPlainObject(document)) return "not-object";

    const version = document.version;
    if (
        typeof version !== "number" ||
        !(SUPPORTED_DOCUMENT_VERSIONS as readonly number[]).includes(version)
    ) {
        return "unsupported-version";
    }
    if (
        Object.keys(document).some((key) => !PROJECT_DOCUMENT_SECTIONS.has(key))
    ) {
        return "unknown-section";
    }
    if (
        Buffer.byteLength(JSON.stringify(document), "utf8") >
        MAX_PROJECT_DOCUMENT_BYTES
    ) {
        return "too-large";
    }
    return inspectNesting(document, 0);
}

export const PROJECT_DOCUMENT_PROBLEM_MESSAGES: Record<
    ProjectDocumentProblem,
    string
> = {
    "not-object": "Проект повреждён: ожидался документ проекта.",
    "unsupported-version":
        "Версия проекта не поддерживается. Обновите страницу.",
    "unknown-section": "Проект содержит неизвестные данные. Обновите страницу.",
    "too-large": "Проект слишком большой: максимум 1 МБ.",
    "too-deep": "Проект повреждён: слишком глубокая вложенность данных.",
    "forbidden-key": "Проект содержит недопустимые данные.",
};
