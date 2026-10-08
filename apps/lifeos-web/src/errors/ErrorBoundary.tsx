// T037: renderöintivirheiden raja. Nappaa React-puun poikkeukset ja näyttää
// redaktoidun ErrorCardin raa'an kaatumisen sijaan (ei stackia käyttäjälle).
// - getDerivedStateFromError: redaktoi heti fromUnknownilla.
// - componentDidCatch: raportoi vain DEVissä (koodi+otsikko, ei bodya).
// - "Palaa alkuun" resetoi rajan; "Yritä uudelleen" yrittää renderiä uudelleen.
// - Raja ei niele tapahtumakäsittelijöiden/async-virheitä — ne kulkevat
//   edelleen ErrorCard-polun kautta kutsujassa (ei globaalia nielemistä).
import { t } from "../language.tsx";
import { Component } from "react";
import type { ReactNode } from "react";
import { Button } from "@lifeos/ui";
import { fromUnknown, reportError, type AppError } from "./appError.ts";
import { ErrorCard } from "./ErrorCard.tsx";

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly error: AppError | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: fromUnknown(error) };
  }

  componentDidCatch(error: unknown): void {
    reportError(fromUnknown(error));
  }

  private readonly resetToHome = (): void => {
    this.setState({ error: null });
    if (typeof window !== "undefined") {
      window.location.assign("/");
    }
  };

  private readonly retry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    return (
      <main>
        <ErrorCard error={error} onRetry={this.retry} />
        <p>
          <Button variant="secondary" onClick={this.resetToHome}>
            {t("Palaa alkuun")}
          </Button>
        </p>
      </main>
    );
  }
}
