import type { ReactElement } from "react";
import { render as testingLibraryRender, type RenderOptions } from "@testing-library/react";
import { LanguageProvider } from "../src/language.tsx";

export function render(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return testingLibraryRender(ui, { wrapper: LanguageProvider, ...options });
}
