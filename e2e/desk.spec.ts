import { expect, test } from "@playwright/test";

test("demo crew publishes a cited brief", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Agent Crew" })).toBeVisible();
  await expect(page.getByTestId("mode-badge")).toContainText(/demo/i);
  await page.getByRole("button", { name: /shared blackboard/i }).click();
  await page.getByRole("button", { name: "Run the crew" }).click();
  await expect(page.getByTestId("lane-planner")).toContainText(/reducer|search|handoff/i);
  await expect(page.getByTestId("lane-researcher")).toContainText(/fixture-corpus|shared blackboard|source/i);
  await expect(page.getByTestId("lane-critic")).toContainText(/citation|revision|approve|reject/i);
  const report = page.getByTestId("report");
  await expect(report).toContainText(/reducer|blackboard/i);
  await expect(page.getByTestId("sources").locator("a").first()).toBeVisible();
  await expect(report).toContainText(/demo-scripted/i);
});

test("mobile layout keeps the assignment, saved runs, and the lanes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Assignment" })).toBeVisible();
  await expect(page.getByTestId("saved-runs")).toBeVisible();
  await expect(page.getByTestId("saved-empty")).toBeVisible();
  await expect(page.getByTestId("lane-critic")).toBeVisible();
  await expect(page.getByTestId("report")).toContainText(/critic signs off/i);
});

test("a finished demo run reopens after refresh and stays labeled demo", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("archive-note")).toContainText(/this browser/i);
  await expect(page.getByTestId("archive-note")).not.toContainText(/mongodb/i);
  await expect(page.getByTestId("saved-empty")).toBeVisible();
  await page.getByRole("button", { name: /shared blackboard/i }).click();
  await page.getByRole("button", { name: "Run the crew" }).click();
  await expect(page.getByTestId("report")).toContainText(/reducer|blackboard/i);
  const saved = page.getByTestId("saved-run").first();
  await expect(saved).toContainText(/demo/i);
  await expect(saved).toContainText(/scripted/i);
  await page.reload();
  await expect(page.getByTestId("mode-badge")).toContainText(/demo/i);
  await expect(page.getByTestId("saved-run").first()).toContainText(/scripted/i);
  await page.getByTestId("saved-run").first().click();
  await expect(page.getByTestId("reopened-run")).toContainText(/demo/i);
  await expect(page.getByTestId("reopened-run")).toContainText(/groq/i);
  await expect(page.getByTestId("report")).toContainText(/demo-scripted/i);
  await expect(page.getByTestId("lane-researcher")).toContainText(/fixture-corpus|shared blackboard|source/i);
  await expect(page.getByTestId("sources").locator("a").first()).toBeVisible();
});
