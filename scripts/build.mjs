import { mkdir, copyFile, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(rootDir, "..");
const distDir = path.join(projectRoot, "dist");
const isWatch = process.argv.includes("--watch");

async function ensureDist() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(path.join(distDir, "background"), { recursive: true });
  await mkdir(path.join(distDir, "content"), { recursive: true });
  await mkdir(path.join(distDir, "app"), { recursive: true });
  await mkdir(path.join(distDir, "assets"), { recursive: true });
}

async function copyStaticFiles() {
  await copyFile(path.join(projectRoot, "src", "app", "app.html"), path.join(distDir, "app", "app.html"));
  await copyFile(path.join(projectRoot, "src", "app", "app.css"), path.join(distDir, "app", "app.css"));

  const assetFiles = await readdir(path.join(projectRoot, "assets"));
  for (const fileName of assetFiles) {
    if (fileName === ".gitkeep") {
      continue;
    }

    await copyFile(path.join(projectRoot, "assets", fileName), path.join(distDir, "assets", fileName));
  }
}

async function buildOnce() {
  await ensureDist();

  await esbuild.build({
    entryPoints: {
      "background/service-worker": path.join(projectRoot, "src", "background", "service-worker.js"),
      "content/usps-content": path.join(projectRoot, "src", "content", "usps-content.js"),
      "app/app": path.join(projectRoot, "src", "app", "app.js")
    },
    outdir: distDir,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["chrome120"],
    sourcemap: true,
    logLevel: "info"
  });

  await copyStaticFiles();
}

if (isWatch) {
  const ctx = await esbuild.context({
    entryPoints: {
      "background/service-worker": path.join(projectRoot, "src", "background", "service-worker.js"),
      "content/usps-content": path.join(projectRoot, "src", "content", "usps-content.js"),
      "app/app": path.join(projectRoot, "src", "app", "app.js")
    },
    outdir: distDir,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["chrome120"],
    sourcemap: true,
    logLevel: "info"
  });

  await ensureDist();
  await ctx.watch();
  await copyStaticFiles();
  console.log("Watching for changes...");
} else {
  await buildOnce();
}
