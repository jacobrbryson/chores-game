import { spawn } from "node:child_process";

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const args = ["expo", "start", "--offline", "--go", ...process.argv.slice(2)];

const child = spawn(command, args, {
  env: {
    ...process.env,
    EXPO_NO_REDIRECT_PAGE: "1",
  },
  shell: process.platform === "win32",
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
