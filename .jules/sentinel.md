# Sentinel's Journal

## 2026-08-20 - Missing input validation in imported settings

**Vulnerability:** `applySettings()` accepted arbitrary JSON values from a user-uploaded file and assigned them directly to internal camera/shader state (e.g. `camera.fov`, radian rotation values) without validating they were finite numbers within the expected slider bounds.

**Learning:** The DOM slider clamping (`slider.value = x`) provides partial protection for display, but values flowing into Three.js (`camera.fov`, `degToRad`) bypass this — a non-finite number like `Infinity` or `NaN` would corrupt renderer state silently.

**Prevention:** Always validate external numeric input with `isFinite()` and explicit min/max clamping before applying to internal state. Never rely solely on DOM attribute clamping for security. Also, never surface raw `err.message` from JSON parsing in user-facing alerts — it can expose implementation details.
