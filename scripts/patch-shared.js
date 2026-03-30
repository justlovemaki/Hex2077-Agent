import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const sharedDir = path.join(root, "node_modules", "@openclaw-china", "shared");

if (!fs.existsSync(sharedDir)) {
  console.log("@openclaw-china/shared not found, skipping patch.");
  process.exit(0);
}

// 1. Patch package.json
const pkgPath = path.join(sharedDir, "package.json");
if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  pkg.exports = {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  console.log("Patched shared/package.json");
}

// 2. Patch tsconfig.json
const tsconfigPath = path.join(sharedDir, "tsconfig.json");
const tsconfig = {
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "rootDir": "src",
    "downlevelIteration": true
  },
  "include": ["src"],
  "exclude": ["**/*.test.ts"]
};
fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
console.log("Patched shared/tsconfig.json");

// 3. Patch tencent-flash.ts (fix type error)
const tencentFlashPath = path.join(sharedDir, "src", "asr", "tencent-flash.ts");
if (fs.existsSync(tencentFlashPath)) {
  let content = fs.readFileSync(tencentFlashPath, "utf-8");
  content = content.replace(/body: audio,/g, "body: audio as any,");
  fs.writeFileSync(tencentFlashPath, content);
  console.log("Patched shared/src/asr/tencent-flash.ts");
}

// 4. Compile
console.log("Compiling @openclaw-china/shared...");
try {
  execSync("npx tsc -p .", { cwd: sharedDir, stdio: "inherit" });
  console.log("Successfully compiled @openclaw-china/shared");
} catch (error) {
  console.error("Failed to compile @openclaw-china/shared:", error.message);
}
