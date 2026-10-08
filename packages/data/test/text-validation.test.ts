import { describe, expect, it } from "vitest";
import { hasControlCharacters } from "../src/text-validation.ts";

describe("stored text control-character validation", () => {
  it.each(["\u0000", "\t", "\n", "\u001f", "\u007f", "\u0085", "\u009f"])(
    "rejects control characters inside otherwise valid text: %j",
    (character) => {
      expect(hasControlCharacters(`before${character}after`)).toBe(true);
    },
  );

  it.each(["", " \u007e\u00a0", "Ää Öö · Café 🏃"])(
    "allows printable Unicode text: %j",
    (value) => {
      expect(hasControlCharacters(value)).toBe(false);
    },
  );
});
