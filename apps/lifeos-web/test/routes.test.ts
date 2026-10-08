import { describe, expect, it } from "vitest";
import { safeNotificationRoute } from "../src/routes.ts";

describe("safeNotificationRoute", () => {
  it("keeps navigation inside the allowlisted app routes", () => {
    expect(safeNotificationRoute("/tasks?task=task_42&external=https%3A%2F%2Fevil.test")).toBe(
      "/tasks?task=task_42",
    );
    expect(safeNotificationRoute("/settings?unexpected=value")).toBe("/settings");
    expect(safeNotificationRoute("/not-a-route")).toBe("/");
  });

  it("rejects external, script, ambiguous, and malformed destinations", () => {
    expect(safeNotificationRoute("https://evil.test/tasks?task=task_42")).toBe("/");
    expect(safeNotificationRoute("//evil.test/tasks")).toBe("/");
    expect(safeNotificationRoute("javascript:alert(1)")).toBe("/");
    expect(safeNotificationRoute("/tasks?task=one&task=two")).toBe("/tasks");
    expect(safeNotificationRoute("/tasks?task=%2F%2Fevil.test")).toBe("/tasks");
    expect(safeNotificationRoute("/" + "x".repeat(512))).toBe("/");
  });
});
