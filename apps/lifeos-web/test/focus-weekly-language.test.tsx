import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FocusSession } from "@lifeos/domain";
import { LanguageSelector } from "../src/LanguageSelector.tsx";
import { FocusWeeklyStats } from "../src/views/focus/FocusWeeklyStats.tsx";
import { render } from "./renderWithLanguage.tsx";

afterEach(() => {
  cleanup();
  localStorage.removeItem("lifeos.language.v1");
});

it("refreshes memoized weekday labels when switching language with unchanged sessions", async () => {
  localStorage.removeItem("lifeos.language.v1");
  const sessions: readonly FocusSession[] = [];
  const user = userEvent.setup();
  render(
    <>
      <LanguageSelector />
      <FocusWeeklyStats sessions={sessions} />
    </>,
  );

  expect(screen.getByRole("listitem", { name: /Maanantai/ })).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "EN" }));
  expect(screen.getByRole("listitem", { name: /Monday/ })).toBeInTheDocument();
  expect(screen.queryByRole("listitem", { name: /Maanantai/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "FI" }));
  expect(screen.getByRole("listitem", { name: /Maanantai/ })).toBeInTheDocument();
});
