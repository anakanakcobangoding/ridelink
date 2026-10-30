# RideLink navigation manual test guide

Test only while the motorcycle is stopped and parked safely. Do not operate the screen while riding. Use HTTPS on physical iPhones; localhost is not a valid substitute for production geolocation behavior.

## iPhone Safari checklist

1. Configure a MapTiler browser key with the test HTTPS origin allowlisted and a server-only ORS key. Confirm the provider dashboard has quota available.
2. On one iPhone, open the RideLink room in Safari and tap **Aktifkan GPS**. Accept location permission and check the displayed accuracy.
3. Search for a destination and select a result, or tap a point on the map. Tap **Hitung rute** and confirm the route geometry, distance, duration, and next turn appear.
4. Confirm spoken prompts are understandable. A system voice matching `id-ID` is device-dependent; use the visible instruction if no suitable voice exists.
5. Walk a short, safe route with the device carried outdoors (not in a moving vehicle) and check route progress, arrival, and rerouting only after sustained deviation. Observe that location remains local to that device.
6. Repeat with a second room participant. Confirm each device independently grants location and receives its own route/progress; no coordinates appear in room events.
7. While parked, test Safari background and locked screen, then return to Safari. GPS tracking and speech can pause/suspend in iOS background; RideLink does not promise continuous tracking or guidance there.
8. Test without MapTiler key and without ORS key. The mock map should still allow selecting a point; geocoding/routing should report configuration is missing rather than imply a live route.

Record iOS version, Safari version, headset/Bluetooth state, provider key origin restrictions, approximate GPS accuracy, selected voice, and whether background/lock interrupted tracking. No physical iPhone has been tested as part of this implementation.
