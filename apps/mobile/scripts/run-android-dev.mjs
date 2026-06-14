import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

const knownJdks = [
  process.env.JAVA_HOME,
  "C:\\Program Files\\Microsoft\\jdk-17.0.19.10-hotspot",
  "C:\\Program Files\\Android\\Android Studio\\jbr",
  "C:\\Program Files\\Android\\Android Studio\\jre",
].filter(Boolean);

const javaHome = knownJdks.find((path) => existsSync(`${path}\\bin\\java.exe`));
const androidSdkRoot =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  `${process.env.LOCALAPPDATA}\\Android\\Sdk`;

if (!javaHome) {
  console.error("Could not find a local JDK. Install JDK 17 or Android Studio, then retry.");
  process.exit(1);
}

if (!existsSync(`${androidSdkRoot}\\platform-tools\\adb.exe`)) {
  console.error(`Could not find adb at ${androidSdkRoot}\\platform-tools\\adb.exe.`);
  console.error("Install Android SDK Platform-Tools from Android Studio, then retry.");
  process.exit(1);
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const args = ["expo", "run:android", ...process.argv.slice(2)];

const child = spawn(command, args, {
  env: {
    ...process.env,
    ANDROID_HOME: androidSdkRoot,
    ANDROID_SDK_ROOT: androidSdkRoot,
    JAVA_HOME: javaHome,
    PATH: `${javaHome}\\bin;${androidSdkRoot}\\platform-tools;${process.env.PATH ?? ""}`,
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
