import { expect, test } from "playwright/test";

const routeResponse = { route: {
  routeId: "ducking-test-route",
  geometry: { type: "LineString", coordinates: [[106.82, -6.17], [106.821, -6.17], [106.822, -6.17]] },
  distanceMeters: 220,
  durationSeconds: 60,
  steps: [
    { stepIndex: 0, distanceMeters: 0, durationSeconds: 0, maneuverType: "depart", maneuverLocation: [106.82, -6.17], instruction: "Mulai perjalanan", name: "" },
    { stepIndex: 1, distanceMeters: 110, durationSeconds: 30, maneuverType: "turn", maneuverModifier: "right", maneuverLocation: [106.821, -6.17], instruction: "Belok kanan", name: "" },
    { stepIndex: 2, distanceMeters: 110, durationSeconds: 30, maneuverType: "arrive", maneuverLocation: [106.822, -6.17], instruction: "Tiba di tujuan", name: "" },
  ],
  destination: { coordinates: [106.822, -6.17] },
} };

async function meanMusicRms(page) {
  return page.locator("audio[aria-label='Musik bersama RideLink']").evaluate(async (audio) => {
    const mixer = audio.__ridelinkAudioDucking;
    if (!mixer?.measureOutputRms) return null;
    const readings = [];
    for (let index = 0; index < 8; index += 1) {
      readings.push(mixer.measureOutputRms());
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    return readings.reduce((total, value) => total + value, 0) / readings.length;
  });
}

test("navigation speech ducks only the local music signal while both riders remain connected", async ({ browser }) => {
  const contextA = await browser.newContext({ permissions: ["microphone", "geolocation"], geolocation: { longitude: 106.82, latitude: -6.17, accuracy: 12 } });
  const contextB = await browser.newContext({ permissions: ["microphone"] });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await pageB.addInitScript(() => {
    const nativePlay = HTMLMediaElement.prototype.play;
    window.__ridelinkMusicUnlocked = false;
    HTMLMediaElement.prototype.play = function playWithAutoplayGate(...args) {
      if (this.matches("audio[aria-label='Musik bersama RideLink']") && !window.__ridelinkMusicUnlocked) {
        return Promise.reject(new DOMException("Autoplay blocked by the test", "NotAllowedError"));
      }
      return nativePlay.apply(this, args);
    };
    document.addEventListener("click", (event) => {
      if (event.target.closest(".music-sync-status button")) window.__ridelinkMusicUnlocked = true;
    }, true);
  });
  await pageA.addInitScript(() => {
    class TestUtterance {
      constructor(text) { this.text = text; }
    }
    Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: TestUtterance });
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
      getVoices: () => [{ lang: "id-ID" }],
      cancel() {},
      speak(utterance) {
        window.__activeRideLinkUtterance = utterance;
        utterance.onstart?.();
      },
    } });
  });
  await pageA.route("**/api/navigation/geocode?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ places: [{ id: "mock:destination", label: "Tujuan uji, Jakarta", coordinates: [106.822, -6.17] }] }) }));
  await pageA.route("**/api/navigation/route", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(routeResponse) }));

  const audioA = pageA.locator("audio[aria-label='Musik bersama RideLink']");
  const audioB = pageB.locator("audio[aria-label='Musik bersama RideLink']");
  try {
    await pageA.goto("/");
    await pageA.getByLabel("NAMA PANGGILAN").first().fill("Duck A");
    await pageA.getByRole("button", { name: "Buat room" }).click();
    const code = await pageA.locator("#invite-room-code").inputValue();

    await pageB.goto("/");
    await pageB.locator("#join-nickname").fill("Duck B");
    await pageB.locator("#room-code").fill(code);
    await pageB.getByRole("button", { name: "Gabung room" }).click();
    await expect(pageB.getByRole("heading", { name: "Shared music" })).toBeVisible();
    await Promise.all([
      pageA.getByRole("button", { name: "Enable microphone" }).click(),
      pageB.getByRole("button", { name: "Enable microphone" }).click(),
    ]);
    await expect.poll(() => pageA.locator(".diagnostics-grid").getByText("connected").count()).toBeGreaterThan(0);
    await expect.poll(() => pageB.locator(".diagnostics-grid").getByText("connected").count()).toBeGreaterThan(0);

    await pageA.getByRole("button", { name: "Putar musik" }).click();
    await expect(pageB.getByRole("button", { name: "Aktifkan audio" })).toBeVisible();
    await pageB.getByRole("button", { name: "Aktifkan audio" }).click();
    await expect.poll(() => audioA.evaluate((audio) => !audio.paused && audio.currentTime > 0.5)).toBe(true);
    await expect.poll(() => audioB.evaluate((audio) => !audio.paused && audio.currentTime > 0.5)).toBe(true);
    await expect.poll(() => audioA.evaluate((audio) => Boolean(audio.__ridelinkAudioDucking?.measureOutputRms))).toBe(true);
    await expect.poll(() => audioB.evaluate((audio) => Boolean(audio.__ridelinkAudioDucking?.measureOutputRms))).toBe(true);
    const baselineRms = await meanMusicRms(pageA);
    const peerBaselineRms = await meanMusicRms(pageB);
    expect(baselineRms).toBeGreaterThan(0.001);
    expect(peerBaselineRms).toBeGreaterThan(0.001);

    await pageA.getByRole("button", { name: "Aktifkan GPS" }).click();
    await expect(pageA.getByText("GPS aktif", { exact: true })).toBeVisible();
    await pageA.getByRole("textbox", { name: "TUJUAN" }).fill("Tujuan uji");
    await pageA.getByRole("button", { name: "Tujuan uji, Jakarta" }).click();
    await pageA.getByRole("button", { name: "Hitung rute" }).click();
    await expect(pageA.getByRole("button", { name: "Ucapkan instruksi" })).toBeVisible();
    await pageA.getByRole("button", { name: "Ucapkan instruksi" }).click();
    await expect(pageA.locator(".music-ducking-state")).toHaveAttribute("data-ducking-state", "ducked");
    const [duckedRms, peerDuckedRms] = await Promise.all([meanMusicRms(pageA), meanMusicRms(pageB)]);
    expect(duckedRms).toBeLessThan(baselineRms * 0.45);
    expect(peerDuckedRms).toBeGreaterThan(peerBaselineRms * 0.8);
    await expect(pageA.getByRole("button", { name: "Jeda musik" })).toBeVisible();
    await expect(pageB.getByRole("button", { name: "Jeda musik" })).toBeVisible();

    await pageA.evaluate(() => window.__activeRideLinkUtterance.onend?.());
    await expect(pageA.locator(".music-ducking-state")).toHaveAttribute("data-ducking-state", "restoring");
    await expect.poll(() => audioA.evaluate((audio) => audio.__ridelinkAudioDucking?.audioContext.state === "running")).toBe(true);
    await expect.poll(() => audioA.evaluate((audio) => Number(audio.dataset.duckingGain) === 1), { timeout: 3000 }).toBe(true);
    await expect.poll(() => pageA.locator(".diagnostics-grid").getByText("connected").count()).toBeGreaterThan(0);
    await expect.poll(() => pageB.locator(".diagnostics-grid").getByText("connected").count()).toBeGreaterThan(0);
  } finally {
    await Promise.all([contextA.close(), contextB.close()]);
  }
});
