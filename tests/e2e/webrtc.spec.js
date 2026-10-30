import { expect, test } from "playwright/test";

async function installMediaInstrumentation(context) {
  await context.addInitScript(() => {
    window.__ridelinkPeerConnections = [];
    window.__ridelinkLocalStreams = [];
    const PeerConnection = window.RTCPeerConnection;
    window.RTCPeerConnection = new Proxy(PeerConnection, {
      construct(target, args) {
        const pc = Reflect.construct(target, args);
        window.__ridelinkPeerConnections.push(pc);
        return pc;
      },
    });
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await getUserMedia(...args);
      window.__ridelinkLocalStreams.push(stream);
      return stream;
    };
  });
}

async function readDiagnostics(page) {
  return page.locator(".diagnostics-grid").evaluate((grid) => {
    const values = {};
    for (const item of grid.querySelectorAll("div")) {
      values[item.querySelector("dt")?.textContent] = item.querySelector("dd")?.textContent;
    }
    return values;
  });
}

async function readAudioBytes(page, direction) {
  return page.evaluate(async (mediaDirection) => {
    let total = 0;
    for (const pc of window.__ridelinkPeerConnections) {
      const stats = await pc.getStats();
      for (const report of stats.values()) {
        const kind = report.kind ?? report.mediaType;
        if (kind === "audio" && report.type === (mediaDirection === "incoming" ? "inbound-rtp" : "outbound-rtp")) {
          total += mediaDirection === "incoming" ? report.bytesReceived ?? 0 : report.bytesSent ?? 0;
        }
      }
    }
    return total;
  }, direction);
}

test("two browser participants exchange audio, mute, and clean up after leave", async ({ browser }) => {
  const contextA = await browser.newContext({ permissions: ["microphone"] });
  const contextB = await browser.newContext({ permissions: ["microphone"] });
  await Promise.all([installMediaInstrumentation(contextA), installMediaInstrumentation(contextB)]);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await pageA.goto("/");
    await pageA.getByLabel("NAMA PANGGILAN").first().fill("Rider A");
    await pageA.getByRole("button", { name: "Buat room" }).click();
    await expect(pageA.locator("#invite-room-code")).toBeVisible();
    const roomCode = await pageA.locator("#invite-room-code").inputValue();

    await pageB.goto("/");
    await pageB.locator("#join-nickname").fill("Rider B");
    await pageB.locator("#room-code").fill(roomCode);
    await pageB.getByRole("button", { name: "Gabung room" }).click();
    await expect(pageB.locator("#invite-room-code")).toBeVisible();
    await expect(pageA.getByText("ROOM PENUH", { exact: true })).toBeVisible();

    await Promise.all([
      pageA.getByRole("button", { name: "Enable microphone" }).click(),
      pageB.getByRole("button", { name: "Enable microphone" }).click(),
    ]);

    await expect.poll(async () => (await readDiagnostics(pageA))["Peer"], { timeout: 30_000 }).toBe("connected");
    await expect.poll(async () => (await readDiagnostics(pageB))["Peer"], { timeout: 30_000 }).toBe("connected");
    await pageA.waitForFunction(() => window.__ridelinkPeerConnections.some((pc) => pc.getReceivers().some((receiver) => receiver.track.kind === "audio" && receiver.track.readyState === "live")));
    await pageB.waitForFunction(() => window.__ridelinkPeerConnections.some((pc) => pc.getReceivers().some((receiver) => receiver.track.kind === "audio" && receiver.track.readyState === "live")));
    await expect.poll(() => pageA.locator("audio[aria-label='Suara rider lain']").evaluate((audio) => !audio.paused && audio.srcObject?.getAudioTracks().some((track) => track.readyState === "live"))).toBe(true);
    await expect.poll(() => pageB.locator("audio[aria-label='Suara rider lain']").evaluate((audio) => !audio.paused && audio.srcObject?.getAudioTracks().some((track) => track.readyState === "live"))).toBe(true);
    await expect.poll(() => readAudioBytes(pageA, "incoming"), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect.poll(() => readAudioBytes(pageB, "incoming"), { timeout: 20_000 }).toBeGreaterThan(0);

    await expect.poll(async () => (await readDiagnostics(pageA))["Pasangan ICE"], { timeout: 10_000 }).toMatch(/direct|relay/);
    await expect.poll(async () => (await readDiagnostics(pageB))["Pasangan ICE"], { timeout: 10_000 }).toMatch(/direct|relay/);
    await expect.poll(() => readAudioBytes(pageA, "outgoing"), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect.poll(() => readAudioBytes(pageB, "outgoing"), { timeout: 20_000 }).toBeGreaterThan(0);
    const connectedA = await readDiagnostics(pageA);
    const connectedB = await readDiagnostics(pageB);
    expect(connectedA.ICE).toMatch(/connected|completed/);
    expect(connectedB.ICE).toMatch(/connected|completed/);
    expect(connectedA["Pasangan ICE"]).toMatch(/direct|relay/);
    expect(connectedB["Pasangan ICE"]).toMatch(/direct|relay/);

    const muteButtonA = pageA.getByRole("button", { name: "Mute microphone" });
    await muteButtonA.click();
    await expect(pageA.getByRole("button", { name: "Unmute microphone" })).toBeVisible();
    await expect.poll(async () => (await readDiagnostics(pageA))["Track lokal"]).toContain("muted");
    await pageA.getByRole("button", { name: "Unmute microphone" }).click();
    await expect(pageA.getByRole("button", { name: "Mute microphone" })).toBeVisible();
    await expect.poll(async () => (await readDiagnostics(pageA))["Track lokal"]).toContain("enabled");

    const beforeLeave = await pageB.evaluate(() => ({
      peerCount: window.__ridelinkPeerConnections.length,
      localTrackCount: window.__ridelinkLocalStreams[0]?.getAudioTracks().length ?? 0,
    }));
    expect(beforeLeave.peerCount).toBeGreaterThan(0);
    expect(beforeLeave.localTrackCount).toBeGreaterThan(0);
    await pageB.getByRole("button", { name: /Keluar dari room/ }).click();
    await expect(pageB).toHaveURL(/\/$/);
    await expect.poll(() => pageB.evaluate(() => window.__ridelinkPeerConnections.every((pc) => pc.connectionState === "closed"))).toBe(true);
    await expect.poll(() => pageB.evaluate(() => window.__ridelinkLocalStreams.every((stream) => stream.getTracks().every((track) => track.readyState === "ended")))).toBe(true);
    await expect(pageA.getByText("MENUNGGU RIDER", { exact: true })).toBeVisible();
    await expect.poll(() => pageA.evaluate(() => window.__ridelinkPeerConnections.every((pc) => pc.connectionState === "closed"))).toBe(true);
    await expect.poll(() => pageA.evaluate(() => window.__ridelinkLocalStreams.every((stream) => stream.getTracks().every((track) => track.readyState === "ended")))).toBe(true);
    await expect.poll(() => pageA.locator("audio[aria-label='Suara rider lain']").evaluate((audio) => audio.srcObject === null)).toBe(true);

    const cleanupB = await pageB.evaluate(() => ({
      peersClosed: window.__ridelinkPeerConnections.every((pc) => pc.connectionState === "closed"),
      localTracksEnded: window.__ridelinkLocalStreams.every((stream) => stream.getTracks().every((track) => track.readyState === "ended")),
    }));
    console.log("WEBRTC_E2E_METRICS", JSON.stringify({ connectedA, connectedB, beforeLeave, cleanupB }));
  } finally {
    await Promise.all([contextA.close(), contextB.close()]);
  }
});
