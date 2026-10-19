import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isValidRightsEvidence } from "./image-rights-policy.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(projectRoot, "image-rights.manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const publicRoot = path.join(projectRoot, manifest.publicRoot);
const requireCleared = process.argv.includes("--require-cleared");

const walk = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(
        entries.map((entry) => {
            const entryPath = path.join(directory, entry.name);
            return entry.isDirectory() ? walk(entryPath) : [entryPath];
        }),
    );
    return files.flat();
};

// macOS can hand back NFD file names; git and Linux use NFC. Normalize so the
// digest is identical on every platform.
const normalizePath = (value) => value.split(path.sep).join("/").normalize("NFC");
const belongsToGroup = (relativePath, group) => {
    const inPath = relativePath === group.path || relativePath.startsWith(`${group.path}/`);
    const excluded = group.excludePrefixes.some(
        (prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`),
    );
    return inPath && !excluded;
};

const files = (await walk(publicRoot)).map((absolutePath) => ({
    absolutePath,
    relativePath: normalizePath(path.relative(publicRoot, absolutePath)),
}));
const failures = [];

for (const file of files) {
    const owners = manifest.groups.filter((group) => belongsToGroup(file.relativePath, group));
    if (owners.length !== 1) {
        failures.push(
            `${file.relativePath}: expected exactly one rights group, found ${owners.length}`,
        );
    }
}

for (const group of manifest.groups) {
    const groupFiles = files.filter((file) => belongsToGroup(file.relativePath, group));
    const digestLines = await Promise.all(
        groupFiles.map(async (file) => {
            const digest = createHash("sha256")
                .update(await readFile(file.absolutePath))
                .digest("hex");
            return `${file.relativePath}\0${digest}`;
        }),
    );
    const digest = createHash("sha256").update(digestLines.sort().join("\n")).digest("hex");

    if (groupFiles.length !== group.expectedFileCount) {
        failures.push(
            `${group.id}: expected ${group.expectedFileCount} files, found ${groupFiles.length}`,
        );
    }
    if (digest !== group.contentDigestSha256) {
        failures.push(
            `${group.id}: content digest changed (${digest}); review the files and update the manifest intentionally`,
        );
    }
    if (
        requireCleared &&
        (group.rightsStatus !== "cleared" || !isValidRightsEvidence(group.rightsEvidence))
    ) {
        failures.push(
            `${group.id}: publication rights are not cleared or evidence is not a stable HTTPS/internal record (${group.rightsStatus})`,
        );
    }

    console.log(
        `${group.id}: ${groupFiles.length} files, digest ${digest}, rights ${group.rightsStatus}`,
    );
}

if (files.length !== manifest.groups.reduce((sum, group) => sum + group.expectedFileCount, 0)) {
    failures.push(
        `manifest tracks ${manifest.groups.reduce((sum, group) => sum + group.expectedFileCount, 0)} files, public/images contains ${files.length}`,
    );
}

if (failures.length > 0) {
    console.error("\nImage rights gate failed:");
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
} else {
    console.log(
        requireCleared
            ? `\nImage rights release gate passed for ${files.length} files.`
            : `\nImage inventory is complete for ${files.length} files. Run with --require-cleared before publication.`,
    );
}
