import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = process.cwd();
const standaloneRoot = path.join(projectRoot, ".next", "standalone");

const readArgument = (name, fallback) => {
    const index = process.argv.indexOf(name);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const copyIfPresent = async (source, destination) => {
    try {
        await access(source);
    } catch {
        return;
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true, force: true });
};

await copyIfPresent(path.join(projectRoot, "public"), path.join(standaloneRoot, "public"));
await copyIfPresent(
    path.join(projectRoot, ".next", "static"),
    path.join(standaloneRoot, ".next", "static"),
);

process.env.HOSTNAME = readArgument("--hostname", process.env.HOSTNAME ?? "127.0.0.1");
process.env.PORT = readArgument("--port", process.env.PORT ?? "3000");

await import(pathToFileURL(path.join(standaloneRoot, "server.js")).href);
