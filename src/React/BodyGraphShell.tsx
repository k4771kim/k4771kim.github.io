import { lazy, Suspense, useEffect, useState } from "react";

const LazyBodyGraph = lazy(() => import("./BodyGraphWrapper"));

function BodyGraphPlaceholder() {
  return (
    <div
      data-bodygraph-placeholder
      aria-hidden="true"
      style={{ width: "100%", height: "100%" }}
    />
  );
}

export default function BodyGraphShell() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div
      data-bodygraph-shell
      role="img"
      aria-label="Human Design BodyGraph 3D visualization"
      style={{ width: "100%", height: "100%" }}
    >
      {mounted ? (
        <Suspense fallback={<BodyGraphPlaceholder />}>
          <LazyBodyGraph />
        </Suspense>
      ) : (
        <BodyGraphPlaceholder />
      )}
    </div>
  );
}
