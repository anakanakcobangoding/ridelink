import { expect, test } from "playwright/test";

test("navigation requests GPS by gesture and displays a normalized route from mocked provider data", async ({ browser }) => {
  const context = await browser.newContext({ permissions: ["geolocation"], geolocation: { longitude: 106.82, latitude: -6.17, accuracy: 12 } });
  const page = await context.newPage();
  await page.route("**/api/navigation/geocode?**", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ places: [{ id: "mock:destination", label: "Tujuan uji, Jakarta", coordinates: [106.822, -6.17] }] }) }));
  await page.route("**/api/navigation/route", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ route: {
    routeId: "test-route",
    geometry: { type: "LineString", coordinates: [[106.82, -6.17], [106.821, -6.17], [106.822, -6.17]] },
    distanceMeters: 220,
    durationSeconds: 60,
    steps: [
      { stepIndex: 0, distanceMeters: 0, durationSeconds: 0, maneuverType: "depart", maneuverLocation: [106.82, -6.17], instruction: "Mulai perjalanan", name: "" },
      { stepIndex: 1, distanceMeters: 110, durationSeconds: 30, maneuverType: "turn", maneuverModifier: "right", maneuverLocation: [106.821, -6.17], instruction: "Belok kanan", name: "" },
      { stepIndex: 2, distanceMeters: 110, durationSeconds: 30, maneuverType: "arrive", maneuverLocation: [106.822, -6.17], instruction: "Tiba di tujuan", name: "" },
    ],
    destination: { coordinates: [106.822, -6.17] },
  } }) }));
  try {
    const homeResponse = await page.goto("/");
    const headers = homeResponse.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["permissions-policy"]).toContain("microphone=(self)");
    await page.getByLabel("NAMA PANGGILAN").first().fill("Navigation Rider");
    await page.getByRole("button", { name: "Buat room" }).click();
    await expect(page.getByRole("heading", { name: "Rute & GPS" })).toBeVisible();
    await expect(page.locator(".navigation-map canvas.maplibregl-canvas")).toBeVisible();
    await page.getByRole("button", { name: "Aktifkan GPS" }).click();
    await expect(page.getByText("GPS aktif", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "TUJUAN" }).fill("Tujuan uji");
    await expect(page.getByRole("button", { name: "Tujuan uji, Jakarta" })).toBeVisible();
    await page.getByRole("button", { name: "Tujuan uji, Jakarta" }).click();
    await page.getByRole("button", { name: "Hitung rute" }).click();
    await expect(page.getByText("Belok kanan", { exact: true })).toBeVisible();
    await expect(page.getByText("220 meter total · 1 menit")).toBeVisible();
    await expect(page.getByText(/Akurasi ±12 m · baik/)).toBeVisible();
  } finally {
    await context.close();
  }
});
