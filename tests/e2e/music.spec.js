import { expect, test } from "playwright/test";

test("two riders hear synchronized demo playback with independent local volume alongside intercom", async ({ browser }) => {
  const contextA = await browser.newContext({ permissions: ["microphone"] });
  const contextB = await browser.newContext({ permissions: ["microphone"] });
  await contextB.addInitScript(() => {
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
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const audioA = () => pageA.locator("audio[aria-label='Musik bersama RideLink']");
  const audioB = () => pageB.locator("audio[aria-label='Musik bersama RideLink']");

  try {
    await pageA.goto("/");
    await pageA.getByLabel("NAMA PANGGILAN").first().fill("Musik A");
    await pageA.getByRole("button", { name: "Buat room" }).click();
    await expect(pageA.locator("#invite-room-code")).toBeVisible();
    const code = await pageA.locator("#invite-room-code").inputValue();

    await pageB.goto("/");
    await pageB.locator("#join-nickname").fill("Musik B");
    await pageB.locator("#room-code").fill(code);
    await pageB.getByRole("button", { name: "Gabung room" }).click();
    await expect(pageB.getByRole("heading", { name: "Shared music" })).toBeVisible();

    await Promise.all([
      pageA.getByRole("button", { name: "Enable microphone" }).click(),
      pageB.getByRole("button", { name: "Enable microphone" }).click(),
    ]);
    await expect.poll(() => pageA.locator(".diagnostics-grid").getByText("connected").count()).toBeGreaterThan(0);
    await expect.poll(() => pageB.locator(".diagnostics-grid").getByText("connected").count()).toBeGreaterThan(0);

    await expect(pageA.getByText("Open Road Loop", { exact: true }).first()).toBeVisible();
    await expect(pageB.getByText("Open Road Loop", { exact: true }).first()).toBeVisible();
    await pageA.getByRole("button", { name: "Putar musik" }).click();
    await expect(pageB.getByRole("button", { name: "Jeda musik" })).toBeVisible();
    await expect.poll(() => audioA().evaluate((audio) => !audio.paused && audio.currentTime > 0.5), { timeout: 20_000 }).toBe(true);
    await expect(pageB.getByText("Perlu sentuhan untuk memutar", { exact: true })).toBeVisible();
    await pageB.getByRole("button", { name: "Aktifkan audio" }).click();
    await expect.poll(() => audioB().evaluate((audio) => !audio.paused && audio.currentTime > 0.5), { timeout: 20_000 }).toBe(true);
    const synchronizedTimes = await Promise.all([
      audioA().evaluate((audio) => audio.currentTime),
      audioB().evaluate((audio) => audio.currentTime),
    ]);
    expect(Math.abs(synchronizedTimes[0] - synchronizedTimes[1])).toBeLessThan(2);

    const progress = pageA.getByRole("slider", { name: "Posisi lagu" });
    const bounds = await progress.boundingBox();
    await progress.click({ position: { x: bounds.width * 0.55, y: bounds.height / 2 } });
    await expect.poll(async () => {
      const [timeA, timeB] = await Promise.all([
        audioA().evaluate((audio) => audio.currentTime),
        audioB().evaluate((audio) => audio.currentTime),
      ]);
      return Math.abs(timeA - timeB);
    }, { timeout: 10_000 }).toBeLessThan(2);
    expect(await audioA().evaluate((audio) => audio.currentTime)).toBeGreaterThan(6);
    expect(await audioB().evaluate((audio) => audio.currentTime)).toBeGreaterThan(6);

    await audioA().evaluate((audio) => audio.dispatchEvent(new Event("waiting")));
    await expect(pageA.getByText("Memuat audio", { exact: true })).toBeVisible();
    await audioA().evaluate((audio) => audio.dispatchEvent(new Event("playing")));
    await expect(pageA.getByText("Tersinkron", { exact: true })).toBeVisible();

    await pageA.getByRole("button", { name: "Track berikutnya" }).click();
    await expect(pageB.getByText("Coastal Miles", { exact: true }).first()).toBeVisible();
    await expect(pageB.getByRole("button", { name: "Jeda musik" })).toBeVisible();
    await pageB.getByRole("button", { name: "Track sebelumnya" }).click();
    await expect(pageA.getByText("Open Road Loop", { exact: true }).first()).toBeVisible();

    await pageB.getByRole("button", { name: "Mute musik lokal" }).click();
    await expect.poll(() => audioB().evaluate((audio) => audio.__ridelinkAudioDucking?.muted)).toBe(true);
    expect(await audioA().evaluate((audio) => audio.__ridelinkAudioDucking?.muted)).toBe(false);
    await pageB.getByRole("button", { name: "Aktifkan musik lokal" }).click();
    await expect.poll(() => audioB().evaluate((audio) => audio.__ridelinkAudioDucking?.muted)).toBe(false);
    const localVolumeA = pageA.getByRole("slider", { name: "Volume lokal" });
    const localVolumeB = pageB.getByRole("slider", { name: "Volume lokal" });
    await localVolumeB.focus();
    await localVolumeB.press("End");
    await expect.poll(() => audioB().evaluate((audio) => audio.__ridelinkAudioDucking?.userGainNode.gain.value)).toBe(1);
    expect(await audioA().evaluate((audio) => audio.__ridelinkAudioDucking?.userGainNode.gain.value)).toBeCloseTo(0.65, 5);
    await localVolumeB.press("Home");
    await expect.poll(() => audioB().evaluate((audio) => audio.__ridelinkAudioDucking?.userGainNode.gain.value)).toBe(0);
    expect(await localVolumeA.evaluate((slider) => Number(slider.value))).toBe(0.65);
    await localVolumeB.press("End");

    await expect.poll(() => pageA.locator(".diagnostics-grid").getByText("connected").count()).toBeGreaterThan(0);
    await expect.poll(() => pageB.locator(".diagnostics-grid").getByText("connected").count()).toBeGreaterThan(0);
    await pageB.getByRole("button", { name: "Jeda musik" }).click();
    await expect.poll(() => audioA().evaluate((audio) => audio.paused)).toBe(true);
    await expect.poll(() => audioB().evaluate((audio) => audio.paused)).toBe(true);

    await audioA().evaluate((audio) => { window.__removedMusicAudio = audio; });
    await audioB().evaluate((audio) => { window.__removedMusicAudio = audio; });
    await pageB.getByRole("button", { name: "Keluar dari room" }).click();
    await expect(pageB).toHaveURL(/\/$/);
    await expect.poll(() => pageB.evaluate(() => window.__removedMusicAudio.getAttribute("src") === null && window.__removedMusicAudio.paused)).toBe(true);
    await pageA.getByRole("button", { name: "Keluar dari room" }).click();
    await expect(pageA).toHaveURL(/\/$/);
    await expect.poll(() => pageA.evaluate(() => window.__removedMusicAudio.getAttribute("src") === null && window.__removedMusicAudio.paused)).toBe(true);
  } finally {
    await Promise.all([contextA.close(), contextB.close()]);
  }
});
