import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { BodyGraphScene } from "@hdhub/bodygraph-3d";
import { humanDesignData } from "../data/humanDesignData";

interface ZoomPanControls {
  enableZoom: boolean;
  enablePan: boolean;
}

function supportsZoomAndPan(value: unknown): value is ZoomPanControls {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<Record<keyof ZoomPanControls, unknown>>;
  return (
    typeof candidate.enableZoom === "boolean" &&
    typeof candidate.enablePan === "boolean"
  );
}

function DisableZoomAndPan() {
  const controls = useThree((state) => state.controls);

  useEffect(() => {
    if (!supportsZoomAndPan(controls)) return;

    controls.enableZoom = false;
    controls.enablePan = false;
  }, [controls]);

  return null;
}

export default function BodyGraphWrapper() {
  const cleanupRef = useRef<null | (() => void)>(null);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  return (
    <div data-bodygraph-leaf style={{ width: "100%", height: "100%" }}>
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
            el.removeEventListener("wheel", stopWheel, true);
            el.removeEventListener("touchstart", stopMultiTouch, true);
            el.removeEventListener("touchmove", stopMultiTouch, true);
            el.removeEventListener("pointerdown", stopPanMouseButtons, true);
            el.removeEventListener("contextmenu", stopContextMenu);
          };
        }}
      >
        <BodyGraphScene data={humanDesignData} />
        <DisableZoomAndPan />
      </Canvas>
    </div>
  );
}
