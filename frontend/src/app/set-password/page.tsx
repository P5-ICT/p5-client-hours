import { Suspense } from "react";
import { SetPasswordView } from "@/components/views/auth-views";

export default function Page() {
  // useSearchParams needs a Suspense boundary when the page is built ahead of time.
  return (
    <Suspense fallback={null}>
      <SetPasswordView />
    </Suspense>
  );
}
