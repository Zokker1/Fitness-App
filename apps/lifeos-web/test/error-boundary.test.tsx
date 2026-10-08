// T037: ErrorCard + ErrorBoundary -testit (happy-dom).
// - Kortti: rooli tason mukaan, retry-nappi vain kun onRetry, koodi näkyy.
// - Raja: kaatunut lapsi -> redaktoitu kortti (ei stackia/PII:tä näkyvissä);
//   retry palauttaa; Palaa alkuun ohjaa "/".
// HUOM: jokainen render unmountataan (RTL cleanup on pois päältä tässä
// projektissa) — muuten kortit kasaantuvat samaan documenttiin.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorCard } from "../src/errors/ErrorCard.tsx";
import { ErrorBoundary } from "../src/errors/ErrorBoundary.tsx";

const WARNING = {
  title: "Tarkista syöte",
  body: "Otsikko ei saa olla tyhjä.",
  actionLabel: null as string | null,
  diagnosticCode: "data.task.validation.empty-title",
  level: "warning" as const,
};

const RETRYABLE = {
  title: "Jokin epäonnistui",
  body: "Yritä uudelleen.",
  actionLabel: "Yritä uudelleen",
  diagnosticCode: "db.request.timeout",
  level: "error" as const,
};

describe("ErrorCard", () => {
  it("warning -> role=status, ei retry-nappia ilman handleria", () => {
    const view = render(<ErrorCard error={WARNING} />);
    try {
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.getByTestId("error-diagnostic-code")).toHaveTextContent(
        "data.task.validation.empty-title",
      );
    } finally {
      view.unmount();
    }
  });

  it("error + onRetry -> role=alert ja nappi kutsuu handleria", () => {
    const onRetry = vi.fn();
    const view = render(<ErrorCard error={RETRYABLE} onRetry={onRetry} />);
    try {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      const button = screen.getByRole("button", { name: "Yritä uudelleen" });
      button.click();
      expect(onRetry).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
    }
  });

  it("actionLabel ilman handleria ei renderöi nappia", () => {
    const view = render(<ErrorCard error={RETRYABLE} />);
    try {
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    } finally {
      view.unmount();
    }
  });

  it("focus siirtyy otsikkoon (a11y §31)", () => {
    const view = render(<ErrorCard error={RETRYABLE} onRetry={() => undefined} />);
    try {
      expect(screen.getByRole("heading", { name: "Jokin epäonnistui" })).toHaveFocus();
    } finally {
      view.unmount();
    }
  });
});

function Boom({ secret }: { readonly secret: string }): React.JSX.Element {
  throw new Error(secret);
}

describe("ErrorBoundary", () => {
  it("redaktoi kaatumisen: ei stackia/PII:tä, koodi näkyy", () => {
    const secret = "Bearer abcdefghijklmnop user@example.com";
    const view = render(
      <ErrorBoundary>
        <Boom secret={secret} />
      </ErrorBoundary>,
    );
    try {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(view.container.textContent).not.toContain("Bearer");
      expect(view.container.textContent).not.toContain("user@example.com");
      expect(screen.getByTestId("error-diagnostic-code")).toHaveTextContent("app.unknown");
    } finally {
      view.unmount();
    }
  });

  it("Yritä uudelleen palauttaa lapset", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    let shouldThrow = true;
    function Flaky(): React.JSX.Element {
      if (shouldThrow) {
        const error = new Error("boom");
        error.name = "FlakyError";
        throw error;
      }
      return <p>toipunut</p>;
    }
    const view = render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );
    try {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      shouldThrow = false;
      const user = userEvent.setup();
      // userEvent awaitaa Reactin tilapäivityksen (act) — sync-click ei tee sitä.
      await user.click(screen.getByRole("button", { name: "Yritä uudelleen" }));
      expect(screen.getByText("toipunut")).toBeInTheDocument();
    } finally {
      view.unmount();
    }
  });
});
