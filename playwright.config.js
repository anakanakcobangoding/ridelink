import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3100",
    browserName: "chromium",
    headless: true,
    launchOptions: {
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
    },
    permissions: ["microphone"],
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "SIGNALING_PORT=4100 SIGNALING_CORS_ORIGIN=http://localhost:3100 npm run dev:signaling",
      url: "http://127.0.0.1:4100/health",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "RIDELINK_DIST_DIR=.next-e2e NEXT_PUBLIC_SIGNALING_URL=http://localhost:4100 npm run dev --workspace @ridelink/web -- --hostname 127.0.0.1 --port 3100",
      url: "http://127.0.0.1:3100",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
