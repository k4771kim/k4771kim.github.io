import { Canvas, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useRef } from "react";
import { BodyGraphScene } from "@hdhub/bodygraph-3d";

interface BodyGraphWrapperProps {
  data: any;
}

function DisableZoomAndPan() {
  const controls = useThree((state) => state.controls as any);

  useEffect(() => {
    if (!controls) return;

    controls.enableZoom = false;
    controls.enablePan = false;
  }, [controls]);

  return null;
}

export default function BodyGraphWrapper({ data }: BodyGraphWrapperProps) {
  const cleanupRef = useRef<null | (() => void)>(null);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  return (
    <Canvas
      style={{ width: "100%", height: "100%" }}
      dpr={[1, 1.5]}
      camera={{ position: [3, 3, 3], fov: 45 }}
      onCreated={({ gl }) => {
        cleanupRef.current?.();
        const el = gl.domElement;

        const stopWheel = (e: WheelEvent) => {
          e.stopImmediatePropagation();
        };

        const stopMultiTouch = (e: TouchEvent) => {
          if (e.touches.length >= 2) {
            e.stopImmediatePropagation();
          }
        };

        const stopPanMouseButtons = (e: PointerEvent) => {
          if (e.button === 1 || e.button === 2) {
            e.stopImmediatePropagation();
          }
        };

        const stopContextMenu = (e: MouseEvent) => {
          e.preventDefault();
        };

        el.addEventListener("wheel", stopWheel, { capture: true, passive: false });
        el.addEventListener("touchstart", stopMultiTouch, { capture: true, passive: false });
        el.addEventListener("touchmove", stopMultiTouch, { capture: true, passive: false });
        el.addEventListener("pointerdown", stopPanMouseButtons, { capture: true, passive: false });
        el.addEventListener("contextmenu", stopContextMenu, { passive: false });

        cleanupRef.current = () => {
          el.removeEventListener("wheel", stopWheel, { capture: true } as EventListenerOptions);
          el.removeEventListener("touchstart", stopMultiTouch, { capture: true } as EventListenerOptions);
          el.removeEventListener("touchmove", stopMultiTouch, { capture: true } as EventListenerOptions);
          el.removeEventListener("pointerdown", stopPanMouseButtons, { capture: true } as EventListenerOptions);
          el.removeEventListener("contextmenu", stopContextMenu);
        };
      }}
    >
      <Suspense fallback={null}>
        <BodyGraphScene data={data} />
      </Suspense>
      <DisableZoomAndPan />
    </Canvas>
  );
}
