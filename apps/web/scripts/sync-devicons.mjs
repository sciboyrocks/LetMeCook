import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";

const ICONS = [
  "python", "javascript", "typescript", "react", "nextjs", "nodejs", "docker", "kubernetes",
  "postgresql", "mongodb", "redis", "go", "rust", "java", "cplusplus", "csharp", "ruby", "php",
  "swift", "kotlin", "flutter", "vuejs", "angularjs", "svelte", "tailwindcss", "graphql",
  "git", "github", "linux", "ubuntu", "bash", "nginx", "amazonwebservices", "googlecloud",
  "terraform", "vscode", "sqlite",
];

const VARIANTS = ["original", "plain", "original-wordmark", "plain-wordmark"];

const projectRoot = process.cwd();
const deviconRoot = resolve(projectRoot, "node_modules", "devicon", "icons");
const outputDir = resolve(projectRoot, "public", "devicons");

mkdirSync(outputDir, { recursive: true });

const missing = [];

for (const icon of ICONS) {
  let sourcePath;

  for (const variant of VARIANTS) {
    const candidate = resolve(deviconRoot, icon, `${icon}-${variant}.svg`);
    if (existsSync(candidate)) {
      sourcePath = candidate;
      break;
    }
  }

  if (!sourcePath) {
    missing.push(icon);
    continue;
  }

  const destPath = resolve(outputDir, `${icon}.svg`);
  copyFileSync(sourcePath, destPath);
}

if (missing.length > 0) {
  console.warn(`Missing icons (${missing.length}): ${missing.join(", ")}`);
}

console.log(`Synced ${ICONS.length - missing.length}/${ICONS.length} icons to public/devicons`);
