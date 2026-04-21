import { Providers } from "./providers";
import { Router } from "./router";
import { RootErrorBoundary } from "@/features/errors/GenericErrorPage";

export function App() {
  return (
    <RootErrorBoundary>
      <Providers>
        <Router />
      </Providers>
    </RootErrorBoundary>
  );
}
